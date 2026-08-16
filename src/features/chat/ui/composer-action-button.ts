import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';

export interface ComposerActionButtonCallbacks {
  /** Sends the current composer content (same path as the Enter key). */
  onSend: () => void;
  /** Interrupts the active stream (same path as Escape). */
  onStop: () => void;
}

/**
 * Send/stop action button at the end of the input toolbar.
 * Shows a send arrow while idle and switches to a stop square while streaming.
 */
export class ComposerActionButton {
  private buttonEl: HTMLButtonElement;
  private iconEl: HTMLElement;
  private callbacks: ComposerActionButtonCallbacks;
  private streaming = false;
  private sendEnabled = false;

  constructor(parentEl: HTMLElement, callbacks: ComposerActionButtonCallbacks) {
    this.callbacks = callbacks;
    this.buttonEl = parentEl.createEl('button', {
      cls: 'qoderian-composer-action-btn',
      attr: { type: 'button' },
    });
    this.iconEl = this.buttonEl.createSpan({ cls: 'qoderian-composer-action-btn-icon' });

    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.streaming) {
        this.callbacks.onStop();
      } else if (this.sendEnabled) {
        this.callbacks.onSend();
      }
    });

    this.setStreaming(false);
    this.updateSendAvailability(false);
  }

  /** Switches between send (idle) and stop (streaming) modes. */
  setStreaming(streaming: boolean): void {
    this.streaming = streaming;
    this.buttonEl.empty();
    this.iconEl = this.buttonEl.createSpan({ cls: 'qoderian-composer-action-btn-icon' });
    if (streaming) {
      setIcon(this.iconEl, 'square');
      this.buttonEl.addClass('is-stop');
      this.buttonEl.toggleClass('is-disabled', false);
      this.buttonEl.disabled = false;
      this.buttonEl.setAttribute('aria-label', t('composer.stop'));
      this.buttonEl.setAttribute('title', t('composer.stop'));
    } else {
      setIcon(this.iconEl, 'arrow-up');
      this.buttonEl.removeClass('is-stop');
      this.buttonEl.setAttribute('aria-label', t('composer.send'));
      this.buttonEl.setAttribute('title', t('composer.send'));
      this.applySendEnabled();
    }
  }

  /** Updates whether the composer has sendable content (text or images). */
  updateSendAvailability(hasContent: boolean): void {
    this.sendEnabled = hasContent;
    if (!this.streaming) {
      this.applySendEnabled();
    }
  }

  private applySendEnabled(): void {
    this.buttonEl.toggleClass('is-disabled', !this.sendEnabled);
    this.buttonEl.disabled = !this.sendEnabled;
  }
}
