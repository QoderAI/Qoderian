import { createMockEl } from '@test/helpers/mock-element';

import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/tab-bar';
import type { TabBarItem } from '@/features/chat/tabs/types';

function makeItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Refactor session loading',
    isActive: true,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}

function makeRect(left: number, right: number): DOMRect {
  return {
    left, right, width: right - left,
    top: 0, bottom: 30, height: 30, x: left, y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Gives the strip a viewport and every rendered pill a horizontal span. */
function installRects(
  containerEl: any,
  viewport: [number, number],
  pills: Array<[number, number]>,
): void {
  containerEl.getBoundingClientRect = () => makeRect(viewport[0], viewport[1]);
  const originalCreateDiv = containerEl.createDiv;
  let index = 0;
  containerEl.createDiv = (opts?: { cls?: string; text?: string }) => {
    const el = originalCreateDiv.call(containerEl, opts);
    const span = pills[index++] ?? [0, 0];
    el.getBoundingClientRect = () => makeRect(span[0], span[1]);
    return el;
  };
}

function createBar(options: { legacy?: boolean } = {}): {
  bar: TabBar;
  containerEl: ReturnType<typeof createMockEl>;
  callbacks: { [K in keyof TabBarCallbacks]: jest.Mock };
} {
  const containerEl = createMockEl();
  const callbacks = {
    onTabClick: jest.fn(),
    onTabClose: jest.fn(),
    onNewTab: jest.fn(),
  };
  const bar = new TabBar(containerEl as unknown as HTMLElement, callbacks, {
    isLegacyMode: () => options.legacy === true,
  });
  return { bar, containerEl, callbacks };
}

describe('TabBar session pills', () => {
  it('labels each pill with the session title', () => {
    const { bar, containerEl } = createBar();

    bar.update([
      makeItem({ id: 'tab-1', title: 'Fix tab labels' }),
      makeItem({ id: 'tab-2', title: 'Ship release', isActive: false }),
    ]);

    const labels = containerEl.querySelectorAll('.qoderian-tab-badge-label') as Array<{ textContent: string }>;
    expect(labels.map(label => label.textContent)).toEqual(['Fix tab labels', 'Ship release']);
  });

  it('renders no close affordance for a lone blank session', () => {
    const { bar, containerEl } = createBar();

    bar.update([makeItem({ canClose: false })]);

    expect(containerEl.querySelector('.qoderian-tab-badge-close')).toBeNull();
    expect(containerEl.children[0].hasClass('qoderian-tab-badge-closable')).toBe(false);
  });

  it('closes the session from the close affordance without switching', () => {
    const { bar, containerEl, callbacks } = createBar();
    bar.update([makeItem({ id: 'tab-2' })]);

    const closeEl = containerEl.querySelector('.qoderian-tab-badge-close');
    closeEl?.dispatchEvent({
      type: 'click',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(callbacks.onTabClose).toHaveBeenCalledWith('tab-2');
    expect(callbacks.onTabClick).not.toHaveBeenCalled();
  });

  it('switches to the session when the pill is clicked', () => {
    const { bar, containerEl, callbacks } = createBar();
    bar.update([makeItem({ id: 'tab-3' })]);

    containerEl.children[0].dispatchEvent({ type: 'click' });

    expect(callbacks.onTabClick).toHaveBeenCalledWith('tab-3');
  });

  it('scrolls the active pill into view when it sits past the right edge', () => {
    const { bar, containerEl } = createBar();
    installRects(containerEl, [0, 200], [[0, 120], [260, 380]]);

    bar.update([
      makeItem({ id: 'tab-1', title: 'First', isActive: false }),
      makeItem({ id: 'tab-2', title: 'Second', isActive: true }),
    ]);

    expect(containerEl.scrollLeft).toBe(380 - 200 + 8);
  });

  it('leaves the scroll position alone when the active pill is already visible', () => {
    const { bar, containerEl } = createBar();
    installRects(containerEl, [0, 400], [[0, 120], [130, 250]]);

    bar.update([
      makeItem({ id: 'tab-1', title: 'First', isActive: false }),
      makeItem({ id: 'tab-2', title: 'Second', isActive: true }),
    ]);

    expect(containerEl.scrollLeft).toBe(0);
  });

  it('renders numbered badges without a close affordance in legacy mode', () => {
    const { bar, containerEl } = createBar({ legacy: true });

    bar.update([makeItem({ id: 'tab-1', index: 2, title: 'Fix tab labels' })]);

    expect(containerEl.hasClass('qoderian-tab-badges--legacy')).toBe(true);
    expect(containerEl.querySelector('.qoderian-tab-badge-label')?.textContent).toBe('2');
    expect(containerEl.querySelector('.qoderian-tab-badge-close')).toBeNull();
  });

  it('expands the title on double click in legacy mode', () => {
    const { bar, containerEl } = createBar({ legacy: true });
    bar.update([makeItem({ id: 'tab-1', index: 1, title: 'Fix tab labels' })]);

    containerEl.children[0].dispatchEvent({ type: 'dblclick', preventDefault: jest.fn(), stopPropagation: jest.fn() });

    expect(containerEl.querySelector('.qoderian-tab-badge-label')?.textContent).toBe('Fix tab labels');
    expect(containerEl.children[0].hasClass('qoderian-tab-badge-expanded')).toBe(true);
  });
});
