import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import type QoderianPlugin from '@/main';
import {
  classifyQoderProbeError,
  probeRuntimeCatalog,
  type QoderRuntimeProbeOutcome,
  type QoderRuntimeProbeResult,
} from '@/qoder/commands/probe-runtime-commands';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  setMockAvailableModels: (models: any[]) => void;
  setMockInitializationModels: (models: any[]) => void;
  setMockUsageInfo: (usageInfo: unknown) => void;
  resetMockMessages: () => void;
  getLastOptions: () => sdkModule.Options | undefined;
  getLastResponse: () => {
    initializationResult: jest.Mock;
    getAvailableModels: jest.Mock;
    close: jest.Mock;
  } | null;
};

jest.mock('@/core/fs/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

jest.mock('@/core/env/environment', () => ({
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/mock/bin'),
  getMissingNodeError: jest.fn().mockReturnValue(null),
  findNodeExecutable: jest.fn().mockReturnValue('/usr/bin/node'),
}));

function createMockPlugin(settings: Record<string, unknown> = {}): QoderianPlugin {
  return {
    app: {},
    settings,
    getResolvedQoderCliPath: jest.fn().mockReturnValue('/mock/qoder'),
  } as unknown as QoderianPlugin;
}

function setInitMessage(payload: Record<string, unknown> = {}): void {
  sdkMock.setMockMessages([
    { type: 'system', subtype: 'init', session_id: 'probe-session', ...payload },
  ], { appendResult: false });
}

function expectSuccessfulProbe(
  result: QoderRuntimeProbeOutcome,
): asserts result is QoderRuntimeProbeResult {
  expect('error' in result ? result.error : null).toBeNull();
}

describe('probeRuntimeCatalog', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
  });

  it('reads commands and agents from a single initialization response', async () => {
    setInitMessage({
      commands: [{ name: 'commit', description: 'Create a commit', argumentHint: '' }],
      agents: [
        { name: 'Explore', description: 'Fast codebase exploration', model: 'auto' },
        { name: '  ', description: 'Blank agent is dropped' },
      ],
    });

    const result = await probeRuntimeCatalog(createMockPlugin());

    expect(result).toEqual({
      commands: [{
        id: 'sdk:commit',
        name: 'commit',
        description: 'Create a commit',
        argumentHint: '',
        content: '',
        source: 'sdk',
      }],
      agents: [{ name: 'Explore', description: 'Fast codebase exploration', model: 'auto' }],
      models: [],
    });
    expect(sdkMock.getLastResponse()?.initializationResult).toHaveBeenCalled();
    expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
  });

  it('includes the credits usage snapshot when the SDK reports it', async () => {
    setInitMessage();
    sdkMock.setMockUsageInfo({ totalUsagePercentage: 7 });

    const result = await probeRuntimeCatalog(createMockPlugin());

    expectSuccessfulProbe(result);
    expect(result.usageInfo).toEqual({ totalUsagePercentage: 7 });
  });

  it('omits usage info when getUsageInfo fails', async () => {
    setInitMessage();
    sdkMock.setMockUsageInfo(new Error('usage unavailable'));

    const result = await probeRuntimeCatalog(createMockPlugin());

    expectSuccessfulProbe(result);
    expect(result.usageInfo).toBeUndefined();
    expect(result.commands).toEqual([]);
  });

  it('uses the same settingSources as the Qoder runtime when user settings are disabled', async () => {
    setInitMessage();

    await probeRuntimeCatalog(createMockPlugin({
      qoder: { loadUserSettings: false },
    }));

    expect(sdkMock.getLastOptions()?.settingSources).toEqual(['project', 'local']);
    expect(sdkMock.getLastOptions()?.persistSession).toBe(false);
  });

  it('includes user settings in the probe when the runtime would include them', async () => {
    setInitMessage();

    await probeRuntimeCatalog(createMockPlugin({
      qoder: { loadUserSettings: true },
    }));

    expect(sdkMock.getLastOptions()?.settingSources).toEqual(['user', 'project', 'local']);
  });

  it('returns a timeout status when the probe never reaches init', async () => {
    sdkMock.setMockMessages([], { appendResult: false });

    const result = await probeRuntimeCatalog(createMockPlugin(), { timeoutMs: 50 });

    expect(result).toMatchObject({
      error: {
        kind: 'offline',
        message: expect.stringContaining('did not respond'),
      },
    });
  });

  it('returns setup guidance when qodercli is not installed', async () => {
    const plugin = createMockPlugin();
    (plugin.getResolvedQoderCliPath as jest.Mock).mockReturnValue(null);

    const result = await probeRuntimeCatalog(plugin);

    expect(result).toEqual({
      error: {
        kind: 'cliMissing',
        message: expect.stringContaining('Install qodercli'),
      },
    });
  });

  it('classifies sign-in and compatibility failures with actionable guidance', () => {
    expect(classifyQoderProbeError(new Error('Authentication required: please login')))
      .toMatchObject({ kind: 'authRequired', message: expect.stringContaining('Sign in') });
    expect(classifyQoderProbeError(new Error('No qodercli login found. Run "qodercli login" first.')))
      .toMatchObject({ kind: 'authRequired', message: expect.stringContaining('Sign in') });
    expect(classifyQoderProbeError(
      new Error('Transport closed'),
      false,
      'No qodercli login found. Run "qodercli login" first.',
    )).toMatchObject({ kind: 'authRequired', message: expect.stringContaining('Sign in') });
    expect(classifyQoderProbeError(new Error('Protocol version mismatch')))
      .toMatchObject({ kind: 'incompatible', message: expect.stringContaining('Update qodercli') });
  });

  it('maps the full model catalog with IDE-style groups', async () => {
    setInitMessage();
    sdkMock.setMockAvailableModels([
      { value: 'auto', displayName: 'Auto', description: 'Model auto-selected', isDefault: true },
      { value: 'qmodel', displayName: 'Qwen3.7-Plus', description: '0.1x Credit', isNew: true },
      {
        value: 'qwen3.8-max-preview',
        displayName: 'Peach-07-17-DogFooding',
        description: 'Reasoning · Vision · 0.00x Credit',
        source: 'organization',
        serverScene: 'byok_enterprise',
      },
      { value: 'disabled-model', displayName: 'Disabled', description: '', isEnabled: false },
      { value: '  ', displayName: 'Blank', description: '' },
    ]);

    const result = await probeRuntimeCatalog(createMockPlugin());
    expectSuccessfulProbe(result);

    expect(result.models).toEqual([
      { value: 'auto', displayName: 'Auto', description: 'Model auto-selected', group: 'Qoder' },
      { value: 'qmodel', displayName: 'Qwen3.7-Plus', description: '0.1x Credit', group: 'New models' },
      {
        value: 'qwen3.8-max-preview',
        displayName: 'Peach-07-17-DogFooding',
        description: 'Reasoning · Vision · 0.00x Credit',
        group: 'Enterprise',
      },
    ]);
  });

  it('flattens the server promotion block into selector-ready pricing', async () => {
    setInitMessage();
    sdkMock.setMockAvailableModels([
      {
        value: 'efficient',
        displayName: 'Efficient',
        description: 'Vision · 0.30x Credit',
        priceFactor: 0.3,
        originalPriceFactor: 0.5,
      },
      {
        value: 'qmodel_latest',
        displayName: 'Qwen3.7-Max',
        description: '0.50x Credit',
        isNew: true,
        priceFactor: 0.5,
        promotion: {
          active: false,
          badge: { en: 'Off-Peak 80% off', zh: '错峰2折', ja: '   ' },
          discount_factor: 0.2,
          before_promotion_price_factor: 0.5,
          window_start: '22:00',
          window_end: '08:00',
          timezone: 'Asia/Singapore',
          rule_id: 'idle_time_model_credit_discount',
        },
      },
    ]);

    const result = await probeRuntimeCatalog(createMockPlugin());
    expectSuccessfulProbe(result);

    expect(result.models[0]).toEqual({
      value: 'efficient',
      displayName: 'Efficient',
      description: 'Vision · 0.30x Credit',
      group: 'Qoder',
      priceFactor: 0.3,
      originalPriceFactor: 0.5,
    });
    expect(result.models[1]).toEqual({
      value: 'qmodel_latest',
      displayName: 'Qwen3.7-Max',
      description: '0.50x Credit',
      group: 'New models',
      priceFactor: 0.5,
      promotion: {
        active: false,
        badge: { en: 'Off-Peak 80% off', zh: '错峰2折' },
        discountFactor: 0.2,
        window: '22:00-08:00 Asia/Singapore',
      },
    });
  });

  it('maps context_config and thinking_config for the per-model editor', async () => {
    setInitMessage();
    sdkMock.setMockAvailableModels([
      {
        value: 'qmodel_38max',
        displayName: 'Qwen 3.8 Max',
        description: '',
        context_config: {
          '1M': { token_count: 1000000, is_default: false },
          '200K': { token_count: 200000, is_default: true },
          ' 400K ': { token_count: 400000, is_default: false },
          'bogus': { token_count: -1 },
        },
        thinking_config: {
          disabled: { description: 'Respond directly' },
          enabled: {
            description: 'Think first',
            efforts: { xhigh: { is_default: true }, low: { description: 'Minimal' } },
            is_default: true,
          },
        },
      },
      {
        value: 'no-thinking-disable',
        displayName: 'Thinking only',
        description: '',
        thinking_config: {
          enabled: { description: 'Think first', efforts: { high: {} }, is_default: true },
        },
      },
    ]);

    const result = await probeRuntimeCatalog(createMockPlugin());
    expectSuccessfulProbe(result);

    expect(result.models[0]).toEqual({
      value: 'qmodel_38max',
      displayName: 'Qwen 3.8 Max',
      description: '',
      group: 'Qoder',
      contextTiers: [
        { label: '200K', tokenCount: 200000, isDefault: true },
        { label: '400K', tokenCount: 400000, isDefault: false },
        { label: '1M', tokenCount: 1000000, isDefault: false },
      ],
      thinkingDisableable: true,
      thinkingEfforts: [
        { value: 'low', isDefault: false, description: 'Minimal' },
        { value: 'xhigh', isDefault: true },
      ],
    });
    // Without thinking_config.disabled the toggle must stay hidden.
    expect(result.models[1]).not.toHaveProperty('thinkingDisableable');
    expect(result.models[1]).not.toHaveProperty('contextTiers');
    expect(result.models[1]).toHaveProperty('thinkingEfforts', [
      { value: 'high', isDefault: false },
    ]);
  });

  it('uses initialization pricing when a live catalog refresh returns empty', async () => {
    setInitMessage();
    sdkMock.setMockAvailableModels([]);
    sdkMock.setMockInitializationModels([
      {
        value: 'qmodel',
        displayName: 'Qwen3.7-Plus',
        description: '0.10x Credit',
        isNew: true,
        priceFactor: 0.1,
        promotion: {
          active: true,
          badge: { en: 'Off-Peak 60% off', zh: '错峰4折' },
          discount_factor: 0.4,
        },
      },
    ]);

    const result = await probeRuntimeCatalog(createMockPlugin());
    expectSuccessfulProbe(result);

    expect(result.models).toEqual([{
      value: 'qmodel',
      displayName: 'Qwen3.7-Plus',
      description: '0.10x Credit',
      group: 'New models',
      priceFactor: 0.1,
      promotion: {
        active: true,
        badge: { en: 'Off-Peak 60% off', zh: '错峰4折' },
        discountFactor: 0.4,
      },
    }]);
    expect(sdkMock.getLastResponse()?.getAvailableModels).toHaveBeenCalledWith({
      fetchStrategy: 'live',
    });
  });
});
