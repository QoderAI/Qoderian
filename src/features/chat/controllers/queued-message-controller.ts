import { setIcon } from 'obsidian';

import type { ChatTurnRequest } from '../../../core/runtime/types';
import { appendMarkdownSnippet } from '../../../shared/markdown/markdown';
import type { ChatState } from '../state/chat-state';
import type { QueuedMessage } from '../state/types';
import type { ImageContextManager } from '../ui/image-context';
import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from './queued-turn';

export interface QueuedMessageControllerDeps {
  state: ChatState;
  getInputEl: () => HTMLTextAreaElement;
  getImageContextManager: () => ImageContextManager | null;
  resetInputHeight: () => void;
  sendQueuedTurn: (message: QueuedChatTurn) => void;
}

/** Owns the single queued turn, its composer projection, and indicator UI. */
export class QueuedMessageController {
  constructor(private readonly deps: QueuedMessageControllerDeps) {}

  enqueue(displayContent: string, turnRequest: ChatTurnRequest): void {
    const incoming = this.createQueuedMessage(displayContent, turnRequest);
    this.deps.state.queuedMessage = this.mergeQueuedMessages(
      this.deps.state.queuedMessage,
      incoming,
    );
    this.updateIndicator();
  }

  updateIndicator(): void {
    const { state } = this.deps;
    const indicatorEl = state.queueIndicatorEl;
    if (!indicatorEl) return;
    indicatorEl.empty();

    const message = state.queuedMessage;
    if (!message) {
      indicatorEl.removeClass('qoderian-visible-flex');
      indicatorEl.addClass('qoderian-hidden');
      return;
    }

    indicatorEl.createSpan({
      cls: 'qoderian-queue-indicator-text',
      text: `⌙ Queued: ${this.getQueuedMessageDisplay(message)}`,
    });
    const actionsEl = indicatorEl.createDiv({ cls: 'qoderian-queue-indicator-actions' });
    const editButton = this.createIconButton(actionsEl, 'pencil', 'Edit queued message');
    editButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.withdrawToComposer();
    });
    const discardButton = this.createIconButton(actionsEl, 'trash-2', 'Discard queued message');
    discardButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.clear();
    });
    indicatorEl.addClass('qoderian-visible-flex');
    indicatorEl.removeClass('qoderian-hidden');
  }

  clear(): void {
    this.deps.state.queuedMessage = null;
    this.updateIndicator();
  }

  withdrawToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;
    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, true);
    this.updateIndicator();
  }

  restorePendingToComposer(): void {
    const { state } = this.deps;
    this.restoreMessageToInput(state.queuedMessage, true);
    state.queuedMessage = null;
    this.updateIndicator();
  }

  process(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;
    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateIndicator();
    window.setTimeout(() => this.deps.sendQueuedTurn(this.toQueuedChatTurn(queuedMessage)), 0);
  }

  private restoreMessageToInput(message: QueuedMessage | null, mergeWithComposer: boolean): void {
    if (!message) return;
    const inputEl = this.deps.getInputEl();
    const currentContent = mergeWithComposer ? inputEl.value.trim() : '';
    inputEl.value = currentContent
      ? appendMarkdownSnippet(message.content, currentContent)
      : message.content;

    const imageContextManager = this.deps.getImageContextManager();
    const currentImages = mergeWithComposer
      ? (imageContextManager?.getAttachedImages() ?? [])
      : [];
    const restoredImages = [...(message.images ?? []), ...currentImages];
    if (restoredImages.length > 0) imageContextManager?.setImages(restoredImages);
    this.deps.resetInputHeight();
    inputEl.focus();
  }

  private getQueuedMessageDisplay(message: QueuedMessage): string {
    const rawContent = message.content.trim();
    const preview = rawContent.length > 40 ? `${rawContent.slice(0, 40)}...` : rawContent;
    if ((message.images?.length ?? 0) > 0) return preview ? `${preview} [images]` : '[images]';
    return preview;
  }

  private createIconButton(parentEl: HTMLElement, icon: string, label: string): HTMLElement {
    const button = parentEl.createEl('button', {
      cls: 'qoderian-queue-indicator-icon-action',
      attr: { 'aria-label': label, title: label, type: 'button' },
    });
    setIcon(button, icon);
    return button;
  }

  private cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
      ...message,
      images: message.images ? [...message.images] : undefined,
      turnRequest: message.turnRequest ? cloneChatTurnRequest(message.turnRequest) : undefined,
    };
  }

  private createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      content: displayContent,
      images: request.images,
      editorContext: request.editorSelection ?? null,
      browserContext: request.browserSelection ?? null,
      canvasContext: request.canvasSelection ?? null,
      turnRequest: request,
    };
  }

  private toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
    if (message.turnRequest) {
      return {
        displayContent: message.content,
        request: cloneChatTurnRequest(message.turnRequest),
      };
    }
    return {
      displayContent: message.content,
      request: {
        text: message.content,
        images: message.images ? [...message.images] : undefined,
        editorSelection: message.editorContext,
        browserSelection: message.browserContext ?? null,
        canvasSelection: message.canvasContext,
      },
    };
  }

  private mergeQueuedMessages(existing: QueuedMessage | null, incoming: QueuedMessage): QueuedMessage {
    if (!existing) return this.cloneQueuedMessage(incoming);
    const mergedTurn = mergeQueuedChatTurns(
      this.toQueuedChatTurn(existing),
      this.toQueuedChatTurn(incoming),
    );
    return this.createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
  }
}
