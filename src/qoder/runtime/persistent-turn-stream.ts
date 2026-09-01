import type { SDKUserMessage } from '@qoder-ai/qoder-agent-sdk';

import { logElapsed } from '../../core/diagnostics/performance';
import type { StreamChunk } from '../../core/types';
import type { QoderMessageChannel } from './qoder-message-channel';
import { isSessionExpiredError } from './session-context';
import { createResponseHandler, type ResponseHandler } from './types';

interface PersistentTurnStreamOptions {
  message: SDKUserMessage;
  messageChannel: QoderMessageChannel;
  registerHandler: (handler: ResponseHandler) => void;
  unregisterHandler: (handlerId: string) => void;
  onMessageQueued: () => void;
  onCompleted: () => void;
  fallback: () => AsyncGenerator<StreamChunk>;
}

/** Bridges callback-based persistent Query responses into an async chunk stream. */
export async function* streamPersistentTurn(
  options: PersistentTurnStreamOptions,
): AsyncGenerator<StreamChunk> {
  const state = {
    chunks: [] as StreamChunk[],
    resolveChunk: null as ((chunk: StreamChunk | null) => void) | null,
    done: false,
    error: null as Error | null,
  };
  const handlerId = `handler-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const enqueuedAt = performance.now();
  let sawFirstChunk = false;
  const handler = createResponseHandler({
    id: handlerId,
    onChunk: chunk => {
      if (!sawFirstChunk) {
        sawFirstChunk = true;
        // Covers CLI cold-start when the persistent Query was just spawned.
        logElapsed('turn.enqueueToFirstChunk', enqueuedAt);
      }
      handler.markChunkSeen();
      if (state.resolveChunk) {
        state.resolveChunk(chunk);
        state.resolveChunk = null;
      } else {
        state.chunks.push(chunk);
      }
    },
    onDone: () => {
      state.done = true;
      state.resolveChunk?.(null);
      state.resolveChunk = null;
    },
    onError: error => {
      state.error = error;
      state.done = true;
      state.resolveChunk?.(null);
      state.resolveChunk = null;
    },
  });

  options.registerHandler(handler);
  try {
    try {
      options.messageChannel.enqueue(options.message);
    } catch (error) {
      if (error instanceof Error && error.message.includes('closed')) {
        yield* options.fallback();
        return;
      }
      throw error;
    }
    options.onMessageQueued();

    while (!state.done) {
      if (state.chunks.length > 0) {
        yield state.chunks.shift()!;
        continue;
      }

      const chunk = await new Promise<StreamChunk | null>(resolve => {
        state.resolveChunk = resolve;
      });
      if (chunk) yield chunk;
    }

    while (state.chunks.length > 0) {
      yield state.chunks.shift()!;
    }

    if (state.error) {
      if (isSessionExpiredError(state.error)) throw state.error;
      yield { type: 'error', content: state.error.message };
    }

    options.onCompleted();
    yield { type: 'done' };
  } finally {
    options.unregisterHandler(handlerId);
  }
}
