import type QoderianPlugin from '../../../main';
import { autoResizeTextarea } from '../ui/textarea-resize';
import {
  sendTabInputMessageFromEnterKey,
  sendTabInputMessageFromExplicitEnterShortcut,
} from './input-shortcuts';
import type { TabData } from './types';

/** Wires composer keyboard/input behavior and the per-tab auto-scroll tracker. */
export function wireTabInputEvents(tab: TabData, plugin: QoderianPlugin): void {
  const { dom, ui, state, controllers } = tab;

  let wasBangBashActive = ui.bangBashModeManager?.isActive() ?? false;
  const syncBangBashSuppression = (): void => {
    const isActive = ui.bangBashModeManager?.isActive() ?? false;
    if (isActive === wasBangBashActive) return;
    wasBangBashActive = isActive;

    ui.slashCommandDropdown?.setEnabled(!isActive);
    if (isActive) ui.fileContextManager?.hideMentionDropdown();
  };

  const handleDropdownKeydown = (event: KeyboardEvent): boolean => {
    if (controllers.inputController?.handleResumeKeydown(event)) return true;
    if (ui.slashCommandDropdown?.handleKeydown(event)) return true;
    if (ui.fileContextManager?.handleMentionKeydown(event)) return true;
    return false;
  };

  // Obsidian handles Escape during the capture phase. Listen on window first so
  // open composer dropdowns can consume navigation keys before Obsidian does.
  const dropdownCaptureHandler = (event: KeyboardEvent): void => {
    if (event.target !== dom.inputEl) return;
    if (handleDropdownKeydown(event)) event.stopPropagation();
  };
  window.addEventListener('keydown', dropdownCaptureHandler, true);

  const keydownHandler = (event: KeyboardEvent) => {
    if (ui.bangBashModeManager?.isActive()) {
      ui.bangBashModeManager.handleKeydown(event);
      syncBangBashSuppression();
      return;
    }
    if (ui.instructionModeManager?.handleTriggerKey(event)) return;
    if (ui.bangBashModeManager?.handleTriggerKey(event)) {
      syncBangBashSuppression();
      return;
    }
    if (ui.instructionModeManager?.handleKeydown(event)) return;
    if (sendTabInputMessageFromExplicitEnterShortcut(tab, event)) return;
    if (handleDropdownKeydown(event)) return;

    if (event.key === 'Escape' && !event.isComposing && state.isStreaming) {
      event.preventDefault();
      controllers.inputController?.cancelStreaming();
      return;
    }
    sendTabInputMessageFromEnterKey(tab, plugin.settings, event);
  };
  dom.inputEl.addEventListener('keydown', keydownHandler);
  dom.eventCleanups.push(() => {
    window.removeEventListener('keydown', dropdownCaptureHandler, true);
    dom.inputEl.removeEventListener('keydown', keydownHandler);
  });

  const inputHandler = () => {
    if (!ui.bangBashModeManager?.isActive()) {
      ui.fileContextManager?.handleInputChange();
    }
    ui.instructionModeManager?.handleInputChange();
    ui.bangBashModeManager?.handleInputChange();
    syncBangBashSuppression();
    autoResizeTextarea(dom.inputEl);
  };
  dom.inputEl.addEventListener('input', inputHandler);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', inputHandler));

  const scrollThreshold = 20;
  const reEnableDelay = 150;
  let reEnableTimeout: number | null = null;

  const scrollHandler = () => {
    if (!(plugin.settings.enableAutoScroll ?? true)) {
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= scrollThreshold;
    if (!isAtBottom) {
      if (reEnableTimeout) {
        window.clearTimeout(reEnableTimeout);
        reEnableTimeout = null;
      }
      state.autoScrollEnabled = false;
    } else if (!state.autoScrollEnabled && !reEnableTimeout) {
      reEnableTimeout = window.setTimeout(() => {
        reEnableTimeout = null;
        const { scrollTop, scrollHeight, clientHeight } = dom.messagesEl;
        if (scrollHeight - scrollTop - clientHeight <= scrollThreshold) {
          state.autoScrollEnabled = true;
        }
      }, reEnableDelay);
    }
  };
  dom.messagesEl.addEventListener('scroll', scrollHandler, { passive: true });
  dom.eventCleanups.push(() => {
    dom.messagesEl.removeEventListener('scroll', scrollHandler);
    if (reEnableTimeout) window.clearTimeout(reEnableTimeout);
  });
}
