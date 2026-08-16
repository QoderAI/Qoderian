import { createMockEl } from '@test/helpers/mock-element';

import { ComposerActionButton } from '@/features/chat/ui/composer-action-button';

describe('ComposerActionButton', () => {
  function createButton() {
    const parentEl = createMockEl();
    const onSend = jest.fn();
    const onStop = jest.fn();
    const button = new ComposerActionButton(parentEl, { onSend, onStop });
    const buttonEl = parentEl.querySelector('.qoderian-composer-action-btn');
    if (!buttonEl) throw new Error('action button missing');
    return { button, buttonEl, onSend, onStop };
  }

  it('starts disabled with the send label', () => {
    const { buttonEl } = createButton();

    expect(buttonEl.disabled).toBe(true);
    expect(buttonEl.hasClass('is-disabled')).toBe(true);
    expect(buttonEl.getAttribute('title')).toBe('Send message');
  });

  it('enables once the composer has content and sends on click', () => {
    const { button, buttonEl, onSend } = createButton();

    button.updateSendAvailability(true);
    expect(buttonEl.disabled).toBe(false);

    buttonEl.click();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks while disabled', () => {
    const { buttonEl, onSend } = createButton();

    buttonEl.click();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('switches to stop mode while streaming and routes clicks to stop', () => {
    const { button, buttonEl, onSend, onStop } = createButton();
    button.updateSendAvailability(true);

    button.setStreaming(true);
    expect(buttonEl.disabled).toBe(false);
    expect(buttonEl.hasClass('is-stop')).toBe(true);
    expect(buttonEl.getAttribute('title')).toBe('Stop generation');

    buttonEl.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('re-applies send availability when streaming ends', () => {
    const { button, buttonEl } = createButton();

    button.setStreaming(true);
    button.setStreaming(false);
    expect(buttonEl.disabled).toBe(true);
    expect(buttonEl.hasClass('is-stop')).toBe(false);

    button.updateSendAvailability(true);
    button.setStreaming(true);
    button.setStreaming(false);
    expect(buttonEl.disabled).toBe(false);
  });
});
