import type {
  CanUseTool,
  PermissionMode as SDKPermissionMode,
  PermissionResult,
} from '@qoder-ai/qoder-agent-sdk';

import type {
  ApprovalCallback,
  AskUserQuestionCallback,
} from '../../core/runtime/types';
import type {
  ApprovalDecision,
  ExitPlanModeCallback,
  ExitPlanModeDecision,
} from '../../core/types';
import type { PermissionMode } from '../../core/types/settings';
import {
  TOOL_ASK_USER_QUESTION,
  TOOL_EXIT_PLAN_MODE,
} from '../tools/tool-names';
import { getActionDescription } from './approval-manager';
import { buildPermissionUpdates } from './qoder-permission-updates';

export interface QoderApprovalHandlerDeps {
  getPreapprovedTools: () => string[] | null;
  getApprovalCallback: () => ApprovalCallback | null;
  getAskUserQuestionCallback: () => AskUserQuestionCallback | null;
  getExitPlanModeCallback: () => ExitPlanModeCallback | null;
  getPermissionMode: () => PermissionMode;
  resolveSDKPermissionMode: (mode: PermissionMode) => SDKPermissionMode;
  syncPermissionMode: (mode: PermissionMode, sdkMode: SDKPermissionMode) => void;
}

export function createQoderApprovalCallback(
  deps: QoderApprovalHandlerDeps,
): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const preapprovedTools = deps.getPreapprovedTools();
    if (preapprovedTools?.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    const exitPlanModeCallback = deps.getExitPlanModeCallback();
    if (toolName === TOOL_EXIT_PLAN_MODE && exitPlanModeCallback) {
      try {
        const decision: ExitPlanModeDecision | null = await exitPlanModeCallback(input, options.signal);
        if (decision === null) {
          return { behavior: 'deny', message: 'User cancelled.', interrupt: true };
        }
        if (decision.type === 'feedback') {
          return { behavior: 'deny', message: decision.text, interrupt: false };
        }

        const permissionMode = deps.getPermissionMode();
        const sdkMode = deps.resolveSDKPermissionMode(permissionMode);
        deps.syncPermissionMode(permissionMode, sdkMode);
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [
            { type: 'setMode', mode: sdkMode, destination: 'session' },
          ],
        };
      } catch (error) {
        return {
          behavior: 'deny',
          message: `Failed to handle plan mode exit: ${error instanceof Error ? error.message : 'Unknown error'}`,
          interrupt: true,
        };
      }
    }

    const askUserQuestionCallback = deps.getAskUserQuestionCallback();
    if (toolName === TOOL_ASK_USER_QUESTION && askUserQuestionCallback) {
      try {
        // The SDK's JSDoc says "Other will be provided automatically" but
        // the SDK doesn't inject isOther into the canUseTool input. Qoderian
        // intercepts at canUseTool and renders its own UI, so we must inject
        // isOther here to match Qoder CLI's built-in behavior.
        const questions = input.questions;
        if (Array.isArray(questions)) {
          for (const q of questions) {
            if (isObjectRecord(q) && !('isOther' in q)) {
              q.isOther = true;
            }
          }
        }
        const answers = await askUserQuestionCallback(input, options.signal);
        if (answers === null) {
          return { behavior: 'deny', message: 'User declined to answer.', interrupt: true };
        }
        return { behavior: 'allow', updatedInput: { ...input, answers } };
      } catch (error) {
        return {
          behavior: 'deny',
          message: `Failed to get user answers: ${error instanceof Error ? error.message : 'Unknown error'}`,
          interrupt: true,
        };
      }
    }

    const approvalCallback = deps.getApprovalCallback();
    if (!approvalCallback) {
      return { behavior: 'deny', message: 'No approval handler available.' };
    }

    try {
      const { decisionReason, blockedPath, agentID } = options;
      const description = getActionDescription(toolName, input);
      const decision: ApprovalDecision = await approvalCallback(
        toolName,
        input,
        description,
        { decisionReason, blockedPath, agentID },
      );

      if (decision === 'cancel') {
        return { behavior: 'deny', message: 'User interrupted.', interrupt: true };
      }

      if (decision === 'allow' || decision === 'allow-always') {
        const updatedPermissions = buildPermissionUpdates(
          toolName,
          input,
          decision,
          options.suggestions,
        );
        return { behavior: 'allow', updatedInput: input, updatedPermissions };
      }

      return { behavior: 'deny', message: 'User denied this action.', interrupt: false };
    } catch (error) {
      return {
        behavior: 'deny',
        message: `Approval request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        interrupt: false,
      };
    }
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
