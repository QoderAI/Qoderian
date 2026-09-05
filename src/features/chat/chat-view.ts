import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Notice, Scope, setIcon } from 'obsidian';

import { finishRestoreReport } from '../../core/diagnostics/restore-report';
import { VIEW_TYPE_QODERIAN } from '../../core/types';
import { t } from '../../i18n/i18n';
import type QoderianPlugin from '../../main';
import { fetchCreditsUsage } from '../../qoder/services/credits-usage';
import { openExternalBrowserUrl } from '../../qoder/services/qoder-login-service';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../shared/dom/animation-frame';
import { setButtonTooltip } from '../../shared/dom/tooltip';
import { createIconSvg, QODER_ICON, QODERIAN_ICON_ID } from '../../shared/icons';
import { QoderianSettingsModal } from '../settings/settings-modal';
import type { HistoryConversationStatus } from './controllers/conversation-controller';
import {
  sendTabInputMessageFromExplicitEnterShortcut,
} from './tabs/tab';
import { TabBar } from './tabs/tab-bar';
import { TabManager } from './tabs/tab-manager';
import { DEFAULT_MAX_TABS, type TabData, type TabId } from './tabs/types';
import { CreditsUsageButton } from './ui/credits-usage-button';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class QoderianView extends ItemView {
  private plugin: QoderianPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;
  private inputFooterEl: HTMLElement | null = null;
  private inputNavRowHostEl: HTMLElement | null = null;
  private activeInputSlotEl: HTMLElement | null = null;
  private activeInputTabId: TabId | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private updateBadgeEl: HTMLElement | null = null;
  private newTabButtonEl: HTMLElement | null = null;
  private historyButtonEl: HTMLElement | null = null;
  private settingsButtonEl: HTMLElement | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;
  private creditsUsageButton: CreditsUsageButton | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Latest tab-state write, used to flush the final state during view close.
  private pendingPersist: Promise<void> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: QoderianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches QoderianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this);
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_QODERIAN;
  }

  getDisplayText(): string {
    return 'Qoderian';
  }

  getIcon(): string {
    return QODERIAN_ICON_ID;
  }

  invalidateQoderCommandCaches(): void {
    this.tabManager?.invalidateQoderCommandCaches();
  }

  async onOpen() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('qoderian-container');

    const header = this.viewContainerEl.createDiv({ cls: 'qoderian-header' });
    this.buildHeader(header);

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'qoderian-tab-content-container' });
    this.buildInputFooter();

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.syncHeaderLogo();
        },
        onActiveTabChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.syncHeaderLogo();
        },
        onTabSwitched: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
          this.syncHeaderLogo();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.updateInputLocation();
          this.persistTabState();
        },
        onTabStreamingChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
        },
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.updateHistoryDropdown();
          this.persistTabState();
          this.syncHeaderLogo();
        },
      }
    );

    this.wireEventHandlers();
    await this.restoreOrCreateTabs();
    this.syncHeaderLogo();
    this.attachNavRowContentToInputFooter();
    this.updateInputLocation();
    this.updateTabBarVisibility();
  }

  async onClose() {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    await this.persistTabStateImmediate();

    this.restoreActiveInputToTabContent();
    await this.tabManager?.destroy();
    this.tabManager = null;

    this.tabBar?.destroy();
    this.tabBar = null;

    this.creditsUsageButton?.destroy();
    this.creditsUsageButton = null;
    this.scope = null;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement): void {
    const titleEl = header.createDiv({ cls: 'qoderian-title' });

    this.logoEl = titleEl.createSpan({ cls: 'qoderian-logo' });
    this.syncHeaderLogo();

    titleEl.createEl('h4', { text: 'Qoder', cls: 'qoderian-title-text' });

    this.updateBadgeEl = titleEl.createEl('button', {
      cls: 'qoderian-update-badge qoderian-hidden',
      attr: { type: 'button' },
    });
    void this.refreshUpdateBadge();

    const actionsEl = header.createDiv({ cls: 'qoderian-header-actions' });

    // History belongs to the view-level chrome rather than the active tab's
    // composer, so it stays reachable while the input is tall or scrolled.
    const historyContainer = actionsEl.createDiv({ cls: 'qoderian-history-container' });
    const historyBtn = historyContainer.createDiv({
      cls: 'qoderian-input-nav-btn qoderian-header-action qoderian-history-btn',
    });
    setIcon(historyBtn, 'history');
    setButtonTooltip(historyBtn, t('nav.chatHistory'));
    historyBtn.setAttribute('role', 'button');
    historyBtn.setAttribute('tabindex', '0');
    historyBtn.setAttribute('aria-haspopup', 'listbox');
    historyBtn.setAttribute('aria-expanded', 'false');
    this.historyButtonEl = historyBtn;

    this.historyDropdown = historyContainer.createDiv({ cls: 'qoderian-history-menu' });
    this.historyDropdown.setAttribute('role', 'listbox');

    const toggleHistory = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleHistoryDropdown();
    };
    historyBtn.addEventListener('click', toggleHistory);
    historyBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') toggleHistory(event);
    });

    // Credits usage is account-level, so it sits beside history in the fixed
    // header instead of moving with the active tab's composer.
    const agentCatalog = this.plugin.qoderServices.agentCatalog;
    this.creditsUsageButton = new CreditsUsageButton(actionsEl, {
      getCachedUsage: () => agentCatalog.getUsageInfo(),
      fetchUsage: () => fetchCreditsUsage(this.plugin),
      subscribeRuntimeStatus: (listener) => agentCatalog.subscribeRuntimeStatus(listener),
    });

    const settingsBtn = actionsEl.createDiv({
      cls: 'qoderian-input-nav-btn qoderian-header-action qoderian-settings-btn',
    });
    setIcon(settingsBtn, 'settings');
    setButtonTooltip(settingsBtn, t('common.settings'));
    settingsBtn.setAttribute('role', 'button');
    settingsBtn.setAttribute('tabindex', '0');
    this.settingsButtonEl = settingsBtn;

    const openSettings = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      this.openSettings();
    };
    settingsBtn.addEventListener('click', openSettings);
    settingsBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openSettings(event);
    });
  }

  /**
   * Builds the active tab nav row content.
   * The wrapper is moved to the active tab's nav row on tab switches.
   */
  private buildNavRowContent(): HTMLElement {
    const wrapper = createDiv({ cls: 'qoderian-input-nav-content' });

    this.tabBarContainerEl = wrapper.createDiv({ cls: 'qoderian-tab-bar-container' });
    this.tabBar = new TabBar(this.tabBarContainerEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Failed to create tab'));
      },
    });

    this.newTabButtonEl = wrapper.createEl('button', {
      cls: 'qoderian-input-nav-btn qoderian-new-tab-btn',
      attr: { type: 'button' },
    });
    setIcon(this.newTabButtonEl, 'plus');
    setButtonTooltip(this.newTabButtonEl, t('commands.newTab'));
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice('Failed to create tab'));
    });

    return wrapper;
  }

  private buildInputFooter(): void {
    if (!this.viewContainerEl) return;

    this.inputFooterEl = this.viewContainerEl.createDiv({ cls: 'qoderian-input-footer' });
    this.inputNavRowHostEl = this.inputFooterEl.createDiv({
      cls: 'qoderian-input-nav-row qoderian-view-input-nav-row',
    });
    this.activeInputSlotEl = this.inputFooterEl.createDiv({ cls: 'qoderian-active-input-slot' });
  }

  private attachNavRowContentToInputFooter(): void {
    if (!this.inputNavRowHostEl || !this.navRowContent) return;

    this.tabBar?.captureScrollPosition();
    this.inputNavRowHostEl.appendChild(this.navRowContent);
    this.tabBar?.restoreScrollPosition();
  }

  private updateInputLocation(): void {
    const activeTab = this.tabManager?.getActiveTab();
    if (!this.activeInputSlotEl) return;

    if (!activeTab) {
      this.activeInputSlotEl.empty();
      this.activeInputTabId = null;
      return;
    }

    if (this.activeInputTabId && this.activeInputTabId !== activeTab.id) {
      const previousTab = this.tabManager?.getTab(this.activeInputTabId);
      if (previousTab) {
        previousTab.dom.contentEl.appendChild(previousTab.dom.inputComposerEl);
      }
    }

    if (this.activeInputTabId === activeTab.id) {
      if (activeTab.dom.inputComposerEl.parentElement !== this.activeInputSlotEl) {
        this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
      }
      return;
    }

    this.activeInputSlotEl.empty();
    this.activeInputSlotEl.appendChild(activeTab.dom.inputComposerEl);
    this.activeInputTabId = activeTab.id;
  }

  private restoreActiveInputToTabContent(): void {
    if (!this.activeInputTabId) return;

    const activeInputTab = this.tabManager?.getTab(this.activeInputTabId);
    if (activeInputTab) {
      activeInputTab.dom.contentEl.appendChild(activeInputTab.dom.inputComposerEl);
    }
    this.activeInputSlotEl?.empty();
    this.activeInputTabId = null;
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  /** Re-applies locale-dependent static text after a language change. */
  refreshLocalizedChrome(): void {
    if (this.newTabButtonEl) setButtonTooltip(this.newTabButtonEl, t('commands.newTab'));
    if (this.historyButtonEl) setButtonTooltip(this.historyButtonEl, t('nav.chatHistory'));
    if (this.settingsButtonEl) setButtonTooltip(this.settingsButtonEl, t('common.settings'));
    if (this.updateBadgeEl?.dataset.version) {
      this.updateBadgeEl.setText(t('updates.available', { version: this.updateBadgeEl.dataset.version }));
      this.updateBadgeEl.setAttribute(
        'aria-label',
        t('updates.openRelease', { version: this.updateBadgeEl.dataset.version }),
      );
    }
    this.creditsUsageButton?.refreshLocale();
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.composerResize?.refreshLocale();
    }
    this.updateTabBar();
  }

  private async refreshUpdateBadge(): Promise<void> {
    const badge = this.updateBadgeEl;
    if (!badge) return;

    const update = await this.plugin.getAvailableUpdate();
    if (!update || this.updateBadgeEl !== badge) return;

    badge.dataset.version = update.version;
    badge.setText(t('updates.available', { version: update.version }));
    badge.setAttribute('aria-label', t('updates.openRelease', { version: update.version }));
    badge.removeClass('qoderian-hidden');
    badge.addEventListener('click', () => openExternalBrowserUrl(update.url), { once: true });
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice('Failed to switch tab'));
    }
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      const tab = this.tabManager?.getTab(tabId);
      // If streaming, treat close like user interrupt (force close cancels the stream)
      const force = tab?.state.isStreaming ?? false;
      await this.tabManager?.closeTab(tabId, force);
      this.updateTabBarVisibility();
    } catch {
      new Notice('Failed to close tab');
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? DEFAULT_MAX_TABS;
      new Notice(`Maximum ${maxTabs} tabs allowed`);
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;

    this.tabBarContainerEl.toggleClass('qoderian-hidden', !showTabBar);

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('qoderian-hidden', !canCreateTab);
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  /** Ensures the fixed Qoder logo is mounted in the header. */
  private syncHeaderLogo(): void {
    if (!this.logoEl) return;
    const existing = this.logoEl.querySelector('svg');
    if (existing) return;
    this.logoEl.empty();
    const svg = createIconSvg(QODER_ICON, {
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.historyDropdown.removeClass('visible');
      this.historyButtonEl?.setAttribute('aria-expanded', 'false');
    } else {
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
      this.historyButtonEl?.setAttribute('aria-expanded', 'true');
    }
  }

  private openSettings(): void {
    new QoderianSettingsModal(this.plugin).open();
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationStatus: (id) => this.getHistoryConversationStatus(id),
      });
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.historyDropdown?.removeClass('visible');
    this.historyButtonEl?.setAttribute('aria-expanded', 'false');
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.historyDropdown?.removeClass('visible');
    this.historyButtonEl?.setAttribute('aria-expanded', 'false');
  }

  private getHistoryConversationStatus(conversationId: string): HistoryConversationStatus {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return {
        openState: 'current',
        isRunning: activeTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(activeTab),
      };
    }

    const localTab = this.findTabWithConversation(conversationId);
    if (localTab) {
      return {
        openState: 'open',
        isRunning: localTab.state.isStreaming,
        location: 'current-view',
        tabIndex: this.getHistoryTabIndex(localTab),
      };
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      const crossViewTab = crossViewResult.view.getTabManager()?.getTab(crossViewResult.tabId);
      return {
        openState: 'open',
        isRunning: crossViewTab?.state.isStreaming ?? false,
        location: 'other-view',
      };
    }

    return {
      openState: 'closed',
      isRunning: false,
      location: 'current-view',
    };
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  private getHistoryTabIndex(tab: TabData): number | undefined {
    const index = this.tabManager?.getAllTabs().findIndex(candidate => candidate.id === tab.id) ?? -1;
    return index >= 0 ? index + 1 : undefined;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.historyDropdown?.removeClass('visible');
      this.historyButtonEl?.setAttribute('aria-expanded', 'false');
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.eventRefs.push(
      this.plugin.app.vault.on('create', () => markCacheDirty(true)),
      this.plugin.app.vault.on('delete', () => markCacheDirty(true)),
      this.plugin.app.vault.on('rename', () => markCacheDirty(true)),
      this.plugin.app.vault.on('modify', () => markCacheDirty(false))
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    try {
      if (!this.tabManager) return;

      // Try to restore from persisted state
      const persistedState = await this.plugin.storage.getTabManagerState();
      if (persistedState && persistedState.openTabs.length > 0) {
        await this.tabManager.restoreState(persistedState);
      } else {
        // Fallback: create a new empty tab
        await this.tabManager.createTab();
      }
    } finally {
      // Drain startup restore diagnostics and surface them once, aggregated.
      const issues = finishRestoreReport();
      if (issues.length > 0) {
        new Notice(t('restore.failed', { count: issues.length }), 10000);
      }
    }
  }

  /**
   * Starts persistence of the tab layout state immediately. Tab mutations are
   * infrequent, and delaying the write until a timer fires risks losing the
   * latest state when Obsidian unloads the plugin.
   *
   * Public so the plugin can request persistence for changes made outside
   * TabManager callbacks (e.g. draft model changes on blank tabs).
   */
  persistTabState(): void {
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    const write = this.plugin.persistTabManagerState(state).catch(() => {
      // Persistence is best-effort; later state changes will retry.
    }).finally(() => {
      if (this.pendingPersist === write) {
        this.pendingPersist = null;
      }
    });
    this.pendingPersist = write;
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    if (!this.tabManager) return;
    const state = this.tabManager.getPersistedState();
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Gets shared view controls that should preserve active tab selection context. */
  getSharedSelectionFocusScopeEls(): HTMLElement[] {
    return [
      this.inputNavRowHostEl,
    ].filter((el): el is HTMLElement => el !== null);
  }
}
