import { createMockEl } from '@test/helpers/mock-element';
import { MarkdownRenderer } from 'obsidian';

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
    component,
    messagesEl,
    renderer: new MessageRenderer(plugin as any, component as any, messagesEl),
  };
}

describe('MessageRenderer math', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes backslash delimiters at the shared chat render boundary', async () => {
    const { component, renderer } = createRenderer();
    const container = createMockEl();

    await renderer.renderContent(container, 'Inline \\(x\\) and display \\[y\\].');

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Inline $x$ and display $$y$$.',
      container,
      '',
      component,
    );
  });

  it('keeps normalized formulas literal during deferred streaming renders', async () => {
    const { component, renderer } = createRenderer();
    const container = createMockEl();

    await renderer.renderContent(container, 'Streaming \\[x + y\\]', { deferMath: true });

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Streaming \\$\\$x + y\\$\\$',
      container,
      '',
      component,
    );
  });

  it('normalizes formulas when rendering stored conversation blocks', () => {
    const { component, messagesEl, renderer } = createRenderer();
    const message: ChatMessage = {
      id: 'assistant-math',
      role: 'assistant',
      content: '\\[x^2\\]',
      timestamp: 1,
      contentBlocks: [{ type: 'text', content: '\\[x^2\\]' }],
    };

    renderer.renderStoredMessage(message);

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      '$$x^2$$',
      expect.anything(),
      '',
      component,
    );
    expect(messagesEl.querySelector('.qoderian-text-block')).not.toBeNull();
  });
});
