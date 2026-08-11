import { createMockEl } from '@test/helpers/mock-element';

import {
  bindSelectionChipRemove,
  createSelectionChip,
  SELECTION_CHIP_LABEL_CLASS,
  SELECTION_CHIP_REMOVE_CLASS,
  setSelectionChipLabel,
} from '@/features/chat/controllers/selection-chip';

describe('selection-chip', () => {
  it('builds a hidden chip skeleton with icon, label and remove button', () => {
    const parent = createMockEl();

    const chip = createSelectionChip(parent as any, 'qoderian-selection-indicator', 'text-select');

    expect(chip.hasClass('qoderian-selection-indicator')).toBe(true);
    expect(chip.hasClass('qoderian-hidden')).toBe(true);
    expect(chip.querySelector('.qoderian-file-chip-icon')).not.toBeNull();
    expect(chip.querySelector(`.${SELECTION_CHIP_LABEL_CLASS}`)).not.toBeNull();
    const removeEl = chip.querySelector(`.${SELECTION_CHIP_REMOVE_CLASS}`);
    expect(removeEl).not.toBeNull();
    expect(removeEl!.textContent).toBe('×');
    expect(removeEl!.getAttribute('aria-label')).toBe('Remove');
  });

  it('writes the label into the label span, not the chip root', () => {
    const chip = createSelectionChip(createMockEl() as any, 'qoderian-selection-indicator', 'text-select');

    setSelectionChipLabel(chip as any, '8 lines selected');

    const label = chip.querySelector(`.${SELECTION_CHIP_LABEL_CLASS}`)!;
    expect(label.textContent).toBe('8 lines selected');
    expect(chip.textContent).toBe('');
  });

  it('falls back to the root element when no label span exists', () => {
    const bare = createMockEl();

    setSelectionChipLabel(bare as any, '2 lines selected');

    expect(bare.textContent).toBe('2 lines selected');
  });

  it('invokes onRemove when the remove button is clicked', () => {
    const chip = createSelectionChip(createMockEl() as any, 'qoderian-selection-indicator', 'text-select');
    const onRemove = jest.fn();
    bindSelectionChipRemove(chip as any, onRemove);

    const removeEl = chip.querySelector(`.${SELECTION_CHIP_REMOVE_CLASS}`) as any;
    removeEl.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the chip has no remove button', () => {
    const bare = createMockEl();

    expect(() => bindSelectionChipRemove(bare as any, jest.fn())).not.toThrow();
  });
});
