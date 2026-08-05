import type { HookCallbackMatcher } from '@qoder-ai/qoder-agent-sdk';

import type { SubagentRuntimeState } from '../../core/runtime/types';

export type SubagentHookState = SubagentRuntimeState;

const STOP_BLOCK_REASON = 'Background subagents are still running. Use `TaskOutput task_id="..." block=true` to wait for their results before ending your turn.';

export function createStopSubagentHook(
  getState: () => SubagentHookState
): HookCallbackMatcher {
  return {
    hooks: [
      async () => {
        let hasRunning: boolean;
        try {
          hasRunning = getState().hasRunning;
        } catch {
          // State lookup failed — assume subagents are running to be safe.
          hasRunning = true;
        }

        if (hasRunning) {
          return { decision: 'block' as const, reason: STOP_BLOCK_REASON };
        }

        return {};
      },
    ],
  };
}
