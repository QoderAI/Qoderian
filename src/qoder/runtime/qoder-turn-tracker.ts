import type { Query, SDKMessage } from '@qoder-ai/qoder-agent-sdk';

import type { ChatTurnMetadata } from '../../core/runtime/types';
import type { StreamChunk } from '../../core/types';
import { getContextWindowSize } from '../models/model-catalog';
import { toQoderRuntimeModelId } from '../models/model-selection';
import {
  createTransformStreamState,
  createTransformUsageState,
} from '../stream/transform-qoder-message';
import type { TransformEvent } from '../stream/types';

type UsageChunk = Extract<StreamChunk, { type: 'usage' }>;

interface ContextUsageRequest {
  query: Query | null;
  isCurrentQuery: (query: Query) => boolean;
  configuredModel: string;
  sessionId: string | null;
}

/** Owns metadata and usage state that lives for exactly one Qoder turn. */
export class QoderTurnTracker {
  private metadata: ChatTurnMetadata = {};
  private bufferedUsageChunk: UsageChunk | null = null;
  private readonly streamState = createTransformStreamState();
  private readonly usageState = createTransformUsageState();

  consumeMetadata(): ChatTurnMetadata {
    const metadata = { ...this.metadata };
    this.metadata = {};
    this.bufferedUsageChunk = null;
    return metadata;
  }

  reset(): void {
    this.metadata = {};
    this.bufferedUsageChunk = null;
    this.clearTransformState();
  }

  clearTransformState(): void {
    this.streamState.clearAll();
    this.usageState.clear();
  }

  record(update: Partial<ChatTurnMetadata>): void {
    this.metadata = { ...this.metadata, ...update };
  }

  bufferUsage(chunk: UsageChunk): UsageChunk {
    this.bufferedUsageChunk = chunk;
    return chunk;
  }

  updateContextWindow(contextWindow: number): UsageChunk | null {
    if (!this.bufferedUsageChunk || contextWindow <= 0) {
      return null;
    }

    const usage = this.bufferedUsageChunk.usage;
    const percentage = Math.min(
      100,
      Math.max(0, Math.round((usage.contextTokens / contextWindow) * 100)),
    );
    const nextChunk: UsageChunk = {
      ...this.bufferedUsageChunk,
      usage: {
        ...usage,
        contextWindow,
        contextWindowIsAuthoritative: true,
        percentage,
      },
    };
    this.bufferedUsageChunk = nextChunk;
    return nextChunk;
  }

  getTransformOptions(model: string) {
    return {
      intendedModel: toQoderRuntimeModelId(model),
      streamState: this.streamState,
      usageState: this.usageState,
    };
  }

  /** Reads the CLI's public context-usage control API when available. */
  async fetchContextUsage(request: ContextUsageRequest): Promise<UsageChunk | null> {
    const activeQuery = request.query;
    if (!activeQuery || typeof activeQuery.getContextUsage !== 'function') {
      return null;
    }

    try {
      const response = await activeQuery.getContextUsage();
      if (!request.isCurrentQuery(activeQuery)) {
        return null;
      }

      const previousUsage = this.bufferedUsageChunk?.usage;
      const model = toQoderRuntimeModelId(
        response.model || previousUsage?.model || request.configuredModel,
      );
      const reportedContextWindow = [response.rawMaxTokens, response.maxTokens]
        .find(value => Number.isFinite(value) && value > 0);
      const previousContextWindow = previousUsage?.model === model && previousUsage.contextWindow > 0
        ? previousUsage.contextWindow
        : undefined;
      const contextWindow = reportedContextWindow
        ?? previousContextWindow
        ?? getContextWindowSize(model);
      const ratio = Number.isFinite(response.percentage)
        ? Math.min(1, Math.max(0, response.percentage))
        : 0;
      const reportedTotalTokens = Number.isFinite(response.totalTokens) && response.totalTokens > 0
        ? response.totalTokens
        : 0;
      const estimatedContextTokens = ratio > 0
        ? Math.max(1, Math.round(contextWindow * ratio))
        : 0;
      const contextTokens = reportedTotalTokens
        || estimatedContextTokens
        || previousUsage?.contextTokens
        || 0;
      const apiUsage = response.apiUsage;

      return {
        type: 'usage',
        usage: {
          model,
          inputTokens: apiUsage?.input_tokens || previousUsage?.inputTokens || 0,
          cacheCreationInputTokens: apiUsage?.cache_creation_input_tokens
            || previousUsage?.cacheCreationInputTokens
            || 0,
          cacheReadInputTokens: apiUsage?.cache_read_input_tokens
            || previousUsage?.cacheReadInputTokens
            || 0,
          contextWindow,
          contextWindowIsAuthoritative: reportedContextWindow !== undefined,
          contextTokens,
          percentage: Number.isFinite(response.percentage)
            ? Math.round(ratio * 100)
            : Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100))),
        },
        sessionId: request.sessionId,
      };
    } catch {
      // Usage is supplemental; older or closing queries may reject the request.
      return null;
    }
  }
}

/** Marks only transformed stream content that is actually visible to the user. */
export function noteVisibleStreamContent(
  message: SDKMessage,
  event: TransformEvent,
  callbacks: { onText: () => void; onThinking: () => void },
): void {
  if (message.type !== 'stream_event') return;

  if (event.type === 'text') {
    callbacks.onText();
  } else if (event.type === 'thinking') {
    callbacks.onThinking();
  }
}
