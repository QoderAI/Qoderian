import type {
  CanUseTool,
  Options,
  PermissionMode as SDKPermissionMode,
} from '@qoder-ai/qoder-agent-sdk';
import { qodercliAuth } from '@qoder-ai/qoder-agent-sdk';

import type { AppPluginManager } from '../../core/types/services';
import type { PermissionMode,QoderianSettings } from '../../core/types/settings';
import {
  getQoderSettings,
  resolveQoderSettingSources,
} from '../config/settings';
import type { McpServerManager } from '../mcp/mcp-server-manager';
import { createQoderModelPolicyProvider } from '../models/model-policy';
import { toQoderRuntimeModelId } from '../models/model-selection';
import { resolveModelReasoningEffort } from '../models/qoder-model-config';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../prompt/main-agent';
import { createCustomSpawnFunction } from './custom-spawn';
import {
  DISABLED_BUILTIN_SUBAGENTS,
  type PersistentQueryConfig,
  UNSUPPORTED_SDK_TOOLS,
} from './types';

export interface QueryOptionsContext {
  vaultPath: string;
  cliPath: string;
  settings: QoderianSettings;
  customEnv: Record<string, string>;
  enhancedPath: string;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
}

export interface PersistentQueryContext extends QueryOptionsContext {
  abortController?: AbortController;
  resume?: {
    sessionId: string;
    sessionAt?: string;
    fork?: boolean;
  };
  canUseTool?: CanUseTool;
  hooks: Options['hooks'];
  externalContextPaths?: string[];
}

export interface ColdStartQueryContext extends QueryOptionsContext {
  abortController?: AbortController;
  sessionId?: string;
  modelOverride?: string;
  canUseTool?: CanUseTool;
  hooks: Options['hooks'];
  mcpMentions?: Set<string>;
  enabledMcpServers?: Set<string>;
  allowedTools?: string[];
  hasEditorContext: boolean;
  externalContextPaths?: string[];
}

export class QueryOptionsBuilder {
  static needsRestart(
    currentConfig: PersistentQueryConfig | null,
    newConfig: PersistentQueryConfig
  ): boolean {
    if (!currentConfig) return true;

    // These require restart (cannot be updated dynamically)
    if (currentConfig.systemPromptKey !== newConfig.systemPromptKey) return true;
    if (currentConfig.disallowedToolsKey !== newConfig.disallowedToolsKey) return true;
    if (currentConfig.mcpServersKey !== newConfig.mcpServersKey) return true;
    if (currentConfig.pluginsKey !== newConfig.pluginsKey) return true;
    if (currentConfig.settingSources !== newConfig.settingSources) return true;
    if (currentConfig.qoderCliPath !== newConfig.qoderCliPath) return true;

    // Non-bypass modes can be changed dynamically. Entering or leaving bypass mode must restart the
    // Query so the dangerous CLI capability is present only while YOLO is active.
    const currentBypassesPermissions = currentConfig.sdkPermissionMode === 'bypassPermissions';
    const newBypassesPermissions = newConfig.sdkPermissionMode === 'bypassPermissions';
    if (currentBypassesPermissions !== newBypassesPermissions) return true;

    // External context paths require restart (additionalDirectories can't be updated dynamically)
    if (QueryOptionsBuilder.pathsChanged(currentConfig.externalContextPaths, newConfig.externalContextPaths)) {
      return true;
    }

    return false;
  }

  static buildPersistentQueryConfig(
    ctx: QueryOptionsContext,
    externalContextPaths?: string[]
  ): PersistentQueryConfig {
    const qoderSettings = getQoderSettings(ctx.settings);
    const systemPromptSettings: SystemPromptSettings = {
      mediaFolder: ctx.settings.mediaFolder,
      customPrompt: ctx.settings.systemPrompt,
      vaultPath: ctx.vaultPath,
      userName: ctx.settings.userName,
    };

    const sdkPermissionMode = QueryOptionsBuilder.resolveQoderSdkPermissionMode(
      ctx.settings.permissionMode,
    );

    const disallowedToolsKey = ctx.mcpManager.getAllDisallowedMcpTools().join('|');
    const pluginsKey = ctx.pluginManager.getPluginsKey();

    const settingSources = resolveQoderSettingSources(qoderSettings.loadUserSettings);
    const runtimeModel = toQoderRuntimeModelId(ctx.settings.model);

    return {
      model: runtimeModel,
            effortLevel: resolveModelReasoningEffort(runtimeModel, ctx.settings),
      permissionMode: ctx.settings.permissionMode,
      sdkPermissionMode,
      systemPromptKey: computeSystemPromptKey(systemPromptSettings),
      disallowedToolsKey,
      mcpServersKey: '', // Dynamic via setMcpServers, not tracked for restart
      pluginsKey,
      externalContextPaths: externalContextPaths || [],
      settingSources: settingSources.join(','),
      qoderCliPath: ctx.cliPath,
    };
  }

  static buildPersistentQueryOptions(ctx: PersistentQueryContext): Options {
    const runtimeModel = toQoderRuntimeModelId(ctx.settings.model);
    const { options } = QueryOptionsBuilder.buildBaseOptions(
      ctx,
      runtimeModel,
      ctx.abortController,
    );

    options.disallowedTools = [
      ...ctx.mcpManager.getAllDisallowedMcpTools(),
      ...UNSUPPORTED_SDK_TOOLS,
      ...DISABLED_BUILTIN_SUBAGENTS,
    ];

    QueryOptionsBuilder.applyPermissionMode(
      options,
      ctx.settings.permissionMode,
      ctx.canUseTool,
    );
    QueryOptionsBuilder.applyThinking(options, ctx.settings, runtimeModel);
    options.hooks = ctx.hooks;

    // Pull mode: the provider re-reads live settings so model/override
    // changes apply on the next LLM call without restarting the query.
    options.resolveModel = createQoderModelPolicyProvider(
      () => ctx.settings.model,
      ctx.settings,
    );

    options.enableFileCheckpointing = true;

    if (ctx.resume) {
      options.resume = ctx.resume.sessionId;
      if (ctx.resume.fork) {
        options.forkSession = true;
      }
    }

    if (ctx.externalContextPaths && ctx.externalContextPaths.length > 0) {
      options.additionalDirectories = ctx.externalContextPaths;
    }

    return options;
  }

  static buildColdStartQueryOptions(ctx: ColdStartQueryContext): Options {
    const selectedModel = toQoderRuntimeModelId(ctx.modelOverride ?? ctx.settings.model);
    const { options } = QueryOptionsBuilder.buildBaseOptions(
      ctx,
      selectedModel,
      ctx.abortController,
    );

    const mcpMentions = ctx.mcpMentions || new Set<string>();
    const uiEnabledServers = ctx.enabledMcpServers || new Set<string>();
    const combinedMentions = new Set([...mcpMentions, ...uiEnabledServers]);
    const mcpServers = ctx.mcpManager.getActiveServers(combinedMentions);

    if (Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    const disallowedMcpTools = ctx.mcpManager.getDisallowedMcpTools(combinedMentions);
    options.disallowedTools = [
      ...disallowedMcpTools,
      ...UNSUPPORTED_SDK_TOOLS,
      ...DISABLED_BUILTIN_SUBAGENTS,
    ];

    QueryOptionsBuilder.applyPermissionMode(
      options,
      ctx.settings.permissionMode,
      ctx.canUseTool,
    );
    options.hooks = ctx.hooks;
    QueryOptionsBuilder.applyThinking(options, ctx.settings, selectedModel);
    options.resolveModel = createQoderModelPolicyProvider(
      () => selectedModel,
      ctx.settings,
    );

    if (ctx.allowedTools !== undefined && ctx.allowedTools.length > 0) {
      options.allowedTools = ctx.allowedTools;
    }

    if (ctx.sessionId) {
      options.resume = ctx.sessionId;
    }

    if (ctx.externalContextPaths && ctx.externalContextPaths.length > 0) {
      options.additionalDirectories = ctx.externalContextPaths;
    }

    return options;
  }

  static resolveQoderSdkPermissionMode(
    permissionMode: PermissionMode,
  ): SDKPermissionMode {
    if (permissionMode === 'yolo') return 'bypassPermissions';
    return permissionMode;
  }

  private static applyPermissionMode(
    options: Options,
    permissionMode: PermissionMode,
    canUseTool?: CanUseTool
  ): void {
    if (canUseTool) {
      options.canUseTool = canUseTool;
    }

    const sdkPermissionMode = QueryOptionsBuilder.resolveQoderSdkPermissionMode(
      permissionMode,
    );
    options.permissionMode = sdkPermissionMode;

    if (sdkPermissionMode === 'bypassPermissions') {
      options.allowDangerouslySkipPermissions = true;
    }
  }

  private static buildBaseOptions(
    ctx: QueryOptionsContext,
    model: string,
    abortController?: AbortController,
  ): { options: Options; qoderSettings: ReturnType<typeof getQoderSettings> } {
    const qoderSettings = getQoderSettings(ctx.settings);
    const systemPromptSettings: SystemPromptSettings = {
      mediaFolder: ctx.settings.mediaFolder,
      customPrompt: ctx.settings.systemPrompt,
      vaultPath: ctx.vaultPath,
      userName: ctx.settings.userName,
    };
    const options: Options = {
      cwd: ctx.vaultPath,
      systemPrompt: buildSystemPrompt(systemPromptSettings),
      model,
      abortController,
      auth: qodercliAuth(),
      pathToQoderCLIExecutable: ctx.cliPath,
      settingSources: resolveQoderSettingSources(qoderSettings.loadUserSettings),
      env: {
        ...process.env,
        ...ctx.customEnv,
        PATH: ctx.enhancedPath,
      },
      includePartialMessages: true,
    };

    options.spawnQoderCLIProcess = createCustomSpawnFunction(ctx.enhancedPath);

    return { options, qoderSettings };
  }

  private static applyThinking(
    options: Options,
    settings: QoderianSettings,
    model: string
  ): void {
    const effortLevel = resolveModelReasoningEffort(model, settings);
    options.extraArgs = {
      ...options.extraArgs,
      'reasoning-effort': effortLevel,
    };
  }

  private static pathsChanged(a?: string[], b?: string[]): boolean {
    const aKey = [...(a || [])].sort().join('|');
    const bKey = [...(b || [])].sort().join('|');
    return aKey !== bKey;
  }

}
