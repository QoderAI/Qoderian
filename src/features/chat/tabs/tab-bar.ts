import { Menu, setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { scheduleAnimationFrame } from '../../../shared/dom/animation-frame';
import { setButtonTooltip } from '../../../shared/dom/tooltip';
import type { TabBarItem, TabId } from './types';

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

/**
 * TabBar renders minimal numbered badge navigation.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private expandedTitleTabIds = new Set<TabId>();
  private lastKnownScrollLeft = 0;
  private readonly handleScroll = (): void => {
    this.captureScrollPosition();
  };

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('qoderian-tab-badges');
    this.containerEl.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    this.captureStableScrollPosition();
    this.pruneExpandedTitleState(items);

    // Clear existing badges
    this.containerEl.empty();

    // Render badges
    for (const item of items) {
      this.renderBadge(item);
    }

    this.restoreScrollPosition();
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): void {
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'qoderian-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'qoderian-tab-badge-active';
    } else if (item.needsAttention) {
      stateClass = 'qoderian-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'qoderian-tab-badge-streaming';
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    const badgeEl = this.containerEl.createDiv({
      cls: [
        'qoderian-tab-badge',
        stateClass,
        item.canClose ? 'qoderian-tab-badge-closable' : '',
        isTitleExpanded ? 'qoderian-tab-badge-expanded' : '',
      ].filter(Boolean).join(' '),
    });
    const labelEl = badgeEl.createSpan({
      cls: 'qoderian-tab-badge-label',
      text: this.getBadgeLabel(item),
    });

    // Obsidian uses aria-label for hover tooltips here; adding title causes duplicate tooltip text.
    setButtonTooltip(badgeEl, item.title);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');

    if (item.canClose) {
      const menuEl = badgeEl.createSpan({ cls: 'qoderian-tab-badge-menu' });
      menuEl.setAttribute('role', 'button');
      menuEl.setAttribute('tabindex', '0');
      menuEl.setAttribute('aria-haspopup', 'menu');
      setIcon(menuEl, 'ellipsis');
      setButtonTooltip(menuEl, t('commands.tabActions'));

      const openMenu = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        this.showTabMenu(item, menuEl);
      };
      menuEl.addEventListener('click', openMenu);
      menuEl.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      menuEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          openMenu(event);
        }
      });
    }

    // Click handler to switch tab
    badgeEl.addEventListener('click', () => {
      this.captureScrollPosition();
      this.callbacks.onTabClick(item.id);
    });

    badgeEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleBadgeTitle(item, badgeEl, labelEl);
    });

    // Right-click opens the same menu instead of deleting immediately.
    if (item.canClose) {
      badgeEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTabMenu(item, badgeEl);
      });
    }
  }

  private showTabMenu(item: TabBarItem, anchorEl: HTMLElement): void {
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem(menuItem => menuItem
      .setTitle(t('commands.closeTab'))
      .setIcon('x')
      .setWarning(true)
      .onClick(() => this.callbacks.onTabClose(item.id)));

    const rect = anchorEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.right, y: rect.bottom }, anchorEl.ownerDocument);
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('qoderian-tab-badges');
    this.containerEl.removeEventListener('scroll', this.handleScroll);
    this.expandedTitleTabIds.clear();
    this.lastKnownScrollLeft = 0;
  }

  captureScrollPosition(): void {
    this.lastKnownScrollLeft = this.containerEl.scrollLeft;
  }

  restoreScrollPosition(): void {
    const scrollLeft = this.lastKnownScrollLeft;
    this.containerEl.scrollLeft = scrollLeft;
    if (scrollLeft <= 0) return;

    scheduleAnimationFrame(() => {
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

  private pruneExpandedTitleState(items: TabBarItem[]): void {
    const visibleTabIds = new Set(items.map(item => item.id));
    for (const tabId of this.expandedTitleTabIds) {
      if (!visibleTabIds.has(tabId)) {
        this.expandedTitleTabIds.delete(tabId);
      }
    }
  }

  private toggleBadgeTitle(
    item: TabBarItem,
    badgeEl: HTMLElement,
    labelEl: HTMLElement,
  ): void {
    if (this.expandedTitleTabIds.has(item.id)) {
      this.expandedTitleTabIds.delete(item.id);
    } else {
      this.expandedTitleTabIds.add(item.id);
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    labelEl.textContent = this.getBadgeLabel(item);
    badgeEl.toggleClass('qoderian-tab-badge-expanded', isTitleExpanded);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
  }

  private getBadgeLabel(item: TabBarItem): string {
    if (!this.expandedTitleTabIds.has(item.id)) {
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
