import { createMockEl } from '@test/helpers/mock-element';

import { TabManager } from '@/features/chat/tabs/tab-manager';

function makeManager(options: {
  maxTabs: number;
  tabs: Array<{ id: string; conversationId: string | null }>;
  redesign?: boolean;
}): {
  manager: TabManager;
  switchTo: jest.Mock;
} {
  const switchTo = jest.fn().mockResolvedValue(undefined);
  const plugin = {
    settings: {
      maxTabs: options.maxTabs,
      enableSessionTabsRedesign: options.redesign ?? true,
    },
    app: { workspace: {} },
    findConversationAcrossViews: jest.fn().mockReturnValue(null),
  } as any;
  const manager = new TabManager(plugin, createMockEl() as unknown as HTMLElement, {} as any, {});

  const tabs = new Map<string, any>(options.tabs.map(tab => [tab.id, {
    id: tab.id,
    conversationId: tab.conversationId,
    state: {},
    controllers: { conversationController: { switchTo } },
  }]));
  (manager as any).tabs = tabs;
  (manager as any).activeTabId = options.tabs[0]?.id ?? null;

  return { manager, switchTo };
}

describe('TabManager.openConversation', () => {
  it('refuses a new tab at the limit instead of replacing the active tab', async () => {
    const { manager, switchTo } = makeManager({
      maxTabs: 3,
      tabs: [
        { id: 'tab-1', conversationId: 'conv-1' },
        { id: 'tab-2', conversationId: null },
        { id: 'tab-3', conversationId: null },
      ],
    });

    const opened = await manager.openConversation('conv-history', { preferNewTab: true });

    expect(opened).toBe(false);
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('switches to the existing tab when the conversation is already open', async () => {
    const { manager } = makeManager({
      maxTabs: 3,
      tabs: [
        { id: 'tab-1', conversationId: 'conv-1' },
        { id: 'tab-2', conversationId: null },
        { id: 'tab-3', conversationId: null },
      ],
    });
    const switchTab = jest.spyOn(manager, 'switchToTab').mockResolvedValue(undefined);

    const opened = await manager.openConversation('conv-1', { preferNewTab: true });

    expect(opened).toBe(true);
    expect(switchTab).toHaveBeenCalledWith('tab-1');
  });

  it('still opens in the active tab when a new tab is not requested', async () => {
    const { manager, switchTo } = makeManager({
      maxTabs: 3,
      tabs: [{ id: 'tab-1', conversationId: 'conv-1' }],
    });

    const opened = await manager.openConversation('conv-2');

    expect(opened).toBe(true);
    expect(switchTo).toHaveBeenCalledWith('conv-2');
  });

  it('falls back to the active tab at the limit while the redesign is off', async () => {
    const { manager, switchTo } = makeManager({
      maxTabs: 3,
      redesign: false,
      tabs: [
        { id: 'tab-1', conversationId: 'conv-1' },
        { id: 'tab-2', conversationId: null },
        { id: 'tab-3', conversationId: null },
      ],
    });

    const opened = await manager.openConversation('conv-history', { preferNewTab: true });

    expect(opened).toBe(true);
    expect(switchTo).toHaveBeenCalledWith('conv-history');
  });
});
