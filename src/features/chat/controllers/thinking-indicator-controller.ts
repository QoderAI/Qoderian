import { formatDurationMmSs } from '../../../core/time/date';
import type { StreamChunk } from '../../../core/types';
import { FLAVOR_TEXTS } from '../flavor-texts';
import type { ChatState } from '../state/chat-state';

interface ThinkingIndicatorControllerDeps {
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  updateQueueIndicator: () => void;
}

type ModelQueueChunk = Extract<StreamChunk, { type: 'model_queue' }>;

const SHOW_DELAY_MS = 400;

function buildQueueLabel(chunk: ModelQueueChunk): string {
  const parts: string[] = [];
  if (chunk.queueCount && chunk.queueCount > 0) parts.push(`${chunk.queueCount} ahead`);
  if (chunk.waitTimeMs && chunk.waitTimeMs > 0) parts.push(`~${Math.ceil(chunk.waitTimeMs / 1000)}s wait`);
  return parts.length > 0 ? `Model is queued (${parts.join(' · ')})...` : 'Model is queued...';
}

/** Owns the delayed flavor-text indicator and its elapsed-time timer. */
export class ThinkingIndicatorController {
  private queueLabel: string | null = null;

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

      const queueActive = this.queueLabel !== null;
      const queueCls = queueActive ? ' qoderian-thinking--queue' : '';
      const cls = `qoderian-thinking${overrideCls ? ` ${overrideCls}` : queueCls}`;
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || this.queueLabel || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ cls: 'qoderian-thinking-text', text });

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

  /** Reflects CLI model-capacity queue progress onto the waiting indicator. */
  setQueue(chunk: ModelQueueChunk): void {
    const { state } = this.deps;
    if (chunk.status === 'ready') {
      if (this.queueLabel === null) return;
      this.queueLabel = null;
      if (state.thinkingEl) {
        state.thinkingEl.removeClass('qoderian-thinking--queue');
        const label = state.thinkingEl.querySelector<HTMLElement>('.qoderian-thinking-text');
        label?.setText(FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)]);
      }
      return;
    }

    this.queueLabel = buildQueueLabel(chunk);
    if (state.thinkingEl) {
      state.thinkingEl.addClass('qoderian-thinking--queue');
      state.thinkingEl.querySelector<HTMLElement>('.qoderian-thinking-text')?.setText(this.queueLabel);
      return;
    }
    this.show(this.queueLabel, 'qoderian-thinking--queue');
  }

  hide(): void {
    const { state } = this.deps;
    this.queueLabel = null;
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    state.clearFlavorTimerInterval();
    state.thinkingEl?.remove();
    state.thinkingEl = null;
  }
}
