import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import type QoderianPlugin from '@/main';
import { fetchStoredSessionContextUsage } from '@/qoder/services/context-usage';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  setMockContextUsage: (payload: unknown) => void;
  resetMockMessages: () => void;
  getLastResponse: () => {
    initializationResult: jest.Mock;
    getContextUsage: jest.Mock;
    close: jest.Mock;
  } | null;
  getLastOptions: () => { resume?: string } | undefined;
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

const PAYLOAD = {
  model: 'qoder-sonnet-4-5',
  contextWindow: { usedPercentage: 12.5 },
  categories: [
    { type: 'system_tools', percentage: 6.1 },
    { type: 'messages', percentage: 6.4 },
    { type: 'free_space', percentage: 87.5 },
  ],
  skills: { count: 3, percentageOfContext: 0.1, items: [] },
};

describe('fetchStoredSessionContextUsage', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'stored-session' },
    ], { appendResult: false });
  });

  it('resumes the stored session and returns its breakdown', async () => {
    sdkMock.setMockContextUsage(PAYLOAD);

    const breakdown = await fetchStoredSessionContextUsage(
      createMockPlugin(),
      'stored-session',
    );

    expect(breakdown?.usedPercentage).toBe(12.5);
    expect(breakdown?.categories).toHaveLength(3);
    expect(breakdown?.skills.count).toBe(3);
    expect(sdkMock.getLastOptions()?.resume).toBe('stored-session');
    expect(sdkMock.getLastResponse()?.getContextUsage).toHaveBeenCalled();
    expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
  });

  it('returns null when no CLI path is resolved', async () => {
    const breakdown = await fetchStoredSessionContextUsage(
      createMockPlugin(null),
      'stored-session',
      { maxAgeMs: 0 },
    );

    expect(breakdown).toBeNull();
    expect(sdkMock.getLastResponse()).toBeNull();
  });

  it('returns null when the resume or read fails', async () => {
    sdkMock.setMockContextUsage(new Error('Invalid session identifier'));

    const breakdown = await fetchStoredSessionContextUsage(
      createMockPlugin(),
      'stored-session',
      { maxAgeMs: 0 },
    );

    expect(breakdown).toBeNull();
    expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
  });

  it('reuses a fresh read instead of spawning the CLI again', async () => {
    sdkMock.setMockContextUsage(PAYLOAD);

    await fetchStoredSessionContextUsage(createMockPlugin(), 'reuse-session');
    const response = sdkMock.getLastResponse();
    const breakdown = await fetchStoredSessionContextUsage(createMockPlugin(), 'reuse-session');

    expect(breakdown?.usedPercentage).toBe(12.5);
    expect(response?.getContextUsage).toHaveBeenCalledTimes(1);
  });
});
