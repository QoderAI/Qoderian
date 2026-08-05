import type { AppPluginManager } from '@/core/types/services';
import type { PermissionMode, QoderianSettings } from '@/core/types/settings';
import { DEFAULT_QODER_SETTINGS } from '@/qoder/config/settings';
import type { McpServerManager } from '@/qoder/mcp/mcp-server-manager';
import {
  type PersistentQueryContext,
  QueryOptionsBuilder,
} from '@/qoder/runtime/qoder-query-options-builder';

function createContext(
  permissionMode: PermissionMode,
): PersistentQueryContext {
  const settings = {
    model: 'auto',
    effortLevel: 'medium',
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

describe('QueryOptionsBuilder permissions', () => {
  it.each(['default', 'acceptEdits', 'auto', 'plan'] as const)(
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
      createContext('acceptEdits'),
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
