import type { PermissionMode as SDKPermissionMode, Query } from '@qoder-ai/qoder-agent-sdk';

import type {
  ChatRuntimeQueryOptions,
} from '../../core/runtime/types';
import type { McpServerConfig } from '../../core/types';
import type { PermissionMode, QoderianSettings } from '../../core/types/settings';
import type { McpServerManager } from '../mcp/mcp-server-manager';
import {
  resolveEffortLevel,
} from '../models/model-catalog';
import { toQoderRuntimeModelId } from '../models/model-selection';
import type {
  ClosePersistentQueryOptions,
  PersistentQueryConfig,
  QoderEnsureReadyOptions,
} from './types';

export interface QoderDynamicUpdateDeps {
  getPersistentQuery: () => Query | null;
  getCurrentConfig: () => PersistentQueryConfig | null;
  mutateCurrentConfig: (mutate: (config: PersistentQueryConfig) => void) => void;
  getVaultPath: () => string | null;
  getCliPath: () => string | null;
  getScopedSettings: () => QoderianSettings;
  getPermissionMode: () => PermissionMode;
  resolveSDKPermissionMode: (mode: PermissionMode) => SDKPermissionMode;
  mcpManager: McpServerManager;
  buildPersistentQueryConfig: (
    vaultPath: string,
    cliPath: string,
    externalContextPaths?: string[],
  ) => PersistentQueryConfig;
  needsRestart: (newConfig: PersistentQueryConfig) => boolean;
  ensureReady: (options: QoderEnsureReadyOptions) => Promise<boolean>;
  setCurrentMcpServers: (servers: Record<string, McpServerConfig>) => void;
  setCurrentExternalContextPaths: (paths: string[]) => void;
  notifyFailure: (message: string) => void;
}

export async function applyQoderDynamicUpdates(
  deps: QoderDynamicUpdateDeps,
  queryOptions?: ChatRuntimeQueryOptions,
  restartOptions?: ClosePersistentQueryOptions,
  allowRestart = true,
): Promise<void> {
  const persistentQuery = deps.getPersistentQuery();
  if (!persistentQuery) {
    return;
  }

  const vaultPath = deps.getVaultPath();
  if (!vaultPath) {
    return;
  }

  const cliPath = deps.getCliPath();
  if (!cliPath) {
    return;
  }

  const settings = deps.getScopedSettings();
  const selectedModel = toQoderRuntimeModelId(queryOptions?.model || settings.model);
  const permissionMode = deps.getPermissionMode();

  const currentConfig = deps.getCurrentConfig();
  if (currentConfig && selectedModel !== currentConfig.model) {
    try {
      await persistentQuery.setModel(selectedModel);
      deps.mutateCurrentConfig(config => {
        config.model = selectedModel;
      });
    } catch {
      // qodercli may not support dynamic model switching — silently continue
    }
  }

  const effortLevel = resolveEffortLevel(selectedModel, settings.effortLevel);
  const currentEffort = deps.getCurrentConfig()?.effortLevel ?? null;
  if (effortLevel !== currentEffort) {
    try {
      await persistentQuery.applyFlagSettings({ effortLevel });
      deps.mutateCurrentConfig(config => {
        config.effortLevel = effortLevel;
      });
    } catch {
      // qodercli may not support dynamic effort level updates — silently continue
    }
  }

  const configBeforePermissionUpdate = deps.getCurrentConfig();
  if (configBeforePermissionUpdate) {
    const sdkMode = deps.resolveSDKPermissionMode(permissionMode);
    const currentSdkMode = configBeforePermissionUpdate.sdkPermissionMode ?? null;
    const requiresBypassRestart = (sdkMode === 'bypassPermissions')
      !== (currentSdkMode === 'bypassPermissions');
    if (requiresBypassRestart) {
      // Bypass requires a startup capability. Restart before entering or leaving
      // it so dangerous permission skipping is enabled only for YOLO.
    } else if (sdkMode !== currentSdkMode) {
      try {
        await persistentQuery.setPermissionMode(sdkMode);
        deps.mutateCurrentConfig(config => {
          config.permissionMode = permissionMode;
          config.sdkPermissionMode = sdkMode;
        });
      } catch {
        // qodercli may not support dynamic permission mode updates — silently continue
      }
    } else {
      deps.mutateCurrentConfig(config => {
        config.permissionMode = permissionMode;
        config.sdkPermissionMode = sdkMode;
      });
    }
  }

  const mcpMentions = queryOptions?.mcpMentions || new Set<string>();
  const uiEnabledServers = queryOptions?.enabledMcpServers || new Set<string>();
  const combinedMentions = new Set([...mcpMentions, ...uiEnabledServers]);
  const mcpServers = deps.mcpManager.getActiveServers(combinedMentions);
  const mcpServersKey = JSON.stringify(mcpServers);

  if (deps.getCurrentConfig() && mcpServersKey !== deps.getCurrentConfig()!.mcpServersKey) {
    deps.setCurrentMcpServers(mcpServers);
  }

  const newExternalContextPaths = queryOptions?.externalContextPaths || [];
  deps.setCurrentExternalContextPaths(newExternalContextPaths);

  if (!allowRestart) {
    return;
  }

  const newConfig = deps.buildPersistentQueryConfig(vaultPath, cliPath, newExternalContextPaths);
  if (!deps.needsRestart(newConfig)) {
    return;
  }

  const restarted = await deps.ensureReady({
    externalContextPaths: newExternalContextPaths,
    preserveHandlers: restartOptions?.preserveHandlers,
    force: true,
  });

  if (restarted && deps.getPersistentQuery()) {
    await applyQoderDynamicUpdates(deps, queryOptions, restartOptions, false);
  }
}
