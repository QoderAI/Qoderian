import { createMockEl } from '@test/helpers/mock-element';

import { TabBar } from '@/features/chat/tabs/tab-bar';
import type { TabBarItem } from '@/features/chat/tabs/types';

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
  it('renders a dedicated close control only for closable tabs', () => {
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
    expect(badges[0].querySelector('.qoderian-tab-badge-close')).not.toBeNull();
    expect(badges[1].querySelector('.qoderian-tab-badge-close')).toBeNull();
  });

  it('closes the target tab without activating it', () => {
    const container = createMockEl();
    const onTabClick = jest.fn();
    const onTabClose = jest.fn();
    const tabBar = new TabBar(container, {
      onTabClick,
      onTabClose,
      onNewTab: jest.fn(),
    });
    tabBar.update([item()]);

    const closeEl = container.querySelector('.qoderian-tab-badge-close')!;
    const event = {
      type: 'click',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    closeEl.dispatchEvent(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(onTabClose).toHaveBeenCalledWith('tab-1');
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it('keeps the close control when expanding and collapsing a title', () => {
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
    expect(badge.querySelector('.qoderian-tab-badge-close')).not.toBeNull();

    badge.dispatchEvent({
      type: 'dblclick',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(badge.querySelector('.qoderian-tab-badge-label')?.textContent).toBe('1');
    expect(badge.querySelector('.qoderian-tab-badge-close')).not.toBeNull();
  });
});
