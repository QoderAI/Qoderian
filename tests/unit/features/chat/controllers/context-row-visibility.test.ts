import { createMockEl } from '@test/helpers/mock-element';

import { updateContextRowHasContent } from '@/features/chat/controllers/context-row-visibility';

function createContextRow(browserIndicator: HTMLElement | null): HTMLElement {
  const editorIndicator = createMockEl();
  editorIndicator.addClass('qoderian-selection-indicator qoderian-hidden');
  const canvasIndicator = createMockEl();
  canvasIndicator.addClass('qoderian-canvas-indicator qoderian-hidden');
  const fileIndicator = createMockEl();
  fileIndicator.addClass('qoderian-file-indicator qoderian-hidden');
  const imagePreview = createMockEl();
  imagePreview.addClass('qoderian-image-preview qoderian-hidden');
  const lookup = new Map<string, unknown>([
    ['.qoderian-selection-indicator', editorIndicator],
    ['.qoderian-browser-selection-indicator', browserIndicator],
    ['.qoderian-canvas-indicator', canvasIndicator],
    ['.qoderian-file-indicator', fileIndicator],
    ['.qoderian-image-preview', imagePreview],
  ]);

  const contextRow = createMockEl();
  const toggle = contextRow.classList.toggle;
  contextRow.classList.toggle = jest.fn((cls: string, force?: boolean) => toggle(cls, force));
  contextRow.querySelector = jest.fn((selector: string) => lookup.get(selector) ?? null);
  return contextRow as unknown as HTMLElement;
}

describe('updateContextRowHasContent', () => {
  it('does not treat missing browser indicator as visible content', () => {
    const contextRowEl = createContextRow(null);

    expect(() => updateContextRowHasContent(contextRowEl)).not.toThrow();
    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', false);
  });

  it('treats browser indicator as visible only when it is not hidden', () => {
    const browserIndicator = createMockEl();
    browserIndicator.addClass('qoderian-browser-selection-indicator');
    const contextRowEl = createContextRow(browserIndicator);

    updateContextRowHasContent(contextRowEl);

    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', true);
  });
});
