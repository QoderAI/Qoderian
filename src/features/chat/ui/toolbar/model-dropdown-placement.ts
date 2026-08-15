/**
 * Pure placement decisions for the model dropdown cascade panel.
 *
 * The rules mirror the flip/size middleware of floating-positioning
 * libraries: prefer the anchor's inline-start edge and flip only when the
 * panel would overflow the viewport there, and cap the panel height to the
 * space available above the toolbar. Keeping the decisions pure (no DOM
 * access) makes them unit-testable without a layout engine; the selector
 * component only measures and applies the results.
 */

export interface ModelDropdownAnchorRect {
  left: number;
  right: number;
  top: number;
}

/** Breathing room kept between the panel and the viewport edge. */
export const MODEL_DROPDOWN_VIEWPORT_MARGIN = 8;
/** Repo-wide popover height convention (see nav TOC popover). */
export const MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT = 420;
/** Floor so the panel stays usable even in very short windows. */
export const MODEL_DROPDOWN_MIN_HEIGHT = 160;

/**
 * Decides whether the panel should anchor to the inline-end edge of its
 * toolbar instead of the inline-start edge. Start alignment keeps the panel
 * flush with the trigger button; flipping is a last resort for anchors whose
 * start side cannot fit the panel.
 */
export function shouldFlipModelDropdown(
  anchor: ModelDropdownAnchorRect,
  panelWidth: number,
  viewportWidth: number,
): boolean {
  const margin = MODEL_DROPDOWN_VIEWPORT_MARGIN;
  const fitsAtStart = anchor.left + panelWidth <= viewportWidth - margin;
  const fitsAtEnd = anchor.right - panelWidth >= margin;
  return !fitsAtStart && fitsAtEnd;
}

/**
 * Caps the panel to the vertical space above the toolbar so the upward
 * growing dropdown never covers the viewport top, without exceeding the
 * repo-wide 420px popover convention.
 */
export function modelDropdownMaxHeight(anchorTop: number): number {
  const available = anchorTop - MODEL_DROPDOWN_VIEWPORT_MARGIN;
  if (!Number.isFinite(available)) return MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT;
  return Math.max(
    MODEL_DROPDOWN_MIN_HEIGHT,
    Math.min(available, MODEL_DROPDOWN_FALLBACK_MAX_HEIGHT),
  );
}

/**
 * Anchors the compact editor card to its edited row like an IDE flyout,
 * clamped so the card never escapes the visible list area.
 */
export function modelEditorPaneOffset(
  rowVisibleTop: number,
  editorHeight: number,
  listVisibleHeight: number,
): number {
  if (!Number.isFinite(rowVisibleTop)
    || !Number.isFinite(editorHeight)
    || !Number.isFinite(listVisibleHeight)) {
    return 0;
  }
  return Math.max(0, Math.min(rowVisibleTop, listVisibleHeight - editorHeight));
}
