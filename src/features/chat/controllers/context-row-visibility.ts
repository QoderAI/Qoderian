export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.qoderian-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.qoderian-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.qoderian-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.qoderian-file-indicator');
  const imagePreview = contextRowEl.querySelector('.qoderian-image-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('qoderian-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('qoderian-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('qoderian-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('qoderian-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('qoderian-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection || hasBrowserSelection || hasCanvasSelection || hasFileChips || hasImageChips
  );
}
