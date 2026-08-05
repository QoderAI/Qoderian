import type { SlashCommand } from '../../core/types';

export interface SlashCommandDropdownConfig {
  triggerChars: string[];
}

export interface SlashCommandDropdownEntry extends SlashCommand {
  displayPrefix: string;
  insertPrefix: string;
}

export function toSlashCommandDropdownEntries(
  commands: SlashCommand[],
  displayPrefix = '/',
  insertPrefix = '/',
): SlashCommandDropdownEntry[] {
  return commands.map(command => ({ ...command, displayPrefix, insertPrefix }));
}

interface DropdownItem {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
  displayPrefix: string;
  insertPrefix: string;
  isBuiltIn: boolean;
  slashCommand?: SlashCommand;
}

function normalizeArgumentHint(hint: string): string {
  if (!hint || hint.includes('[') || hint.includes('<')) return hint;
  return `[${hint}]`;
}

function getSearchMatchPriority(item: DropdownItem, searchLower: string): number {
  if (!searchLower) return 0;

  const nameLower = item.name.toLowerCase();
  if (nameLower === searchLower) return 0;
  if (nameLower.startsWith(searchLower)) return 1;
  if (nameLower.includes(searchLower)) return 2;
  return 3;
}

export interface SlashCommandDropdownCallbacks {
  onSelect: (command: SlashCommand) => void;
  onHide: () => void;
}

export interface SlashCommandDropdownOptions {
  fixed?: boolean;
  /** Immediately available entries supplied by the owning feature. */
  staticEntries?: SlashCommandDropdownEntry[];
  catalogConfig?: SlashCommandDropdownConfig;
  getEntries?: () => Promise<SlashCommandDropdownEntry[]>;
  /** Subscribes to catalog changes (e.g., background SDK command loading). */
  subscribeCatalogChanges?: (listener: () => void) => () => void;
}

export class SlashCommandDropdown {
  private containerEl: HTMLElement;
  private dropdownEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | HTMLInputElement;
  private callbacks: SlashCommandDropdownCallbacks;
  private enabled = true;
  private onInput: () => void;
  private triggerStartIndex = -1;
  private activeTriggerChar = '/';
  private selectedIndex = 0;
  private filteredItems: DropdownItem[] = [];
  private isFixed: boolean;
  private staticEntries: SlashCommandDropdownEntry[];
  private catalogConfig: SlashCommandDropdownConfig | null;
  private getEntries: (() => Promise<SlashCommandDropdownEntry[]>) | null;
  private cachedEntries: SlashCommandDropdownEntry[] = [];
  private entriesFetched = false;
  private fetchState: { generation: number; promise: Promise<void> } | null = null;
  private catalogGeneration = 0;
  private catalogSubscribe?: (listener: () => void) => () => void;
  private unsubscribeCatalog?: () => void;
  private destroyed = false;

  private requestId = 0;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement | HTMLInputElement,
    callbacks: SlashCommandDropdownCallbacks,
    options: SlashCommandDropdownOptions = {}
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.isFixed = options.fixed ?? false;
    this.staticEntries = options.staticEntries ?? [];
    this.catalogConfig = options.catalogConfig ?? null;
    this.getEntries = options.getEntries ?? null;
    this.catalogSubscribe = options.subscribeCatalogChanges;
    this.subscribeToCatalog();

    this.onInput = () => this.handleInputChange();
    this.inputEl.addEventListener('input', this.onInput);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }

  setCatalog(
    config: SlashCommandDropdownConfig,
    getEntries: () => Promise<SlashCommandDropdownEntry[]>,
    subscribe?: (listener: () => void) => () => void,
  ): void {
    this.catalogConfig = config;
    this.getEntries = getEntries;
    this.catalogSubscribe = subscribe;
    this.subscribeToCatalog();
    this.resetCatalogCache();
  }

  handleInputChange(): void {
    if (!this.enabled || this.destroyed) return;

    const text = this.getInputValue();
    const cursorPos = this.getCursorPosition();
    const textBeforeCursor = text.substring(0, cursorPos);
    const triggerChars = this.catalogConfig?.triggerChars ?? ['/'];

    // Scan backward from cursor for the nearest valid trigger char.
    // Valid trigger: at position 0, or preceded by whitespace.
    let triggerIndex = -1;
    let triggerChar = '';

    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = textBeforeCursor.charAt(i);
      if (/\s/.test(ch)) break;
      if (triggerChars.includes(ch)) {
        if (i === 0 || /\s/.test(textBeforeCursor.charAt(i - 1))) {
          triggerIndex = i;
          triggerChar = ch;
        }
        break;
      }
    }

    if (triggerIndex === -1) {
      this.hide();
      return;
    }

    const searchText = textBeforeCursor.substring(triggerIndex + 1);

    if (/\s/.test(searchText)) {
      this.hide();
      return;
    }

    this.triggerStartIndex = triggerIndex;
    this.activeTriggerChar = triggerChar;
    const isAtPosition0 = triggerIndex === 0;
    void this.showDropdown(searchText, isAtPosition0);
  }

  handleKeydown(e: KeyboardEvent): boolean {
    if (e.isComposing || !this.enabled || !this.isVisible()) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.navigate(1);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.navigate(-1);
        return true;
      case 'Enter':
      case 'Tab':
        if (this.filteredItems.length > 0) {
          e.preventDefault();
          this.selectItem();
          return true;
        }
        return false;
      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;
    }
    return false;
  }

  isVisible(): boolean {
    return this.dropdownEl?.hasClass('visible') ?? false;
  }

  hide(): void {
    if (this.dropdownEl) {
      this.dropdownEl.removeClass('visible');
    }
    this.triggerStartIndex = -1;
    this.callbacks.onHide();
  }

  destroy(): void {
    this.destroyed = true;
    this.requestId++;
    this.catalogGeneration++;
    this.fetchState = null;
    this.inputEl.removeEventListener('input', this.onInput);
    this.unsubscribeCatalog?.();
    this.unsubscribeCatalog = undefined;
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
  }

  resetCatalogCache(): void {
    this.cachedEntries = [];
    this.entriesFetched = false;
    // Invalidate both pending renders and in-flight fetch results. Request IDs
    // must remain monotonic so an old request can never match a newer one.
    this.requestId++;
    this.catalogGeneration++;
    this.fetchState = null;
  }

  private getInputValue(): string {
    return this.inputEl.value;
  }

  private getCursorPosition(): number {
    return this.inputEl.selectionStart || 0;
  }

  private setInputValue(value: string): void {
    this.inputEl.value = value;
  }

  private setCursorPosition(pos: number): void {
    this.inputEl.selectionStart = pos;
    this.inputEl.selectionEnd = pos;
  }

  private async showDropdown(searchText: string, isAtPosition0 = true): Promise<void> {
    const currentRequest = ++this.requestId;

    // Render immediately with built-in commands and any cached entries so the
    // dropdown never waits on CLI startup; refresh in the background instead.
    this.renderWithCurrentData(searchText, isAtPosition0);

    if (this.entriesFetched || !this.getEntries) return;

    await this.fetchEntries();

    if (this.destroyed || currentRequest !== this.requestId) return;

    this.renderWithCurrentData(searchText, isAtPosition0);
  }

  private renderWithCurrentData(searchText: string, isAtPosition0: boolean): void {
    const searchLower = searchText.toLowerCase();
    const includeBuiltIns = isAtPosition0 && this.activeTriggerChar === '/';
    const allItems = this.buildItemList(includeBuiltIns);

    this.filteredItems = allItems
      .filter(item =>
        item.name.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower)
      )
      .sort((a, b) => {
        const priorityDifference =
          getSearchMatchPriority(a, searchLower) - getSearchMatchPriority(b, searchLower);
        return priorityDifference || a.name.localeCompare(b.name);
      });

    if (searchText.length > 0 && this.filteredItems.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = 0;
    this.render();
  }

  private async fetchEntries(): Promise<void> {
    if (this.entriesFetched || !this.getEntries) return;

    const generation = this.catalogGeneration;
    if (!this.fetchState || this.fetchState.generation !== generation) {
      const getEntries = this.getEntries;
      const promise = getEntries().then((entries) => {
        if (
          !this.destroyed
          && generation === this.catalogGeneration
          && getEntries === this.getEntries
        ) {
          this.cachedEntries = entries;
          // Empty results are authoritative and should be cached too.
          this.entriesFetched = true;
        }
      }).catch(() => {
        // Leave entriesFetched false so the next input can retry.
      }).finally(() => {
        if (this.fetchState?.generation === generation) {
          this.fetchState = null;
        }
      });
      this.fetchState = { generation, promise };
    }

    await this.fetchState.promise;
  }

  private subscribeToCatalog(): void {
    this.unsubscribeCatalog?.();
    this.unsubscribeCatalog = undefined;
    if (!this.catalogSubscribe) return;
    this.unsubscribeCatalog = this.catalogSubscribe(() => this.handleCatalogChange());
  }

  private handleCatalogChange(): void {
    this.resetCatalogCache();
    // Refresh the visible dropdown; otherwise the next open picks up new data.
    if (this.isVisible()) {
      this.handleInputChange();
    }
  }

  private buildItemList(includeBuiltIns: boolean): DropdownItem[] {
    const seenNames = new Set<string>();
    const items: DropdownItem[] = [];

    if (includeBuiltIns) {
      for (const entry of this.staticEntries) {
        this.appendEntry(items, seenNames, entry, true);
      }
    }

    for (const entry of this.cachedEntries) {
      this.appendEntry(items, seenNames, entry, false);
    }

    return items;
  }

  private appendEntry(
    items: DropdownItem[],
    seenNames: Set<string>,
    entry: SlashCommandDropdownEntry,
    isBuiltIn: boolean,
  ): void {
    const nameLower = entry.name.toLowerCase();
    if (seenNames.has(nameLower)) return;

    seenNames.add(nameLower);
    items.push({
      name: entry.name,
      description: entry.description,
      argumentHint: entry.argumentHint,
      content: entry.content,
      displayPrefix: entry.displayPrefix,
      insertPrefix: entry.insertPrefix,
      isBuiltIn,
      slashCommand: {
        id: entry.id,
        name: entry.name,
        description: entry.description,
        content: entry.content,
        argumentHint: entry.argumentHint,
        allowedTools: entry.allowedTools,
        model: entry.model,
        source: entry.source,
        kind: entry.kind,
        disableModelInvocation: entry.disableModelInvocation,
        userInvocable: entry.userInvocable,
        context: entry.context,
        agent: entry.agent,
        hooks: entry.hooks,
      },
    });
  }

  private render(): void {
    if (!this.dropdownEl) {
      this.dropdownEl = this.createDropdownElement();
    }

    this.dropdownEl.empty();

    if (this.filteredItems.length === 0) {
      const emptyEl = this.dropdownEl.createDiv({ cls: 'qoderian-slash-empty' });
      emptyEl.setText('No matching commands');
    } else {
      for (let i = 0; i < this.filteredItems.length; i++) {
        const item = this.filteredItems[i];
        const itemEl = this.dropdownEl.createDiv({ cls: 'qoderian-slash-item' });

        if (i === this.selectedIndex) {
          itemEl.addClass('selected');
        }

        const nameEl = itemEl.createSpan({ cls: 'qoderian-slash-name' });
        nameEl.setText(`${item.displayPrefix}${item.name}`);

        if (item.argumentHint) {
          const hintEl = itemEl.createSpan({ cls: 'qoderian-slash-hint' });
          hintEl.setText(normalizeArgumentHint(item.argumentHint));
        }

        if (item.description) {
          const descEl = itemEl.createDiv({ cls: 'qoderian-slash-desc' });
          descEl.setText(item.description);
        }

        itemEl.addEventListener('click', () => {
          this.selectedIndex = i;
          this.selectItem();
        });

        itemEl.addEventListener('mouseenter', () => {
          this.selectedIndex = i;
          this.updateSelection();
        });
      }
    }

    this.dropdownEl.addClass('visible');

    if (this.isFixed) {
      this.positionFixed();
    }
  }

  private createDropdownElement(): HTMLElement {
    if (this.isFixed) {
      return this.containerEl.createDiv({
        cls: 'qoderian-slash-dropdown qoderian-slash-dropdown-fixed',
      });
    } else {
      return this.containerEl.createDiv({ cls: 'qoderian-slash-dropdown' });
    }
  }

  private positionFixed(): void {
    if (!this.dropdownEl || !this.isFixed) return;

    const inputRect = this.inputEl.getBoundingClientRect();
    this.dropdownEl.setCssProps({
      '--qoderian-fixed-dropdown-bottom': `${window.innerHeight - inputRect.top + 4}px`,
      '--qoderian-fixed-dropdown-left': `${inputRect.left}px`,
      '--qoderian-fixed-dropdown-width': `${Math.max(inputRect.width, 280)}px`,
    });
  }

  private navigate(direction: number): void {
    const maxIndex = this.filteredItems.length - 1;
    this.selectedIndex = Math.max(0, Math.min(maxIndex, this.selectedIndex + direction));
    this.updateSelection();
  }

  private updateSelection(): void {
    const items = this.dropdownEl?.querySelectorAll('.qoderian-slash-item');
    items?.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.addClass('selected');
        (item as HTMLElement).scrollIntoView({ block: 'nearest' });
      } else {
        item.removeClass('selected');
      }
    });
  }

  private selectItem(): void {
    if (this.filteredItems.length === 0) return;

    const selected = this.filteredItems[this.selectedIndex];
    if (!selected) return;

    const text = this.getInputValue();
    const beforeTrigger = text.substring(0, this.triggerStartIndex);
    const afterCursor = text.substring(this.getCursorPosition());
    const replacement = `${selected.insertPrefix}${selected.name} `;

    this.setInputValue(beforeTrigger + replacement + afterCursor);
    this.setCursorPosition(beforeTrigger.length + replacement.length);

    this.hide();
    if (selected.slashCommand) {
      this.callbacks.onSelect(selected.slashCommand);
    }
    this.inputEl.focus();
  }
}
