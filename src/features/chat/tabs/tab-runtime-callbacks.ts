import type { AutoTurnResult } from '../../../core/runtime/types';
import type { ChatMessage, QoderianSettings, StreamChunk } from '../../../core/types';
import type QoderianPlugin from '../../../main';
import { TOOL_AGENT_OUTPUT } from '../../../qoder/tools/tool-names';
import { generateMessageId } from './message-id';
import {
  getTabPermissionMode,
  getTabSettingsSnapshot,
} from './tab-qoder-context';
import type { TabData } from './types';

/** Connects the runtime's host callbacks to the tab-owned UI and state. */
export function setupServiceCallbacks(tab: TabData, plugin: QoderianPlugin): void {
  if (!tab.service || !tab.controllers.inputController) return;

  tab.service.setApprovalCallback(
    async (toolName, input, description, options) =>
      await tab.controllers.inputController?.handleApprovalRequest(toolName, input, description, options)
      ?? 'cancel'
  );
  tab.service.setApprovalDismisser(
    () => tab.controllers.inputController?.dismissPendingApprovalPrompt()
  );
  tab.service.setAskUserQuestionCallback(
    async (input, signal) =>
      await tab.controllers.inputController?.handleAskUserQuestion(input, signal)
      ?? null
  );
  tab.service.setExitPlanModeCallback(async (input, signal) => {
    const decision = await tab.controllers.inputController?.handleExitPlanMode(input, signal) ?? null;
    if (decision !== null && decision.type !== 'feedback') {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        updatePlanModeUI(tab, plugin, 'default');
      }
      if (decision.type === 'approve-new-session') {
        tab.state.pendingNewSessionPlan = decision.planContent;
        tab.state.cancelRequested = true;
      }
    }
    return decision;
  });
  tab.service.setSubagentStateSource(() => ({
    hasRunning: tab.services.subagentManager.hasRunningSubagents(),
  }));
  tab.service.setAutoTurnCallback((result: AutoTurnResult) => renderAutoTriggeredTurn(tab, result));
  tab.service.setPermissionModeSyncCallback((sdkMode) => {
    const mode = sdkMode === 'bypassPermissions' || sdkMode === 'yolo'
      ? 'yolo'
      : ['default', 'acceptEdits', 'auto', 'plan'].includes(sdkMode)
      ? sdkMode as QoderianSettings['permissionMode']
      : 'default';
    const currentMode = getTabPermissionMode(tab, plugin);

    if (currentMode !== mode) {
      updatePlanModeUI(tab, plugin, mode);
    }
  });
}

function isVisibleAutoTurnChunk(chunk: StreamChunk, hiddenToolIds: Set<string>): boolean {
  switch (chunk.type) {
    case 'text':
      return chunk.content.trim().length > 0;
    case 'thinking':
    case 'notice':
    case 'error':
    case 'tool_output':
    case 'context_compacted':
    case 'subagent_tool_use':
    case 'subagent_tool_result':
      return true;
    case 'tool_use':
      return chunk.name !== TOOL_AGENT_OUTPUT;
    case 'tool_result':
      return !hiddenToolIds.has(chunk.id);
    default:
      return false;
  }
}

function hasVisibleAutoTurnMessageContent(msg: ChatMessage): boolean {
  if (msg.content.trim().length > 0) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return msg.contentBlocks?.some(block =>
    block.type !== 'text' || block.content.trim().length > 0
  ) ?? false;
}

async function renderAutoTriggeredTurn(tab: TabData, result: AutoTurnResult): Promise<void> {
  if (!tab.dom.contentEl.isConnected) return;

  const { chunks, metadata } = result;
  if (chunks.length === 0) return;

  const hiddenToolIds = new Set(
    chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> =>
        chunk.type === 'tool_use' && chunk.name === TOOL_AGENT_OUTPUT
      )
      .map(chunk => chunk.id)
  );
  const hasVisibleContent = chunks.some(chunk => isVisibleAutoTurnChunk(chunk, hiddenToolIds));

  const assistantMsg: ChatMessage = {
    id: metadata.assistantMessageId ?? generateMessageId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: [],
    contentBlocks: [],
    ...(metadata.assistantMessageId && { assistantMessageId: metadata.assistantMessageId }),
  };

  const previousContentEl = tab.state.currentContentEl;
  const previousTextEl = tab.state.currentTextEl;
  const previousTextContent = tab.state.currentTextContent;
  const previousThinkingState = tab.state.currentThinkingState;

  if (hasVisibleContent) {
    tab.state.addMessage(assistantMsg);
    const msgEl = tab.renderer?.addMessage?.(assistantMsg);
    const contentEl = msgEl?.querySelector<HTMLElement>('.qoderian-message-content');
    if (contentEl) {
      if (!previousContentEl) tab.state.toolCallElements.clear();
      tab.state.currentContentEl = contentEl;
      tab.state.currentTextEl = null;
      tab.state.currentTextContent = '';
      tab.state.currentThinkingState = null;
    }
  }

  try {
    for (const chunk of chunks) {
      await tab.controllers.streamController?.handleStreamChunk(chunk, assistantMsg);
    }

    if (hasVisibleContent && !hasVisibleAutoTurnMessageContent(assistantMsg)) {
      const placeholder = '(background task completed)';
      assistantMsg.content = placeholder;
      await tab.controllers.streamController?.appendText(placeholder);
    }

    if (hasVisibleContent) {
      await tab.controllers.streamController?.finalizeCurrentThinkingBlock(assistantMsg);
      await tab.controllers.streamController?.finalizeCurrentTextBlock(assistantMsg);
    }
  } finally {
    if (hasVisibleContent) {
      tab.controllers.streamController?.hideThinkingIndicator();
      tab.services.subagentManager.resetStreamingState?.();
      tab.state.currentContentEl = previousContentEl;
      tab.state.currentTextEl = previousTextEl;
      tab.state.currentTextContent = previousTextContent;
      tab.state.currentThinkingState = previousThinkingState;
      tab.renderer?.scrollToBottom();
    }
  }
}

export function updatePlanModeUI(tab: TabData, plugin: QoderianPlugin, mode: string): void {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  snapshot.permissionMode = mode as QoderianSettings['permissionMode'];
  void plugin.saveSettings();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass('qoderian-input-plan-mode', mode === 'plan');
}
