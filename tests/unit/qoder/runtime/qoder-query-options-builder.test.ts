import type { ModelPolicyContext } from '@qoder-ai/qoder-agent-sdk';

import type { AppPluginManager } from '@/core/types/services';
import type { PermissionMode, QoderianSettings } from '@/core/types/settings';
import { DEFAULT_QODER_SETTINGS } from '@/qoder/config/settings';
import type { McpServerManager } from '@/qoder/mcp/mcp-server-manager';
import {
  type ColdStartQueryContext,
  type PersistentQueryContext,
  QueryOptionsBuilder,
} from '@/qoder/runtime/qoder-query-options-builder';

function createContext(
  permissionMode: PermissionMode,
): PersistentQueryContext {
  const settings = {
    model: 'auto',
    permissionMode,
    mediaFolder: '',
    systemPrompt: '',
    userName: '',
    qoder: {
      ...DEFAULT_QODER_SETTINGS,
    },
  } as QoderianSettings;

  return {
    vaultPath: '/test/vault',
    cliPath: '/test/qodercli',
    settings,
    customEnv: {},
    enhancedPath: '/test/bin',
    mcpManager: {
      getAllDisallowedMcpTools: jest.fn().mockReturnValue([]),
    } as unknown as McpServerManager,
    pluginManager: {
      getPluginsKey: jest.fn().mockReturnValue(''),
    } as unknown as AppPluginManager,
    hooks: {},
  };
}

function createColdStartContext(): ColdStartQueryContext {
  return {
    ...createContext('default'),
    hasEditorContext: false,
    mcpManager: {
      getAllDisallowedMcpTools: jest.fn().mockReturnValue([]),
      getActiveServers: jest.fn().mockReturnValue({}),
      getDisallowedMcpTools: jest.fn().mockReturnValue([]),
    } as unknown as McpServerManager,
  };
}

const policyContext = {
  purpose: 'main',
  sessionId: 'session-1',
  turnIndex: 0,
  availableModels: [],
} as ModelPolicyContext;

describe('QueryOptionsBuilder permissions', () => {
  it.each(['default', 'auto', 'plan'] as const)(
    'maps %s directly without enabling dangerous permission bypass',
    (permissionMode) => {
      const options = QueryOptionsBuilder.buildPersistentQueryOptions(
        createContext(permissionMode),
      );

      expect(options.permissionMode).toBe(permissionMode);
      expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    },
  );

  it('passes Auto only as the SDK permission mode without legacy CLI flags', () => {
    const autoOptions = QueryOptionsBuilder.buildPersistentQueryOptions(
      createContext('auto'),
    );
    const askOptions = QueryOptionsBuilder.buildPersistentQueryOptions(
      createContext('default'),
    );

    expect(autoOptions.permissionMode).toBe('auto');
    expect(autoOptions.extraArgs).not.toHaveProperty('enable-auto-mode');
    expect(askOptions.extraArgs).not.toHaveProperty('enable-auto-mode');
  });

  it('enables dangerous permission bypass only for YOLO', () => {
    const options = QueryOptionsBuilder.buildPersistentQueryOptions(
      createContext('yolo'),
    );

    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it('restarts when entering or leaving YOLO, but not between non-bypass modes', () => {
    const safeConfig = QueryOptionsBuilder.buildPersistentQueryConfig(
      createContext('auto'),
    );
    const otherSafeConfig = QueryOptionsBuilder.buildPersistentQueryConfig(
      createContext('default'),
    );
    const yoloConfig = QueryOptionsBuilder.buildPersistentQueryConfig(
      createContext('yolo'),
    );

    expect(QueryOptionsBuilder.needsRestart(safeConfig, otherSafeConfig)).toBe(false);
    expect(QueryOptionsBuilder.needsRestart(safeConfig, yoloConfig)).toBe(true);
    expect(QueryOptionsBuilder.needsRestart(yoloConfig, safeConfig)).toBe(true);
  });
});

describe('QueryOptionsBuilder model policy', () => {
  it('registers a pull-mode resolveModel provider on persistent queries', () => {
    const options = QueryOptionsBuilder.buildPersistentQueryOptions(createContext('default'));

    expect(typeof options.resolveModel).toBe('function');
    expect(options.resolveModel?.(policyContext)).toEqual({ model: 'auto' });
  });

  it('re-reads live settings so editor overrides apply without a restart', () => {
    const ctx = createContext('default');
    const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);

    // The user switches model and disables thinking mid-session.
    (ctx.settings as { model: string }).model = 'qmodel_38max';
    ctx.settings.qoder.discoveredModels = [{
      value: 'qmodel_38max',
      displayName: 'Qwen 3.8 Max',
      description: '',
      thinkingDisableable: true,
    }];
    ctx.settings.qoder.modelOverrides = {
      qmodel_38max: { thinkingEnabled: false },
    };

    expect(options.resolveModel?.(policyContext)).toEqual({
      model: 'qmodel_38max',
      parameters: { reasoningEffort: 'none' },
    });
  });

  it('registers the provider on cold-start queries with the selected model', () => {
    const ctx = createColdStartContext();
    ctx.modelOverride = 'qmodel_38max';
    ctx.settings.qoder.modelOverrides = {
      qmodel_38max: { contextWindow: 1000000 },
    };

    const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

    expect(options.resolveModel?.(policyContext)).toEqual({
      model: 'qmodel_38max',
      parameters: { contextWindow: 1000000 },
    });
  });
});
