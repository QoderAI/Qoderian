import { formatDurationMmSs } from '../../../core/time/date';
import { FLAVOR_TEXTS } from '../flavor-texts';
import type { ChatState } from '../state/chat-state';

interface ThinkingIndicatorControllerDeps {
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  updateQueueIndicator: () => void;
}

const SHOW_DELAY_MS = 400;

/** Owns the delayed flavor-text indicator and its elapsed-time timer. */
export class ThinkingIndicatorController {
  constructor(private readonly deps: ThinkingIndicatorControllerDeps) {}

  show(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }
    if (state.currentThinkingState) return;

    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls ? `qoderian-thinking ${overrideCls}` : 'qoderian-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      const timerSpan = state.thinkingEl.createSpan({ cls: 'qoderian-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) state.clearFlavorTimerInterval();
          return;
        }

        const elapsedSeconds = Math.floor(
          (performance.now() - state.responseStartTime) / 1000,
        );
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer();

      if (state.flavorTimerInterval) state.clearFlavorTimerInterval();
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(
        thinkingWindow.setInterval(updateTimer, 1000),
        thinkingWindow,
      );
    }, SHOW_DELAY_MS), timerWindow);
  }

  hide(): void {
    const { state } = this.deps;
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    state.clearFlavorTimerInterval();
    state.thinkingEl?.remove();
    state.thinkingEl = null;
  }
}
