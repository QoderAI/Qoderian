import { createMockEl } from '@test/helpers/mock-element';

import {
  beginRestoreReport,
  finishRestoreReport,
} from '@/core/diagnostics/restore-report';
import { TabManager } from '@/features/chat/tabs/tab-manager';

describe('TabManager restore diagnostics', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    finishRestoreReport();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeManager(): TabManager {
    const plugin = {
      settings: { maxTabs: 5 },
      getConversationById: jest.fn(async () => undefined),
    } as any;
    const containerEl = createMockEl() as unknown as HTMLElement;
    return new TabManager(plugin, containerEl, {} as any, {});
  }

  it('reports a tab issue for each tab that fails to restore and keeps going', async () => {
    const manager = makeManager();
    jest.spyOn(manager, 'createTab').mockImplementation(async (_conversationId, tabId) => {
      if (tabId === 'bad') throw new Error('metadata missing');
      return { id: tabId } as any;
    });

    beginRestoreReport();
    await manager.restoreState({
      openTabs: [
        { tabId: 'good', conversationId: 'conv-good' },
        { tabId: 'bad', conversationId: 'conv-bad' },
      ],
      activeTabId: null,
    });

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'tab',
      detail: expect.stringContaining('bad'),
    });
  });

  it('does not report when every tab restores', async () => {
    const manager = makeManager();
    jest.spyOn(manager, 'createTab').mockResolvedValue({ id: 'tab' } as any);

    beginRestoreReport();
    await manager.restoreState({
      openTabs: [{ tabId: 'good', conversationId: 'conv-good' }],
      activeTabId: null,
    });

    expect(finishRestoreReport()).toEqual([]);
  });
});
