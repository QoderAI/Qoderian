import type { SDKResultError } from '@qoder-ai/qoder-agent-sdk';
import { buildSDKMessage } from '@test/helpers/sdk-messages';

import type { StreamChunk } from '@/core/types';
import { QoderResponseRouter } from '@/qoder/runtime/qoder-response-router';
import { createResponseHandler } from '@/qoder/runtime/types';

function createRouterHarness() {
  const onTurnComplete = jest.fn();
  const deps = {
    turnTracker: {
      getTransformOptions: () => ({}),
      fetchContextUsage: async () => null,
      bufferUsage: (chunk: StreamChunk) => chunk,
      updateContextWindow: () => null,
      record: jest.fn(),
    },
    getCurrentQuery: () => null,
    getMessageChannel: () => ({ onTurnComplete }),
    getConfiguredModel: () => 'qoder-sonnet-4-5',
    getConfiguredContextWindow: () => undefined,
    getSessionId: () => null,
    onSessionInit: jest.fn(),
    onPlanModeEntered: jest.fn(),
  };
  const router = new QoderResponseRouter(deps as never);

  const chunks: StreamChunk[] = [];
  const events = { onDone: jest.fn(), onError: jest.fn() };
  const handler = createResponseHandler({
    id: 'test-handler',
    onChunk: chunk => chunks.push(chunk),
    onDone: events.onDone,
    onError: events.onError,
  });
  router.register(handler);

  return { router, handler, chunks, events, onTurnComplete };
}

function buildAbortResult(): SDKResultError {
  return buildSDKMessage({
    type: 'result',
    subtype: 'error_during_execution',
    errors: ['Operation aborted'],
    terminal_reason: 'aborted_streaming',
  }) as SDKResultError;
}

describe('QoderResponseRouter', () => {
  describe('aborted turn results', () => {
    it('keeps the active handler alive so the successor turn keeps streaming', async () => {
      const { router, events, onTurnComplete } = createRouterHarness();

      await router.route(buildAbortResult());

      expect(onTurnComplete).toHaveBeenCalledTimes(1);
      expect(events.onDone).not.toHaveBeenCalled();
    });

    it('completes the handler on the successor turn result', async () => {
      const { router, events } = createRouterHarness();

      await router.route(buildAbortResult());
      expect(events.onDone).not.toHaveBeenCalled();

      await router.route(buildSDKMessage({ type: 'result', subtype: 'success' }));
      expect(events.onDone).toHaveBeenCalledTimes(1);
    });

    it('routes nothing to the handler for an abort receipt', async () => {
      const { router, chunks } = createRouterHarness();

      await router.route(buildAbortResult());

      expect(chunks).toEqual([]);
    });

    it('completes the handler for non-abort error results', async () => {
      const { router, events } = createRouterHarness();

      await router.route(buildSDKMessage({
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['Credit limit reached'],
      }));

      expect(events.onDone).toHaveBeenCalledTimes(1);
    });
  });
});
