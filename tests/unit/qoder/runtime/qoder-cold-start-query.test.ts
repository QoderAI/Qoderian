import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import { type ColdStartQueryConfig, runColdStartQuery } from '@/qoder/runtime/qoder-cold-start-query';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  resetMockMessages: () => void;
  simulateCrash: (afterChunks?: number) => void;
  getLastOptions: () => Record<string, any> | undefined;
  getLastResponse: () => { close: jest.Mock } | null;
};

// --- Mocks ---

jest.mock('@/core/fs/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

jest.mock('@/core/env/environment', () => ({
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/mock/bin'),
  getMissingNodeError: jest.fn().mockReturnValue(null),
  findNodeExecutable: jest.fn().mockReturnValue('/usr/bin/node'),
}));

const { getVaultPath } = jest.requireMock('@/core/fs/path');
const { getMissingNodeError } = jest.requireMock('@/core/env/environment');

function createMockPlugin(overrides?: Partial<ColdStartQueryConfig['plugin']>) {
  return {
    app: {},
    settings: {
      model: 'performance',
      effortLevel: 'medium',
      qoder: {
        loadUserSettings: false,
      },
    },
    getResolvedQoderCliPath: jest.fn().mockReturnValue('/mock/qoder'),
    ...overrides,
  } as unknown as ColdStartQueryConfig['plugin'];
}

function createConfig(overrides?: Partial<ColdStartQueryConfig>): ColdStartQueryConfig {
  return {
    plugin: createMockPlugin(),
    systemPrompt: 'Test system prompt',
    ...overrides,
  };
}

// --- Tests ---

beforeEach(() => {
  sdkMock.resetMockMessages();
  (getVaultPath as jest.Mock).mockReturnValue('/test/vault');
  (getMissingNodeError as jest.Mock).mockReturnValue(null);
});

describe('runColdStartQuery', () => {
  describe('happy path', () => {
    it('returns accumulated text and session ID', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess-42' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } },
      ]);

      const result = await runColdStartQuery(createConfig(), 'hi');

      expect(result.text).toBe('Hello World');
      expect(result.sessionId).toBe('sess-42');
    });

    it('returns null sessionId when no init event', async () => {
      sdkMock.setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      ]);

      const result = await runColdStartQuery(createConfig(), 'hi');

      expect(result.sessionId).toBeNull();
    });

    it('ignores non-assistant SDK messages with string message payloads', async () => {
      sdkMock.setMockMessages([
        { type: 'permission_denied', message: 'Permission denied' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } },
      ]);

      const result = await runColdStartQuery(createConfig(), 'hi');

      expect(result.text).toBe('answer');
    });
  });

  describe('infrastructure errors', () => {
    it('throws when vault path is null', async () => {
      (getVaultPath as jest.Mock).mockReturnValue(null);

      await expect(
        runColdStartQuery(createConfig(), 'hi')
      ).rejects.toThrow('Could not determine vault path');
    });

    it('throws when CLI path is null', async () => {
      const plugin = createMockPlugin({
        getResolvedQoderCliPath: jest.fn().mockReturnValue(null),
      });

      await expect(
        runColdStartQuery(createConfig({ plugin }), 'hi')
      ).rejects.toThrow('Qoder CLI not found');
    });

    it('throws when node is missing', async () => {
      (getMissingNodeError as jest.Mock).mockReturnValue('Node.js not found');

      await expect(
        runColdStartQuery(createConfig(), 'hi')
      ).rejects.toThrow('Node.js not found');
    });
  });

  describe('SDK options', () => {
    it('passes system prompt, tools, and model to SDK', async () => {
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess' },
      ]);

      await runColdStartQuery(
        createConfig({
          systemPrompt: 'Custom prompt',
          tools: [],
          model: 'qoder-haiku-4-5',
        }),
        'hi',
      );

      const opts = sdkMock.getLastOptions();
      expect(opts?.systemPrompt).toBe('Custom prompt');
      expect(opts?.tools).toEqual([]);
      expect(opts?.model).toBe('qoder-haiku-4-5');
      expect(opts?.permissionMode).toBe('bypassPermissions');
      expect(opts?.allowDangerouslySkipPermissions).toBe(true);
    });

    it('passes hooks to SDK', async () => {
      const hooks = { PreToolUse: [{ hooks: [jest.fn()] }] };
      sdkMock.setMockMessages([]);

      await runColdStartQuery(createConfig({ hooks }), 'hi');

      const opts = sdkMock.getLastOptions();
      expect(opts?.hooks).toBe(hooks);
    });

    it('sets persistSession false when configured', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(createConfig({ persistSession: false }), 'hi');

      const opts = sdkMock.getLastOptions();
      expect(opts?.persistSession).toBe(false);
    });

    it('sets resume when resumeSessionId provided', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(
        createConfig({ resumeSessionId: 'old-sess' }),
        'hi',
      );

      const opts = sdkMock.getLastOptions();
      expect(opts?.resume).toBe('old-sess');
    });

    it('does not set thinking when disabled', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(
        createConfig({ thinking: { disabled: true } }),
        'hi',
      );

      const opts = sdkMock.getLastOptions();
      expect(opts?.extraArgs?.['reasoning-effort']).toBeUndefined();
    });

    it('uses the configured Qoder model when no override is provided', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(createConfig(), 'hi');

      const opts = sdkMock.getLastOptions();
      expect(opts?.model).toBe('performance');
    });

    it('loads project and local settings when user settings are disabled', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(
        createConfig({
          settings: {
            model: 'performance',
            effortLevel: 'medium',
            qoder: { loadUserSettings: false },
          },
        }),
        'hi',
      );

      expect(sdkMock.getLastOptions()?.settingSources).toEqual(['project', 'local']);
    });

    it('loads user, project, and local settings when user settings are enabled', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(
        createConfig({
          settings: {
            model: 'performance',
            effortLevel: 'medium',
            qoder: { loadUserSettings: true },
          },
        }),
        'hi',
      );

      expect(sdkMock.getLastOptions()?.settingSources).toEqual(['user', 'project', 'local']);
    });

    it('clamps unsupported xhigh effort before calling the SDK', async () => {
      sdkMock.setMockMessages([]);

      await runColdStartQuery(
        createConfig({
          settings: {
            model: 'performance',
            effortLevel: 'xhigh',
            qoder: { loadUserSettings: false },
          },
        }),
        'hi',
      );

      const opts = sdkMock.getLastOptions();
      expect(opts?.extraArgs?.['reasoning-effort']).toBe('high');
    });
  });

  describe('abort handling', () => {
    it('throws Cancelled when aborted mid-stream', async () => {
      const abortController = new AbortController();

      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
      ]);

      // Abort before the query starts (signal will be checked on first iteration)
      abortController.abort();

      await expect(
        runColdStartQuery(createConfig({ abortController }), 'hi')
      ).rejects.toThrow('Cancelled');
    });
  });

  describe('SDK errors', () => {
    it('propagates SDK errors', async () => {
      sdkMock.simulateCrash(0);

      await expect(
        runColdStartQuery(createConfig(), 'hi')
      ).rejects.toThrow('Simulated consumer crash');
      expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
    });

    it('rejects an unsuccessful result with SDK error details', async () => {
      sdkMock.setMockMessages([{
        type: 'result',
        subtype: 'error_max_turns',
        errors: ['Maximum turns reached'],
      }], { appendResult: false });

      await expect(
        runColdStartQuery(createConfig(), 'hi'),
      ).rejects.toThrow('Maximum turns reached');
      expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
    });

    it('rejects a query that ends without a success result', async () => {
      sdkMock.setMockMessages([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
      ], { appendResult: false });

      await expect(
        runColdStartQuery(createConfig(), 'hi'),
      ).rejects.toThrow('ended without a successful result');
      expect(sdkMock.getLastResponse()?.close).toHaveBeenCalled();
    });
  });

  describe('onTextChunk callback', () => {
    it('calls onTextChunk with accumulated text', async () => {
      const chunks: string[] = [];
      sdkMock.setMockMessages([
        { type: 'system', subtype: 'init', session_id: 'sess' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }] } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } },
      ]);

      await runColdStartQuery(
        createConfig({ onTextChunk: (text) => chunks.push(text) }),
        'hi',
      );

      expect(chunks).toEqual(['Hello ', 'Hello World']);
    });
  });
});
