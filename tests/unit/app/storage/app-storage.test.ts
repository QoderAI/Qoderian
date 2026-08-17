import { QoderianStorage } from '@/app/storage/app-storage';
import {
  beginRestoreReport,
  finishRestoreReport,
} from '@/core/diagnostics/restore-report';

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

describe('QoderianStorage tab layout restore diagnostics', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    finishRestoreReport();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeStorage(loadData: () => Promise<unknown>): QoderianStorage {
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn(loadData),
      saveData: jest.fn(async () => {}),
    } as any;
    return new QoderianStorage(plugin);
  }

  it('reports a layout issue when loadData throws', async () => {
    const storage = makeStorage(async () => {
      throw new Error('data.json corrupt');
    });

    beginRestoreReport();
    expect(await storage.getTabManagerState()).toBeNull();

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'layout',
      detail: expect.stringContaining('data.json corrupt'),
    });
  });

  it('reports a layout issue when the persisted layout fails validation', async () => {
    const storage = makeStorage(async () => ({ tabManagerState: { openTabs: 'nope' } }));

    beginRestoreReport();
    expect(await storage.getTabManagerState()).toBeNull();

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0].stage).toBe('layout');
  });

  it('does not report when no layout was persisted yet', async () => {
    const storage = makeStorage(async () => ({}));

    beginRestoreReport();
    expect(await storage.getTabManagerState()).toBeNull();

    expect(finishRestoreReport()).toEqual([]);
  });

  it('reports a layout issue when loadData yields null but the raw data file is non-empty', async () => {
    const plugin = {
      app: {
        vault: {
          adapter: {
            read: jest.fn(async () => '{broken'),
          },
        },
      },
      loadData: jest.fn(async () => null),
      saveData: jest.fn(async () => {}),
    } as any;
    const storage = new QoderianStorage(plugin);

    beginRestoreReport();
    expect(await storage.getTabManagerState()).toBeNull();

    const issues = finishRestoreReport();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      stage: 'layout',
      detail: expect.stringContaining('could not be read'),
    });
  });

  it('reports the same unreadable data file only once across repeated reads', async () => {
    const storage = makeStorage(async () => {
      throw new Error('data.json corrupt');
    });

    beginRestoreReport();
    await storage.getTabManagerState();
    await storage.getTabManagerState();

    // Duplicate issues are dropped when the report window closes.
    expect(finishRestoreReport()).toHaveLength(1);
  });
});
