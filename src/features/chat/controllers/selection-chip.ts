import { setIcon } from 'obsidian';

/** Chip part classes shared with file chips so all context pills look identical. */
export const SELECTION_CHIP_ICON_CLASS = 'qoderian-file-chip-icon';
export const SELECTION_CHIP_LABEL_CLASS = 'qoderian-file-chip-name';
export const SELECTION_CHIP_REMOVE_CLASS = 'qoderian-file-chip-remove';

/**
 * Builds a context chip (icon + label + remove button) for selection indicators,
 * matching the file chip pill design.
 */
export function createSelectionChip(
  parentEl: HTMLElement,
  cls: string,
  icon: string
): HTMLElement {
  const chipEl = parentEl.createDiv({ cls: `${cls} qoderian-hidden` });
  const iconEl = chipEl.createSpan({ cls: SELECTION_CHIP_ICON_CLASS });
  setIcon(iconEl, icon);
  chipEl.createSpan({ cls: SELECTION_CHIP_LABEL_CLASS });
  const removeEl = chipEl.createSpan({ cls: SELECTION_CHIP_REMOVE_CLASS });
  removeEl.setText('\u00D7');
  removeEl.setAttribute('aria-label', 'Remove');
  return chipEl;
}

/** Writes the chip label; falls back to the root element when no label span exists. */
export function setSelectionChipLabel(chipEl: HTMLElement, text: string): void {
  const labelEl = chipEl.querySelector<HTMLElement>(`.${SELECTION_CHIP_LABEL_CLASS}`);
  (labelEl ?? chipEl).setText(text);
}

/** Wires the chip's remove button, when present, to the given callback. */
export function bindSelectionChipRemove(chipEl: HTMLElement, onRemove: () => void): void {
  const removeEl = chipEl.querySelector<HTMLElement>(`.${SELECTION_CHIP_REMOVE_CLASS}`);
  removeEl?.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemove();
  });
}
