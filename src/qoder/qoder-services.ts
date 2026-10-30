import { shutdownDaemon } from '@qoder-ai/qoder-agent-sdk';

import { getVaultPath } from '../core/fs/path';
import type { ChatRuntime } from '../core/runtime/chat-runtime';
import type { VaultFileAdapter } from '../core/storage/vault-file-adapter';
import type {
  AppAgentCatalog,
  AppAgentStorage,
  AppMcpStorage,
  AppPluginManager,
} from '../core/types/services';
import { QoderCommandCatalog } from './commands/qoder-command-catalog';
import type { QoderCommandCatalogContract } from './commands/qoder-command-catalog-contract';
import {
  QoderRuntimeCatalog,
  shouldRetryQoderRuntimeStatus,
} from './commands/qoder-runtime-catalog';
import { updateQoderSettings } from './config/settings';
import { QoderConversationHistoryService } from './history/qoder-conversation-history-service';
import { McpServerManager } from './mcp/mcp-server-manager';
import { qoderModelConfig } from './models/qoder-model-config';
import { PluginManager } from './plugins/plugin-manager';
import type { QoderHostContext } from './qoder-host-context';
import { QoderChatRuntime as QoderChatRuntime } from './runtime/qoder-chat-runtime';
import { QoderCliResolver } from './runtime/qoder-cli-resolver';
import { QoderTaskResultInterpreter } from './runtime/qoder-task-result-interpreter';
import { QoderInlineEditService } from './services/qoder-inline-edit-service';
import { QoderInstructionRefineService } from './services/qoder-instruction-refine-service';
import { QoderLoginService } from './services/qoder-login-service';
import { QoderTitleGenerationService } from './services/qoder-title-generation-service';
import { QoderStorage } from './storage/qoder-storage';

/**
 * Plugin-scoped Qoder services.
 *
 * Qoder CLI is the only integration, so these services are composed directly
 * on the plugin instance.
 */
export interface QoderServices {
  qoderStorage: QoderStorage;
  cliResolver: QoderCliResolver;
  mcpStorage: AppMcpStorage;
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentStorage: AppAgentStorage;
  agentCatalog: AppAgentCatalog;
  commandCatalog: QoderCommandCatalogContract;
  modelConfig: typeof qoderModelConfig;
  historyService: QoderConversationHistoryService;
  taskResultInterpreter: QoderTaskResultInterpreter;
  loginService: QoderLoginService;
  /**
   * Stops the SDK's process-wide daemon. Required after CLI path/edition
   * changes and login, because a running daemon keeps its original launch
   * configuration and credentials.
   */
  shutdownRuntime(): Promise<void>;
  dispose(): void;
  createRuntime(): ChatRuntime;
  createTitleGenerationService(): QoderTitleGenerationService;
  createInstructionRefineService(): QoderInstructionRefineService;
  createInlineEditService(): QoderInlineEditService;
}

export async function createQoderServices(
  plugin: QoderHostContext,
  adapter: VaultFileAdapter,
): Promise<QoderServices> {
  const qoderStorage = new QoderStorage(plugin, adapter);

  const cliResolver = new QoderCliResolver();
  const mcpStorage = qoderStorage.mcp;
  const mcpManager = new McpServerManager(mcpStorage);
  await mcpManager.loadServers();

  const vaultPath = getVaultPath(plugin.app) ?? '';
  const pluginManager = new PluginManager(vaultPath, qoderStorage.qoderCliSettings);
  await pluginManager.loadPlugins();

  const agentStorage = qoderStorage.agents;

  // Runtime catalog: commands, agents and models come from one SDK init.
  const settingsBag = plugin.settings as unknown as Record<string, unknown>;
  const agentCatalog = new QoderRuntimeCatalog(plugin, (update) => {
    updateQoderSettings(settingsBag, update);
    void plugin.saveSettings?.();
  });

  const commandCatalog = new QoderCommandCatalog(
    qoderStorage.commands,
    qoderStorage.skills,
    async () => {
      await agentCatalog.refresh();
      return agentCatalog.getCommands();
    },
  );

  // Non-blocking startup preload: probe once in the background so the slash
  // command dropdown has SDK commands ready without waiting on CLI startup.
  // A single delayed retry covers Electron startup races without repeatedly
  // launching the CLI for explicit setup/authentication failures.
  let startupRetryTimer: number | null = null;
  let disposed = false;
  const preloadRuntimeCatalog = async (allowRetry: boolean): Promise<void> => {
    const succeeded = await agentCatalog.refresh();
    if (disposed) return;
    if (succeeded) {
      commandCatalog.setRuntimeCommands(agentCatalog.getCommands());
      return;
    }
    if (allowRetry && shouldRetryQoderRuntimeStatus(agentCatalog.getRuntimeStatus())) {
      startupRetryTimer = window.setTimeout(() => {
        startupRetryTimer = null;
        if (!disposed) void preloadRuntimeCatalog(false);
      }, 1_500);
    }
  };
  void preloadRuntimeCatalog(true);

  const historyService = new QoderConversationHistoryService();
  const taskResultInterpreter = new QoderTaskResultInterpreter();
  const shutdownRuntime = async (): Promise<void> => {
    await shutdownDaemon().catch(() => {
      // Best-effort: a failed shutdown must not block settings/login flows.
    });
  };
  const loginService = new QoderLoginService(plugin, () => {
    if (disposed) return;
    // Credentials are written by the CLI after the daemon may already have
    // started, so restart the daemon before re-probing the runtime.
    void shutdownRuntime().then(() => agentCatalog.refresh()).then(() => {
      if (!disposed) loginService.reset();
    });
  });

  return {
    qoderStorage,
    cliResolver,
    mcpStorage,
    mcpManager,
    pluginManager,
    agentStorage,
    agentCatalog,
    commandCatalog,
    modelConfig: qoderModelConfig,
    historyService,
    taskResultInterpreter,
    loginService,
    shutdownRuntime,
    dispose: () => {
      disposed = true;
      void shutdownRuntime();
      loginService.dispose();
      if (startupRetryTimer !== null) {
        window.clearTimeout(startupRetryTimer);
        startupRetryTimer = null;
      }
    },
    createRuntime: () => new QoderChatRuntime(plugin, {
      mcpManager,
      pluginManager,
      agentCatalog,
    }),
    createTitleGenerationService: () => new QoderTitleGenerationService(plugin),
    createInstructionRefineService: () => new QoderInstructionRefineService(plugin),
    createInlineEditService: () => new QoderInlineEditService(plugin),
  };
}
