import { createMockEl } from '@test/helpers/mock-element';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/message-renderer';

describe('MessageRenderer error blocks', () => {
  it('renders a formal error block without a normal-completion duration footer', () => {
    const messagesEl = createMockEl();
    const plugin = {
      app: {},
      settings: { expandFileEditsByDefault: false, mediaFolder: '' },
    };
    const component = { registerDomEvent: jest.fn() };
    const renderer = new MessageRenderer(
      plugin as any,
      component as any,
      messagesEl,
    );
    const message: ChatMessage = {
      id: 'assistant-error',
      role: 'assistant',
      content: '',
      timestamp: 1,
      durationSeconds: 4,
      durationFlavorWord: 'Distilled',
      contentBlocks: [{ type: 'error', content: 'Credit limit reached.' }],
    };

    renderer.renderStoredMessage(message);

    expect(messagesEl.querySelector('.qoderian-error-block')).not.toBeNull();
    expect(messagesEl.querySelector('.qoderian-response-footer')).toBeNull();
  });
});
