import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { scheduleAnimationFrame } from '../../../shared/dom/animation-frame';
import { setButtonTooltip } from '../../../shared/dom/tooltip';
import type { TabBarItem, TabId } from './types';

const EDGE_PADDING = 8;
const EXPANDED_TITLE_MAX_LENGTH = 32;
const TRUNCATED_TITLE_SUFFIX = '...';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;
}

export interface TabBarOptions {
  /** Legacy numbered badges; false renders the session pills. */
  isLegacyMode?: () => boolean;
}

/**
 * TabBar renders the session tabs of the active tab's composer row:
 * numbered badges (legacy) or titled pills with a close affordance.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private isLegacyMode: () => boolean;
  private lastKnownScrollLeft = 0;
  private lastActiveTabId: TabId | null = null;
  private expandedTitleTabIds = new Set<TabId>();
  private readonly handleScroll = (): void => {
    this.captureScrollPosition();
  };

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks, options: TabBarOptions = {}) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.isLegacyMode = options.isLegacyMode ?? (() => false);
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('qoderian-tab-badges');
    this.syncLegacyClass();
    this.containerEl.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    const legacy = this.isLegacyMode();
    this.captureStableScrollPosition();
    this.syncLegacyClass();
    if (legacy) {
      this.pruneExpandedTitleState(items);
    }

    // Clear existing badges
    this.containerEl.empty();

    // Render badges
    for (const item of items) {
      if (legacy) {
        this.renderLegacyBadge(item);
      } else {
        this.renderSessionPill(item);
      }
    }

    this.restoreScrollPosition();

    if (legacy) {
      return;
    }

    // Only follow the active pill when the active tab actually changes, so a
    // user scrolling through the strip is not yanked back by unrelated updates.
    const activeId = items.find(item => item.isActive)?.id ?? null;
    if (activeId !== this.lastActiveTabId) {
      this.revealActiveBadge(items);
      this.lastActiveTabId = activeId;
    }
  }

  /** Creates the badge shell both renderings share: state class, tooltip, click. */
  private createBadgeEl(item: TabBarItem, variantClass: string): HTMLElement {
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'qoderian-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'qoderian-tab-badge-active';
    } else if (item.needsAttention) {
      stateClass = 'qoderian-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'qoderian-tab-badge-streaming';
    }

    const badgeEl = this.containerEl.createDiv({
      cls: ['qoderian-tab-badge', stateClass, variantClass].filter(Boolean).join(' '),
    });

    // Obsidian uses aria-label for hover tooltips here; adding title causes duplicate tooltip text.
    setButtonTooltip(badgeEl, item.title);

    // Click handler to switch tab
    badgeEl.addEventListener('click', () => {
      this.captureScrollPosition();
      this.callbacks.onTabClick(item.id);
    });

    return badgeEl;
  }

  /** Legacy rendering: numbered badge, double-click to expand, right-click to close. */
  private renderLegacyBadge(item: TabBarItem): void {
    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    const badgeEl = this.createBadgeEl(
      item,
      isTitleExpanded ? 'qoderian-tab-badge-expanded' : '',
    );
    const labelEl = badgeEl.createSpan({
      cls: 'qoderian-tab-badge-label',
      text: this.getLegacyBadgeLabel(item, isTitleExpanded),
    });
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');

    badgeEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleBadgeTitle(item, badgeEl, labelEl);
    });

    this.wireRightClickClose(item, badgeEl);
  }

  /** Redesigned rendering: conversation title with a hover close button. */
  private renderSessionPill(item: TabBarItem): void {
    const badgeEl = this.createBadgeEl(
      item,
      item.canClose ? 'qoderian-tab-badge-closable' : '',
    );
    badgeEl.createSpan({ cls: 'qoderian-tab-badge-label', text: item.title });

    this.renderCloseAffordance(item, badgeEl);
    this.wireRightClickClose(item, badgeEl);
  }

  /** Right-click closes the tab when it can be closed. */
  private wireRightClickClose(item: TabBarItem, badgeEl: HTMLElement): void {
    if (!item.canClose) {
      return;
    }

    badgeEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.callbacks.onTabClose(item.id);
    });
  }

  /** Adds the hover close button of the session pills. */
  private renderCloseAffordance(item: TabBarItem, badgeEl: HTMLElement): void {
    if (!item.canClose) {
      return;
    }

    const closeEl = badgeEl.createSpan({ cls: 'qoderian-tab-badge-close' });
    closeEl.setAttribute('role', 'button');
    closeEl.setAttribute('tabindex', '0');
    setIcon(closeEl, 'x');
    setButtonTooltip(closeEl, t('nav.closeSession'));

    const closeTab = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onTabClose(item.id);
    };
    closeEl.addEventListener('click', closeTab);
    closeEl.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    closeEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        closeTab(event);
      }
    });
  }

  /** Scrolls the active pill into the strip's viewport. */
  private revealActiveBadge(items: TabBarItem[]): void {
    const index = items.findIndex(item => item.isActive);
    const badge = index >= 0 ? this.containerEl.children[index] as HTMLElement | undefined : undefined;
    if (!badge || typeof badge.getBoundingClientRect !== 'function') {
      return;
    }

    const viewport = this.containerEl.getBoundingClientRect();
    const rect = badge.getBoundingClientRect();
    // Unmeasured (hidden view) or already visible: nothing to do.
    if (!viewport.width || !rect.width) {
      return;
    }
    if (rect.left >= viewport.left && rect.right <= viewport.right) {
      return;
    }

    const delta = rect.left < viewport.left
      ? rect.left - viewport.left - EDGE_PADDING
      : rect.right - viewport.right + EDGE_PADDING;
    this.containerEl.scrollLeft = Math.max(0, this.containerEl.scrollLeft + delta);
    this.captureScrollPosition();
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('qoderian-tab-badges');
    this.containerEl.removeClass('qoderian-tab-badges--legacy');
    this.containerEl.removeEventListener('scroll', this.handleScroll);
    this.expandedTitleTabIds.clear();
    this.lastKnownScrollLeft = 0;
    this.lastActiveTabId = null;
  }

  captureScrollPosition(): void {
    this.lastKnownScrollLeft = this.containerEl.scrollLeft;
  }

  restoreScrollPosition(): void {
    const scrollLeft = this.lastKnownScrollLeft;
    this.containerEl.scrollLeft = scrollLeft;
    if (scrollLeft <= 0) return;

    scheduleAnimationFrame(() => {
      // A newer position (e.g. revealing the active pill) took over meanwhile.
      if (this.lastKnownScrollLeft !== scrollLeft) return;
      if (this.containerEl.scrollLeft !== 0) return;
      this.containerEl.scrollLeft = scrollLeft;
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private captureStableScrollPosition(): void {
    const currentScrollLeft = this.containerEl.scrollLeft;
    if (currentScrollLeft > 0 || this.lastKnownScrollLeft === 0) {
      this.lastKnownScrollLeft = currentScrollLeft;
    }
  }

  private syncLegacyClass(): void {
    this.containerEl.toggleClass('qoderian-tab-badges--legacy', this.isLegacyMode());
  }

  private pruneExpandedTitleState(items: TabBarItem[]): void {
    const visibleTabIds = new Set(items.map(item => item.id));
    for (const tabId of this.expandedTitleTabIds) {
      if (!visibleTabIds.has(tabId)) {
        this.expandedTitleTabIds.delete(tabId);
      }
    }
  }

  private toggleBadgeTitle(item: TabBarItem, badgeEl: HTMLElement, labelEl: HTMLElement): void {
    if (this.expandedTitleTabIds.has(item.id)) {
      this.expandedTitleTabIds.delete(item.id);
    } else {
      this.expandedTitleTabIds.add(item.id);
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    labelEl.textContent = this.getLegacyBadgeLabel(item, isTitleExpanded);
    badgeEl.toggleClass('qoderian-tab-badge-expanded', isTitleExpanded);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
  }

  private getLegacyBadgeLabel(item: TabBarItem, isTitleExpanded: boolean): string {
    if (!isTitleExpanded) {
      return String(item.index);
    }

    return this.truncateExpandedTitle(item.title);
  }

  private truncateExpandedTitle(title: string): string {
    const chars = Array.from(title);
    if (chars.length <= EXPANDED_TITLE_MAX_LENGTH) {
      return title;
    }

    return `${chars.slice(0, EXPANDED_TITLE_MAX_LENGTH - TRUNCATED_TITLE_SUFFIX.length).join('')}${TRUNCATED_TITLE_SUFFIX}`;
  }
}
