import type { ChatRuntime } from '../../../core/runtime/chat-runtime';
import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { isSubagentToolName, TOOL_TASK } from '../../../qoder/tools/tool-names';
import { isBlockedToolResult } from '../rendering/tool-call-renderer';
import type { SubagentManager } from '../services/subagent-manager';
import type { ChatState } from '../state/chat-state';

export interface SubagentStreamCoordinatorDeps {
  state: ChatState;
  subagentManager: SubagentManager;
  getAgentService?: () => ChatRuntime | null;
  normalizeToolResultContent(content: unknown): string;
  showThinkingIndicator(): void;
  scrollToBottom(): void;
}

/** Owns sync/async subagent correlation, hydration, and message projection. */
export class SubagentStreamCoordinator {
  private static readonly RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

  constructor(private readonly deps: SubagentStreamCoordinatorDeps) {}

  handleTaskToolUse(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
    msg: ChatMessage,
  ): void {
    const { state, subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input);

    const result = subagentManager.handleTaskToolUse(chunk.id, chunk.input, state.currentContentEl);
    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.deps.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.deps.showThinkingIndicator();
        break;
      case 'buffered':
        this.deps.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  renderPendingTaskFromResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.deps.state.currentContentEl,
      chunk.toolUseResult,
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  async handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    if (subagentManager.hasPendingTask(parentToolUseId)) {
      const result = subagentManager.renderPendingTask(
        parentToolUseId,
        this.deps.state.currentContentEl,
      );
      if (result?.mode === 'sync') {
        this.recordSubagentInMessage(msg, result.subagentState.info, parentToolUseId);
      } else if (result) {
        this.recordSubagentInMessage(msg, result.info, parentToolUseId, 'async');
      }
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);
    if (!subagentState) return;

    if (chunk.type === 'subagent_tool_use') {
      const toolCall: ToolCallInfo = {
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
        status: 'running',
        isExpanded: false,
      };
      subagentManager.addSyncToolCall(parentToolUseId, toolCall);
      this.deps.showThinkingIndicator();
      return;
    }

    const toolCall = subagentState.info.toolCalls.find(tc => tc.id === chunk.id);
    if (!toolCall) return;
    const normalizedContent = this.deps.normalizeToolResultContent(chunk.content);
    const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
    toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
    toolCall.result = normalizedContent;
    subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
  }

  finalizeSyncSubagent(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): void {
    const isError = chunk.isError || false;
    const normalizedContent = this.deps.normalizeToolResultContent(chunk.content);
    const finalized = this.deps.subagentManager.finalizeSyncSubagent(
      chunk.id,
      chunk.content,
      isError,
      chunk.toolUseResult,
    );
    const extractedResult = finalized?.result ?? normalizedContent;

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    if (taskToolCall.subagent) {
      taskToolCall.subagent.status = isError ? 'error' : 'completed';
      taskToolCall.subagent.result = extractedResult;
    }
    if (finalized) this.applySubagentToTaskToolCall(taskToolCall, finalized);
    this.deps.showThinkingIndicator();
  }

  handleAgentOutputToolUse(chunk: Extract<StreamChunk, { type: 'tool_use' }>): void {
    this.deps.subagentManager.handleAgentOutputToolUse({
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    });
    this.deps.showThinkingIndicator();
  }

  handleAsyncTaskToolResult(chunk: Extract<StreamChunk, { type: 'tool_result' }>): boolean {
    const { subagentManager } = this.deps;
    if (!subagentManager.isPendingAsyncTask(chunk.id)) return false;
    subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
    return true;
  }

  async handleAgentOutputToolResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
  ): Promise<boolean> {
    const { subagentManager } = this.deps;
    const isLinked = subagentManager.isLinkedAgentOutputTool(chunk.id);
    const handled = subagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      chunk.toolUseResult,
    );
    await this.hydrateAsyncSubagentToolCalls(handled);
    return isLinked || handled !== undefined;
  }

  async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>,
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result,
    );
    await this.hydrateAsyncSubagentToolCalls(handled);
    if (handled) this.deps.showThinkingIndicator();
  }

  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    for (let index = this.deps.state.messages.length - 1; index >= 0; index--) {
      const msg = this.deps.state.messages[index];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) break;
    }
    this.deps.scrollToBottom();
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async',
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, info);

    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId,
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId });
    }
  }

  private async hydrateAsyncSubagentToolCalls(subagent: SubagentInfo | undefined): Promise<void> {
    if (!subagent || subagent.mode !== 'async' || !subagent.agentId) return;
    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const runtime = this.deps.getAgentService?.();
    if (!runtime) return;
    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      true,
    );
    if (hasHydrated) this.deps.subagentManager.refreshAsyncSubagent(subagent);
    if (!finalResultHydrated) this.scheduleAsyncSubagentResultRetry(subagent, runtime, 0);
  }

  private async tryHydrateAsyncSubagent(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    hydrateToolCalls: boolean,
  ): Promise<{ hasHydrated: boolean; finalResultHydrated: boolean }> {
    let hasHydrated = false;
    let finalResultHydrated = false;

    if (hydrateToolCalls && !subagent.toolCalls?.length) {
      const recoveredToolCalls = await runtime.loadSubagentToolCalls?.(subagent.agentId || '') ?? [];
      if (recoveredToolCalls.length > 0) {
        subagent.toolCalls = recoveredToolCalls.map(toolCall => ({
          ...toolCall,
          input: { ...toolCall.input },
        }));
        hasHydrated = true;
      }
    }

    const recoveredFinalResult = await runtime.loadSubagentFinalResult?.(subagent.agentId || '') ?? null;
    if (recoveredFinalResult && recoveredFinalResult.trim().length > 0) {
      finalResultHydrated = true;
      if (recoveredFinalResult !== subagent.result) {
        subagent.result = recoveredFinalResult;
        hasHydrated = true;
      }
    }
    return { hasHydrated, finalResultHydrated };
  }

  private scheduleAsyncSubagentResultRetry(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number,
  ): void {
    if (!subagent.agentId || attempt >= SubagentStreamCoordinator.RESULT_RETRY_DELAYS_MS.length) return;
    const delay = SubagentStreamCoordinator.RESULT_RETRY_DELAYS_MS[attempt];
    window.setTimeout(() => {
      void this.retryAsyncSubagentResult(subagent, runtime, attempt);
    }, delay);
  }

  private async retryAsyncSubagentResult(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number,
  ): Promise<void> {
    if (!subagent.agentId) return;
    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      false,
    );
    if (hasHydrated) this.deps.subagentManager.refreshAsyncSubagent(subagent);
    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, attempt + 1);
    }
  }

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>,
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existing = msg.toolCalls.find(
      toolCall => toolCall.id === toolId && isSubagentToolName(toolCall.name),
    );
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: TOOL_TASK,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private applySubagentToTaskToolCall(toolCall: ToolCallInfo, subagent: SubagentInfo): void {
    toolCall.subagent = subagent;
    if (subagent.status === 'completed') toolCall.status = 'completed';
    else if (subagent.status === 'error') toolCall.status = 'error';
    else toolCall.status = 'running';
    if (subagent.result !== undefined) toolCall.result = subagent.result;
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCall = msg.toolCalls?.find(
      toolCall => toolCall.id === subagent.id && isSubagentToolName(toolCall.name),
    );
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }
}
