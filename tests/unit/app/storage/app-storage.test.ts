import { QoderianStorage } from '@/app/storage/app-storage';

describe('QoderianStorage', () => {
  it('serializes tab layout read-modify-write operations', async () => {
    let data: Record<string, unknown> = { unrelated: true };
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn(async () => ({ ...data })),
      saveData: jest.fn(async (next: Record<string, unknown>) => {
        activeWrites++;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        data = { ...next };
        activeWrites--;
      }),
    } as any;
    const storage = new QoderianStorage(plugin);
    const first = {
      openTabs: [{ tabId: 'one', conversationId: 'conversation-one' }],
      activeTabId: 'one',
    };
    const second = {
      openTabs: [{ tabId: 'two', conversationId: 'conversation-two' }],
      activeTabId: 'two',
    };

    await Promise.all([
      storage.setTabManagerState(first),
      storage.setTabManagerState(second),
    ]);

    expect(maxActiveWrites).toBe(1);
    expect(plugin.loadData).toHaveBeenCalledTimes(2);
    expect(plugin.saveData).toHaveBeenCalledTimes(2);
    expect(data).toEqual({ unrelated: true, tabManagerState: second });
  });
});
