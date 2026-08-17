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
  /** Effective context window from the per-model editor override, if any. */
  configuredContextWindow?: number;
  sessionId: string | null;
}

/**
 * Wire shape returned by the qodercli `get_context_usage` control API
 * (1.1.21+). Percentages are reported in percent units (5.4 === 5.4%);
 * absolute token counts only appear when the CLI can provide them.
 * The SDK's declared response type still mirrors an older shape, so the
 * tracker reads the payload through this interface.
 */
interface CliContextUsagePayload {
  model?: string;
  tokenCountsAvailable?: boolean;
  contextWindow?: {
    usedPercentage?: number;
    usedTokens?: number;
    maxTokens?: number;
  };
  categories?: Array<{ type?: string; tokens?: number; percentage?: number }>;
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
      const payload = await activeQuery.getContextUsage() as unknown as CliContextUsagePayload;
      if (!request.isCurrentQuery(activeQuery)) {
        return null;
      }

      const previousUsage = this.bufferedUsageChunk?.usage;
      const model = toQoderRuntimeModelId(
        payload.model || previousUsage?.model || request.configuredModel,
      );
      const rawMaxTokens = payload.contextWindow?.maxTokens;
      const reportedMaxTokens = typeof rawMaxTokens === 'number'
        && Number.isFinite(rawMaxTokens) && rawMaxTokens > 0
        ? rawMaxTokens
        : undefined;
      const hasReportedWindow = reportedMaxTokens !== undefined;
      const previousContextWindow = previousUsage?.model === model && previousUsage.contextWindow > 0
        ? previousUsage.contextWindow
        : undefined;
      // Without a CLI-reported window the configured tier is the source of
      // truth; buffered chunks only carry catalog fallbacks.
      const configuredContextWindow = Number.isFinite(request.configuredContextWindow)
        && (request.configuredContextWindow as number) > 0
        ? request.configuredContextWindow
        : undefined;
      const contextWindow = reportedMaxTokens
        ?? configuredContextWindow
        ?? previousContextWindow
        ?? getContextWindowSize(model);

      const rawUsedPercentage = payload.contextWindow?.usedPercentage;
      const hasReportedRatio = typeof rawUsedPercentage === 'number'
        && Number.isFinite(rawUsedPercentage);
      const ratio = hasReportedRatio ? Math.min(1, Math.max(0, rawUsedPercentage / 100)) : 0;

      // Absolute counts are only meaningful when the CLI can provide them.
      const categoryTokens = payload.tokenCountsAvailable === true
        ? (payload.categories ?? []).reduce(
          (sum, category) => sum + (typeof category.tokens === 'number'
            && Number.isFinite(category.tokens) && category.tokens > 0
            ? category.tokens
            : 0),
          0,
        )
        : 0;
      const rawUsedTokens = payload.contextWindow?.usedTokens;
      const usedTokens = typeof rawUsedTokens === 'number'
        && Number.isFinite(rawUsedTokens) && rawUsedTokens > 0
        ? rawUsedTokens
        : 0;
      const reportedTotalTokens = [usedTokens, categoryTokens].find(value => value > 0) ?? 0;
      const estimatedContextTokens = ratio > 0
        ? Math.max(1, Math.round(contextWindow * ratio))
        : 0;
      const contextTokens = reportedTotalTokens
        || estimatedContextTokens
        || previousUsage?.contextTokens
        || 0;

      return {
        type: 'usage',
        usage: {
          model,
          inputTokens: previousUsage?.inputTokens || 0,
          cacheCreationInputTokens: previousUsage?.cacheCreationInputTokens || 0,
          cacheReadInputTokens: previousUsage?.cacheReadInputTokens || 0,
          contextWindow,
          contextWindowIsAuthoritative: hasReportedWindow,
          contextTokens,
          percentage: hasReportedRatio
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
