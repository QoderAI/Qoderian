import { Notice } from 'obsidian';

import { hasErrorContentBlock } from '../../../core/chat/error-blocks';
import { detectBuiltInCommand } from '../../../core/commands/built-in-commands';
import type { BrowserSelectionContext, CanvasSelectionContext } from '../../../core/context/types';
import type { EditorSelectionContext } from '../../../core/editor/editor-context';
import type { ChatRuntime } from '../../../core/runtime/chat-runtime';
import type { ApprovalCallbackOptions, ChatTurnRequest } from '../../../core/runtime/types';
import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '../../../core/types';
import {
  type InstructionRefineService,
  type TitleGenerationService,
} from '../../../core/types/services';
import type QoderianPlugin from '../../../main';
import { extractUserDisplayContent } from '../../../qoder/prompt/context/prompt-context';
import { TOOL_EXIT_PLAN_MODE } from '../../../qoder/tools/tool-names';
import { appendMarkdownSnippet } from '../../../shared/markdown/markdown';
import { COMPLETION_FLAVOR_WORDS } from '../flavor-texts';
import type { MessageRenderer } from '../rendering/message-renderer';
import { updateToolCallResult } from '../rendering/tool-call-renderer';
import type { SubagentManager } from '../services/subagent-manager';
import type { ChatState } from '../state/chat-state';
import type { FileContextManager } from '../ui/file-context/file-context-manager';
import type { ImageContextManager } from '../ui/image-context';
import type { AddExternalContextResult, McpServerSelector } from '../ui/input-toolbar';
import { InstructionModal } from '../ui/instruction-confirm-modal';
import type { InstructionModeManager } from '../ui/instruction-mode-manager';
import type { StatusPanel } from '../ui/status-panel';
import { ApprovalFlowController } from './approval-flow-controller';
import type { BrowserSelectionController } from './browser-selection-controller';
import type { CanvasSelectionController } from './canvas-selection-controller';
import type { ConversationController } from './conversation-controller';
import { InputCommandController } from './input-command-controller';
import { QueuedMessageController } from './queued-message-controller';
import { cloneChatTurnRequest, type QueuedChatTurn } from './queued-turn';
import type { SelectionController } from './selection-controller';
import type { StreamController } from './stream-controller';

export interface InputControllerDeps {
  plugin: QoderianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLTextAreaElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  getAuxiliaryModel?: () => string | null;
  getAgentService?: () => ChatRuntime | null;
  getSubagentManager: () => SubagentManager;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openConversation?: (conversationId: string) => Promise<void>;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
}

export class InputController {
  private deps: InputControllerDeps;
  private readonly approvalFlow: ApprovalFlowController;
  private readonly inputCommands: InputCommandController;
  private readonly queuedMessages: QueuedMessageController;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  // While a steer splice is swapping the render target (finalizing the old
  // bubble is async), the send loop buffers successor chunks instead of
  // rendering them into the old bubble; the splice replays them into the
  // fresh bubble afterwards. Without this, the steered reply's opening
  // tokens land in the interrupted bubble and look lost/misplaced.
  private steerSpliceActive = false;
  private steerSpliceBuffer: StreamChunk[] = [];
  // Contract: `user_message_start` / `assistant_message_start` boundary
  // chunks currently have no producer in the runtime — they are a reserved
  // mechanism, so the handlers below are dormant. Steering relies on
  // immediate UI-side splicing (spliceRuntimeUserMessage) and does NOT echo
  // through this path. If a producer is ever wired up, queued-message
  // steering must first register its expected echo here, otherwise the echo
  // would splice a second, duplicate bubble for the same message.
  private pendingRuntimeUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }> = [];
  private sawInitialRuntimeUserMessage = false;
  private awaitingRuntimeAssistantStart = false;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
    this.approvalFlow = new ApprovalFlowController({
      state: deps.state,
      renderer: deps.renderer,
      streamController: deps.streamController,
      getInputContainerEl: deps.getInputContainerEl,
    });
    this.inputCommands = new InputCommandController({
      plugin: deps.plugin,
      state: deps.state,
      conversationController: deps.conversationController,
      getExternalContextSelector: deps.getExternalContextSelector,
      getInputContainerEl: deps.getInputContainerEl,
      getInputEl: deps.getInputEl,
      openConversation: deps.openConversation,
      onForkAll: deps.onForkAll,
    });
    this.queuedMessages = new QueuedMessageController({
      state: deps.state,
      getInputEl: deps.getInputEl,
      getImageContextManager: deps.getImageContextManager,
      resetInputHeight: deps.resetInputHeight,
      canSteerQueuedTurn: () => this.canSteerQueuedTurn(),
      steerQueuedTurn: message => this.steerQueuedTurn(message),
      sendQueuedTurn: message => {
        void this.sendMessage({
          content: message.displayContent,
          images: message.request.images,
          turnRequestOverride: message.request,
        });
      },
    });
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  private syncInstructionRefineModelOverride(
    instructionRefineService: InstructionRefineService,
  ): void {
    instructionRefineService.setModelOverride?.(this.getAuxiliaryModel() ?? undefined);
  }

  private isResumeSessionAtStillNeeded(resumeUuid: string, previousMessages: ChatMessage[]): boolean {
    for (let i = previousMessages.length - 1; i >= 0; i--) {
      if (previousMessages[i].role === 'assistant' && previousMessages[i].assistantMessageId === resumeUuid) {
        // Still needed only if no messages follow the resume point
        return i === previousMessages.length - 1;
      }
    }
    return false;
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    const {
      plugin,
      state,
      renderer,
      streamController,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
      conversationController
    } = this.deps;

    // During conversation creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingConversation || state.isSwitchingConversation) return;

    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const content = (contentOverride ?? inputEl.value).trim();
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages) return;

    // Check for built-in commands first (e.g., /clear, /new, /add-dir)
    const builtInCmd = detectBuiltInCommand(content);
    if (builtInCmd) {
      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      await this.inputCommands.execute(builtInCmd.command, builtInCmd.args);
      return;
    }

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      const images = hasImages
        ? [...(imageOverride ?? imageContextManager?.getAttachedImages() ?? [])]
        : undefined;
      const editorContext = selectionController.getContext();
      const browserContext = browserSelectionController?.getContext() ?? null;
      const canvasContext = canvasSelectionController.getContext();
      const { displayContent, turnRequest } = await this.buildTurnSubmission({
        content,
        images,
        editorContextOverride: editorContext,
        browserContextOverride: browserContext,
        canvasContextOverride: canvasContext,
      });
      this.queuedMessages.enqueue(displayContent, turnRequest);

      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      if (shouldUseInput) {
        imageContextManager?.clearImages();
      }
      return;
    }

    if (shouldUseInput) {
      inputEl.value = '';
      this.deps.resetInputHeight();
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false; // Allow usage updates for new query
    // Re-render the send queue so steer buttons reflect the now-active turn
    // (rows rendered during the brief idle gap after process() lost them).
    this.updateQueueIndicator();
    this.deps.getSubagentManager().resetSpawnedCount();
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true; // Reset auto-scroll based on setting
    const streamGeneration = state.bumpStreamGeneration();

    // Hide welcome message when sending first message
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.addClass('qoderian-hidden');
    }

    fileContextManager?.startSession();

    // Slash commands are passed directly to SDK for handling
    // SDK handles expansion, $ARGUMENTS, @file references, and frontmatter options
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(content);

    // Only clear images if we consumed user input (not for programmatic content override)
    if (shouldUseInput) {
      imageContextManager?.clearImages();
    }

    const turnSubmission = options?.turnRequestOverride
      ? {
        displayContent: content,
        turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
      }
      : await this.buildTurnSubmission({
        content,
        images: imagesForMessage,
        editorContextOverride: options?.editorContextOverride,
        browserContextOverride: options?.browserContextOverride,
        canvasContextOverride: options?.canvasContextOverride,
      });
    const { displayContent, turnRequest } = turnSubmission;

    fileContextManager?.markCurrentNoteSent();

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: displayContent,
      displayContent,                // Original user input (for UI display)
      timestamp: Date.now(),
      images: imagesForMessage,
    };
    state.addMessage(userMsg);
    state.hasPendingConversationSave = true;
    renderer.addMessage(userMsg);

    await this.triggerTitleGeneration();

    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);
    this.pendingRuntimeUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialRuntimeUserMessage = false;
    this.awaitingRuntimeAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'qoderian-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    let wasInterrupted = false;
    let wasInvalidated = false;
    let didEnqueueToSdk = false;
    let planCompleted = false;

    // Lazy initialization: ensure service is ready before first query
    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice('Failed to initialize agent service. Please try again.');
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        // Re-render the send queue so steer buttons drop now that the turn
        // ended before it started (same contract as the normal exit path).
        this.updateQueueIndicator();
        this.activeStreamingAssistantMessage = null;
        this.resetRuntimeMessageBoundaryState();
        return;
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice('Agent service not available. Please reload the plugin.');
      streamController.hideThinkingIndicator();
      state.isStreaming = false;
      this.updateQueueIndicator();
      this.activeStreamingAssistantMessage = null;
      this.resetRuntimeMessageBoundaryState();
      return;
    }

    // Restore pendingResumeAt from persisted conversation state (survives plugin reload)
    const conversationIdForSend = state.currentConversationId;
    if (conversationIdForSend) {
      const conv = plugin.getConversationSync(conversationIdForSend);
      if (conv?.resumeAtMessageId) {
        if (this.isResumeSessionAtStillNeeded(conv.resumeAtMessageId, state.messages.slice(0, -2))) {
          agentService.setResumeCheckpoint(conv.resumeAtMessageId);
        } else {
          try {
            await plugin.updateConversation(conversationIdForSend, { resumeAtMessageId: undefined });
          } catch {
            // Best-effort — don't block send
          }
        }
      }
    }

    try {
      const preparedTurn = agentService.prepareTurn(turnRequest);
      userMsg.content = preparedTurn.persistedContent;
      userMsg.currentNote = preparedTurn.isCompact
        ? undefined
        : preparedTurn.request.currentNotePath;

      // Pass history WITHOUT current turn (userMsg + assistantMsg we just added)
      // This prevents duplication when rebuilding context for new sessions
      const previousMessages = state.messages.slice(0, -2);
      for await (const chunk of agentService.query(preparedTurn, previousMessages)) {
        if (state.streamGeneration !== streamGeneration) {
          wasInvalidated = true;
          break;
        }
        if (state.cancelRequested) {
          wasInterrupted = true;
          break;
        }

        if (await this.handleRuntimeMessageBoundaryChunk(chunk)) {
          continue;
        }

        if (this.steerSpliceActive) {
          this.steerSpliceBuffer.push(chunk);
          continue;
        }

        await streamController.handleStreamChunk(
          chunk,
          this.activeStreamingAssistantMessage ?? assistantMsg,
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await streamController.handleStreamChunk(
        { type: 'error', content: errorMsg },
        this.activeStreamingAssistantMessage ?? assistantMsg,
      );
    } finally {
      const finalAssistantMsg = this.activeStreamingAssistantMessage ?? assistantMsg;
      const turnMetadata = agentService.consumeTurnMetadata();
      userMsg.userMessageId = turnMetadata.userMessageId ?? userMsg.userMessageId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      didEnqueueToSdk = didEnqueueToSdk || turnMetadata.wasSent === true;
      planCompleted = planCompleted || turnMetadata.planCompleted === true;

      // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
      state.clearFlavorTimerInterval();

      // Skip remaining cleanup if stream was invalidated (tab closed or conversation switched)
      if (!wasInvalidated && state.streamGeneration === streamGeneration) {
        const didCancelThisTurn = wasInterrupted || state.cancelRequested;
        if (didCancelThisTurn && !state.pendingNewSessionPlan) {
          await streamController.appendText('\n\n<span class="qoderian-interrupted">Interrupted</span> <span class="qoderian-interrupted-hint">· What should Qoderian do instead?</span>');
        }
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        state.cancelRequested = false;
        // Re-render the send queue so steer buttons drop now that the turn
        // ended (guards the paused/revised paths that skip process()).
        this.updateQueueIndicator();
        // Capture response duration before resetting state (skip for interrupted responses and compaction)
        const hasCompactBoundary = finalAssistantMsg.contentBlocks?.some(b => b.type === 'context_compacted');
        const hasError = hasErrorContentBlock(finalAssistantMsg);
        if (!didCancelThisTurn && !hasCompactBoundary && !hasError) {
          const durationSeconds = state.responseStartTime
            ? Math.floor((performance.now() - state.responseStartTime) / 1000)
            : 0;
          if (durationSeconds > 0) {
            finalAssistantMsg.durationSeconds = durationSeconds;
            finalAssistantMsg.durationFlavorWord =
              COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
          }
        } else if (hasError) {
          finalAssistantMsg.durationSeconds = undefined;
          finalAssistantMsg.durationFlavorWord = undefined;
        }

        // Shared with the stored-message path so live and reloaded turns match.
        const completedContentEl = state.currentContentEl;
        if (completedContentEl) {
          renderer.appendResponseFooter(completedContentEl, finalAssistantMsg);
          renderer.updateTurnChangesButton(finalAssistantMsg, completedContentEl);
        }

        await streamController.finalizeCurrentThinkingBlock(finalAssistantMsg);
        await streamController.finalizeCurrentTextBlock(finalAssistantMsg);
        this.deps.getSubagentManager().resetStreamingState();

        // approve-new-session: the tool_result chunk is dropped because cancelRequested
        // was set before the stream loop could process it — manually set the result so
        // the saved conversation renders correctly when revisited
        if (state.pendingNewSessionPlan && finalAssistantMsg.toolCalls) {
          for (const tc of finalAssistantMsg.toolCalls) {
            if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
              tc.status = 'completed';
              tc.result = 'User approved the plan and started a new session.';
              updateToolCallResult(tc.id, tc, state.toolCallElements);
            }
          }
        }

        if (completedContentEl) {
          renderer.collapseCompletedTurn(finalAssistantMsg, completedContentEl);
        }
        state.currentContentEl = null;

        this.syncScrollToBottomAfterRenderUpdates();

        // Show plan approval and await a decision before save/auto-send.
        let planAutoSendContent: string | null = null;
        let planApprovalInvalidated = false;
        let shouldProcessQueuedMessage = true;
        if (planCompleted && !didCancelThisTurn) {
          const { decision, invalidated } = await this.approvalFlow.showPlanApproval();

          // Re-check invalidation after async approval prompt
          if (state.streamGeneration !== streamGeneration || invalidated) {
            planApprovalInvalidated = true;
          } else if (decision?.type === 'implement') {
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
            planAutoSendContent = 'Implement the plan.';
          } else if (decision?.type === 'revise') {
            // Keep plan mode active, populate input with feedback text
            this.deps.getInputEl().value = decision.text;
            shouldProcessQueuedMessage = false;
          } else {
            // cancel or null (dismissed)
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
          }
        }

        if (!planApprovalInvalidated) {
          // Only clear resumeAtMessageId if enqueue succeeded; preserve checkpoint on failure for retry
          const saveExtras = didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
          await conversationController.save(true, saveExtras);

          const userMsgIndex = state.messages.indexOf(userMsg);
          renderer.refreshActionButtons(userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);

          // Auto-implement takes precedence over both approve-new-session and queued input
          if (planAutoSendContent) {
            this.deps.getInputEl().value = planAutoSendContent;
            this.sendMessage().catch(() => {});
          } else {
            // approve-new-session: create fresh conversation and send plan content
            // Must be inside the invalidation guard — if the tab was closed or
            // conversation switched, we must not create a new session on stale state.
            const planContent = state.pendingNewSessionPlan;
            if (planContent) {
              state.pendingNewSessionPlan = null;
              await conversationController.createNew();
              this.deps.getInputEl().value = planContent;
              this.sendMessage().catch(() => {
                // sendMessage() handles its own errors internally; this prevents
                // unhandled rejection if an unexpected error slips through.
              });
            } else if (shouldProcessQueuedMessage) {
              this.queuedMessages.process();
            }
          }
        }
      }

      if (wasInvalidated) {
        this.queuedMessages.updateIndicator();
      }

      this.activeStreamingAssistantMessage = null;
      this.resetRuntimeMessageBoundaryState();
    }
  }
  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    this.queuedMessages.updateIndicator();
  }

  clearQueuedMessage(): void {
    this.queuedMessages.clear();
  }

  /** Steering is only possible while a turn is streaming mid-flight. */
  private canSteerQueuedTurn(): boolean {
    const { state } = this.deps;
    return state.isStreaming
      && !state.cancelRequested
      && !!this.getAgentService()?.steerTurn;
  }

  /**
   * Codex-style steering: inject a queued turn into the in-flight turn. The
   * CLI interrupts the active turn and handles the text immediately
   * (`priority: 'now'`). Returns false when steering is not possible right
   * now; the message should stay queued then.
   */
  steerQueuedTurn(turn: QueuedChatTurn): boolean {
    if (!this.canSteerQueuedTurn()) return false;
    const text = turn.request.text.trim();
    if (!text) return false;
    const accepted = this.getAgentService()?.steerTurn?.(text) ?? false;
    if (!accepted) return false;
    this.beginSteerSplice({
      displayContent: turn.displayContent,
      persistedContent: text,
    });
    return true;
  }

  /**
   * Runs the steer splice with chunk buffering active: successor chunks that
   * arrive while the splice awaits the old bubble's finalization are held
   * back and replayed into the fresh bubble once the splice completes.
   */
  private beginSteerSplice(details: { displayContent: string; persistedContent?: string }): void {
    if (!this.steerSpliceActive) {
      this.steerSpliceActive = true;
      this.steerSpliceBuffer = [];
    }
    void this.spliceRuntimeUserMessage(details)
      .catch(() => undefined)
      .then(() => this.drainSteerSpliceBuffer())
      .catch(() => {
        this.steerSpliceActive = false;
        this.steerSpliceBuffer = [];
      });
  }

  /** Replays chunks buffered during the splice, then reopens direct rendering. */
  private async drainSteerSpliceBuffer(): Promise<void> {
    try {
      while (this.steerSpliceBuffer.length > 0) {
        const chunk = this.steerSpliceBuffer.shift()!;
        const target = this.activeStreamingAssistantMessage;
        if (target) await this.deps.streamController.handleStreamChunk(chunk, target);
      }
    } catch (error) {
      const target = this.activeStreamingAssistantMessage;
      if (target) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await this.deps.streamController
          .handleStreamChunk({ type: 'error', content: message }, target)
          .catch(() => undefined);
      }
    } finally {
      this.steerSpliceActive = false;
    }
  }

  private async buildTurnSubmission(options: {
    content: string;
    images?: ChatMessage['images'];
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
  }): Promise<{
    displayContent: string;
    turnRequest: ChatTurnRequest;
  }> {
    const {
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const fileContextManager = this.deps.getFileContextManager();
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const externalContextSelector = this.deps.getExternalContextSelector();

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

    const editorContext = options.editorContextOverride !== undefined
      ? options.editorContextOverride
      : selectionController.getContext();
    const browserContext = options.browserContextOverride !== undefined
      ? options.browserContextOverride
      : (browserSelectionController?.getContext() ?? null);
    const canvasContext = options.canvasContextOverride !== undefined
      ? options.canvasContextOverride
      : canvasSelectionController.getContext();

    const externalContextPaths = externalContextSelector?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    const transformedText = !isCompact && fileContextManager
      ? await fileContextManager.transformContextMentions(options.content)
      : options.content;
    const enabledMcpServers = mcpServerSelector?.getEnabledServers();

    return {
      displayContent: options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
        editorSelection: editorContext,
        browserSelection: browserContext,
        canvasSelection: canvasContext,
        externalContextPaths: externalContextPaths && externalContextPaths.length > 0
          ? externalContextPaths
          : undefined,
        enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
          ? enabledMcpServers
          : undefined,
      },
    };
  }


  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.qoderian-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private resetRuntimeMessageBoundaryState(): void {
    this.pendingRuntimeUserMessages = [];
    this.sawInitialRuntimeUserMessage = false;
    this.awaitingRuntimeAssistantStart = false;
  }

  private async handleRuntimeMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleRuntimeUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleRuntimeAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleRuntimeUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingRuntimeUserMessages.shift();
    if (!this.sawInitialRuntimeUserMessage) {
      this.sawInitialRuntimeUserMessage = true;
      return;
    }

    this.updateQueueIndicator();
    await this.spliceRuntimeUserMessage({
      displayContent: expected?.displayContent ?? chunk.content,
      persistedContent: expected?.persistedContent,
      images: expected?.images,
      currentNote: expected?.currentNote,
    });
  }

  /**
   * Finalize the streaming assistant bubble, render a user bubble, and open a
   * fresh assistant bubble below it. Shared by runtime user-message echoes
   * and queued-message steering.
   */
  private async spliceRuntimeUserMessage(details: {
    displayContent: string;
    persistedContent?: string;
    images?: ChatMessage['images'];
    currentNote?: string;
  }): Promise<void> {
    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
        if (this.deps.state.currentContentEl) {
          this.deps.renderer.collapseCompletedTurn(
            previousAssistant,
            this.deps.state.currentContentEl,
          );
        }
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const { displayContent, images } = details;
    const persistedContent = details.persistedContent ?? displayContent;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: details.currentNote,
        images,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingRuntimeAssistantStart = true;
  }

  private async handleRuntimeAssistantMessageStart(): Promise<void> {
    if (this.awaitingRuntimeAssistantStart) {
      this.awaitingRuntimeAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      if (this.deps.state.currentContentEl) {
        this.deps.renderer.collapseCompletedTurn(
          previousAssistant,
          this.deps.state.currentContentEl,
        );
      }
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingRuntimeAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentConversationId) {
      const sessionId = this.getAgentService()?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        sessionId,
      });
      state.currentConversationId = conversation.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      async (conversationId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(conversationId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    // Codex-style: interrupting a turn pauses the queue instead of draining it.
    this.queuedMessages.pause();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    window.requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ============================================
  // Instruction Mode
  // ============================================

  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;

    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();

    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;

    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: (finalInstruction) => {
            void (async (): Promise<void> => {
              const currentPrompt = plugin.settings.systemPrompt;
              plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
              await plugin.saveSettings();

              new Notice('Instruction added to custom system prompt');
              instructionModeManager?.clear();
            })();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager?.clear();
          },
          onClarificationSubmit: async (response) => {
            this.syncInstructionRefineModelOverride(instructionRefineService);
            const result = await instructionRefineService.continueConversation(response);

            if (wasCancelled) {
              return;
            }

            if (!result.success) {
              if (result.error === 'Cancelled') {
                return;
              }
              new Notice(result.error || 'Failed to process response');
              modal?.showError(result.error || 'Failed to process response');
              return;
            }

            if (result.clarification) {
              modal?.showClarification(result.clarification);
            } else if (result.refinedInstruction) {
              modal?.showConfirmation(result.refinedInstruction);
            }
          }
        }
      );
      modal.open();

      this.syncInstructionRefineModelOverride(instructionRefineService);
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );

      if (wasCancelled) {
        return;
      }

      if (!result.success) {
        if (result.error === 'Cancelled') {
          instructionModeManager?.clear();
          return;
        }
        new Notice(result.error || 'Failed to refine instruction');
        modal.showError(result.error || 'Failed to refine instruction');
        instructionModeManager?.clear();
        return;
      }

      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new Notice('No instruction received');
        modal.showError('No instruction received');
        instructionModeManager?.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Error: ${errorMsg}`);
      modal?.showError(errorMsg);
      instructionModeManager?.clear();
    }
  }
  // ============================================
  // Approval and question flows
  // ============================================

  handleApprovalRequest(
    toolName: string,
    _input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    return this.approvalFlow.requestToolApproval(toolName, description, approvalOptions);
  }

  handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    return this.approvalFlow.askUser(input, signal);
  }

  handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    return this.approvalFlow.exitPlanMode(input, signal);
  }

  dismissPendingApprovalPrompt(): void {
    this.approvalFlow.dismissApprovalPrompt();
  }

  dismissPendingApproval(): void {
    this.approvalFlow.dismissAll();
  }
  handleResumeKeydown(e: KeyboardEvent): boolean {
    return this.inputCommands.handleResumeKeydown(e);
  }

  isResumeDropdownVisible(): boolean {
    return this.inputCommands.isResumeDropdownVisible();
  }

  destroyResumeDropdown(): void {
    this.inputCommands.destroyResumeDropdown();
  }
}
