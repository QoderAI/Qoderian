import type { TFile } from 'obsidian';
import { setIcon } from 'obsidian';

import { buildExternalContextDisplayEntries } from '../../core/context/external-context';
import { type ExternalContextFile, externalContextScanner } from '../../core/context/external-context-scanner';
import { SelectableDropdown } from '../components/selectable-dropdown';
import {
  type FolderMentionItem,
  type MentionExtensionProvider,
  type MentionItem,
} from './types';

export interface MentionDropdownOptions {
  fixed?: boolean;
}

export interface MentionDropdownCallbacks {
  onAttachFile: (path: string) => void;
  getExternalContexts: () => string[];
  getCachedVaultFolders: () => Array<Pick<FolderMentionItem, 'name' | 'path'>>;
  getCachedVaultFiles: () => TFile[];
  normalizePathForVault: (path: string | undefined | null) => string | null;
}

export class MentionDropdownController {
  private containerEl: HTMLElement;
  private inputEl: HTMLTextAreaElement | HTMLInputElement;
  private callbacks: MentionDropdownCallbacks;
  private dropdown: SelectableDropdown<MentionItem>;
  private mentionStartIndex = -1;
  private selectedMentionIndex = 0;
  private filteredMentionItems: MentionItem[] = [];
  private filteredContextFiles: ExternalContextFile[] = [];
  private activeContextFilter: { folderName: string; contextRoot: string } | null = null;
  private activeExtensionFilter = false;
  private extensionProvider: MentionExtensionProvider | null = null;
  private fixed: boolean;
  private debounceTimer: number | null = null;
  private renderGeneration = 0;
  private destroyed = false;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement | HTMLInputElement,
    callbacks: MentionDropdownCallbacks,
    options: MentionDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.fixed = options.fixed ?? false;

    this.dropdown = new SelectableDropdown<MentionItem>(this.containerEl, {
      listClassName: 'qoderian-mention-dropdown',
      itemClassName: 'qoderian-mention-item',
      emptyClassName: 'qoderian-mention-empty',
      fixed: this.fixed,
      fixedClassName: 'qoderian-mention-dropdown-fixed',
    });
  }

  setExtensionProvider(provider: MentionExtensionProvider | null): void {
    if (this.extensionProvider !== provider && this.dropdown.isVisible()) {
      this.hide();
    }
    this.renderGeneration++;
    this.extensionProvider = provider;
  }

  preScanExternalContexts(): void {
    const externalContexts = this.callbacks.getExternalContexts() || [];
    if (externalContexts.length === 0) return;

    window.setTimeout(() => {
      void (async () => {
        try {
          await externalContextScanner.scanPaths(externalContexts);
        } catch {
          // Pre-scan is best-effort, ignore failures.
        }
      })();
    }, 0);
  }

  isVisible(): boolean {
    return this.dropdown.isVisible();
  }

  hide(): void {
    this.dropdown.hide();
    this.mentionStartIndex = -1;
  }

  containsElement(el: Node): boolean {
    return this.dropdown.getElement()?.contains(el) ?? false;
  }

  destroy(): void {
    this.destroyed = true;
    this.renderGeneration++;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dropdown.destroy();
  }

  handleInputChange(): void {
    if (this.destroyed) return;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    // Old results no longer describe the current input and must never be
    // selectable while the debounced refresh is pending.
    this.hide();
    const generation = ++this.renderGeneration;

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      const text = this.inputEl.value;

      const cursorPos = this.inputEl.selectionStart || 0;
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf('@');

      if (lastAtIndex === -1) {
        this.hide();
        return;
      }

      const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (!/\s/.test(charBeforeAt) && lastAtIndex !== 0) {
        this.hide();
        return;
      }

      const searchText = textBeforeCursor.substring(lastAtIndex + 1);

      this.mentionStartIndex = lastAtIndex;
      void this.showMentionDropdown(searchText, generation);
    }, 200);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (e.isComposing || !this.dropdown.isVisible()) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.dropdown.moveSelection(1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.dropdown.moveSelection(-1);
      this.selectedMentionIndex = this.dropdown.getSelectedIndex();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.selectMentionItem();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // If in secondary menu, return to first level instead of closing
      if (this.activeContextFilter || this.activeExtensionFilter) {
        this.returnToFirstLevel();
        return true;
      }
      this.hide();
      return true;
    }

    return false;
  }

  private async showMentionDropdown(searchText: string, generation: number): Promise<void> {
    if (this.destroyed || generation !== this.renderGeneration) return;
    const searchLower = searchText.toLowerCase();
    this.filteredMentionItems = [];
    this.filteredContextFiles = [];

    const externalContexts = this.callbacks.getExternalContexts() || [];
    const contextEntries = buildExternalContextDisplayEntries(externalContexts);

    const extensionResult = this.extensionProvider?.getItems(searchText);
    if (extensionResult?.exclusive) {
      this.activeExtensionFilter = true;
      this.activeContextFilter = null;
      this.filteredMentionItems.push(...extensionResult.items);
      this.selectedMentionIndex = 0;
      this.renderMentionDropdown();
      return;
    }

    const isFilterSearch = searchText.includes('/');
    let fileSearchText = searchLower;

    if (isFilterSearch) {
      const matchingContext = contextEntries
        .filter(entry => searchLower.startsWith(`${entry.displayNameLower}/`))
        .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length)[0];

      if (matchingContext) {
        const prefixLength = matchingContext.displayName.length + 1;
        fileSearchText = searchText.substring(prefixLength).toLowerCase();
        this.activeContextFilter = {
          folderName: matchingContext.displayName,
          contextRoot: matchingContext.contextRoot,
        };
      } else {
        this.activeContextFilter = null;
      }
    }

    if (this.activeContextFilter && isFilterSearch) {
      let contextFiles: ExternalContextFile[] = [];
      try {
        contextFiles = await externalContextScanner.scanPaths([this.activeContextFilter.contextRoot]);
      } catch {
        // Keep the dropdown usable if an external context becomes unavailable.
      }
      if (this.destroyed || generation !== this.renderGeneration) return;
      this.filteredContextFiles = contextFiles
        .filter(file => {
          const relativePath = file.relativePath.replace(/\\/g, '/');
          const pathLower = relativePath.toLowerCase();
          const nameLower = file.name.toLowerCase();
          return pathLower.includes(fileSearchText) || nameLower.includes(fileSearchText);
        })
        .sort((a, b) => {
          const aNameMatch = a.name.toLowerCase().startsWith(fileSearchText);
          const bNameMatch = b.name.toLowerCase().startsWith(fileSearchText);
          if (aNameMatch && !bNameMatch) return -1;
          if (!aNameMatch && bNameMatch) return 1;
          return b.mtime - a.mtime;
        });

      for (const file of this.filteredContextFiles) {
        const relativePath = file.relativePath.replace(/\\/g, '/');
        this.filteredMentionItems.push({
          type: 'context-file',
          name: relativePath,
          absolutePath: file.path,
          contextRoot: file.contextRoot,
          folderName: this.activeContextFilter.folderName,
        });
      }

      const firstVaultItemIndex = this.filteredMentionItems.length;
      const vaultItemCount = this.appendVaultItems(searchLower);

      if (this.hideIfNoResults()) {
        return;
      }

      if (this.filteredContextFiles.length === 0 && vaultItemCount > 0) {
        this.selectedMentionIndex = firstVaultItemIndex;
      } else {
        this.selectedMentionIndex = 0;
      }

      this.renderMentionDropdown();
      return;
    }

    this.activeContextFilter = null;
    this.activeExtensionFilter = false;
    if (extensionResult) {
      this.filteredMentionItems.push(...extensionResult.items);
    }

    if (contextEntries.length > 0) {
      const matchingFolders = new Set<string>();
      for (const entry of contextEntries) {
        if (entry.displayNameLower.includes(searchLower) && !matchingFolders.has(entry.displayName)) {
          matchingFolders.add(entry.displayName);
          this.filteredMentionItems.push({
            type: 'context-folder',
            name: entry.displayName,
            contextRoot: entry.contextRoot,
            folderName: entry.displayName,
          });
        }
      }
    }

    const firstVaultItemIndex = this.filteredMentionItems.length;
    const vaultItemCount = this.appendVaultItems(searchLower);

    if (this.hideIfNoResults()) {
      return;
    }

    this.selectedMentionIndex = vaultItemCount > 0 ? firstVaultItemIndex : 0;

    this.renderMentionDropdown();
  }

  private appendVaultItems(searchLower: string): number {
    type ScoredItem =
      | { type: 'folder'; name: string; path: string; startsWithQuery: boolean; mtime: number }
      | { type: 'file'; name: string; path: string; file: TFile; startsWithQuery: boolean; mtime: number };

    const compare = (a: ScoredItem, b: ScoredItem): number => {
      if (a.startsWithQuery !== b.startsWithQuery) return a.startsWithQuery ? -1 : 1;
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      if (a.type !== b.type) return a.type === 'file' ? -1 : 1;
      return a.path.localeCompare(b.path);
    };

    const allFiles = this.callbacks.getCachedVaultFiles();

    // Derive folder mtime from the most recently modified file within each folder
    const folderMtimeMap = new Map<string, number>();
    for (const f of allFiles) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join('/');
        const existing = folderMtimeMap.get(folderPath) ?? 0;
        if (f.stat.mtime > existing) {
          folderMtimeMap.set(folderPath, f.stat.mtime);
        }
      }
    }

    const scoredFolders: ScoredItem[] = this.callbacks.getCachedVaultFolders()
      .map(f => ({
        name: f.name,
        path: f.path.replace(/\\/g, '/').replace(/\/+$/, ''),
      }))
      .filter(f =>
        f.path.length > 0 &&
        (f.path.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower))
      )
      .map(f => ({
        type: 'folder' as const,
        name: f.name,
        path: f.path,
        startsWithQuery: f.name.toLowerCase().startsWith(searchLower),
        mtime: folderMtimeMap.get(f.path) ?? 0,
      }))
      .sort(compare)
      .slice(0, 50);

    const scoredFiles: ScoredItem[] = allFiles
      .filter(f =>
        f.path.toLowerCase().includes(searchLower) || f.name.toLowerCase().includes(searchLower)
      )
      .map(f => ({
        type: 'file' as const,
        name: f.name,
        path: f.path,
        file: f,
        startsWithQuery: f.name.toLowerCase().startsWith(searchLower),
        mtime: f.stat.mtime,
      }))
      .sort(compare)
      .slice(0, 100);

    const merged = [...scoredFolders, ...scoredFiles].sort(compare);

    for (const item of merged) {
      if (item.type === 'folder') {
        this.filteredMentionItems.push({ type: 'folder', name: item.name, path: item.path });
      } else {
        this.filteredMentionItems.push({ type: 'file', name: item.name, path: item.path, file: item.file });
      }
    }

    return merged.length;
  }

  private hideIfNoResults(): boolean {
    if (this.filteredMentionItems.length > 0) return false;

    this.hide();
    return true;
  }

  private renderMentionDropdown(): void {
    this.dropdown.render({
      items: this.filteredMentionItems,
      selectedIndex: this.selectedMentionIndex,
      emptyText: 'No matches',
      getItemClass: (item) => {
        switch (item.type) {
          case 'folder': return 'vault-folder';
          case 'extension': return item.className ?? 'extension';
          case 'context-file': return 'context-file';
          case 'context-folder': return 'context-folder';
          default: return undefined;
        }
      },
      renderItem: (item, itemEl) => {
        const iconEl = itemEl.createSpan({ cls: 'qoderian-mention-icon' });
        switch (item.type) {
          case 'extension':
            item.renderIcon(iconEl);
            break;
          case 'context-file':
            setIcon(iconEl, 'folder-open');
            break;
          case 'folder':
          case 'context-folder':
            setIcon(iconEl, 'folder');
            break;
          default:
            setIcon(iconEl, 'file-text');
        }

        const textEl = itemEl.createSpan({ cls: 'qoderian-mention-text' });

        switch (item.type) {
          case 'extension': {
            textEl.createSpan({
              cls: ['qoderian-mention-name', item.nameClassName].filter(Boolean).join(' '),
            }).setText(item.displayText);
            if (item.description) {
              textEl.createSpan({
                cls: item.descriptionClassName ?? 'qoderian-mention-description',
              }).setText(item.description);
            }
            break;
          }
          case 'context-folder':
            textEl.createSpan({
              cls: 'qoderian-mention-name qoderian-mention-name-folder',
            }).setText(`@${item.name}/`);
            break;
          case 'context-file':
            textEl.createSpan({
              cls: 'qoderian-mention-name qoderian-mention-name-context',
            }).setText(item.name);
            break;
          case 'folder':
            textEl.createSpan({
              cls: 'qoderian-mention-name qoderian-mention-name-folder',
            }).setText(`@${item.path}/`);
            break;
          default:
            textEl.createSpan({ cls: 'qoderian-mention-path' }).setText(item.path || item.name);
        }
      },
      onItemClick: (item, index, e) => {
        // Stop propagation for folder items to prevent document click handler
        // from hiding dropdown (since dropdown is re-rendered with new DOM)
        if (item.type === 'context-folder' || (item.type === 'extension' && item.submenuSearchText)) {
          e.stopPropagation();
        }
        this.selectedMentionIndex = index;
        this.selectMentionItem();
      },
      onItemHover: (_item, index) => {
        this.selectedMentionIndex = index;
      },
    });

    if (this.fixed) {
      this.positionFixed();
    }
  }

  private positionFixed(): void {
    const dropdownEl = this.dropdown.getElement();
    if (!dropdownEl) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    dropdownEl.setCssProps({
      '--qoderian-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--qoderian-fixed-dropdown-left': `${inputRect.left}px`,
      '--qoderian-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private insertReplacement(beforeAt: string, replacement: string, afterCursor: string): void {
    this.inputEl.value = beforeAt + replacement + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + replacement.length;
  }

  private returnToFirstLevel(): void {
    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    this.inputEl.value = beforeAt + '@' + afterCursor;
    this.inputEl.selectionStart = this.inputEl.selectionEnd = beforeAt.length + 1;

    this.activeContextFilter = null;
    this.activeExtensionFilter = false;

    void this.showMentionDropdown('', this.renderGeneration);
  }

  private selectMentionItem(): void {
    if (this.filteredMentionItems.length === 0) return;

    const selectedIndex = this.dropdown.getSelectedIndex();
    this.selectedMentionIndex = selectedIndex;
    const selectedItem = this.filteredMentionItems[selectedIndex];
    if (!selectedItem) return;

    const text = this.inputEl.value;
    const beforeAt = text.substring(0, this.mentionStartIndex);
    const cursorPos = this.inputEl.selectionStart || 0;
    const afterCursor = text.substring(cursorPos);

    switch (selectedItem.type) {
      case 'extension': {
        if (selectedItem.submenuSearchText) {
          this.activeExtensionFilter = true;
          this.inputEl.focus();
          void this.showMentionDropdown(selectedItem.submenuSearchText, this.renderGeneration);
          return;
        }
        if (selectedItem.replacement) {
          this.insertReplacement(beforeAt, selectedItem.replacement, afterCursor);
        }
        selectedItem.onSelect?.();
        break;
      }
      case 'context-folder': {
        const replacement = `@${selectedItem.name}/`;
        this.insertReplacement(beforeAt, replacement, afterCursor);
        this.inputEl.focus();
        this.handleInputChange();
        return;
      }
      case 'context-file': {
        // Display friendly name in input; absolute path resolution happens at send time.
        const displayName = selectedItem.folderName
          ? `@${selectedItem.folderName}/${selectedItem.name}`
          : `@${selectedItem.name}`;
        if (selectedItem.absolutePath) {
          this.callbacks.onAttachFile(selectedItem.absolutePath);
        }
        this.insertReplacement(beforeAt, `${displayName} `, afterCursor);
        break;
      }
      case 'folder': {
        const normalizedPath = this.callbacks.normalizePathForVault(selectedItem.path);
        this.insertReplacement(beforeAt, `@${normalizedPath ?? selectedItem.path}/ `, afterCursor);
        break;
      }
      default: {
        const rawPath = selectedItem.file?.path ?? selectedItem.path;
        const normalizedPath = this.callbacks.normalizePathForVault(rawPath);
        if (normalizedPath) {
          this.callbacks.onAttachFile(normalizedPath);
        }
        this.insertReplacement(beforeAt, `@${normalizedPath ?? selectedItem.name} `, afterCursor);
        break;
      }
    }

    this.hide();
    this.inputEl.focus();
  }
}
