import type { ChatMessage } from '@/core/types';
import {
  PromptHistoryController,
  type PromptHistoryControllerDeps,
} from '@/features/chat/controllers/prompt-history-controller';
import { autoResizeTextarea } from '@/features/chat/ui/textarea-resize';

jest.mock('@/features/chat/ui/textarea-resize', () => ({
  autoResizeTextarea: jest.fn(),
}));

function createInput(): HTMLTextAreaElement {
  return {
    value: '',
    focus: jest.fn(),
    setSelectionRange: jest.fn(),
  } as unknown as HTMLTextAreaElement;
}

function createUserMessage(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${text}`,
    role: 'user',
    content: text,
    displayContent: text,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createKeyEvent(key: string, overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    isComposing: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault: jest.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

const autoResizeMock = autoResizeTextarea as unknown as jest.Mock;

describe('PromptHistoryController', () => {
  let inputEl: HTMLTextAreaElement;
  let messages: ChatMessage[];
  let conversationId: string | null;

  function createController(overrides: Partial<PromptHistoryControllerDeps> = {}) {
    return new PromptHistoryController({
      getInputEl: () => inputEl,
      getMessages: () => messages,
      getConversationId: () => conversationId,
      ...overrides,
    });
  }

  beforeEach(() => {
    inputEl = createInput();
    conversationId = 'conv-1';
    messages = [
      createUserMessage('first message'),
      { id: 'assistant-1', role: 'assistant', content: 'reply', timestamp: Date.now() },
      createUserMessage('second message'),
      createUserMessage('third message'),
    ];
    autoResizeMock.mockClear();
  });

  it('recalls the most recent sent message on ArrowUp in an empty input', () => {
    const controller = createController();
    const event = createKeyEvent('ArrowUp');

    expect(controller.handleKeydown(event)).toBe(true);
    expect(inputEl.value).toBe('third message');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(autoResizeMock).toHaveBeenCalledWith(inputEl);
    expect(inputEl.setSelectionRange).toHaveBeenCalledWith('third message'.length, 'third message'.length);
  });

  it('walks further back on repeated ArrowUp and stops at the oldest message', () => {
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('third message');

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(true);
    expect(inputEl.value).toBe('second message');

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(true);
    expect(inputEl.value).toBe('first message');

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(false);
    expect(inputEl.value).toBe('first message');
  });

  it('walks forward on ArrowDown and returns to the empty draft past the newest message', () => {
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('second message');

    const forward = createKeyEvent('ArrowDown');
    expect(controller.handleKeydown(forward)).toBe(true);
    expect(inputEl.value).toBe('third message');

    const backToDraft = createKeyEvent('ArrowDown');
    expect(controller.handleKeydown(backToDraft)).toBe(true);
    expect(inputEl.value).toBe('');
    expect(backToDraft.preventDefault).toHaveBeenCalled();

    expect(controller.handleKeydown(createKeyEvent('ArrowDown'))).toBe(false);
    expect(inputEl.value).toBe('');
  });

  it('does not start browsing while the composer holds a draft', () => {
    const controller = createController();
    inputEl.value = 'typing something';

    const event = createKeyEvent('ArrowUp');
    expect(controller.handleKeydown(event)).toBe(false);
    expect(inputEl.value).toBe('typing something');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('stops browsing once the recalled message is edited', () => {
    const controller = createController();
    controller.handleKeydown(createKeyEvent('ArrowUp'));

    inputEl.value = 'third message edited';
    expect(controller.handleKeydown(createKeyEvent('ArrowDown'))).toBe(false);

    // Typing leaves a draft behind, so ArrowUp no longer recalls either.
    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(false);
    expect(inputEl.value).toBe('third message edited');
  });

  it('restarts browsing from the newest message when the draft is cleared', () => {
    const controller = createController();
    controller.handleKeydown(createKeyEvent('ArrowUp'));
    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('second message');

    inputEl.value = '';

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(true);
    expect(inputEl.value).toBe('third message');
  });

  it('restarts browsing against the messages of the current conversation', () => {
    const controller = createController();
    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('third message');

    conversationId = 'conv-2';
    inputEl.value = '';
    messages = [createUserMessage('other conversation message')];

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(true);
    expect(inputEl.value).toBe('other conversation message');
  });

  it('ignores arrow keys while an IME composition is active', () => {
    const controller = createController();
    const event = createKeyEvent('ArrowUp', { isComposing: true } as Partial<KeyboardEvent>);

    expect(controller.handleKeydown(event)).toBe(false);
    expect(inputEl.value).toBe('');
  });

  it('ignores arrow keys when a modifier is held', () => {
    const controller = createController();

    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) {
      const event = createKeyEvent('ArrowUp', { [modifier]: true } as Partial<KeyboardEvent>);
      expect(controller.handleKeydown(event)).toBe(false);
    }
    expect(inputEl.value).toBe('');
  });

  it('ignores other keys', () => {
    const controller = createController();

    expect(controller.handleKeydown(createKeyEvent('ArrowLeft'))).toBe(false);
    expect(controller.handleKeydown(createKeyEvent('Enter'))).toBe(false);
    expect(controller.handleKeydown(createKeyEvent('a'))).toBe(false);
    expect(inputEl.value).toBe('');
  });

  it('does nothing when the conversation has no sent messages', () => {
    messages = [];
    const controller = createController();

    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(false);
    expect(inputEl.value).toBe('');
  });

  it('skips interrupt and rebuilt-context messages', () => {
    messages = [
      createUserMessage('real message'),
      createUserMessage('interrupt', { isInterrupt: true }),
      createUserMessage('rebuilt', { isRebuiltContext: true }),
    ];
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('real message');
    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(false);
  });

  it('skips messages without text', () => {
    messages = [
      createUserMessage('with text'),
      { id: 'image-only', role: 'user', content: '', displayContent: '', timestamp: Date.now() },
    ];
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('with text');
    expect(controller.handleKeydown(createKeyEvent('ArrowUp'))).toBe(false);
  });

  it('prefers the display content of a message over the expanded prompt', () => {
    messages = [
      createUserMessage('', {
        content: '/tests\n\n<current_note>\npath.md\n</current_note>',
        displayContent: '/tests',
      }),
    ];
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('/tests');
  });

  it('extracts the display content when a message has no display content', () => {
    messages = [
      {
        id: 'legacy',
        role: 'user',
        content: 'check this\n\n<current_note>\npath.md\n</current_note>',
        timestamp: Date.now(),
      },
    ];
    const controller = createController();

    controller.handleKeydown(createKeyEvent('ArrowUp'));
    expect(inputEl.value).toBe('check this');
  });
});
