import { TurnErrorAccumulator } from '@/core/chat/error-blocks';
import type { ChatMessage } from '@/core/types';

function createAssistant(content: string, textBlocks: string[]): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content,
    timestamp: 1,
    contentBlocks: textBlocks.map(block => ({ type: 'text', content: block })),
  };
}

describe('TurnErrorAccumulator', () => {
  it('upgrades fully duplicated assistant text into one formal error block', () => {
    const content = "You've reached your credit usage limit.";
    const message = createAssistant(content, [content]);

    new TurnErrorAccumulator(message).reconcile(message, { content });

    expect(message.content).toBe('');
    expect(message.contentBlocks).toEqual([{ type: 'error', content }]);
  });

  it('preserves a partial answer and appends the terminal error', () => {
    const message = createAssistant('I completed the first two steps.', [
      'I completed the first two steps.',
    ]);

    new TurnErrorAccumulator(message).reconcile(message, {
      content: 'The request failed before the final step.',
    });

    expect(message.content).toBe('I completed the first two steps.');
    expect(message.contentBlocks).toEqual([
      { type: 'text', content: 'I completed the first two steps.' },
      { type: 'error', content: 'The request failed before the final step.' },
    ]);
  });

  it('deduplicates multiple sources and upgrades an assistant error code', () => {
    const readableError = "You've reached your credit usage limit.";
    const message = createAssistant(readableError, [readableError]);
    const accumulator = new TurnErrorAccumulator(message);

    accumulator.reconcile(message, { content: 'billing_error', code: 'billing_error' });
    accumulator.reconcile(message, { content: readableError });
    accumulator.reconcile(message, { content: `  ${readableError}\n` });
    accumulator.reconcile(message, { content: 'A second backend error occurred.' });

    expect(message.contentBlocks).toEqual([
      { type: 'error', content: readableError, code: 'billing_error' },
      { type: 'error', content: 'A second backend error occurred.' },
    ]);
  });
});
