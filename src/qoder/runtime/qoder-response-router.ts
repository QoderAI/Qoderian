import type { Query, SDKMessage } from '@qoder-ai/qoder-agent-sdk';
import { Notice } from 'obsidian';

import type { AutoTurnCallback } from '../../core/runtime/types';
import type { StreamChunk } from '../../core/types';
import { isAbortedResult,transformSDKMessage } from '../stream/transform-qoder-message';
import { isContextWindowEvent, isSessionInitEvent, isStreamChunk } from '../stream/type-guards';
import type { SessionInitEvent } from '../stream/types';
import { TOOL_ENTER_PLAN_MODE } from '../tools/tool-names';
import type { QoderMessageChannel } from './qoder-message-channel';
import { noteVisibleStreamContent, type QoderTurnTracker } from './qoder-turn-tracker';
import { isTurnCompleteMessage, type ResponseHandler } from './types';

interface QoderResponseRouterDeps {
  turnTracker: QoderTurnTracker;
  getCurrentQuery: () => Query | null;
  getMessageChannel: () => QoderMessageChannel | null;
  getConfiguredModel: () => string;
  /** Effective context window from the per-model override, if any. */
  getConfiguredContextWindow: () => number | undefined;
  getSessionId: () => string | null;
  onSessionInit: (event: SessionInitEvent) => void;
  onPlanModeEntered: () => void;
}

/** Routes SDK messages to the active turn or a background auto-triggered turn. */
export class QoderResponseRouter {
  private readonly handlers: ResponseHandler[] = [];
  private autoTurnBuffer: StreamChunk[] = [];
  private autoTurnSawStreamText = false;
  private autoTurnSawStreamThinking = false;
  private autoTurnCallback: AutoTurnCallback | null = null;

  constructor(private readonly deps: QoderResponseRouterDeps) {}

  getActiveHandler(): ResponseHandler | undefined {
    return this.handlers[this.handlers.length - 1];
  }

  register(handler: ResponseHandler): void {
    this.handlers.push(handler);
  }

  unregister(handlerId: string): void {
    const index = this.handlers.findIndex(handler => handler.id === handlerId);
    if (index >= 0) this.handlers.splice(index, 1);
  }

  reset(preserveHandlers = false): void {
    this.autoTurnBuffer = [];
    this.autoTurnSawStreamText = false;
    this.autoTurnSawStreamThinking = false;

    if (preserveHandlers) return;
    for (const handler of this.handlers) handler.onDone();
    this.handlers.length = 0;
  }

  setAutoTurnCallback(callback: AutoTurnCallback | null): void {
    this.autoTurnCallback = callback;
  }

  async route(message: SDKMessage): Promise<void> {
    const handler = this.getActiveHandler();
    const autoTurnBufferStartLength = this.autoTurnBuffer.length;
    const transformOptions = this.deps.turnTracker.getTransformOptions(
      this.deps.getConfiguredModel(),
      this.deps.getConfiguredContextWindow(),
    );

    for (const event of transformSDKMessage(message, transformOptions)) {
      noteVisibleStreamContent(message, event, {
        onText: () => {
          if (handler) handler.markStreamTextSeen();
          else this.autoTurnSawStreamText = true;
        },
        onThinking: () => {
          if (handler) handler.markStreamThinkingSeen();
          else this.autoTurnSawStreamThinking = true;
        },
      });

      if (isSessionInitEvent(event)) {
        this.deps.onSessionInit(event);
        continue;
      }

      if (isContextWindowEvent(event)) {
        const usageChunk = this.deps.turnTracker.updateContextWindow(event.contextWindow);
        if (usageChunk) this.dispatchChunk(usageChunk, handler);
        continue;
      }

      if (!isStreamChunk(event)) continue;

      // Streaming can emit zeroed usage snapshots (the CLI masks counts
      // mid-turn); dropping them keeps the meter on its last real reading
      // instead of flashing back to the placeholder.
      if (event.type === 'usage'
        && event.usage.contextTokens <= 0
        && this.deps.turnTracker.hasBufferedUsage()) {
        continue;
      }

      if (
        message.type === 'assistant'
        && event.type === 'text'
        && (handler?.sawStreamText || (!handler && this.autoTurnSawStreamText))
      ) {
        continue;
      }
      if (
        message.type === 'assistant'
        && event.type === 'thinking'
        && (handler?.sawStreamThinking || (!handler && this.autoTurnSawStreamThinking))
      ) {
        continue;
      }

      if (event.type === 'tool_use' && event.name === TOOL_ENTER_PLAN_MODE) {
        this.deps.onPlanModeEntered();
      }

      const normalizedChunk = event.type === 'usage'
        ? this.deps.turnTracker.bufferUsage({
          ...event,
          sessionId: this.deps.getSessionId(),
        })
        : event;
      this.dispatchChunk(normalizedChunk, handler);
    }

    if (
      !handler
      && message.type === 'system'
      && message.subtype === 'task_notification'
      && this.autoTurnBuffer.length > autoTurnBufferStartLength
    ) {
      await this.flushAutoTurnBuffer();
    }

    if (message.type === 'assistant' && message.uuid) {
      this.deps.turnTracker.record({ assistantMessageId: message.uuid });
    }

    if (!isTurnCompleteMessage(message)) return;

    // A priority-'now' steer emits an aborted result for the interrupted
    // turn, but the persistent Query is already running its successor turn.
    // Do not ask the Query for context usage here: that control request waits
    // for the successor to become idle, which blocks this sole response
    // consumer and batches every successor delta until the turn finishes.
    // The message channel must also remain active so another steer can be
    // accepted while the successor is running.
    if (isAbortedResult(message)) {
      handler?.resetStreamText();
      handler?.resetStreamThinking();
      return;
    }

    const contextUsageChunk = await this.deps.turnTracker.fetchContextUsage({
      query: this.deps.getCurrentQuery(),
      isCurrentQuery: query => this.deps.getCurrentQuery() === query,
      configuredModel: this.deps.getConfiguredModel(),
      configuredContextWindow: this.deps.getConfiguredContextWindow(),
      sessionId: this.deps.getSessionId(),
    });
    if (contextUsageChunk) {
      this.dispatchChunk(this.deps.turnTracker.bufferUsage(contextUsageChunk), handler);
    }

    this.deps.getMessageChannel()?.onTurnComplete();
    if (handler) {
      handler.resetStreamText();
      handler.resetStreamThinking();
      handler.onDone();
    } else {
      await this.flushAutoTurnBuffer();
    }
  }

  private dispatchChunk(chunk: StreamChunk, handler: ResponseHandler | undefined): void {
    if (handler) handler.onChunk(chunk);
    else this.autoTurnBuffer.push(chunk);
  }

  private async flushAutoTurnBuffer(): Promise<void> {
    this.autoTurnSawStreamText = false;
    this.autoTurnSawStreamThinking = false;
    if (this.autoTurnBuffer.length === 0) return;

    const chunks = [...this.autoTurnBuffer];
    const metadata = this.deps.turnTracker.consumeMetadata();
    this.autoTurnBuffer = [];
    try {
      await this.autoTurnCallback?.({ chunks, metadata });
    } catch {
      new Notice('Background task completed, but the result could not be rendered.');
    }
  }
}
