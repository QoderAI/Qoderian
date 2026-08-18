import { setIcon } from 'obsidian';

import type { ChatTurnRequest } from '../../../core/runtime/types';
import { t } from '../../../i18n/i18n';
import { appendMarkdownSnippet } from '../../../shared/markdown/markdown';
import type { ChatState } from '../state/chat-state';
import type { QueuedMessage } from '../state/types';
import type { ImageContextManager } from '../ui/image-context';
import {
  cloneChatTurnRequest,
  type QueuedChatTurn,
} from './queued-turn';

export interface QueuedMessageControllerDeps {
  state: ChatState;
  getInputEl: () => HTMLTextAreaElement;
  getImageContextManager: () => ImageContextManager | null;
  resetInputHeight: () => void;
  sendQueuedTurn: (message: QueuedChatTurn) => void;
}

let nextQueuedMessageId = 1;

/** Owns the FIFO queue of pending turns, its composer projection, and list UI. */
export class QueuedMessageController {
  private collapsed = false;
  private draggingId: string | null = null;

  constructor(private readonly deps: QueuedMessageControllerDeps) {}

  enqueue(displayContent: string, turnRequest: ChatTurnRequest): void {
    const incoming = this.createQueuedMessage(displayContent, turnRequest);
    this.deps.state.queuedMessages = [...this.deps.state.queuedMessages, incoming];
    this.updateIndicator();
  }

  updateIndicator(): void {
    const { state } = this.deps;
    const containerEl = state.queueIndicatorEl;
    if (!containerEl) return;
    containerEl.empty();

    const messages = state.queuedMessages;
    if (messages.length === 0) {
      state.queuePaused = false;
      containerEl.removeClass('qoderian-visible-flex');
      containerEl.addClass('qoderian-hidden');
      return;
    }

    if (state.queuePaused) {
      this.renderPausedHeader(containerEl);
    } else {
      this.renderCollapsibleHeader(containerEl, messages.length);
    }

    if (!this.collapsed || state.queuePaused) {
      const listEl = containerEl.createDiv({ cls: 'qoderian-queue-list' });
      for (const message of messages) {
        this.renderRow(listEl, message);
      }
    }

    containerEl.addClass('qoderian-visible-flex');
    containerEl.removeClass('qoderian-hidden');
  }

  clear(): void {
    this.deps.state.queuedMessages = [];
    this.updateIndicator();
  }

  /** Remove one item by id. */
  discard(id: string): void {
    const messages = this.deps.state.queuedMessages;
    if (!messages.some(message => message.id === id)) return;
    this.deps.state.queuedMessages = messages.filter(message => message.id !== id);
    this.updateIndicator();
  }

  /** Withdraw one item back into the composer. */
  withdrawToComposer(id: string): void {
    const { state } = this.deps;
    const target = state.queuedMessages.find(message => message.id === id);
    if (!target) return;
    state.queuedMessages = state.queuedMessages.filter(message => message.id !== id);
    this.restoreMessageToInput(target, true);
    this.updateIndicator();
  }

  /** Suspend auto-drain after the user interrupts a turn (Codex-style pause). */
  pause(): void {
    const { state } = this.deps;
    if (state.queuedMessages.length === 0) return;
    state.queuePaused = true;
    this.updateIndicator();
  }

  /** Resume auto-drain and immediately send the head entry. */
  resume(): void {
    const { state } = this.deps;
    state.queuePaused = false;
    this.updateIndicator();
    this.process();
  }

  /** Drain the head of the queue at turn end. */
  process(): void {
    const { state } = this.deps;
    if (state.queuePaused) return;
    const next = state.queuedMessages[0];
    if (!next) return;
    state.queuedMessages = state.queuedMessages.slice(1);
    this.updateIndicator();
    window.setTimeout(() => this.deps.sendQueuedTurn(this.toQueuedChatTurn(next)), 0);
  }

  private renderCollapsibleHeader(containerEl: HTMLElement, count: number): void {
    const headerEl = containerEl.createDiv({ cls: 'qoderian-queue-header' });
    const toggleEl = headerEl.createEl('button', {
      cls: 'qoderian-queue-header-toggle',
      attr: {
        'aria-label': this.collapsed ? t('chat.queue.expand') : t('chat.queue.collapse'),
        title: this.collapsed ? t('chat.queue.expand') : t('chat.queue.collapse'),
        type: 'button',
      },
    });
    setIcon(toggleEl, this.collapsed ? 'chevron-right' : 'chevron-down');
    toggleEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.collapsed = !this.collapsed;
      this.updateIndicator();
    });
    headerEl.createSpan({
      cls: 'qoderian-queue-header-title',
      text: t('chat.queue.title', { count }),
    });
  }

  private renderPausedHeader(containerEl: HTMLElement): void {
    const headerEl = containerEl.createDiv({ cls: 'qoderian-queue-header qoderian-queue-header-paused' });
    const pauseIconEl = headerEl.createSpan({ cls: 'qoderian-queue-paused-icon' });
    setIcon(pauseIconEl, 'pause');
    headerEl.createSpan({
      cls: 'qoderian-queue-header-title',
      text: t('chat.queue.paused'),
    });
    const resumeEl = headerEl.createEl('button', {
      cls: 'qoderian-queue-resume',
      attr: { 'aria-label': t('chat.queue.resume'), title: t('chat.queue.resume'), type: 'button' },
    });
    setIcon(resumeEl, 'play');
    resumeEl.createSpan({ cls: 'qoderian-queue-resume-label', text: t('chat.queue.resume') });
    resumeEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.resume();
    });
  }

  private renderRow(listEl: HTMLElement, message: QueuedMessage): void {
    const rowEl = listEl.createDiv({ cls: 'qoderian-queue-row' });
    rowEl.dataset.queueId = message.id;

    const handleEl = rowEl.createSpan({
      cls: 'qoderian-queue-row-handle',
      attr: {
        'aria-label': t('chat.queue.drag'),
        title: t('chat.queue.dragTooltip'),
        draggable: 'true',
      },
    });
    setIcon(handleEl, 'grip-vertical');
    this.attachDragHandlers(handleEl, rowEl);

    rowEl.createSpan({
      cls: 'qoderian-queue-row-text',
      text: this.getQueuedMessageDisplay(message),
      attr: { title: message.content.trim() },
    });

    const actionsEl = rowEl.createDiv({ cls: 'qoderian-queue-row-actions' });
    const editEl = this.createIconButton(actionsEl, 'pencil', t('chat.queue.edit'));
    editEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.withdrawToComposer(message.id);
    });

    const deleteEl = this.createIconButton(actionsEl, 'trash-2', t('chat.queue.delete'));
    deleteEl.addEventListener('click', (event) => {
      event.stopPropagation();
      this.discard(message.id);
    });
  }

  private restoreMessageToInput(message: QueuedMessage, mergeWithComposer: boolean): void {
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

  private attachDragHandlers(handleEl: HTMLElement, rowEl: HTMLElement): void {
    handleEl.addEventListener('dragstart', (event) => {
      this.draggingId = rowEl.dataset.queueId ?? null;
      rowEl.addClass('qoderian-queue-row-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', this.draggingId ?? '');
      }
    });
    handleEl.addEventListener('dragend', () => {
      rowEl.removeClass('qoderian-queue-row-dragging');
      this.draggingId = null;
      this.commitDomOrder();
    });
    rowEl.addEventListener('dragover', (event) => {
      if (!this.draggingId || rowEl.dataset.queueId === this.draggingId) return;
      event.preventDefault();
      const listEl = rowEl.parentElement;
      const draggingEl = listEl?.querySelector(`[data-queue-id="${this.draggingId}"]`);
      if (!listEl || !draggingEl) return;
      const rect = rowEl.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      listEl.insertBefore(draggingEl, before ? rowEl : rowEl.nextSibling);
    });
  }

  /** Persist the DOM order after a drag ends. */
  private commitDomOrder(): void {
    const { state } = this.deps;
    const containerEl = state.queueIndicatorEl;
    if (!containerEl) return;
    const ids = [...containerEl.querySelectorAll<HTMLElement>('[data-queue-id]')]
      .map(el => el.dataset.queueId ?? '');
    const byId = new Map(state.queuedMessages.map(message => [message.id, message]));
    const reordered = ids
      .map(id => byId.get(id))
      .filter((message): message is QueuedMessage => Boolean(message));
    for (const message of state.queuedMessages) {
      if (!ids.includes(message.id)) reordered.push(message);
    }
    state.queuedMessages = reordered;
  }

  private createIconButton(parentEl: HTMLElement, icon: string, label: string): HTMLElement {
    const button = parentEl.createEl('button', {
      cls: 'qoderian-queue-indicator-icon-action',
      attr: { 'aria-label': label, title: label, type: 'button' },
    });
    setIcon(button, icon);
    return button;
  }

  private createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      id: `queued-${nextQueuedMessageId++}`,
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
}
