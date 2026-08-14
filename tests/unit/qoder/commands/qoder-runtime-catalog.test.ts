import { probeRuntimeCatalog } from '@/qoder/commands/probe-runtime-commands';
import {
  QoderRuntimeCatalog,
  shouldRetryQoderRuntimeStatus,
} from '@/qoder/commands/qoder-runtime-catalog';

jest.mock('@/qoder/commands/probe-runtime-commands', () => ({
  probeRuntimeCatalog: jest.fn(),
}));

const probeMock = probeRuntimeCatalog as jest.Mock;

function createPlugin(settings: Record<string, unknown> = {}): any {
  return {
    app: {},
    settings,
    getResolvedQoderCliPath: jest.fn().mockReturnValue('/mock/qoder'),
  };
}

describe('QoderRuntimeCatalog', () => {
  beforeEach(() => {
    probeMock.mockReset();
  });

  it('seeds agents from the persisted snapshot', () => {
    const catalog = new QoderRuntimeCatalog(createPlugin({
      qoder: {
        discoveredAgents: [
          { name: 'general-purpose', description: 'Multi-step tasks', model: 'auto' },
        ],
      },
    }));

    expect(catalog.getAvailableAgents()).toEqual([{
      id: 'general-purpose',
      name: 'General Purpose',
      description: 'Multi-step tasks',
      prompt: '',
      source: 'builtin',
      model: 'auto',
    }]);
  });

  it('applies commands and agents from a successful refresh', async () => {
    probeMock.mockResolvedValue({
      commands: [{ id: 'sdk:commit', name: 'commit', description: '', content: '', source: 'sdk' }],
      agents: [{ name: 'Explore', description: 'Fast exploration' }],
      models: [],
    });
    const onPersist = jest.fn();
    const catalog = new QoderRuntimeCatalog(createPlugin(), onPersist);

    await catalog.refresh();

    expect(catalog.getCommands()).toHaveLength(1);
    expect(catalog.getAgentById('Explore')).toMatchObject({
      id: 'Explore',
      name: 'Explore',
      description: 'Fast exploration',
      source: 'builtin',
    });
    expect(onPersist).toHaveBeenCalledWith({
      discoveredAgents: [{ name: 'Explore', description: 'Fast exploration' }],
    });
  });

  it('exposes the usage snapshot from a successful probe', async () => {
    probeMock.mockResolvedValue({
      commands: [],
      agents: [],
      models: [],
      usageInfo: { totalUsagePercentage: 42, userQuota: { total: 100, used: 42 } },
    });
    const catalog = new QoderRuntimeCatalog(createPlugin());

    expect(catalog.getUsageInfo()).toBeNull();
    await catalog.refresh();

    expect(catalog.getUsageInfo()).toEqual({
      totalUsagePercentage: 42,
      userQuota: { total: 100, used: 42 },
    });
  });

  it('keeps the last usage snapshot when a later probe has none', async () => {
    probeMock.mockResolvedValueOnce({
      commands: [],
      agents: [],
      models: [],
      usageInfo: { totalUsagePercentage: 42 },
    });
    const catalog = new QoderRuntimeCatalog(createPlugin());
    await catalog.refresh();

    probeMock.mockResolvedValueOnce({ commands: [], agents: [], models: [] });
    await catalog.refresh();

    expect(catalog.getUsageInfo()).toEqual({ totalUsagePercentage: 42 });
  });

  it('keeps the previous snapshot when the probe fails', async () => {
    probeMock.mockResolvedValueOnce({
      commands: [{ id: 'sdk:commit', name: 'commit', description: '', content: '', source: 'sdk' }],
      agents: [{ name: 'Explore', description: 'Fast exploration' }],
      models: [],
    });
    const catalog = new QoderRuntimeCatalog(createPlugin());
    await catalog.refresh();

    probeMock.mockResolvedValueOnce({
      error: { kind: 'offline', message: 'Could not reach Qoder services.' },
    });
    await catalog.refresh();

    expect(catalog.getCommands()).toHaveLength(1);
    expect(catalog.getAvailableAgents()).toHaveLength(1);
    expect(catalog.getRuntimeStatus()).toMatchObject({ kind: 'offline' });
  });

  it('does not reject when the probe throws', async () => {
    probeMock.mockRejectedValue(new Error('spawn failed'));
    const catalog = new QoderRuntimeCatalog(createPlugin());

    await expect(catalog.refresh()).resolves.toBe(false);
  });

  it('deduplicates concurrent refresh calls', async () => {
    let resolveProbe: (value: any) => void = () => {};
    probeMock.mockImplementation(() => new Promise((resolve) => { resolveProbe = resolve; }));
    const catalog = new QoderRuntimeCatalog(createPlugin());

    const first = catalog.refresh();
    const second = catalog.refresh();
    resolveProbe({ commands: [], agents: [], models: [] });
    await Promise.all([first, second]);

    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('persists models even when the agent list is empty', async () => {
    probeMock.mockResolvedValue({
      commands: [],
      agents: [],
      models: [{ value: 'auto', displayName: 'Auto', description: '', group: 'Qoder' }],
    });
    const onPersist = jest.fn();
    const catalog = new QoderRuntimeCatalog(createPlugin(), onPersist);

    await catalog.refresh();

    expect(onPersist).toHaveBeenCalledWith({
      discoveredModels: [{ value: 'auto', displayName: 'Auto', description: '', group: 'Qoder' }],
    });
    expect(catalog.getRuntimeStatus()).toEqual({
      kind: 'ready',
      message: 'Qoder CLI is ready.',
    });
  });

  it('notifies subscribers while checking and when sign-in is required', async () => {
    probeMock.mockResolvedValue({
      error: {
        kind: 'authRequired',
        message: 'Run `qodercli login`.',
      },
    });
    const catalog = new QoderRuntimeCatalog(createPlugin());
    const listener = jest.fn();
    const unsubscribe = catalog.subscribeRuntimeStatus(listener);

    await catalog.refresh();
    unsubscribe();

    expect(listener).toHaveBeenNthCalledWith(1, {
      kind: 'checking',
      message: 'Checking Qoder CLI and loading models…',
    });
    expect(listener).toHaveBeenLastCalledWith({
      kind: 'authRequired',
      message: 'Run `qodercli login`.',
    });
  });

  describe('applySessionAgents', () => {
    it('seeds an empty catalog with description-less entries', () => {
      const catalog = new QoderRuntimeCatalog(createPlugin());

      catalog.applySessionAgents(['Explore', 'general-purpose', '  ']);

      expect(catalog.getAvailableAgents().map(a => a.id)).toEqual(['Explore', 'general-purpose']);
      expect(catalog.getAgentById('general-purpose')?.name).toBe('General Purpose');
    });

    it('only adds names missing from a populated catalog', () => {
      const catalog = new QoderRuntimeCatalog(createPlugin({
        qoder: { discoveredAgents: [{ name: 'Explore', description: 'From snapshot' }] },
      }));

      catalog.applySessionAgents(['Explore', 'Plan']);

      const agents = catalog.getAvailableAgents();
      expect(agents.map(a => a.id)).toEqual(['Explore', 'Plan']);
      expect(catalog.getAgentById('Explore')?.description).toBe('From snapshot');
    });

    it('ignores empty name lists', () => {
      const catalog = new QoderRuntimeCatalog(createPlugin());

      catalog.applySessionAgents([]);

      expect(catalog.getAvailableAgents()).toEqual([]);
    });
  });

  it('searches agents by name, id and description', () => {
    const catalog = new QoderRuntimeCatalog(createPlugin({
      qoder: {
        discoveredAgents: [
          { name: 'Explore', description: 'Fast codebase exploration' },
          { name: 'general-purpose', description: 'Multi-step tasks' },
        ],
      },
    }));

    expect(catalog.searchAgents('explore').map(a => a.id)).toEqual(['Explore']);
    expect(catalog.searchAgents('general').map(a => a.id)).toEqual(['general-purpose']);
    expect(catalog.searchAgents('multi-step').map(a => a.id)).toEqual(['general-purpose']);
    expect(catalog.searchAgents('nope')).toEqual([]);
  });
});

describe('shouldRetryQoderRuntimeStatus', () => {
  it('retries only transient startup failures', () => {
    expect(shouldRetryQoderRuntimeStatus({ kind: 'offline', message: 'Network unavailable' })).toBe(true);
    expect(shouldRetryQoderRuntimeStatus({ kind: 'failed', message: 'Process startup failed' })).toBe(true);
    expect(shouldRetryQoderRuntimeStatus({ kind: 'authRequired', message: 'Sign in' })).toBe(false);
    expect(shouldRetryQoderRuntimeStatus({ kind: 'cliMissing', message: 'Install CLI' })).toBe(false);
    expect(shouldRetryQoderRuntimeStatus({ kind: 'incompatible', message: 'Update CLI' })).toBe(false);
  });
});
