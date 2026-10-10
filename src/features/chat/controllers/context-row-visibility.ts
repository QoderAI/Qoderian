export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const imagePreview = contextRowEl.querySelector('.qoderian-image-preview');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('qoderian-visible-flex');

  contextRowEl.classList.toggle('has-content', hasImageChips);
}
