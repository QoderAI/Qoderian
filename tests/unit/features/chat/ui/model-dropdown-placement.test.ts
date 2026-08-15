import {
  MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT,
  MODEL_DROPDOWN_MIN_HEIGHT,
  MODEL_DROPDOWN_VIEWPORT_MARGIN,
  modelDropdownMaxHeight,
  modelEditorPaneOffset,
  shouldFlipModelDropdown,
} from '@/features/chat/ui/toolbar/model-dropdown-placement';

describe('shouldFlipModelDropdown', () => {
  it('keeps start alignment when the panel fits at the start edge', () => {
    expect(shouldFlipModelDropdown({ left: 20, right: 140, top: 800 }, 300, 1200)).toBe(false);
  });

  it('prefers start alignment when the panel fits on both edges', () => {
    expect(shouldFlipModelDropdown({ left: 400, right: 520, top: 800 }, 300, 1200)).toBe(false);
  });

  it('flips only when the start edge overflows and the end edge fits', () => {
    // Right-hand sidebar: a 960px cascade panel cannot grow rightward.
    expect(shouldFlipModelDropdown({ left: 1000, right: 1120, top: 800 }, 960, 1200)).toBe(true);
  });

  it('stays at start when neither edge fits (narrow window stacking takes over)', () => {
    expect(shouldFlipModelDropdown({ left: 1000, right: 1120, top: 800 }, 1190, 1200)).toBe(false);
  });

  it('treats an exact fit at the start edge as fitting', () => {
    const anchor = { left: 200, right: 320, top: 800 };
    const width = 1200 - MODEL_DROPDOWN_VIEWPORT_MARGIN - anchor.left;
    expect(shouldFlipModelDropdown(anchor, width, 1200)).toBe(false);
  });

  it('treats an exact fit at the end edge as fitting', () => {
    const anchor = { left: 1000, right: 1120, top: 800 };
    const width = anchor.right - MODEL_DROPDOWN_VIEWPORT_MARGIN;
    expect(shouldFlipModelDropdown(anchor, width, 1200)).toBe(true);
  });
});

describe('modelDropdownMaxHeight', () => {
  it('caps tall windows at the repo-wide popover height convention', () => {
    expect(modelDropdownMaxHeight(1000)).toBe(MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT);
  });

  it('shrinks to the space above the toolbar in short windows', () => {
    expect(modelDropdownMaxHeight(300)).toBe(300 - MODEL_DROPDOWN_VIEWPORT_MARGIN);
  });

  it('floors the height so the panel stays usable in tiny windows', () => {
    expect(modelDropdownMaxHeight(60)).toBe(MODEL_DROPDOWN_MIN_HEIGHT);
  });

  it('falls back to the convention when the measurement is not finite', () => {
    expect(modelDropdownMaxHeight(Number.NaN)).toBe(MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT);
  });
});

describe('modelEditorPaneOffset', () => {
  it('anchors the editor card to the visible top of the edited row', () => {
    expect(modelEditorPaneOffset(80, 220, 420)).toBe(80);
  });

  it('clamps when the editor is taller than the space below the row', () => {
    expect(modelEditorPaneOffset(300, 220, 420)).toBe(200);
  });

  it('clamps to zero for rows at or above the visible list top', () => {
    expect(modelEditorPaneOffset(-10, 220, 420)).toBe(0);
  });

  it('returns zero when any measurement is not finite', () => {
    expect(modelEditorPaneOffset(Number.NaN, 220, 420)).toBe(0);
    expect(modelEditorPaneOffset(80, Number.NaN, 420)).toBe(0);
    expect(modelEditorPaneOffset(80, 220, Number.NaN)).toBe(0);
  });
});
