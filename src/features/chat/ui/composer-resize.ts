import { t } from '../../../i18n/i18n';
import { setButtonTooltip } from '../../../shared/dom/tooltip';

export const COMPOSER_MIN_HEIGHT = 140;
export const COMPOSER_MAX_HEIGHT_PERCENT = 0.75;
export const COMPOSER_KEYBOARD_RESIZE_STEP = 24;

export interface ComposerResizeController {
  destroy(): void;
  refreshLocale(): void;
  reset(): void;
}

export function calculateComposerMaxHeight(viewHeight: number): number {
  return Math.max(COMPOSER_MIN_HEIGHT, Math.floor(viewHeight * COMPOSER_MAX_HEIGHT_PERCENT));
}

export function clampComposerHeight(height: number, viewHeight: number): number {
  return Math.min(
    calculateComposerMaxHeight(viewHeight),
    Math.max(COMPOSER_MIN_HEIGHT, Math.round(height)),
  );
}

/**
 * Makes the top edge of the composer draggable. The footer is anchored at the
 * bottom of the chat view, so dragging upward increases the input area.
 * Double-clicking the handle (or pressing Home) returns to content-driven size.
 */
export function attachComposerResize(
  wrapperEl: HTMLElement,
  handleEl: HTMLElement,
  onResize?: () => void,
): ComposerResizeController {
  const doc = handleEl.ownerDocument;
  const viewWindow = doc.defaultView;
  const containerEl = wrapperEl.closest<HTMLElement>('.qoderian-container');
  let dragging = false;
  let startClientY = 0;
  let startHeight = COMPOSER_MIN_HEIGHT;

  const getViewHeight = (): number => {
    const containerHeight = containerEl?.clientHeight;
    return containerHeight || doc.defaultView?.innerHeight || COMPOSER_MIN_HEIGHT;
  };

  const currentHeight = (): number => {
    const measured = wrapperEl.getBoundingClientRect().height || wrapperEl.clientHeight;
    return measured || COMPOSER_MIN_HEIGHT;
  };

  const updateAriaBounds = (height: number): void => {
    handleEl.setAttribute('aria-valuemin', String(COMPOSER_MIN_HEIGHT));
    handleEl.setAttribute('aria-valuemax', String(calculateComposerMaxHeight(getViewHeight())));
    handleEl.setAttribute('aria-valuenow', String(Math.round(height)));
  };

  const applyHeight = (height: number): void => {
    const nextHeight = clampComposerHeight(height, getViewHeight());
    wrapperEl.classList.add('qoderian-input-wrapper--resized');
    wrapperEl.style.setProperty('--qoderian-input-wrapper-height', `${nextHeight}px`);
    updateAriaBounds(nextHeight);
    onResize?.();
  };

  const stopDragging = (): void => {
    if (!dragging) return;
    dragging = false;
    doc.removeEventListener('pointermove', handlePointerMove);
    doc.removeEventListener('pointerup', stopDragging);
    doc.removeEventListener('pointercancel', stopDragging);
    doc.body?.classList.remove('qoderian-composer-resizing');
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    applyHeight(startHeight + startClientY - event.clientY);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopDragging();
    dragging = true;
    startClientY = event.clientY;
    startHeight = currentHeight();
    doc.addEventListener('pointermove', handlePointerMove);
    doc.addEventListener('pointerup', stopDragging);
    doc.addEventListener('pointercancel', stopDragging);
    doc.body?.classList.add('qoderian-composer-resizing');
  };

  const reset = (): void => {
    stopDragging();
    wrapperEl.classList.remove('qoderian-input-wrapper--resized');
    wrapperEl.style.removeProperty('--qoderian-input-wrapper-height');
    updateAriaBounds(currentHeight());
    onResize?.();
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      reset();
      return;
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp'
      ? COMPOSER_KEYBOARD_RESIZE_STEP
      : -COMPOSER_KEYBOARD_RESIZE_STEP;
    applyHeight(currentHeight() + delta);
  };

  const refreshLocale = (): void => {
    setButtonTooltip(handleEl, t('composer.resize'));
  };

  handleEl.setAttribute('role', 'separator');
  handleEl.setAttribute('aria-orientation', 'horizontal');
  handleEl.setAttribute('tabindex', '0');
  updateAriaBounds(currentHeight());
  refreshLocale();
  handleEl.addEventListener('pointerdown', handlePointerDown);
  handleEl.addEventListener('dblclick', reset);
  handleEl.addEventListener('keydown', handleKeydown);
  viewWindow?.addEventListener('blur', stopDragging);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined' && containerEl) {
    resizeObserver = new ResizeObserver(() => {
      if (wrapperEl.classList.contains('qoderian-input-wrapper--resized')) {
        applyHeight(currentHeight());
      } else {
        updateAriaBounds(currentHeight());
      }
    });
    resizeObserver.observe(containerEl);
  }

  return {
    destroy: () => {
      stopDragging();
      resizeObserver?.disconnect();
      handleEl.removeEventListener('pointerdown', handlePointerDown);
      handleEl.removeEventListener('dblclick', reset);
      handleEl.removeEventListener('keydown', handleKeydown);
      viewWindow?.removeEventListener('blur', stopDragging);
    },
    refreshLocale,
    reset,
  };
}
