import { createMockEl } from '@test/helpers/mock-element';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/message-renderer';

function createRenderer(messagesEl: ReturnType<typeof createMockEl>): MessageRenderer {
  const plugin = {
    app: {},
    settings: { expandFileEditsByDefault: false, mediaFolder: '' },
  };
  const component = { registerDomEvent: jest.fn() };
  return new MessageRenderer(plugin as any, component as any, messagesEl);
}

describe('MessageRenderer error blocks', () => {
  it('renders a formal error block without a normal-completion duration line', () => {
    const messagesEl = createMockEl();
    const renderer = createRenderer(messagesEl);
    const message: ChatMessage = {
      id: 'assistant-error',
      role: 'assistant',
      content: '',
      timestamp: new Date('2026-08-29T17:50:00').getTime(),
      durationSeconds: 4,
      durationFlavorWord: 'Distilled',
      contentBlocks: [{ type: 'error', content: 'Credit limit reached.' }],
    };

    renderer.renderStoredMessage(message);

    expect(messagesEl.querySelector('.qoderian-error-block')).not.toBeNull();
    expect(messagesEl.querySelector('.qoderian-baked-duration')).toBeNull();
    // The footer survives so a failed turn still reports when it happened.
    expect(messagesEl.querySelector('.qoderian-message-time')?.textContent)
      .toBe('2026-08-29 17:50');
  });
});
