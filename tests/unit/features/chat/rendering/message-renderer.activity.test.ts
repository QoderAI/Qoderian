import { createMockEl } from '@test/helpers/mock-element';

import type { ChatMessage } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/message-renderer';
import { setLocale } from '@/i18n/i18n';

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

describe('MessageRenderer completed turn activity', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('collapses intermediate blocks while leaving the final result visible', () => {
    const { messagesEl, renderer } = createRenderer();
    const message: ChatMessage = {
      id: 'assistant-with-steps',
      role: 'assistant',
      content: 'Checking the project.Final answer.',
      timestamp: 1,
      toolCalls: [{
        id: 'tool-1',
        name: 'Read',
        input: { file_path: 'src/main.ts' },
        status: 'completed',
        result: 'file contents',
      }],
      contentBlocks: [
        { type: 'thinking', content: 'I should inspect the project.' },
        { type: 'text', content: 'Checking the project.' },
        { type: 'tool_use', toolId: 'tool-1' },
        { type: 'text', content: 'Final answer.' },
      ],
    };

    renderer.renderStoredMessage(message);

    const activity = messagesEl.querySelector('.qoderian-turn-activity');
    const header = messagesEl.querySelector('.qoderian-turn-activity-header');
    const activityContent = messagesEl.querySelector('.qoderian-turn-activity-content');
    expect(activity).not.toBeNull();
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(activityContent?.hasClass('qoderian-hidden')).toBe(true);
    expect(activityContent?.querySelector('.qoderian-thinking-block')).not.toBeNull();
    expect(activityContent?.querySelector('.qoderian-tool-call')).not.toBeNull();
    expect(activityContent?.querySelector('.qoderian-text-block')).not.toBeNull();

    header?.click();
    expect(activity?.hasClass('expanded')).toBe(true);
    expect(activityContent?.hasClass('qoderian-hidden')).toBe(false);
  });

  it('does not collapse a turn whose last visible block is still a tool call', () => {
    const { messagesEl, renderer } = createRenderer();
    const message: ChatMessage = {
      id: 'assistant-tool-terminal',
      role: 'assistant',
      content: 'Running the command.',
      timestamp: 1,
      toolCalls: [{
        id: 'tool-1',
        name: 'Bash',
        input: { command: 'npm test' },
        status: 'completed',
        result: 'ok',
      }],
      contentBlocks: [
        { type: 'text', content: 'Running the command.' },
        { type: 'tool_use', toolId: 'tool-1' },
      ],
    };

    renderer.renderStoredMessage(message);

    expect(messagesEl.querySelector('.qoderian-turn-activity')).toBeNull();
    expect(messagesEl.querySelector('.qoderian-tool-call')).not.toBeNull();
  });

  it('does not add a disclosure when there are no intermediate steps', () => {
    const { messagesEl, renderer } = createRenderer();
    const message: ChatMessage = {
      id: 'assistant-final-only',
      role: 'assistant',
      content: 'Final answer.',
      timestamp: 1,
      contentBlocks: [{ type: 'text', content: 'Final answer.' }],
    };

    renderer.renderStoredMessage(message);

    expect(messagesEl.querySelector('.qoderian-turn-activity')).toBeNull();
    expect(messagesEl.querySelector('.qoderian-text-block')).not.toBeNull();
  });
});
