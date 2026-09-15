/**
 * Pure placement decisions for the input toolbar's icon-hover dropdowns.
 *
 * The dropdowns visually center on their anchor icon, but the chat container
 * clips overflow: in a narrow sidebar a fixed-width dropdown anchored near
 * the toolbar's leading edge lost its first characters. The placement keeps
 * the icon-centered look when it fits, clamps the center so the dropdown
 * stays inside the toolbar, and caps the width only when the dropdown is
 * wider than the available space. Keeping the decision pure (no DOM access)
 * makes it unit-testable without a layout engine; the selector components
 * only measure and apply the result.
 */

/** Breathing room kept between the dropdown and the toolbar edges. */
export const HOVER_DROPDOWN_EDGE_INSET = 8;

export interface HoverDropdownPlacement {
  /** Dropdown center, relative to the toolbar's left edge. */
  center: number;
  /** Width cap when the dropdown cannot fit the toolbar, else null. */
  maxWidth: number | null;
}

export function placeHoverDropdown(
  iconCenter: number,
  dropdownWidth: number,
  toolbarWidth: number,
  inset: number = HOVER_DROPDOWN_EDGE_INSET,
): HoverDropdownPlacement | null {
  if (!Number.isFinite(iconCenter)
    || !Number.isFinite(dropdownWidth)
    || !Number.isFinite(toolbarWidth)
    || dropdownWidth <= 0
    || toolbarWidth <= 0) {
    return null;
  }

  const available = toolbarWidth - inset * 2;
  const maxWidth = available > 0 && dropdownWidth > available ? available : null;
  const width = maxWidth ?? dropdownWidth;
  const half = width / 2;
  const minCenter = inset + half;
  const maxCenter = toolbarWidth - inset - half;

  // A dropdown wider than the toolbar cannot respect both insets; center it
  // so any remaining clipping stays symmetric.
  const center = minCenter > maxCenter
    ? toolbarWidth / 2
    : Math.min(Math.max(iconCenter, minCenter), maxCenter);

  return { center, maxWidth };
}
