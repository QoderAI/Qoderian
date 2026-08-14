import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import type QoderianPlugin from '@/main';
import { fetchCreditsUsage } from '@/qoder/services/credits-usage';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  setMockUsageInfo: (usageInfo: unknown) => void;
  resetMockMessages: () => void;
  getLastResponse: () => {
    initializationResult: jest.Mock;
    getUsageInfo: jest.Mock;
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

function createMockPlugin(cliPath: string | null = '/mock/qoder'): QoderianPlugin {
  return {
    app: {},
    settings: {},
    getResolvedQoderCliPath: jest.fn().mockReturnValue(cliPath),
  } as unknown as QoderianPlugin;
}

describe('fetchCreditsUsage', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'usage-session' },
    ], { appendResult: false });
  });

  it('returns the usage snapshot from an idle query and closes it', async () => {
    sdkMock.setMockUsageInfo({
      userType: 'teams',
      totalUsagePercentage: 42,
      userQuota: { total: 6000, used: 2500, remaining: 3500, percentage: 42 },
    });

    const usage = await fetchCreditsUsage(createMockPlugin());

    expect(usage?.totalUsagePercentage).toBe(42);
    expect(usage?.userQuota?.remaining).toBe(3500);
    expect(sdkMock.getLastResponse()?.initializationResult).toHaveBeenCalled();
    expect(sdkMock.getLastResponse()?.getUsageInfo).toHaveBeenCalled();
    expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
  });

  it('returns null when no CLI path is resolved', async () => {
    const usage = await fetchCreditsUsage(createMockPlugin(null));

    expect(usage).toBeNull();
    expect(sdkMock.getLastResponse()).toBeNull();
  });

  it('returns null when the SDK reports no usage info', async () => {
    const usage = await fetchCreditsUsage(createMockPlugin());

    expect(usage).toBeNull();
  });

  it('returns null when getUsageInfo rejects', async () => {
    sdkMock.setMockUsageInfo(new Error('usage unavailable'));

    const usage = await fetchCreditsUsage(createMockPlugin());

    expect(usage).toBeNull();
    expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
  });
});
