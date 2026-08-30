import { createMockEl } from '@test/helpers/mock-element';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/message-renderer';

function createRenderer() {
  const messagesEl = createMockEl();
  const component = { registerDomEvent: jest.fn() };
  const plugin = {
    app: {},
    settings: { expandFileEditsByDefault: false, mediaFolder: '' },
  };
  return {
    messagesEl,
    renderer: new MessageRenderer(plugin as any, component as any, messagesEl),
  };
}

const SENT_AT = new Date(2026, 7, 29, 17, 50).getTime();

function userMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    role: 'user',
    content: 'hello',
    timestamp: SENT_AT,
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: SENT_AT,
    contentBlocks: [{ type: 'text', content: 'sure' }],
    ...overrides,
  };
}

describe('MessageRenderer timestamps', () => {
  it('shows the send time in the user action toolbar', () => {
    const { messagesEl, renderer } = createRenderer();

    renderer.renderStoredMessage(userMessage());

    const toolbar = messagesEl.querySelector('.qoderian-user-msg-actions');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector('.qoderian-message-time')?.textContent)
      .toBe('2026-08-29 17:50');
  });

  it('shows the send time on live user messages too', () => {
    const { messagesEl, renderer } = createRenderer();

    renderer.addMessage(userMessage({ id: 'user-live' }));

    expect(messagesEl.querySelector('.qoderian-message-time')?.textContent)
      .toBe('2026-08-29 17:50');
  });

  it('shows one reply time under the whole assistant message, beside the duration', () => {
    const { messagesEl, renderer } = createRenderer();

    renderer.renderStoredMessage(assistantMessage({
      durationSeconds: 16,
      durationFlavorWord: 'Conjured',
    }));

    const footer = messagesEl.querySelector('.qoderian-response-footer');
    expect(footer).not.toBeNull();
    expect(messagesEl.querySelectorAll('.qoderian-message-time').length).toBe(1);
    expect(messagesEl.querySelector('.qoderian-baked-duration')?.textContent)
      .toBe('* Conjured for 16s');
    expect(messagesEl.querySelector('.qoderian-message-time')?.textContent)
      .toBe('2026-08-29 17:50');
  });

  it('still times an interrupted reply that has no duration line', () => {
    const { messagesEl, renderer } = createRenderer();

    renderer.renderStoredMessage(assistantMessage({ isInterrupt: true }));

    expect(messagesEl.querySelector('.qoderian-baked-duration')).toBeNull();
    expect(messagesEl.querySelector('.qoderian-message-time')?.textContent)
      .toBe('2026-08-29 17:50');
  });

  it('omits the footer entirely when the timestamp is unusable', () => {
    const { messagesEl, renderer } = createRenderer();

    renderer.renderStoredMessage(assistantMessage({ timestamp: 0 }));

    expect(messagesEl.querySelector('.qoderian-response-footer')).toBeNull();
  });

  it('keeps the footer off the active reply while it is still streaming', () => {
    const { renderer } = createRenderer();
    const contentEl = createMockEl();

    renderer.rerenderAssistantContent(assistantMessage(), contentEl);

    expect(contentEl.querySelector('.qoderian-response-footer')).toBeNull();
  });
});
