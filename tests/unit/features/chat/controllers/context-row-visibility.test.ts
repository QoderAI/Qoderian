import { createMockEl } from '@test/helpers/mock-element';

import { updateContextRowHasContent } from '@/features/chat/controllers/context-row-visibility';

function createContextRow(imagePreview: HTMLElement | null): HTMLElement {
  const lookup = new Map<string, unknown>([
    ['.qoderian-image-preview', imagePreview],
  ]);

  const contextRow = createMockEl();
  const toggle = contextRow.classList.toggle;
  contextRow.classList.toggle = jest.fn((cls: string, force?: boolean) => toggle(cls, force));
  contextRow.querySelector = jest.fn((selector: string) => lookup.get(selector) ?? null);
  return contextRow as unknown as HTMLElement;
}

describe('updateContextRowHasContent', () => {
  it('does not treat a missing image preview as visible content', () => {
    const contextRowEl = createContextRow(null);

    expect(() => updateContextRowHasContent(contextRowEl)).not.toThrow();
    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', false);
  });

  it('treats the image preview as visible only when it is shown', () => {
    const imagePreview = createMockEl();
    imagePreview.addClass('qoderian-image-preview qoderian-visible-flex');
    const contextRowEl = createContextRow(imagePreview);

    updateContextRowHasContent(contextRowEl);

    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', true);
  });

  it('ignores a hidden image preview', () => {
    const imagePreview = createMockEl();
    imagePreview.addClass('qoderian-image-preview qoderian-hidden');
    const contextRowEl = createContextRow(imagePreview);

    updateContextRowHasContent(contextRowEl);

    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', false);
  });
});
