/**
 * Qoderian - Qoder Agent SDK wrapper
 *
 * Handles communication with Qoder via the Agent SDK. Manages streaming,
 * session persistence, permission modes, and security hooks.
 *
 * Architecture:
 * - Persistent query for active chat conversation (eliminates cold-start latency)
 * - Cold-start queries for inline edit, title generation
 * - QoderMessageChannel for message queueing and turn management
 * - Dynamic updates (model, effort level, permission mode, MCP servers)
 */

import type {
  CanUseTool,
  Options,
  PermissionMode as SDKPermissionMode,
  Query,
  RewindFilesResult,
  SDKUserMessage,
  SlashCommand as SDKSlashCommand,
} from '@qoder-ai/qoder-agent-sdk';
import { query as agentQuery } from '@qoder-ai/qoder-agent-sdk';
import { Notice } from 'obsidian';

import { getEnhancedPath, getMissingNodeError } from '../../core/env/environment';
import { getVaultPath } from '../../core/fs/path';
import type { ChatRuntime } from '../../core/runtime/chat-runtime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
} from '../../core/runtime/types';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  ImageAttachment,
  McpServerConfig,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../core/types';
import type {
  AppAgentCatalog,
  AppPluginManager,
} from '../../core/types/services';
import type { PermissionMode, QoderianSettings } from '../../core/types/settings';
import { getActiveQoderCliEdition, getQoderCliBinaryBaseName } from '../config/cli-edition';
import { loadSubagentFinalResult, loadSubagentToolCalls } from '../history/qoder-history-store';
import type { McpServerManager } from '../mcp/mcp-server-manager';
import { toQoderRuntimeModelId } from '../models/model-selection';
import { qoderModelConfig } from '../models/qoder-model-config';
import { stripCurrentNoteContext } from '../prompt/context/prompt-context';
import { encodeQoderTurn } from '../prompt/qoder-turn-encoder';
import type { QoderHostContext } from '../qoder-host-context';
import {
  createTransformStreamState,
  createTransformUsageState,
  transformSDKMessage,
} from '../stream/transform-qoder-message';
import { isContextWindowEvent, isSessionInitEvent, isStreamChunk } from '../stream/type-guards';
import { TOOL_SKILL } from '../tools/tool-names';
import { streamPersistentTurn } from './persistent-turn-stream';
import { createQoderApprovalCallback } from './qoder-approval-handler';
import {
  buildConversationSessionUpdates,
  buildHistoryRebuildRequest,
  resolveConversationResumeState,
  resolveForkSessionId,
} from './qoder-conversation-session';
import { applyQoderDynamicUpdates } from './qoder-dynamic-updates';
import { QoderMessageChannel } from './qoder-message-channel';
import {
  type ColdStartQueryContext,
  type PersistentQueryContext,
  QueryOptionsBuilder,
  type QueryOptionsContext,
} from './qoder-query-options-builder';
import { QoderResponseRouter } from './qoder-response-router';
import { executeQoderRewind } from './qoder-rewind-service';
import { QoderSessionManager } from './qoder-session-manager';
import { noteVisibleStreamContent, QoderTurnTracker } from './qoder-turn-tracker';
import {
  buildQoderPromptWithImages,
  buildQoderSDKUserMessage,
} from './qoder-user-message-factory';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
  isSessionExpiredError,
} from './session-context';
import { createStopSubagentHook, type SubagentHookState } from './subagent-hooks';
import {
  type ClosePersistentQueryOptions,
  type PersistentQueryConfig,
  type QoderEnsureReadyOptions,
} from './types';

export type { ApprovalDecision };
export type {
  ApprovalCallback,
  ApprovalCallbackOptions,
  AskUserQuestionCallback,
} from '../../core/runtime/types';

export interface QoderRuntimeServices {
  mcpManager: McpServerManager;
  pluginManager: AppPluginManager;
  agentCatalog: Pick<AppAgentCatalog, 'applySessionAgents'>
    & Partial<Pick<AppAgentCatalog, 'getRuntimeStatus'>>;
}

type QueryOptions = ChatRuntimeQueryOptions;

export class QoderChatRuntime implements ChatRuntime {
  private plugin: QoderHostContext;
  private agentCatalog: Pick<AppAgentCatalog, 'applySessionAgents'>
    & Partial<Pick<AppAgentCatalog, 'getRuntimeStatus'>>;
  private pluginManager: AppPluginManager;
  private abortController: AbortController | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private vaultPath: string | null = null;
  private currentExternalContextPaths: string[] = [];
  private currentMcpServers: Record<string, McpServerConfig> = {};
  private readyStateListeners = new Set<(ready: boolean) => void>();

  // Modular components
  private sessionManager = new QoderSessionManager();
  private mcpManager: McpServerManager;

  private persistentQuery: Query | null = null;
  private messageChannel: QoderMessageChannel | null = null;
  private queryAbortController: AbortController | null = null;
  private readonly responseRouter: QoderResponseRouter;
  private responseConsumerRunning = false;
  private responseConsumerPromise: Promise<void> | null = null;
  private closingQueryPromise: Promise<void> | null = null;
  private shuttingDown = false;

  // Tracked configuration for detecting changes that require restart
  private currentConfig: PersistentQueryConfig | null = null;

  // Per-turn tools pre-approved by a slash command on a long-lived Query.
  private currentPreapprovedTools: string[] | null = null;

  private pendingResumeAt?: string;
  private pendingForkSession = false;

  // Last sent message for crash recovery (Phase 1.3)
  private lastSentMessage: SDKUserMessage | null = null;
  private lastSentQueryOptions: QueryOptions | null = null;
  private crashRecoveryAttempted = false;
  private coldStartInProgress = false;  // Prevent consumer error restarts during cold-start

  // SDK command cache — populated on system/init, cleared on persistent query close
  private cachedSdkCommands: SlashCommand[] = [];

  // Subagent hook state source (set from the feature layer).
  private subagentStateSource: (() => SubagentHookState) | null = null;

  private readonly turnTracker = new QoderTurnTracker();

  constructor(plugin: QoderHostContext, services: QoderRuntimeServices) {
    this.plugin = plugin;
    this.mcpManager = services.mcpManager;
    this.pluginManager = services.pluginManager;
    this.agentCatalog = services.agentCatalog;
    this.responseRouter = new QoderResponseRouter({
      turnTracker: this.turnTracker,
      getCurrentQuery: () => this.persistentQuery,
      getMessageChannel: () => this.messageChannel,
      getConfiguredModel: () => this.getScopedSettings().model,
      getConfiguredContextWindow: () => {
        const settings = this.getScopedSettings();
        return qoderModelConfig.getEffectiveContextWindowSize(settings.model, settings);
      },
      getSessionId: () => this.sessionManager.getSessionId(),
      onSessionInit: event => {
        const wasFork = this.pendingForkSession;
        this.sessionManager.captureSession(event.sessionId);
        if (wasFork) {
          this.sessionManager.clearHistoryRebuild();
          this.pendingForkSession = false;
        }
        this.messageChannel?.setSessionId(event.sessionId);
        if (event.agents) {
          try { this.getAgentCatalog().applySessionAgents(event.agents); } catch { /* non-critical */ }
        }
        if (event.permissionMode && this.permissionModeSyncCallback) {
          try { this.permissionModeSyncCallback(event.permissionMode); } catch { /* non-critical */ }
        }
        void this.fetchAndCacheCommands(this.persistentQuery);
      },
      onPlanModeEntered: () => {
        if (this.currentConfig) {
          this.currentConfig.permissionMode = 'plan';
          this.currentConfig.sdkPermissionMode = 'plan';
        }
        try { this.permissionModeSyncCallback?.('plan'); } catch { /* non-critical */ }
      },
    });
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeQoderTurn(request, this.mcpManager);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    return this.turnTracker.consumeMetadata();
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyStateListeners.add(listener);
    try {
      listener(this.isReady());
    } catch {
      // Ignore listener errors
    }
    return () => {
      this.readyStateListeners.delete(listener);
    };
  }

  private notifyReadyStateChange(): void {
    if (this.readyStateListeners.size === 0) {
      return;
    }

    const isReady = this.isReady();
    for (const listener of this.readyStateListeners) {
      try {
        listener(isReady);
      } catch {
        // Ignore listener errors
      }
    }
  }

  setPendingResumeAt(uuid: string | undefined): void {
    this.pendingResumeAt = uuid;
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.setPendingResumeAt(checkpointId);
  }

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    externalContextPaths?: string[],
  ): void {
    if (!conversation) {
      this.pendingForkSession = false;
      this.pendingResumeAt = undefined;
      this.setSessionId(null, externalContextPaths);
      return;
    }

    const resumeState = resolveConversationResumeState(conversation);
    this.pendingForkSession = resumeState.pendingForkSession;
    this.pendingResumeAt = resumeState.pendingResumeAt;
    this.setSessionId(resumeState.sessionId, externalContextPaths);
  }

  buildSessionUpdates({ conversation, sessionInvalidated }: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    return buildConversationSessionUpdates(
      conversation,
      this.getSessionId(),
      sessionInvalidated,
    );
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return resolveForkSessionId(conversation, this.getSessionId());
  }

  async loadSubagentToolCalls(agentId: string): Promise<ToolCallInfo[]> {
    const sessionId = this.getSessionId();
    const vaultPath = getVaultPath(this.plugin.app);
    if (!sessionId || !vaultPath) return [];
    return loadSubagentToolCalls(vaultPath, sessionId, agentId);
  }

  async loadSubagentFinalResult(agentId: string): Promise<string | null> {
    const sessionId = this.getSessionId();
    const vaultPath = getVaultPath(this.plugin.app);
    if (!sessionId || !vaultPath) return null;
    return loadSubagentFinalResult(vaultPath, sessionId, agentId);
  }

  async reloadMcpServers(): Promise<void> {
    await this.mcpManager.loadServers();
  }

  /**
   * Ensures the persistent query is running with current configuration.
   * Unified API that replaces preWarm() and restartPersistentQuery().
   *
   * Behavior:
   * - If not running → start (if paths available)
   * - If running and force=true → close and restart
   * - If running and config changed → close and restart
   * - If running and config unchanged → no-op
   *
   * Note: When restart is needed, the query is closed BEFORE checking if we can
   * start a new one. This ensures fallback to cold-start if CLI becomes unavailable.
   *
   * @returns true if the query was (re)started, false otherwise
   */
  async ensureReady(options?: QoderEnsureReadyOptions): Promise<boolean> {
    const vaultPath = getVaultPath(this.plugin.app);

    // Track external context paths for dynamic updates (empty list clears)
    if (options && options.externalContextPaths !== undefined) {
      this.currentExternalContextPaths = options.externalContextPaths;
    }

    // Auto-resolve session ID from sessionManager if not explicitly provided
    const effectiveSessionId = options?.sessionId ?? this.sessionManager.getSessionId() ?? undefined;
    const externalContextPaths = options?.externalContextPaths ?? this.currentExternalContextPaths;

    // Case 1: Not running → try to start
    if (!this.persistentQuery) {
      if (!vaultPath) return false;
      const cliPath = this.plugin.getResolvedQoderCliPath();
      if (!cliPath) return false;
      await this.startPersistentQuery(vaultPath, cliPath, effectiveSessionId, externalContextPaths);
      return true;
    }

    // Case 2: Force restart (session switch, crash recovery)
    // Close FIRST, then try to start new one (allows fallback if CLI unavailable)
    if (options?.force) {
      await this.closePersistentQuery('forced restart', { preserveHandlers: options.preserveHandlers });
      if (!vaultPath) return false;
      const cliPath = this.plugin.getResolvedQoderCliPath();
      if (!cliPath) return false;
      await this.startPersistentQuery(vaultPath, cliPath, effectiveSessionId, externalContextPaths);
      return true;
    }

    // Case 3: Check if config changed → restart if needed
    // We need vaultPath and cliPath to build config for comparison
    if (!vaultPath) return false;
    const cliPath = this.plugin.getResolvedQoderCliPath();
    if (!cliPath) return false;

    const newConfig = this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
    if (this.needsRestart(newConfig)) {
      // Close FIRST, then try to start new one (allows fallback if CLI unavailable)
      await this.closePersistentQuery('config changed', { preserveHandlers: options?.preserveHandlers });
      // Re-check CLI path as it might have changed during close
      const cliPathAfterClose = this.plugin.getResolvedQoderCliPath();
      if (cliPathAfterClose) {
        await this.startPersistentQuery(vaultPath, cliPathAfterClose, effectiveSessionId, externalContextPaths);
        return true;
      }
      // CLI unavailable after close - query is closed, will fallback to cold-start
      return false;
    }

    // Case 4: Running and config unchanged → no-op
    return false;
  }

  /**
   * Starts the persistent query for the active chat conversation.
   */
  private async startPersistentQuery(
    vaultPath: string,
    cliPath: string,
    resumeSessionId?: string,
    externalContextPaths?: string[]
  ): Promise<void> {
    if (this.closingQueryPromise) {
      await this.closingQueryPromise;
    }
    if (this.persistentQuery) {
      return;
    }

    this.shuttingDown = false;
    this.vaultPath = vaultPath;

    this.messageChannel = new QoderMessageChannel();

    if (resumeSessionId) {
      this.messageChannel.setSessionId(resumeSessionId);
      this.sessionManager.setSessionId(resumeSessionId, this.getScopedSettings().model);
    }

    this.queryAbortController = new AbortController();

    const config = this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths);
    this.currentConfig = config;

    const resumeAtMessageId = this.pendingResumeAt;
    const options = this.buildPersistentQueryOptions(
      vaultPath,
      cliPath,
      resumeSessionId,
      resumeAtMessageId,
      externalContextPaths
    );

    this.persistentQuery = agentQuery({
      prompt: this.messageChannel,
      options,
    });

    if (this.pendingResumeAt === resumeAtMessageId) {
      this.pendingResumeAt = undefined;
    }
    this.attachPersistentQueryStdinErrorHandler(this.persistentQuery);

    this.startResponseConsumer();
    this.notifyReadyStateChange();
  }

  private attachPersistentQueryStdinErrorHandler(query: Query): void {
    const stdin = (query as { transport?: { processStdin?: NodeJS.WritableStream } }).transport?.processStdin;
    if (!stdin || typeof stdin.on !== 'function' || typeof stdin.once !== 'function') {
      return;
    }

    const handler = (error: NodeJS.ErrnoException) => {
      if (this.shuttingDown || this.isPipeError(error)) {
        return;
      }
      void this.closePersistentQuery('stdin error');
    };

    stdin.on('error', handler);
    stdin.once('close', () => {
      stdin.removeListener('error', handler);
    });
  }

  private isPipeError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { code?: string; message?: string };
    return e.code === 'EPIPE' || (typeof e.message === 'string' && e.message.includes('EPIPE'));
  }

  /**
   * Closes the persistent query and cleans up resources.
   */
  closePersistentQuery(_reason?: string, options?: ClosePersistentQueryOptions): Promise<void> {
    if (!this.persistentQuery) {
      return this.closingQueryPromise ?? Promise.resolve();
    }

    const preserveHandlers = options?.preserveHandlers ?? false;
    const query = this.persistentQuery;

    this.shuttingDown = true;

    // Close the message channel (ends the async iterable)
    this.messageChannel?.close();

    // Notify turn generators unless crash recovery will reuse their handlers.
    this.responseRouter.reset(preserveHandlers);

    // Detach synchronously so callers immediately observe a closed runtime.
    this.persistentQuery = null;
    this.messageChannel = null;
    this.queryAbortController = null;
    this.responseConsumerRunning = false;
    this.responseConsumerPromise = null;
    this.currentConfig = null;
    this.cachedSdkCommands = [];
    this.turnTracker.clearTransformState();
    if (!preserveHandlers) {
      this.currentPreapprovedTools = null;
    }

    this.notifyReadyStateChange();

    const closeTask = Promise.resolve()
      .then(() => query.close())
      .catch(() => {
        // Closing is best-effort during teardown; the Query is already detached.
      })
      .finally(() => {
        this.closingQueryPromise = null;
        this.shuttingDown = false;
        this.notifyReadyStateChange();
      });
    this.closingQueryPromise = closeTask;

    // NOTE: Do NOT reset crashRecoveryAttempted here.
    // It's reset in queryViaPersistent after a successful message send,
    // or in resetSession/setSessionId when switching sessions.
    // Resetting it here would cause infinite restart loops on persistent errors.
    return closeTask;
  }

  /**
   * Checks if the persistent query needs to be restarted based on configuration changes.
   */
  private needsRestart(newConfig: PersistentQueryConfig): boolean {
    return QueryOptionsBuilder.needsRestart(this.currentConfig, newConfig);
  }

  /**
   * Builds configuration object for tracking changes.
   */
  private buildPersistentQueryConfig(
    vaultPath: string,
    cliPath: string,
    externalContextPaths?: string[]
  ): PersistentQueryConfig {
    const config = QueryOptionsBuilder.buildPersistentQueryConfig(
      this.buildQueryOptionsContext(vaultPath, cliPath),
      externalContextPaths
    );
    config.mcpServersKey = JSON.stringify(this.currentMcpServers);
    return config;
  }

  /**
   * Builds the base query options context from current state.
   */
  private getScopedSettings(): QoderianSettings {
    return this.plugin.settings;
  }

  private buildQueryOptionsContext(vaultPath: string, cliPath: string): QueryOptionsContext {
    const customEnv: Record<string, string> = {};
    const enhancedPath = getEnhancedPath(undefined, cliPath);

    return {
      vaultPath,
      cliPath,
      settings: this.getScopedSettings(),
      customEnv,
      enhancedPath,
      mcpManager: this.mcpManager,
      pluginManager: this.requirePluginManager(),
    };
  }

  private requirePluginManager(): AppPluginManager {
    return this.pluginManager;
  }

  private getAgentCatalog(): Pick<AppAgentCatalog, 'applySessionAgents'> {
    return this.agentCatalog;
  }

  /**
   * Builds SDK options for the persistent query.
   */
  private buildPersistentQueryOptions(
    vaultPath: string,
    cliPath: string,
    resumeSessionId?: string,
    resumeAtMessageId?: string,
    externalContextPaths?: string[]
  ): Options {
    const baseContext = this.buildQueryOptionsContext(vaultPath, cliPath);
    const hooks = this.buildHooks();

    const ctx: PersistentQueryContext = {
      ...baseContext,
      abortController: this.queryAbortController ?? undefined,
      resume: resumeSessionId
        ? { sessionId: resumeSessionId, sessionAt: resumeAtMessageId, fork: this.pendingForkSession || undefined }
        : undefined,
      canUseTool: this.createApprovalCallback(),
      hooks,
      externalContextPaths,
    };

    const options = QueryOptionsBuilder.buildPersistentQueryOptions(ctx);
    if (Object.keys(this.currentMcpServers).length > 0) {
      options.mcpServers = this.currentMcpServers;
    }
    return options;
  }

  /**
   * Builds the hooks for SDK options.
   * Hooks need access to `this` for dynamic settings, so they're built here.
   */
  private buildHooks() {
    const hooks: Options['hooks'] = {};

    // Resolve feature state at hook execution time so a long-lived Query sees
    // the latest subagent status.
    hooks.Stop = [createStopSubagentHook(
      () => this.subagentStateSource?.() ?? { hasRunning: false }
    )];

    return hooks;
  }

  /**
   * Starts the background consumer loop that routes chunks to handlers.
   */
  private startResponseConsumer(): void {
    if (this.responseConsumerRunning) {
      return;
    }

    this.responseConsumerRunning = true;

    // Track which query this consumer is for, to detect if we were replaced
    const queryForThisConsumer = this.persistentQuery;

    this.responseConsumerPromise = (async () => {
      if (!this.persistentQuery) return;

      try {
        for await (const message of this.persistentQuery) {
          if (this.shuttingDown) break;

          await this.responseRouter.route(message);
        }
      } catch (error) {
        // Skip error handling if this consumer was replaced by a new one.
        // This prevents race conditions where the OLD consumer's error handler
        // interferes with the NEW handler after a restart (e.g., from applyDynamicUpdates).
        if (this.persistentQuery !== queryForThisConsumer && this.persistentQuery !== null) {
          return;
        }

        // Skip restart if cold-start is in progress (it will handle session capture)
        if (!this.shuttingDown && !this.coldStartInProgress) {
          const handler = this.responseRouter.getActiveHandler();
          const errorInstance = error instanceof Error ? error : new Error(String(error));
          const messageToReplay = this.lastSentMessage;

          if (!this.crashRecoveryAttempted && messageToReplay && handler && !handler.sawAnyChunk) {
            this.crashRecoveryAttempted = true;
            try {
              await this.ensureReady({ force: true, preserveHandlers: true });
              if (!this.messageChannel) {
                throw new Error('Persistent query restart did not create message channel', {
                  cause: error,
                });
              }
              await this.applyDynamicUpdates(this.lastSentQueryOptions ?? undefined, { preserveHandlers: true });
              this.messageChannel.enqueue(messageToReplay);
              return;
            } catch (restartError) {
              // If restart failed due to session expiration, invalidate session
              // so next query triggers noSessionButHasHistory → history rebuild
              if (isSessionExpiredError(restartError)) {
                this.sessionManager.invalidateSession();
              }
              handler.onError(errorInstance);
              return;
            }
          }

          // Notify active handler of error
          if (handler) {
            handler.onError(errorInstance);
          }

          // Crash recovery: restart persistent query to prepare for next user message.
          if (!this.crashRecoveryAttempted) {
            this.crashRecoveryAttempted = true;
            try {
              await this.ensureReady({ force: true });
            } catch (restartError) {
              // If restart failed due to session expiration, invalidate session
              // so next query triggers noSessionButHasHistory → history rebuild
              if (isSessionExpiredError(restartError)) {
                this.sessionManager.invalidateSession();
              }
              // Restart failed - next query will start fresh.
            }
          }
        }
      } finally {
        // Only clear the flag if this consumer wasn't replaced by a new one (e.g., after restart)
        // If ensureReady() restarted, it starts a new consumer which sets the flag true,
        // so we shouldn't clear it here.
        if (this.persistentQuery === queryForThisConsumer || this.persistentQuery === null) {
          this.responseConsumerRunning = false;
        }
      }
    })();
  }

  private buildQueryOptionsFromTurnRequest(
    request: ChatTurnRequest,
    encodedTurn: PreparedChatTurn,
    legacyQueryOptions?: QueryOptions,
  ): QueryOptions | undefined {
    const mcpMentions = legacyQueryOptions?.mcpMentions
      ? new Set([...legacyQueryOptions.mcpMentions, ...encodedTurn.mcpMentions])
      : encodedTurn.mcpMentions;

    const effectiveQueryOptions: QueryOptions = {
      allowedTools: legacyQueryOptions?.allowedTools,
      model: legacyQueryOptions?.model,
      mcpMentions,
      enabledMcpServers: request.enabledMcpServers ?? legacyQueryOptions?.enabledMcpServers,
      forceColdStart: legacyQueryOptions?.forceColdStart,
      externalContextPaths: request.externalContextPaths ?? legacyQueryOptions?.externalContextPaths,
    };

    if (
      effectiveQueryOptions.allowedTools === undefined &&
      effectiveQueryOptions.model === undefined &&
      effectiveQueryOptions.enabledMcpServers === undefined &&
      effectiveQueryOptions.forceColdStart === undefined &&
      effectiveQueryOptions.externalContextPaths === undefined &&
      (effectiveQueryOptions.mcpMentions?.size ?? 0) === 0
    ) {
      return undefined;
    }

    return effectiveQueryOptions;
  }

  isPersistentQueryActive(): boolean {
    return this.persistentQuery !== null && !this.shuttingDown;
  }

  /**
   * Sends a query to Qoder and streams the response.
   *
   * Query selection:
   * - Persistent query: default chat conversation
   * - Cold-start query: only when forceColdStart is set
   */
  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: QueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const prompt = turn.prompt;
    const images = turn.request.images;
    queryOptions = this.buildQueryOptionsFromTurnRequest(turn.request, turn, queryOptions);

    const vaultPath = getVaultPath(this.plugin.app);
    if (!vaultPath) {
      yield { type: 'error', content: 'Could not determine vault path' };
      return;
    }

    const resolvedQoderPath = this.plugin.getResolvedQoderCliPath();
    if (!resolvedQoderPath) {
      yield {
        type: 'error',
        content: `Qoder CLI not found. Install ${getQoderCliBinaryBaseName(getActiveQoderCliEdition())} or configure its path in Qoderian settings, then retry.`,
      };
      return;
    }

    const enhancedPath = getEnhancedPath(undefined, resolvedQoderPath);
    const missingNodeError = getMissingNodeError(resolvedQoderPath, enhancedPath);
    if (missingNodeError) {
      yield { type: 'error', content: missingNodeError };
      return;
    }

    const runtimeStatus = this.agentCatalog.getRuntimeStatus?.();
    if (runtimeStatus && [
      'authRequired',
      'incompatible',
      'noModels',
    ].includes(runtimeStatus.kind)) {
      yield { type: 'error', content: runtimeStatus.message };
      return;
    }

    // Rebuild history if needed before choosing persistent vs cold-start
    let promptToSend = prompt;
    let forceColdStart = false;

    // Clear interrupted flag - persistent query handles interruption gracefully,
    // no need to force cold-start just because user cancelled previous response
    if (this.sessionManager.wasInterrupted()) {
      this.sessionManager.clearInterrupted();
    }

    // Session mismatch recovery: SDK returned a different session ID (context lost)
    // Inject history to restore context without forcing cold-start
    if (this.sessionManager.needsHistoryRebuild() && conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildContextFromHistory(conversationHistory);
      const actualPrompt = stripCurrentNoteContext(prompt);
      promptToSend = buildPromptWithHistoryContext(historyContext, prompt, actualPrompt, conversationHistory);
      this.sessionManager.clearHistoryRebuild();
    }

    const noSessionButHasHistory = !this.sessionManager.getSessionId() &&
      conversationHistory && conversationHistory.length > 0;

    if (noSessionButHasHistory) {
      const historyContext = buildContextFromHistory(conversationHistory);
      const actualPrompt = stripCurrentNoteContext(prompt);
      promptToSend = buildPromptWithHistoryContext(historyContext, prompt, actualPrompt, conversationHistory);

      // Note: Do NOT call invalidateSession() here. The cold-start will capture
      // a new session ID anyway, and invalidating would break any persistent query
      // restart that happens during the cold-start (causing SESSION MISMATCH).
      forceColdStart = true;
    }

    const effectiveQueryOptions = forceColdStart
      ? { ...queryOptions, forceColdStart: true }
      : queryOptions;

    if (forceColdStart) {
      // Set flag BEFORE closing to prevent consumer error from triggering restart
      this.coldStartInProgress = true;
      await this.closePersistentQuery('session invalidated');
    }

    // Determine query path: persistent vs cold-start
    const shouldUsePersistent = !effectiveQueryOptions?.forceColdStart;

    if (shouldUsePersistent) {
      // Start persistent query if not running
      if (!this.persistentQuery && !this.shuttingDown) {
        await this.startPersistentQuery(
          vaultPath,
          resolvedQoderPath,
          this.sessionManager.getSessionId() ?? undefined
        );
      }

      if (this.persistentQuery && !this.shuttingDown) {
        // Use persistent query path
        try {
          yield* this.queryViaPersistent(promptToSend, images, vaultPath, resolvedQoderPath, effectiveQueryOptions);
          return;
        } catch (error) {
          if (isSessionExpiredError(error) && conversationHistory && conversationHistory.length > 0) {
            this.sessionManager.invalidateSession();
            const retryRequest = buildHistoryRebuildRequest(prompt, conversationHistory);

            this.coldStartInProgress = true;
            this.abortController = new AbortController();

            try {
              yield* this.queryViaSDK(
                retryRequest.prompt,
                vaultPath,
                resolvedQoderPath,
                // Use current message's images, fallback to history images
                images ?? retryRequest.images,
                effectiveQueryOptions
              );
            } catch (retryError) {
              const msg = retryError instanceof Error ? retryError.message : 'Unknown error';
              yield { type: 'error', content: msg };
            } finally {
              this.coldStartInProgress = false;
              this.abortController = null;
            }
            return;
          }

          throw error;
        }
      }
    }

    // Cold-start path (existing logic)
    // Set flag to prevent consumer error restarts from interfering
    this.coldStartInProgress = true;
    this.abortController = new AbortController();

    try {
      yield* this.queryViaSDK(promptToSend, vaultPath, resolvedQoderPath, images, effectiveQueryOptions);
    } catch (error) {
      if (isSessionExpiredError(error) && conversationHistory && conversationHistory.length > 0) {
        this.sessionManager.invalidateSession();
        const retryRequest = buildHistoryRebuildRequest(prompt, conversationHistory);

        try {
          yield* this.queryViaSDK(
            retryRequest.prompt,
            vaultPath,
            resolvedQoderPath,
            // Use current message's images, fallback to history images
            images ?? retryRequest.images,
            effectiveQueryOptions
          );
        } catch (retryError) {
          const msg = retryError instanceof Error ? retryError.message : 'Unknown error';
          yield { type: 'error', content: msg };
        }
        return;
      }

      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      this.coldStartInProgress = false;
      this.abortController = null;
    }
  }

  /**
   * Query via persistent query (Phase 1.5).
   * Uses the message channel to send messages without cold-start latency.
   */
  private async *queryViaPersistent(
    prompt: string,
    images: ImageAttachment[] | undefined,
    vaultPath: string,
    cliPath: string,
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    this.turnTracker.reset();

    if (!this.persistentQuery || !this.messageChannel) {
      // Fallback to cold-start if persistent query not available
      yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
      return;
    }

    // A persistent Query cannot change Options.allowedTools between turns, so
    // mirror that SDK pre-approval behavior in canUseTool for this turn.
    if (queryOptions?.allowedTools !== undefined) {
      this.currentPreapprovedTools = queryOptions.allowedTools.length > 0
        ? [...queryOptions.allowedTools, TOOL_SKILL]
        : null;
    } else {
      this.currentPreapprovedTools = null;
    }

    const savedPreapprovedTools = this.currentPreapprovedTools;

    // Apply dynamic updates before sending (Phase 1.6)
    await this.applyDynamicUpdates(queryOptions);

    // Restore turn pre-approvals in case a dynamic update restarted the Query.
    this.currentPreapprovedTools = savedPreapprovedTools;

    // Check if applyDynamicUpdates triggered a restart that failed
    // (e.g., CLI path not found, vault path missing)
    if (!this.persistentQuery || !this.messageChannel) {
      yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
      return;
    }
    if (!this.responseConsumerRunning) {
      yield* this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions);
      return;
    }

    const message = this.buildSDKUserMessage(prompt, images);
    const messageChannel = this.messageChannel;

    // Track the turn for crash recovery before it enters the persistent channel.
    this.lastSentMessage = message;
    this.lastSentQueryOptions = queryOptions ?? null;
    this.crashRecoveryAttempted = false;

    try {
      yield* streamPersistentTurn({
        message,
        messageChannel,
        registerHandler: handler => this.responseRouter.register(handler),
        unregisterHandler: handlerId => this.responseRouter.unregister(handlerId),
        onMessageQueued: () => {
          this.turnTracker.record({
            userMessageId: message.uuid ?? undefined,
            wasSent: true,
          });
        },
        onCompleted: () => {
          this.lastSentMessage = null;
          this.lastSentQueryOptions = null;
        },
        fallback: () => this.queryViaSDK(prompt, vaultPath, cliPath, images, queryOptions),
      });
    } finally {
      this.currentPreapprovedTools = null;
    }
  }

  private buildSDKUserMessage(prompt: string, images?: ImageAttachment[]): SDKUserMessage {
    return buildQoderSDKUserMessage(
      prompt,
      this.sessionManager.getSessionId() || '',
      images,
    );
  }

  /**
   * Apply dynamic updates to the persistent query before sending a message (Phase 1.6).
   */
  private async applyDynamicUpdates(
    queryOptions?: QueryOptions,
    restartOptions?: ClosePersistentQueryOptions,
    allowRestart = true
  ): Promise<void> {
    await applyQoderDynamicUpdates(
      {
        getPersistentQuery: () => this.persistentQuery,
        getCurrentConfig: () => this.currentConfig,
        mutateCurrentConfig: (mutate) => {
          if (this.currentConfig) {
            mutate(this.currentConfig);
          }
        },
        getVaultPath: () => this.vaultPath,
        getCliPath: () => this.plugin.getResolvedQoderCliPath(),
        getScopedSettings: () => this.getScopedSettings(),
        getPermissionMode: () => this.plugin.settings.permissionMode,
        resolveSDKPermissionMode: (mode) => this.resolveSDKPermissionMode(mode),
        mcpManager: this.mcpManager,
        buildPersistentQueryConfig: (vaultPath, cliPath, externalContextPaths) =>
          this.buildPersistentQueryConfig(vaultPath, cliPath, externalContextPaths),
        needsRestart: (newConfig) => this.needsRestart(newConfig),
        ensureReady: (options) => this.ensureReady(options),
        setCurrentMcpServers: (servers) => {
          this.currentMcpServers = servers;
        },
        setCurrentExternalContextPaths: (paths) => {
          this.currentExternalContextPaths = paths;
        },
        notifyFailure: (message) => {
          new Notice(message);
        },
      },
      queryOptions,
      restartOptions,
      allowRestart,
    );
  }

  private async *queryViaSDK(
    prompt: string,
    cwd: string,
    cliPath: string,
    images?: ImageAttachment[],
    queryOptions?: QueryOptions
  ): AsyncGenerator<StreamChunk> {
    this.turnTracker.reset();
    const selectedModel = toQoderRuntimeModelId(queryOptions?.model || this.getScopedSettings().model);

    this.sessionManager.setPendingModel(selectedModel);
    this.vaultPath = cwd;

    const queryPrompt = buildQoderPromptWithImages(prompt, images);
    const baseContext = this.buildQueryOptionsContext(cwd, cliPath);
    const externalContextPaths = queryOptions?.externalContextPaths || [];
    const hooks = this.buildHooks();
    const hasEditorContext = prompt.includes('<editor_selection');

    let allowedTools: string[] | undefined;
    if (queryOptions?.allowedTools !== undefined && queryOptions.allowedTools.length > 0) {
      const toolSet = new Set([...queryOptions.allowedTools, TOOL_SKILL]);
      allowedTools = [...toolSet];
    }

    const ctx: ColdStartQueryContext = {
      ...baseContext,
      abortController: this.abortController ?? undefined,
      sessionId: this.sessionManager.getSessionId() ?? undefined,
      modelOverride: queryOptions?.model,
      canUseTool: this.createApprovalCallback(),
      hooks,
      mcpMentions: queryOptions?.mcpMentions,
      enabledMcpServers: queryOptions?.enabledMcpServers,
      allowedTools,
      hasEditorContext,
      externalContextPaths,
    };

    const options = QueryOptionsBuilder.buildColdStartQueryOptions(ctx);

    let sawStreamText = false;
    let sawStreamThinking = false;
    const streamState = createTransformStreamState();
    const usageState = createTransformUsageState();
    const response = agentQuery({ prompt: queryPrompt, options });
    try {
      this.turnTracker.record({ wasSent: true });
      let streamSessionId: string | null = this.sessionManager.getSessionId();

      for await (const message of response) {
        if (this.abortController?.signal.aborted) {
          await response.interrupt();
          break;
        }

        for (const event of transformSDKMessage(message, {
          intendedModel: selectedModel,
          streamState,
          usageState,
        })) {
          noteVisibleStreamContent(message, event, {
            onText: () => {
              sawStreamText = true;
            },
            onThinking: () => {
              sawStreamThinking = true;
            },
          });

          if (isSessionInitEvent(event)) {
            this.sessionManager.captureSession(event.sessionId);
            streamSessionId = event.sessionId;
          } else if (isContextWindowEvent(event)) {
            const usageChunk = this.turnTracker.updateContextWindow(event.contextWindow);
            if (usageChunk) {
              yield usageChunk;
            }
          } else if (isStreamChunk(event)) {
            if (message.type === 'assistant' && sawStreamText && event.type === 'text') {
              continue;
            }
            if (message.type === 'assistant' && sawStreamThinking && event.type === 'thinking') {
              continue;
            }
            if (event.type === 'usage') {
              yield this.turnTracker.bufferUsage({ ...event, sessionId: streamSessionId });
            } else {
              yield event;
            }
          }
        }

        if (message.type === 'assistant' && message.uuid) {
          this.turnTracker.record({ assistantMessageId: message.uuid });
        }

        if (message.type === 'result') {
          sawStreamText = false;
          sawStreamThinking = false;
        }
      }
    } catch (error) {
      // Re-throw session expired errors for outer retry logic to handle
      if (isSessionExpiredError(error)) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', content: msg };
    } finally {
      await response.close().catch(() => {});
      this.sessionManager.clearPendingModel();
      this.currentPreapprovedTools = null;
    }

    yield { type: 'done' };
  }

  /**
   * Inject a text message into the in-flight turn (steering). The channel
   * stamps `priority: 'now'` so the CLI interrupts the active turn and
   * handles the text immediately. Fails when no turn is running.
   */
  steerTurn(text: string): boolean {
    return this.messageChannel?.steer(text) ?? false;
  }

  cancel() {
    this.approvalDismisser?.();

    if (this.abortController) {
      this.abortController.abort();
      this.sessionManager.markInterrupted();
    }

    // Interrupt persistent query (Phase 1.9)
    if (this.persistentQuery && !this.shuttingDown) {
      void this.persistentQuery.interrupt().catch(() => {
        // Silence abort/interrupt errors
      });
    }
  }

  /**
   * Reset the conversation session.
   * Closes the persistent query since session is changing.
   */
  resetSession() {
    // Close persistent query (new session will use cold-start resume)
    void this.closePersistentQuery('session reset');

    // Reset crash recovery for fresh start
    this.crashRecoveryAttempted = false;

    this.sessionManager.reset();
  }

  getSessionId(): string | null {
    return this.sessionManager.getSessionId();
  }

  /** Consume session invalidation flag for persistence updates. */
  consumeSessionInvalidation(): boolean {
    return this.sessionManager.consumeInvalidation();
  }

  /**
   * Check if the service is ready (persistent query is active).
   * Used to determine if SDK skills are available.
   */
  isReady(): boolean {
    return this.isPersistentQueryActive();
  }

  /**
   * Get supported commands (SDK skills).
   * Returns cached commands populated on system/init. Falls back to a fresh
   * supportedCommands() call if the cache is empty (e.g., dropdown opened
   * before the first init event).
   */
  async getSupportedCommands(): Promise<SlashCommand[]> {
    if (this.cachedSdkCommands.length > 0) {
      return this.cachedSdkCommands;
    }
    if (!this.persistentQuery) {
      return [];
    }
    return this.fetchAndCacheCommands(this.persistentQuery);
  }

  /**
   * Fetches commands from the SDK and caches them. Called on system/init
   * (fire-and-forget) and as a fallback from getSupportedCommands().
   */
  private async fetchAndCacheCommands(query: Query | null): Promise<SlashCommand[]> {
    if (!query) return [];
    try {
      const sdkCommands: SDKSlashCommand[] = await query.supportedCommands();
      const mappedCommands = sdkCommands.map((cmd) => ({
        id: `sdk:${cmd.name}`,
        name: cmd.name,
        description: cmd.description,
        argumentHint: cmd.argumentHint,
        content: '',
        source: 'sdk' as const,
      }));
      if (this.persistentQuery !== query) {
        return this.cachedSdkCommands;
      }
      this.cachedSdkCommands = mappedCommands;
      return this.cachedSdkCommands;
    } catch {
      return [];
    }
  }

  /**
   * Set the session ID (for restoring from saved conversation).
   * Closes persistent query synchronously if session is changing, then ensures query is ready.
   *
   * @param id - Session ID to restore, or null for new session
   * @param externalContextPaths - External context paths for the session (prevents stale contexts)
   */
  setSessionId(id: string | null, externalContextPaths?: string[]): void {
    const currentId = this.sessionManager.getSessionId();
    const sessionChanged = currentId !== id;

    // Close synchronously when session changes
    if (sessionChanged) {
      void this.closePersistentQuery('session switch');
      this.crashRecoveryAttempted = false;
    }

    this.sessionManager.setSessionId(id, this.getScopedSettings().model);

    // Track external context paths for when the runtime starts on demand
    if (externalContextPaths !== undefined) {
      this.currentExternalContextPaths = externalContextPaths;
    }

    // Passive: do NOT call ensureReady() here.
    // Runtime starts on demand when query() is called.
  }

  /**
   * Cleanup resources (Phase 5).
   * Called on plugin unload to close persistent query and abort any cold-start query.
   */
  async cleanup(): Promise<void> {
    // Cancel any in-flight cold-start query
    this.cancel();
    await this.closePersistentQuery('plugin cleanup');
    this.resetSession();
  }

  async rewindFiles(userMessageId: string, dryRun?: boolean): Promise<RewindFilesResult> {
    if (!this.persistentQuery) throw new Error('No active query');
    if (this.shuttingDown) throw new Error('Service is shutting down');
    return this.persistentQuery.rewindFiles(userMessageId, { dryRun });
  }

  async rewind(
    userMessageId: string,
    assistantMessageId: string | undefined,
    mode: ChatRewindMode = 'code-and-conversation',
  ): Promise<ChatRewindResult> {
    return executeQoderRewind(userMessageId, {
      assistantMessageId,
      mode,
      rewindFiles: (id, dryRun) => this.rewindFiles(id, dryRun),
      closePersistentQuery: (reason) => this.closePersistentQuery(reason),
      setPendingResumeAt: (resumeAt) => {
        this.pendingResumeAt = resumeAt;
      },
      resetSession: () => this.resetSession(),
      vaultPath: this.vaultPath,
      externalContextPaths: this.currentExternalContextPaths,
    });
  }

  setApprovalCallback(callback: ApprovalCallback | null) {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(dismisser: (() => void) | null) {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null) {
    this.askUserQuestionCallback = callback;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentStateSource(getState: () => SubagentHookState): void {
    this.subagentStateSource = getState;
  }

  setAutoTurnCallback(callback: AutoTurnCallback | null): void {
    this.responseRouter.setAutoTurnCallback(callback);
  }

  private createApprovalCallback(): CanUseTool {
    return createQoderApprovalCallback({
      getPreapprovedTools: () => this.currentPreapprovedTools,
      getApprovalCallback: () => this.approvalCallback,
      getAskUserQuestionCallback: () => this.askUserQuestionCallback,
      getExitPlanModeCallback: () => this.exitPlanModeCallback,
      getPermissionMode: () => this.plugin.settings.permissionMode,
      resolveSDKPermissionMode: (mode) => this.resolveSDKPermissionMode(mode),
      syncPermissionMode: (mode, sdkMode) => {
        if (this.currentConfig) {
          this.currentConfig.permissionMode = mode;
          this.currentConfig.sdkPermissionMode = sdkMode;
        }
      },
    });
  }

  private resolveSDKPermissionMode(mode: PermissionMode): SDKPermissionMode {
    return QueryOptionsBuilder.resolveQoderSdkPermissionMode(mode);
  }
}
