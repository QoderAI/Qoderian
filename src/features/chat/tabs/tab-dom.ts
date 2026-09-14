import type { TabDOMElements } from './types';

/** Builds the stable DOM skeleton owned by one chat tab. */
export function buildTabDOM(contentEl: HTMLElement): TabDOMElements {
  const messagesWrapperEl = contentEl.createDiv({ cls: 'qoderian-messages-wrapper' });
  const messagesEl = messagesWrapperEl.createDiv({ cls: 'qoderian-messages' });
  const welcomeEl = messagesEl.createDiv({ cls: 'qoderian-welcome' });
  const statusPanelContainerEl = contentEl.createDiv({ cls: 'qoderian-status-panel-container' });
  const inputComposerEl = contentEl.createDiv({ cls: 'qoderian-input-composer' });
  const inputContainerEl = inputComposerEl.createDiv({ cls: 'qoderian-input-container' });
  const queueIndicatorEl = inputContainerEl.createDiv({ cls: 'qoderian-input-queue-row' });
  const navRowEl = inputContainerEl.createDiv({ cls: 'qoderian-input-nav-row' });
  const inputWrapper = inputContainerEl.createDiv({ cls: 'qoderian-input-wrapper' });
  const composerResizeHandleEl = inputWrapper.createDiv({ cls: 'qoderian-composer-resize-handle' });
  const contextRowEl = inputWrapper.createDiv({ cls: 'qoderian-context-row' });
  const inputEl = inputWrapper.createEl('textarea', {
    cls: 'qoderian-input',
    attr: {
      placeholder: 'How can I help you today?',
      rows: '3',
      dir: 'auto',
    },
  });

  return {
    contentEl,
    messagesEl,
    welcomeEl,
    statusPanelContainerEl,
    inputComposerEl,
    inputContainerEl,
    queueIndicatorEl,
    inputWrapper,
    composerResizeHandleEl,
    inputEl,
    navRowEl,
    contextRowEl,
    selectionIndicatorEl: null,
    browserIndicatorEl: null,
    canvasIndicatorEl: null,
    eventCleanups: [],
  };
}
