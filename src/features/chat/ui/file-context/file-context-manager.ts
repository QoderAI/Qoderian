import type { App, EventRef } from 'obsidian';
import { Notice, setIcon, TFile } from 'obsidian';

import {
  createExternalContextLookupGetter,
  isMentionStart,
  resolveExternalMentionAtIndex,
} from '../../../../core/context/context-mention-resolver';
import { buildExternalContextDisplayEntries } from '../../../../core/context/external-context';
import {
  type ExternalContextFile,
  externalContextScanner,
} from '../../../../core/context/external-context-scanner';
import { getVaultPath, normalizePathForVault as normalizePathForVaultUtil } from '../../../../core/fs/path';
import type { AgentMentionIndex } from '../../../../core/types/services';
import type { McpServerManager } from '../../../../qoder/mcp/mcp-server-manager';
import { appendMcpIcon } from '../../../../shared/icons';
import { MentionDropdownController } from '../../../../shared/mention/mention-dropdown-controller';
import type { ExtensionMentionItem, MentionExtensionProvider } from '../../../../shared/mention/types';
import type { MentionInsertReference } from '../../../../shared/mention/types';
import { VaultMentionIndex } from '../../../../shared/mention/vault-mention-index';
import type { ComposerReference } from '../composer/composer-reference';
import { FileChipsView } from './file-chips-view';
import { FileContextState } from './file-context-state';
import { isTagExcluded } from './tag-exclusion';

export interface FileContextCallbacks {
  getExcludedTags: () => string[];
  onChipsChanged?: () => void;
  /** Notified whenever the composer reference set changes (insert/rename/delete). */
  onReferencesChanged?: (references: readonly ComposerReference[]) => void;
  getExternalContexts?: () => string[];
  /** Called when an agent is selected from the @ mention dropdown. */
  onAgentMentionSelect?: (agentId: string) => void;
}

export class FileContextManager {
  private app: App;
  private callbacks: FileContextCallbacks;
  private chipsContainerEl: HTMLElement;
  private dropdownContainerEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private state: FileContextState;
  private mentionIndex: VaultMentionIndex;
  private chipsView: FileChipsView;
  private mentionDropdown: MentionDropdownController;
  private mcpManager: McpServerManager | null = null;
  private agentService: AgentMentionIndex | null = null;
  private deleteEventRef: EventRef | null = null;
  private renameEventRef: EventRef | null = null;

  // Current note (shown as chip)
  private currentNotePath: string | null = null;

  // Reference tokens inserted via the mention dropdown, keyed by token text
  private readonly composerReferences = new Map<string, ComposerReference>();

  // MCP server support
  private onMcpMentionChange: ((servers: Set<string>) => void) | null = null;

  constructor(
    app: App,
    chipsContainerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: FileContextCallbacks,
    dropdownContainerEl?: HTMLElement
  ) {
    this.app = app;
    this.chipsContainerEl = chipsContainerEl;
    this.dropdownContainerEl = dropdownContainerEl ?? chipsContainerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    this.state = new FileContextState();
    this.mentionIndex = new VaultMentionIndex(this.app);
    this.mentionIndex.initializeInBackground();

    this.chipsView = new FileChipsView(this.chipsContainerEl, {
      onRemoveAttachment: (filePath) => {
        if (filePath === this.currentNotePath) {
          this.currentNotePath = null;
          this.state.detachFile(filePath);
          this.refreshCurrentNoteChip();
        }
      },
      onOpenFile: (filePath) => {
        void (async (): Promise<void> => {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof TFile)) {
            new Notice(`Could not open file: ${filePath}`);
            return;
          }
          try {
            await this.app.workspace.getLeaf().openFile(file);
          } catch (error) {
            new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      },
    });

    this.mentionDropdown = new MentionDropdownController(
      this.dropdownContainerEl,
      this.inputEl,
      {
        onAttachFile: (filePath) => this.state.attachFile(filePath),
        onInsertReference: (reference) => this.registerComposerReference(reference),
        getExternalContexts: () => this.callbacks.getExternalContexts?.() || [],
        getCachedVaultFolders: () => this.mentionIndex.getCachedVaultFolders(),
        getCachedVaultFiles: () => this.mentionIndex.getCachedVaultFiles(),
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath),
      }
    );
    this.refreshMentionExtensionProvider();

    this.deleteEventRef = this.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.handleFileDeleted(file.path);
    });

    this.renameEventRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) this.handleFileRenamed(oldPath, file.path);
    });
  }

  /** Returns the current note path (shown as chip). */
  getCurrentNotePath(): string | null {
    return this.currentNotePath;
  }

  getAttachedFiles(): Set<string> {
    return this.state.getAttachedFiles();
  }

  /** Checks whether current note should be sent for this session. */
  shouldSendCurrentNote(notePath?: string | null): boolean {
    const resolvedPath = notePath ?? this.currentNotePath;
    return !!resolvedPath && !this.state.hasSentCurrentNote();
  }

  /** Marks current note as sent (call after sending a message). */
  markCurrentNoteSent() {
    this.state.markCurrentNoteSent();
  }

  isSessionStarted(): boolean {
    return this.state.isSessionStarted();
  }

  startSession() {
    this.state.startSession();
  }

  /** Resets state for a new conversation. */
  resetForNewConversation() {
    this.currentNotePath = null;
    this.state.resetForNewConversation();
    this.refreshCurrentNoteChip();
  }

  /** Resets state for loading an existing conversation. */
  resetForLoadedConversation(hasMessages: boolean) {
    this.currentNotePath = null;
    this.state.resetForLoadedConversation(hasMessages);
    this.refreshCurrentNoteChip();
  }

  /** Sets current note (for restoring persisted state). */
  setCurrentNote(notePath: string | null) {
    this.currentNotePath = notePath;
    if (notePath) {
      this.state.attachFile(notePath);
    }
    this.refreshCurrentNoteChip();
  }

  /** Auto-attaches the currently focused file (for new sessions). */
  autoAttachActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && !this.hasExcludedTag(activeFile)) {
      const normalizedPath = this.normalizePathForVault(activeFile.path);
      if (normalizedPath) {
        this.currentNotePath = normalizedPath;
        this.state.attachFile(normalizedPath);
        this.refreshCurrentNoteChip();
      }
    }
  }

  /** Handles file open event. */
  handleFileOpen(file: TFile) {
    const normalizedPath = this.normalizePathForVault(file.path);
    if (!normalizedPath) return;

    if (!this.state.isSessionStarted()) {
      this.state.clearAttachments();
      if (!this.hasExcludedTag(file)) {
        this.currentNotePath = normalizedPath;
        this.state.attachFile(normalizedPath);
      } else {
        this.currentNotePath = null;
      }
      this.refreshCurrentNoteChip();
    }
  }

  markFileCacheDirty() {
    this.mentionIndex.markFilesDirty();
  }

  markFolderCacheDirty() {
    this.mentionIndex.markFoldersDirty();
  }

  /** Handles input changes to detect @ mentions. */
  handleInputChange() {
    this.updateMcpMentionsFromText(this.inputEl.value);
    this.mentionDropdown.handleInputChange();
  }

  /** Handles keyboard navigation in mention dropdown. Returns true if handled. */
  handleMentionKeydown(e: KeyboardEvent): boolean {
    return this.mentionDropdown.handleKeydown(e);
  }

  isMentionDropdownVisible(): boolean {
    return this.mentionDropdown.isVisible();
  }

  hideMentionDropdown() {
    this.mentionDropdown.hide();
  }

  containsElement(el: Node): boolean {
    return this.mentionDropdown.containsElement(el);
  }

  async transformContextMentions(text: string): Promise<string> {
    const externalContexts = this.callbacks.getExternalContexts?.() || [];
    if (externalContexts.length === 0 || !text.includes('@')) return text;

    const contextEntries = buildExternalContextDisplayEntries(externalContexts)
      .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length);
    let scannedFiles: ExternalContextFile[] = [];
    try {
      scannedFiles = await externalContextScanner.scanPaths(externalContexts);
    } catch {
      // Leave unresolved mentions untouched if an external context cannot be scanned.
    }
    const filesByRoot = new Map<string, typeof scannedFiles>();
    for (const file of scannedFiles) {
      const files = filesByRoot.get(file.contextRoot) ?? [];
      files.push(file);
      filesByRoot.set(file.contextRoot, files);
    }
    const getContextLookup = createExternalContextLookupGetter(
      contextRoot => filesByRoot.get(contextRoot) ?? []
    );

    let replaced = false;
    let cursor = 0;
    const chunks: string[] = [];

    for (let index = 0; index < text.length; index++) {
      if (!isMentionStart(text, index)) continue;

      const resolved = resolveExternalMentionAtIndex(text, index, contextEntries, getContextLookup);
      if (!resolved) continue;

      chunks.push(text.slice(cursor, index));
      chunks.push(`${resolved.resolvedPath}${resolved.trailingPunctuation}`);
      cursor = resolved.endIndex;
      index = resolved.endIndex - 1;
      replaced = true;
    }

    if (!replaced) return text;
    chunks.push(text.slice(cursor));
    return chunks.join('');
  }

  /** Cleans up event listeners (call on view close). */
  destroy() {
    if (this.deleteEventRef) this.app.vault.offref(this.deleteEventRef);
    if (this.renameEventRef) this.app.vault.offref(this.renameEventRef);
    this.mentionDropdown.destroy();
    this.chipsView.destroy();
  }

  /** Normalizes a file path to be vault-relative with forward slashes. */
  normalizePathForVault(rawPath: string | undefined | null): string | null {
    const vaultPath = getVaultPath(this.app);
    return normalizePathForVaultUtil(rawPath, vaultPath);
  }

  private refreshCurrentNoteChip(): void {
    this.chipsView.renderCurrentNote(this.currentNotePath);
    this.callbacks.onChipsChanged?.();
  }

  private handleFileRenamed(oldPath: string, newPath: string) {
    const normalizedOld = this.normalizePathForVault(oldPath);
    const normalizedNew = this.normalizePathForVault(newPath);
    if (!normalizedOld) return;

    let needsUpdate = false;

    // Update current note path if renamed
    if (this.currentNotePath === normalizedOld) {
      this.currentNotePath = normalizedNew;
      needsUpdate = true;
    }

    // Update attached files
    if (this.state.getAttachedFiles().has(normalizedOld)) {
      this.state.detachFile(normalizedOld);
      if (normalizedNew) {
        this.state.attachFile(normalizedNew);
      }
      needsUpdate = true;
    }

    // Update composer reference tokens so chips survive renames
    if (this.renameComposerReferences(normalizedOld, normalizedNew)) {
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.refreshCurrentNoteChip();
    }
  }

  private handleFileDeleted(deletedPath: string): void {
    const normalized = this.normalizePathForVault(deletedPath);
    if (!normalized) return;

    let needsUpdate = false;

    // Clear current note if deleted
    if (this.currentNotePath === normalized) {
      this.currentNotePath = null;
      needsUpdate = true;
    }

    // Remove from attached files
    if (this.state.getAttachedFiles().has(normalized)) {
      this.state.detachFile(normalized);
      needsUpdate = true;
    }

    // Drop composer references whose file no longer exists
    if (this.removeComposerReferencesForPath(normalized)) {
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.refreshCurrentNoteChip();
    }
  }

  // ========================================
  // Composer References
  // ========================================

  /** Registers a reference inserted via the mention dropdown or a vault drop. */
  registerComposerReference(reference: MentionInsertReference): void {
    this.composerReferences.set(reference.token, reference);
    this.notifyReferencesChanged();
  }

  /**
   * Rewrites references under a renamed path: tokens in the input text are
   * replaced so chips keep pointing at the new location.
   */
  private renameComposerReferences(oldPath: string, newPath: string | null): boolean {
    let changed = false;
    for (const [token, reference] of Array.from(this.composerReferences.entries())) {
      if (reference.path !== oldPath) continue;

      this.composerReferences.delete(token);
      if (newPath) {
        const newToken = token.replace(oldPath, newPath);
        const renamed = { ...reference, token: newToken, path: newPath };
        this.composerReferences.set(newToken, renamed);
        this.inputEl.value = this.inputEl.value.split(token).join(newToken);
      } else {
        this.inputEl.value = this.inputEl.value.split(token).join('');
      }
      changed = true;
    }
    if (changed) this.notifyReferencesChanged();
    return changed;
  }

  /** Removes references pointing at a deleted path, dropping their tokens. */
  private removeComposerReferencesForPath(deletedPath: string): boolean {
    let changed = false;
    for (const [token, reference] of Array.from(this.composerReferences.entries())) {
      if (reference.path !== deletedPath) continue;
      this.composerReferences.delete(token);
      this.inputEl.value = this.inputEl.value.split(token).join('');
      changed = true;
    }
    if (changed) this.notifyReferencesChanged();
    return changed;
  }

  private notifyReferencesChanged(): void {
    this.callbacks.onReferencesChanged?.(Array.from(this.composerReferences.values()));
  }

  // ========================================
  // MCP Server Support
  // ========================================

  setMcpManager(manager: McpServerManager | null): void {
    this.mcpManager = manager;
    this.refreshMentionExtensionProvider();
  }

  setAgentService(agentService: AgentMentionIndex | null): void {
    this.agentService = agentService;
    this.refreshMentionExtensionProvider();
  }

  setOnMcpMentionChange(callback: (servers: Set<string>) => void): void {
    this.onMcpMentionChange = callback;
  }

  /**
   * Pre-scans external context paths in the background to warm the cache.
   * Should be called when external context paths are added/changed.
   */
  preScanExternalContexts(): void {
    this.mentionDropdown.preScanExternalContexts();
  }

  getMentionedMcpServers(): Set<string> {
    return this.state.getMentionedMcpServers();
  }

  clearMcpMentions(): void {
    this.state.clearMcpMentions();
  }

  updateMcpMentionsFromText(text: string): void {
    if (!this.mcpManager) return;

    const newMentions = this.mcpManager.extractMentions(text);
    if (this.state.setMentionedMcpServers(newMentions)) {
      this.onMcpMentionChange?.(newMentions);
    }
  }

  private refreshMentionExtensionProvider(): void {
    const provider: MentionExtensionProvider = {
      getItems: searchText => {
        const searchLower = searchText.toLowerCase();
        const isFilterSearch = searchText.includes('/');

        if (isFilterSearch && searchLower.startsWith('agents/')) {
          const query = searchText.substring('agents/'.length).toLowerCase();
          const agents = this.agentService?.searchAgents(query) ?? [];
          return {
            exclusive: true,
            items: agents.map(agent => ({
              type: 'extension' as const,
              key: `agent:${agent.id}`,
              displayText: `@${agent.id}`,
              description: agent.description,
              className: 'agent',
              nameClassName: 'qoderian-mention-name-agent',
              descriptionClassName: 'qoderian-mention-agent-desc',
              replacement: `@${agent.id} (agent) `,
              renderIcon: iconEl => setIcon(iconEl, 'bot'),
              onSelect: () => this.callbacks.onAgentMentionSelect?.(agent.id),
            })),
          };
        }

        if (isFilterSearch) return { items: [] };

        const items: ExtensionMentionItem[] = (this.mcpManager?.getContextSavingServers() ?? [])
          .filter(server => server.name.toLowerCase().includes(searchLower))
          .map(server => ({
            type: 'extension' as const,
            key: `mcp:${server.name}`,
            displayText: `@${server.name}`,
            className: 'mcp-server',
            replacement: `@${server.name} `,
            renderIcon: appendMcpIcon,
            onSelect: () => {
              this.state.addMentionedMcpServer(server.name);
              this.onMcpMentionChange?.(this.state.getMentionedMcpServers());
            },
          }));

        const hasAgents = (this.agentService?.searchAgents('') ?? []).length > 0;
        if (hasAgents && 'agents'.includes(searchLower)) {
          items.push({
            type: 'extension' as const,
            key: 'agent-folder',
            displayText: '@Agents/',
            className: 'agent-folder',
            nameClassName: 'qoderian-mention-name-agent-folder',
            submenuSearchText: 'Agents/',
            renderIcon: iconEl => setIcon(iconEl, 'bot'),
            onSelect: undefined,
            replacement: undefined,
          });
        }

        return { items };
      },
    };
    this.mentionDropdown.setExtensionProvider(provider);
  }

  private hasExcludedTag(file: TFile): boolean {
    const excludedTags = this.callbacks.getExcludedTags();
    if (excludedTags.length === 0) return false;

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;

    const fileTags: string[] = [];

    if (cache.frontmatter?.tags) {
      const fmTags: unknown = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        fileTags.push(...fmTags.filter((tag): tag is string => typeof tag === 'string'));
      } else if (typeof fmTags === 'string') {
        fileTags.push(fmTags);
      }
    }

    if (cache.tags) {
      fileTags.push(...cache.tags.map(t => t.tag));
    }

    return fileTags.some(tag => isTagExcluded(tag, excludedTags));
  }
}
