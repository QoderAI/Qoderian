/**
 * @jest-environment jsdom
 */
import { QueuedMessageController } from '@/features/chat/controllers/queued-message-controller';
import type { QueuedChatTurn } from '@/features/chat/controllers/queued-turn';
import { ChatState } from '@/features/chat/state/chat-state';

// setup-window polyfills createEl/createDiv/createSpan as globals but the
// controller calls them as element methods; port the missing pieces here.
const proto = HTMLElement.prototype as unknown as {
  empty?: () => void;
  addClass?: (cls: string) => void;
  removeClass?: (cls: string) => void;
  createEl?: (tag: string, info?: DomInfo | string) => HTMLElement;
  createDiv?: (info?: DomInfo | string) => HTMLElement;
  createSpan?: (info?: DomInfo | string) => HTMLElement;
};

interface DomInfo {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
  title?: string;
}

function applyInfo(el: HTMLElement, info: DomInfo | string | undefined): void {
  const normalized = typeof info === 'string' ? { cls: info } : info ?? {};
  if (normalized.cls) el.classList.add(...normalized.cls.split(/\s+/).filter(Boolean));
  if (normalized.text) el.textContent = normalized.text;
  if (normalized.attr) {
    for (const [name, value] of Object.entries(normalized.attr)) el.setAttribute(name, String(value));
  }
  if (normalized.title !== undefined) el.title = normalized.title;
}

if (!proto.empty) {
  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}
if (!proto.addClass) {
  proto.addClass = function (this: HTMLElement, cls: string) {
    this.classList.add(cls);
  };
}
if (!proto.removeClass) {
  proto.removeClass = function (this: HTMLElement, cls: string) {
    this.classList.remove(cls);
  };
}
if (!proto.createEl) {
  proto.createEl = function (this: HTMLElement, tag: string, info?: DomInfo | string) {
    const el = this.ownerDocument.createElement(tag);
    applyInfo(el, info);
    this.appendChild(el);
    return el;
  };
}
if (!proto.createDiv) {
  proto.createDiv = function (this: HTMLElement, info?: DomInfo | string) {
    return proto.createEl!.call(this, 'div', info);
  };
}
if (!proto.createSpan) {
  proto.createSpan = function (this: HTMLElement, info?: DomInfo | string) {
    return proto.createEl!.call(this, 'span', info);
  };
}

function createController(overrides?: Partial<{
  sendQueuedTurn: (turn: QueuedChatTurn) => void;
}>) {
  const state = new ChatState();
  state.queueIndicatorEl = document.createElement('div');
  const inputEl = document.createElement('textarea');
  const sendQueuedTurn = overrides?.sendQueuedTurn ?? jest.fn();
  const controller = new QueuedMessageController({
    state,
    getInputEl: () => inputEl,
    getImageContextManager: () => null,
    resetInputHeight: jest.fn(),
    sendQueuedTurn,
  });
  return { controller, state, inputEl, sendQueuedTurn };
}

function turnRequest(text: string) {
  return { text };
}

describe('QueuedMessageController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues multiple messages in FIFO order and renders the count', () => {
    const { controller, state } = createController();

    controller.enqueue('first', turnRequest('first'));
    controller.enqueue('second', turnRequest('second'));

    expect(state.queuedMessages).toHaveLength(2);
    expect(state.queuedMessages.map(message => message.content)).toEqual(['first', 'second']);

    const header = state.queueIndicatorEl!.querySelector('.qoderian-queue-header-title');
    expect(header?.textContent).toContain('2');
    const rows = state.queueIndicatorEl!.querySelectorAll('.qoderian-queue-row');
    expect(rows).toHaveLength(2);
  });

  it('process drains the head item as a turn', () => {
    const { controller, state, sendQueuedTurn } = createController();
    controller.enqueue('first', turnRequest('first'));
    controller.enqueue('second', turnRequest('second'));

    controller.process();
    jest.runAllTimers();

    expect(sendQueuedTurn).toHaveBeenCalledTimes(1);
    expect(sendQueuedTurn).toHaveBeenCalledWith(expect.objectContaining({ displayContent: 'first' }));
    expect(state.queuedMessages.map(message => message.content)).toEqual(['second']);
  });

  it('discard removes one item by id', () => {
    const { controller, state } = createController();
    controller.enqueue('first', turnRequest('first'));
    controller.enqueue('second', turnRequest('second'));

    controller.discard(state.queuedMessages[0].id);

    expect(state.queuedMessages.map(message => message.content)).toEqual(['second']);
  });

  it('withdrawToComposer moves one item back into the input', () => {
    const { controller, state, inputEl } = createController();
    controller.enqueue('first', turnRequest('first'));
    controller.enqueue('second', turnRequest('second'));

    controller.withdrawToComposer(state.queuedMessages[1].id);

    expect(inputEl.value).toBe('second');
    expect(state.queuedMessages.map(message => message.content)).toEqual(['first']);
  });

  it('clear empties the queue and hides the panel', () => {
    const { controller, state } = createController();
    controller.enqueue('first', turnRequest('first'));
    controller.clear();

    expect(state.queuedMessages).toHaveLength(0);
    expect(state.queueIndicatorEl!.classList.contains('qoderian-hidden')).toBe(true);
  });

  it('drag reorders the queue on dragend', () => {
    const { controller, state } = createController();
    controller.enqueue('first', turnRequest('first'));
    controller.enqueue('second', turnRequest('second'));

    const rows = () => [...state.queueIndicatorEl!.querySelectorAll('.qoderian-queue-row')] as HTMLElement[];
    const [row1, row2] = rows();
    const handle1 = row1.querySelector('.qoderian-queue-row-handle') as HTMLElement;

    handle1.dispatchEvent(new Event('dragstart'));
    // jsdom rects are zero; clientY 1 lands below the midpoint -> insert after row2
    row2.dispatchEvent(new MouseEvent('dragover', { clientY: 1 }));
    handle1.dispatchEvent(new Event('dragend'));

    expect(state.queuedMessages.map(message => message.content)).toEqual(['second', 'first']);
  });

  it('collapses and expands the list from the header toggle', () => {
    const { controller, state } = createController();
    controller.enqueue('first', turnRequest('first'));

    const toggle = state.queueIndicatorEl!.querySelector('.qoderian-queue-header-toggle') as HTMLElement;
    toggle.dispatchEvent(new Event('click'));
    expect(state.queueIndicatorEl!.querySelectorAll('.qoderian-queue-row')).toHaveLength(0);

    const toggleAgain = state.queueIndicatorEl!.querySelector('.qoderian-queue-header-toggle') as HTMLElement;
    toggleAgain.dispatchEvent(new Event('click'));
    expect(state.queueIndicatorEl!.querySelectorAll('.qoderian-queue-row')).toHaveLength(1);
  });
});
