import * as sdkModule from '@qoder-ai/qoder-agent-sdk';

import type QoderianPlugin from '@/main';
import type { McpServerManager } from '@/qoder/mcp/mcp-server-manager';
import { QoderChatRuntime } from '@/qoder/runtime/qoder-chat-runtime';
import { QoderTitleGenerationService } from '@/qoder/services/qoder-title-generation-service';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  resetMockMessages: () => void;
  query: typeof sdkModule.query;
};

type MockMcpServerManager = jest.Mocked<McpServerManager>;

/** Extracts the label from a `[qoderian perf] label: 12.3ms` console line. */
function perfLabel(line: string): string {
  return line.replace(/^\[qoderian perf\] (\S+): .*$/, '$1');
}

describe('first-turn perf instrumentation', () => {
  let mockPlugin: Partial<QoderianPlugin>;
  let mockMcpManager: MockMcpServerManager;
  let service: QoderChatRuntime;
  let infoSpy: jest.SpyInstance;
  let perfLines: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    sdkMock.resetMockMessages();
    perfLines = [];
    infoSpy = jest.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      const first = typeof args[0] === 'string' ? args[0] : '';
      if (first.startsWith('[qoderian perf] ')) perfLines.push(first);
    });

    mockPlugin = {
      app: {
        vault: { adapter: { basePath: '/mock/vault/path' } },
      },
      settings: {
        model: 'qoder-3-5-sonnet',
        permissionMode: 'ask' as const,
        loadUserQoderSettings: false,
        qoderCliPath: '/usr/local/bin/qoder',
      },
      getResolvedQoderCliPath: jest.fn().mockReturnValue('/usr/local/bin/qoder'),
      pluginManager: {
        getPluginsKey: jest.fn().mockReturnValue(''),
      },
    } as unknown as QoderianPlugin;

    mockMcpManager = {
      loadServers: jest.fn().mockResolvedValue(undefined),
      getAllDisallowedMcpTools: jest.fn().mockReturnValue([]),
      getActiveServers: jest.fn().mockReturnValue({}),
      getDisallowedMcpTools: jest.fn().mockReturnValue([]),
      extractMentions: jest.fn().mockReturnValue(new Set<string>()),
      transformMentions: jest.fn().mockImplementation((text: string) => text),
    } as unknown as MockMcpServerManager;

    service = new QoderChatRuntime(mockPlugin as QoderianPlugin, {
      mcpManager: mockMcpManager,
      pluginManager: (mockPlugin as any).pluginManager,
      agentCatalog: { applySessionAgents: () => {} },
    });
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('logs each runtime stage of a fresh persistent-query turn', async () => {
    // Message shape of a brand-new session: init, then the assistant reply.
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'perf-test-session' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'First reply!' }] } },
    ]);

    const turn = service.prepareTurn({ text: 'hello' });
    const chunks: any[] = [];
    for await (const chunk of service.query(turn)) {
      chunks.push(chunk);
    }
    expect(chunks.some(c => c.type === 'text')).toBe(true);

    const labels = perfLines.map(perfLabel);
    expect(labels).toContain('runtime.spawnPersistentQuery');
    expect(labels).toContain('runtime.cliFirstMessage');
    expect(labels).toContain('runtime.applyDynamicUpdates');
    expect(labels).toContain('turn.enqueueToFirstChunk');

    // The spawn log precedes the first response chunk timing.
    expect(labels.indexOf('runtime.spawnPersistentQuery'))
      .toBeLessThan(labels.indexOf('turn.enqueueToFirstChunk'));

    for (const line of perfLines) {
      expect(line).toMatch(/^\[qoderian perf\] \S+: \d+(\.\d+)?ms$/);
    }
  });

  it('logs the title-generation cold-start query separately', async () => {
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'title-session' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'A Nice Title' }] } },
    ]);

    const titleService = new QoderTitleGenerationService(mockPlugin as any);
    await titleService.generateTitle('conv-1', 'How do I set up a project?', jest.fn());

    expect(perfLines.map(perfLabel)).toContain('title.coldStartQuery');
  });
});
