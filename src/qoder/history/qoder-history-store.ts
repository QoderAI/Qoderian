import { TurnErrorAccumulator } from '../../core/chat/error-blocks';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../core/types';
import { isSubagentToolName } from '../tools/tool-names';
import { buildAsyncSubagentInfo } from './sdk-async-subagent';
import { filterActiveBranch } from './sdk-branch-filter';
import type { SDKSessionLoadResult } from './sdk-history-types';
import {
  collectAsyncSubagentResults,
  collectStructuredPatchResults,
  collectToolResults,
  extractXmlTag,
  hydrateFallbackAskUserAnswers,
  hydrateStructuredToolResults,
  isSystemInjectedMessage,
  mergeAssistantMessage,
  parseSDKMessageToChat,
} from './sdk-message-parsing';
import {
  deleteSDKSession,
  deleteSDKSessionArtifacts,
  encodeVaultPathForSDK,
  getSDKProjectsPath,
  getSDKSessionPath,
  isValidSessionId,
  readSDKSession,
  sdkSessionExists,
} from './sdk-session-paths';
import {
  isValidAgentId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
} from './sdk-subagent-sidecar';

export type {
  AsyncSubagentResult,
  ResolvedAsyncStatus,
  SDKNativeContentBlock,
  SDKNativeMessage,
  SDKSessionLoadResult,
  SDKSessionReadResult,
} from './sdk-history-types';
export {
  collectAsyncSubagentResults,
  deleteSDKSession,
  deleteSDKSessionArtifacts,
  encodeVaultPathForSDK,
  extractXmlTag,
  filterActiveBranch,
  getSDKProjectsPath,
  getSDKSessionPath,
  isValidSessionId,
  loadSubagentFinalResult,
  loadSubagentToolCalls,
  parseSDKMessageToChat,
  readSDKSession,
  sdkSessionExists,
};
export {
  extractAgentIdFromToolUseResult,
  resolveToolUseResultStatus,
} from './sdk-async-subagent';

export async function loadSDKSessionMessages(
  vaultPath: string,
  sessionId: string,
  resumeAtMessageId?: string
): Promise<SDKSessionLoadResult> {
  const result = await readSDKSession(vaultPath, sessionId);

  if (result.error) {
    return { messages: [], skippedLines: result.skippedLines, error: result.error };
  }

  const filteredEntries = filterActiveBranch(result.messages, resumeAtMessageId);

  const toolResults = collectToolResults(filteredEntries);
  const toolUseResults = collectStructuredPatchResults(filteredEntries);
  const asyncSubagentResults = collectAsyncSubagentResults(filteredEntries);

  const chatMessages: ChatMessage[] = [];
  let pendingAssistant: ChatMessage | null = null;

  // Merge consecutive assistant messages until an actual user message appears
  for (const sdkMsg of filteredEntries) {
    if (isSystemInjectedMessage(sdkMsg)) continue;

    // Skip synthetic assistant messages (e.g., "No response requested." after /compact)
    if (sdkMsg.type === 'assistant' && sdkMsg.message?.model === '<synthetic>') continue;

    if (sdkMsg.type === 'result') {
      const resultErrors = Array.isArray(sdkMsg.errors)
        ? sdkMsg.errors.filter(error => error.trim().length > 0)
        : [];
      const isErrorResult = resultErrors.length > 0
        || (!!sdkMsg.subtype && sdkMsg.subtype !== 'success');
      if (!isErrorResult) continue;

      if (!pendingAssistant) {
        const timestamp = sdkMsg.timestamp ? new Date(sdkMsg.timestamp).getTime() : Date.now();
        pendingAssistant = {
          id: sdkMsg.uuid || `sdk-result-error-${timestamp}-${Math.random().toString(36).slice(2)}`,
          role: 'assistant',
          content: '',
          timestamp,
          contentBlocks: [],
        };
      }

      const errors = resultErrors.length > 0
        ? resultErrors
        : [`Result error: ${sdkMsg.subtype}`];
      const accumulator = new TurnErrorAccumulator(pendingAssistant);
      for (const error of errors) {
        accumulator.reconcile(pendingAssistant, { content: error });
      }
      continue;
    }

    const chatMsg = parseSDKMessageToChat(sdkMsg, toolResults);
    if (!chatMsg) continue;

    if (chatMsg.role === 'assistant') {
      // context_compacted must not merge with previous assistant (it's a standalone separator)
      const isCompactBoundary = chatMsg.contentBlocks?.some(b => b.type === 'context_compacted');
      if (isCompactBoundary) {
        if (pendingAssistant) {
          chatMessages.push(pendingAssistant);
        }
        chatMessages.push(chatMsg);
        pendingAssistant = null;
      } else if (pendingAssistant) {
        mergeAssistantMessage(pendingAssistant, chatMsg);
      } else {
        pendingAssistant = chatMsg;
      }
    } else {
      if (pendingAssistant) {
        chatMessages.push(pendingAssistant);
        pendingAssistant = null;
      }
      chatMessages.push(chatMsg);
    }
  }

  if (pendingAssistant) {
    chatMessages.push(pendingAssistant);
  }

  hydrateStructuredToolResults(chatMessages, toolUseResults);
  hydrateFallbackAskUserAnswers(chatMessages);

  // Build SubagentInfo for async Agent tool calls from toolUseResult + queue-operation data
  if (toolUseResults.size > 0 || asyncSubagentResults.size > 0) {
    const sidecarLoads: Array<{ subagent: SubagentInfo; promise: Promise<ToolCallInfo[]> }> = [];

    for (const msg of chatMessages) {
      if (msg.role !== 'assistant' || !msg.toolCalls) continue;
      for (const toolCall of msg.toolCalls) {
        if (!isSubagentToolName(toolCall.name)) continue;
        if (toolCall.subagent) continue;
        if (toolCall.input?.run_in_background !== true) continue;

        const toolUseResult = toolUseResults.get(toolCall.id);
        const subagent = buildAsyncSubagentInfo(
          toolCall,
          toolUseResult,
          asyncSubagentResults
        );
        if (subagent) {
          toolCall.subagent = subagent;
          if (subagent.result !== undefined) {
            toolCall.result = subagent.result;
          }
          toolCall.status = subagent.status;

          // Load tool calls from subagent sidecar JSONL in parallel
          if (subagent.agentId && isValidAgentId(subagent.agentId)) {
            sidecarLoads.push({
              subagent,
              promise: loadSubagentToolCalls(vaultPath, sessionId, subagent.agentId),
            });
          }
        }
      }
    }

    // Hydrate subagent tool calls from sidecar files
    if (sidecarLoads.length > 0) {
      const results = await Promise.all(sidecarLoads.map(s => s.promise));
      for (let i = 0; i < sidecarLoads.length; i++) {
        const toolCalls = results[i];
        if (toolCalls.length > 0) {
          sidecarLoads[i].subagent.toolCalls = toolCalls;
        }
      }
    }
  }

  chatMessages.sort((a, b) => a.timestamp - b.timestamp);

  return { messages: chatMessages, skippedLines: result.skippedLines };
}
