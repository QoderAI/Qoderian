// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './app/electron-compat';
patchSetMaxListenersForElectron();

import type { Editor, WorkspaceLeaf } from 'obsidian';
import { addIcon, MarkdownView, Notice, Plugin } from 'obsidian';

import { QoderianStorage } from './app/storage/app-storage';
import { buildCursorContext } from './core/editor/editor-context';
import { getVaultPath } from './core/fs/path';
import type {
  Conversation,
  ConversationMeta,
  QoderianSettings,
  SessionMetadata,
} from './core/types';
import {
  VIEW_TYPE_QODERIAN,
} from './core/types';
import type { AppTabManagerState } from './core/types/services';
import type { ChatViewPlacement } from './core/types/settings';
import { QoderianView } from './features/chat/chat-view';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/modal';
import { QoderianSettingTab } from './features/settings/settings-tab';
import { setLocale, t } from './i18n/i18n';
import type { Locale } from './i18n/types';
import { setActiveQoderCliEdition } from './qoder/config/cli-edition';
import { normalizeQoderSettings } from './qoder/config/qoder-settings-reconciler';
import { getQoderSettings } from './qoder/config/settings';
import { extractUserDisplayContent } from './qoder/prompt/context/prompt-context';
import {
  createQoderServices,
  type QoderServices,
} from './qoder/qoder-services';
import { createQoderianIconContent, QODERIAN_ICON_ID } from './shared/icons';
import { revealWorkspaceLeaf } from './shared/obsidian/compat';

function isQoderianView(value: unknown): value is QoderianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

export default class QoderianPlugin extends Plugin {
  settings!: QoderianSettings;
  storage!: QoderianStorage;
  qoderServices!: QoderServices;
  private conversations: Conversation[] = [];
  private lastKnownTabManagerState: AppTabManagerState | null = null;

  async onload() {
    await this.loadSettings();
    this.qoderServices = await createQoderServices(this, this.storage.getAdapter());

    this.registerView(
      VIEW_TYPE_QODERIAN,
      (leaf) => new QoderianView(leaf, this)
    );

    addIcon(QODERIAN_ICON_ID, createQoderianIconContent());
    this.addRibbonIcon(QODERIAN_ICON_ID, t('chat.view.openQoderian'), () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: t('commands.openView'),
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'inline-edit',
      name: t('commands.inlineEdit'),
      editorCallback: async (editor: Editor, ctx) => {
        const view = ctx instanceof MarkdownView
          ? ctx
          : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice(t('commands.inlineEditUnavailable'));
          return;
        }

        const selectedText = editor.getSelection();
        const notePath = view.file?.path || 'unknown';

        let editContext: InlineEditContext;
        if (selectedText.trim()) {
          editContext = { mode: 'selection', selectedText };
        } else {
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: 'cursor', cursorContext };
        }

        const modal = new InlineEditModal(
          this.app,
          this,
          editor,
          view,
          editContext,
          notePath,
          () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
        );
        const result = await modal.openAndWait();

        if (result.decision === 'accept' && result.editedText !== undefined) {
          new Notice(editContext.mode === 'cursor' ? t('commands.inserted') : t('commands.editApplied'));
        }
      },
    });

    this.addCommand({
      id: 'new-tab',
      name: t('commands.newTab'),
      checkCallback: (checking: boolean) => {
        if (!this.canCreateNewTab()) return false;

        if (!checking) {
          void this.openNewTab();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'new-session',
      name: t('commands.newSession'),
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        const activeTab = tabManager.getActiveTab();
        if (!activeTab) return false;

        if (activeTab.state.isStreaming) return false;

        if (!checking) {
          void tabManager.createNewConversation();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'close-current-tab',
      name: t('commands.closeCurrentTab'),
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        if (!checking) {
          const activeTabId = tabManager.getActiveTabId();
          if (activeTabId) {
            void tabManager.closeTab(activeTabId);
          }
        }
        return true;
      },
    });

    this.addSettingTab(new QoderianSettingTab(this.app, this));
  }

  onunload(): void {
    this.qoderServices?.dispose();
    void this.persistOpenTabStates();
  }

  private async persistOpenTabStates(): Promise<void> {
    // Best-effort unload fallback. Normal tab mutations are persisted
    // immediately by the view, so correctness does not depend on this Promise
    // finishing after Obsidian starts unloading the plugin.
    const view = this.getView();
    const tabManager = view?.getTabManager();
    if (tabManager) {
      const state = tabManager.getPersistedState();
      await this.persistTabManagerState(state);
    }
  }

  /**
   * The plugin supports a single Qoderian view. Detaches duplicate leaves,
   * keeping `keep` (or the first leaf when omitted).
   */
  private async deduplicateViews(keep?: WorkspaceLeaf | null): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_QODERIAN);
    if (leaves.length <= 1) {
      return;
    }
    const keepLeaf = keep ?? leaves[0];
    for (const leaf of leaves) {
      if (leaf === keepLeaf) continue;
      try {
        leaf.detach();
      } catch {
        // Best-effort cleanup; the leaf may already be detached.
      }
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_QODERIAN)[0] ?? null;

    if (!leaf) {
      leaf = await this.openViewAtPlacement(this.settings.chatViewPlacement);
    }

    await this.deduplicateViews(leaf);

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }
  }

  /** Persists a new default placement and moves the currently open view there. */
  async updateChatViewPlacement(placement: ChatViewPlacement): Promise<void> {
    const previousPlacement = this.settings.chatViewPlacement;
    if (placement === previousPlacement) {
      return;
    }

    const currentLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_QODERIAN)[0];
    if (currentLeaf && this.hasStreamingTab()) {
      throw new Error(t('chat.view.moveBlockedStreaming'));
    }

    this.settings.chatViewPlacement = placement;
    try {
      await this.saveSettings();
      if (currentLeaf) {
        await this.moveViewToPlacement(currentLeaf, placement);
      }
    } catch (error) {
      this.settings.chatViewPlacement = previousPlacement;
      try {
        await this.saveSettings();
      } catch {
        // Keep the original placement error so the UI can explain why the move failed.
      }
      throw error;
    }
  }

  private hasStreamingTab(): boolean {
    return this.getAllViews().some((view) =>
      view.getTabManager()?.getAllTabs().some((tab) => tab.state.isStreaming) ?? false
    );
  }

  private async moveViewToPlacement(
    currentLeaf: WorkspaceLeaf,
    placement: ChatViewPlacement,
  ): Promise<void> {
    await this.persistOpenTabStates();

    // Bypass ensureSideLeaf() while relocating: it searches by view type and
    // may return the current Qoderian leaf even when that leaf is in the main
    // area. getLeft/RightLeaf(false) creates a tab in the existing sidebar
    // group; true would split the sidebar into a separate panel.
    const targetLeaf = await this.openViewAtPlacement(placement, true);
    if (!targetLeaf) {
      throw new Error(t('chat.view.moveFailed'));
    }
    if (targetLeaf === currentLeaf) {
      await revealWorkspaceLeaf(this.app.workspace, currentLeaf);
      return;
    }

    try {
      await revealWorkspaceLeaf(this.app.workspace, targetLeaf);
    } catch (error) {
      targetLeaf.detach();
      throw error;
    }

    currentLeaf.detach();
  }

  private async openViewAtPlacement(
    placement: ChatViewPlacement,
    skipEnsureSideLeaf = false,
  ): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    if (
      placement !== 'main-tab'
      && !skipEnsureSideLeaf
      && typeof workspace.ensureSideLeaf === 'function'
    ) {
      return workspace.ensureSideLeaf(
        VIEW_TYPE_QODERIAN,
        placement === 'left-sidebar' ? 'left' : 'right',
        {
          active: true,
          split: false,
          reveal: false,
        },
      );
    }

    const leaf = placement === 'main-tab'
      ? workspace.getLeaf('tab')
      : placement === 'left-sidebar'
        ? workspace.getLeftLeaf(false)
        : workspace.getRightLeaf(false);
    if (!leaf) {
      return null;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_QODERIAN,
      active: true,
    });
    return leaf;
  }

  private canCreateNewTab(): boolean {
    const hasQoderianLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_QODERIAN).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasQoderianLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<QoderianView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  private buildSessionMetadata(conversation: Conversation): SessionMetadata {
    const qoderState = this.qoderServices?.historyService
      ? this.qoderServices.historyService.buildPersistedQoderState(conversation)
      : conversation.qoderState;

    return {
      id: conversation.id,
      title: conversation.title,
      titleGenerationStatus: conversation.titleGenerationStatus,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastResponseAt: conversation.lastResponseAt,
      sessionId: conversation.sessionId,
      qoderState,
      currentNote: conversation.currentNote,
      externalContextPaths: conversation.externalContextPaths,
      enabledMcpServers: conversation.enabledMcpServers,
      usage: conversation.usage,
      resumeAtMessageId: conversation.resumeAtMessageId,
    };
  }

  async loadSettings() {
    this.storage = new QoderianStorage(this);
    const { qoderian } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = qoderian;
    this.syncActiveQoderCliEdition();

    // Plan mode is ephemeral — return to the SDK's prompting mode on restart.
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'default';
    }
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const allMetadata = await this.storage.sessions.listMetadata();
    this.conversations = allMetadata.map(meta => {
      const resumeSessionId = meta.sessionId !== undefined ? meta.sessionId : meta.id;

      return {
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastResponseAt: meta.lastResponseAt,
        sessionId: resumeSessionId,
        qoderState: meta.qoderState,
        messages: [],
        currentNote: meta.currentNote,
        externalContextPaths: meta.externalContextPaths,
        enabledMcpServers: meta.enabledMcpServers,
        usage: meta.usage,
        titleGenerationStatus: meta.titleGenerationStatus,
        resumeAtMessageId: meta.resumeAtMessageId,
      };
    }).sort(
      (a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt)
    );
    setLocale(this.settings.locale as Locale);

    if (didNormalizeModelVariants) {
      await this.saveSettings();
    }
  }

  normalizeModelVariantSettings(): boolean {
    return normalizeQoderSettings(this.settings);
  }

  async saveSettings() {
    this.syncActiveQoderCliEdition();
    await this.storage.saveQoderianSettings(this.settings);
  }

  /** Keeps the edition-aware path helpers aligned with the persisted settings. */
  private syncActiveQoderCliEdition() {
    setActiveQoderCliEdition(getQoderSettings(this.settings).edition);
  }

  getResolvedQoderCliPath(): string | null {
    return this.qoderServices.cliResolver.resolveFromSettings(this.settings);
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) {
      return t('chat.conversation.emptyPreview');
    }
    const previewText = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;
    return previewText.substring(0, 50) + (previewText.length > 50 ? '...' : '');
  }

  private async loadSdkMessagesForConversation(conversation: Conversation): Promise<void> {
    const historyService = this.qoderServices?.historyService;
    if (!historyService) {
      return;
    }

    await historyService.hydrateConversationHistory(
      conversation,
      getVaultPath(this.app),
    );
  }

  async createConversation(options?: {
    sessionId?: string;
  }): Promise<Conversation> {
    const sessionId = options?.sessionId;
    const conversationId = sessionId ?? this.generateConversationId();
    const conversation: Conversation = {
      id: conversationId,
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: sessionId ?? null,
      messages: [],
    };

    this.conversations.unshift(conversation);
    await this.storage.sessions.saveMetadata(
      this.buildSessionMetadata(conversation)
    );

    return conversation;
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return null;

    await this.loadSdkMessagesForConversation(conversation);

    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    const boundTabs = this.getAllViews().flatMap((view) =>
      (view.getTabManager()?.getAllTabs() ?? []).filter((tab) => tab.conversationId === id)
    );

    // 1. Stop and detach every runtime that can still write this session.
    // Reset the UI before deleting files so a late stream cannot recreate the
    // transcript after deletion.
    for (const tab of boundTabs) {
      tab.controllers.inputController?.cancelStreaming();
    }
    try {
      await Promise.all(boundTabs.map(async (tab) => {
        await tab.service?.cleanup?.();
        await tab.controllers.conversationController?.createNew({ force: true });
      }));
    } catch (error) {
      new Notice(t('chat.conversation.deleteFailed', { error: `${error}` }));
      return;
    }

    // 2. Delete the SDK session first; abort on failure so metadata and
    // memory stay discoverable for a retry.
    try {
      await this.qoderServices.historyService.deleteConversationSession(
        conversation,
        getVaultPath(this.app),
      );
    } catch (error) {
      new Notice(t('chat.conversation.deleteFailed', { error: `${error}` }));
      return;
    }

    // 3. Delete metadata; abort on failure so the in-memory record remains
    // available for a retry in the current process.
    try {
      await this.storage.sessions.deleteMetadata(id);
    } catch (error) {
      new Notice(t('chat.conversation.deleteFailed', { error: `${error}` }));
      return;
    }

    // 4. Both persisted layers are gone — remove the in-memory record.
    const index = this.conversations.indexOf(conversation);
    if (index >= 0) {
      this.conversations.splice(index, 1);
    }
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();

    await this.storage.sessions.saveMetadata(
      this.buildSessionMetadata(conversation)
    );
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    Object.assign(conversation, updates, { updatedAt: Date.now() });

    await this.storage.sessions.saveMetadata(
      this.buildSessionMetadata(conversation)
    );

    // Clear image data from memory after save (data is persisted by SDK).
    // Skip for pending forks: their deep-cloned images aren't in SDK storage yet.
    if (!this.qoderServices.historyService.isPendingForkConversation(conversation)) {
      for (const msg of conversation.messages) {
        if (msg.images) {
          for (const img of msg.images) {
            img.data = '';
          }
        }
      }
    }
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id) || null;

    if (conversation) {
      await this.loadSdkMessagesForConversation(conversation);
    }

    return conversation;
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversations.find(c => c.id === id) || null;
  }

  getConversationList(): ConversationMeta[] {
    return this.conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  /** Requests debounced tab-state persistence from all open views. */
  requestPersistTabState(): void {
    for (const view of this.getAllViews()) {
      view.persistTabState();
    }
  }

  getView(): QoderianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_QODERIAN);
    return leaves.map(leaf => leaf.view).find(isQoderianView) ?? null;
  }

  getAllViews(): QoderianView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_QODERIAN);
    return leaves.map(leaf => leaf.view).filter(isQoderianView);
  }

  findConversationAcrossViews(conversationId: string): { view: QoderianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }

}
