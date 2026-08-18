import { setTooltip } from 'obsidian';

/**
 * Hover delay (ms) for icon-button tooltips.
 * Obsidian's native aria-label tooltips use a 1000ms cold-start delay, which
 * feels sluggish next to the 200-500ms range common in web toolbars.
 */
const BUTTON_TOOLTIP_DELAY = 300;

/**
 * Sets a hover tooltip on an icon button with a snappier-than-default delay.
 * Keeps the native Obsidian tooltip rendering (placement, arrow, a11y) intact.
 */
export function setButtonTooltip(el: HTMLElement, text: string): void {
  setTooltip(el, text, { delay: BUTTON_TOOLTIP_DELAY });
}
