import { createMockEl } from '@test/helpers/mock-element';
import { Menu } from 'obsidian';

import { TabBar } from '@/features/chat/tabs/tab-bar';
import type { TabBarItem } from '@/features/chat/tabs/types';

type MockMenuInstance = Menu & {
  items: Array<{ clickHandler: (() => void) | null }>;
  showAtPosition: jest.Mock;
};

const MockMenu = Menu as typeof Menu & { instances: MockMenuInstance[] };

function item(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Conversation one',
    isActive: true,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}

describe('TabBar', () => {
  beforeEach(() => {
    MockMenu.instances.length = 0;
  });

  it('renders a dedicated actions menu only for closable tabs', () => {
    const container = createMockEl();
    const tabBar = new TabBar(container, {
      onTabClick: jest.fn(),
      onTabClose: jest.fn(),
      onNewTab: jest.fn(),
    });

    tabBar.update([
      item(),
      item({ id: 'tab-2', index: 2, canClose: false }),
    ]);

    const badges = container.querySelectorAll('.qoderian-tab-badge');
    expect(badges[0].querySelector('.qoderian-tab-badge-menu')).not.toBeNull();
    expect(badges[1].querySelector('.qoderian-tab-badge-menu')).toBeNull();
  });

  it('opens a menu without activating or immediately closing the tab', () => {
    const container = createMockEl();
    const onTabClick = jest.fn();
    const onTabClose = jest.fn();
    const tabBar = new TabBar(container, {
      onTabClick,
      onTabClose,
      onNewTab: jest.fn(),
    });
    tabBar.update([item()]);

    const menuEl = container.querySelector('.qoderian-tab-badge-menu')!;
    const event = {
      type: 'click',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    menuEl.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onTabClose).not.toHaveBeenCalled();
    expect(onTabClick).not.toHaveBeenCalled();
    expect(MockMenu.instances).toHaveLength(1);
    expect(MockMenu.instances[0].showAtPosition).toHaveBeenCalledTimes(1);

    MockMenu.instances[0].items[0].clickHandler?.();
    expect(onTabClose).toHaveBeenCalledWith('tab-1');
  });

  it('keeps the actions menu when expanding and collapsing a title', () => {
    const container = createMockEl();
    const tabBar = new TabBar(container, {
      onTabClick: jest.fn(),
      onTabClose: jest.fn(),
      onNewTab: jest.fn(),
    });
    tabBar.update([item()]);

    const badge = container.querySelector('.qoderian-tab-badge')!;
    badge.dispatchEvent({
      type: 'dblclick',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(badge.querySelector('.qoderian-tab-badge-label')?.textContent).toBe('Conversation one');
    expect(badge.querySelector('.qoderian-tab-badge-menu')).not.toBeNull();

    badge.dispatchEvent({
      type: 'dblclick',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(badge.querySelector('.qoderian-tab-badge-label')?.textContent).toBe('1');
    expect(badge.querySelector('.qoderian-tab-badge-menu')).not.toBeNull();
  });
});
