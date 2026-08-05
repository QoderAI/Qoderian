import type {
  ChatRuntimeConversationState,
  SessionUpdateResult,
} from '../../core/runtime/types';
import type { ChatMessage, Conversation, ImageAttachment, QoderState } from '../../core/types';
import { stripCurrentNoteContext } from '../prompt/context/prompt-context';
import { getQoderState } from '../types/qoder-state';
import {
  buildContextFromHistory,
  buildPromptWithHistoryContext,
  getLastUserMessage,
} from './session-context';

export interface ConversationResumeState {
  sessionId: string | null;
  pendingForkSession: boolean;
  pendingResumeAt?: string;
}

export function resolveConversationResumeState(
  conversation: ChatRuntimeConversationState,
): ConversationResumeState {
  const state = getQoderState(conversation.qoderState);
  const pendingForkSession = !conversation.sessionId && !!state.forkSource;
  return {
    sessionId: conversation.sessionId ?? state.forkSource?.sessionId ?? null,
    pendingForkSession,
    pendingResumeAt: pendingForkSession ? state.forkSource?.resumeAt : undefined,
  };
}

export function buildConversationSessionUpdates(
  conversation: Conversation | null,
  currentSessionId: string | null,
  sessionInvalidated: boolean,
): SessionUpdateResult {
  const existingState = getQoderState(conversation?.qoderState);
  const oldSdkSessionId = conversation?.sessionId ?? null;
  const sessionChanged = currentSessionId
    && oldSdkSessionId
    && currentSessionId !== oldSdkSessionId;
  const previousSessionIds = sessionChanged
    ? [...new Set([...(existingState.previousSessionIds || []), oldSdkSessionId])]
    : existingState.previousSessionIds;
  const isForkSourceOnly = !!existingState.forkSource
    && !conversation?.sessionId
    && currentSessionId === existingState.forkSource.sessionId;

  const resolvedSessionId = sessionInvalidated
    ? null
    : isForkSourceOnly
      ? conversation?.sessionId ?? null
      : currentSessionId ?? conversation?.sessionId ?? null;
  const qoderState: QoderState = { ...existingState, previousSessionIds };

  if (
    existingState.forkSource
    && currentSessionId
    && currentSessionId !== existingState.forkSource.sessionId
  ) {
    delete qoderState.forkSource;
  }

  return {
    updates: {
      sessionId: resolvedSessionId,
      qoderState,
    },
  };
}

export function resolveForkSessionId(
  conversation: Conversation | null,
  currentSessionId: string | null,
): string | null {
  if (currentSessionId) return currentSessionId;
  if (!conversation) return null;
  const state = getQoderState(conversation.qoderState);
  return conversation.sessionId ?? state.forkSource?.sessionId ?? null;
}

export function buildHistoryRebuildRequest(
  prompt: string,
  conversationHistory: ChatMessage[],
): { prompt: string; images?: ImageAttachment[] } {
  const historyContext = buildContextFromHistory(conversationHistory);
  const actualPrompt = stripCurrentNoteContext(prompt);
  return {
    prompt: buildPromptWithHistoryContext(
      historyContext,
      prompt,
      actualPrompt,
      conversationHistory,
    ),
    images: getLastUserMessage(conversationHistory)?.images,
  };
}
