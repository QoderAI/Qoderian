/**
 * @jest-environment jsdom
 */

import {
  attachComposerResize,
  calculateComposerMaxHeight,
  clampComposerHeight,
  COMPOSER_KEYBOARD_RESIZE_STEP,
  COMPOSER_MAX_HEIGHT_PERCENT,
  COMPOSER_MIN_HEIGHT,
} from '@/features/chat/ui/composer-resize';

describe('composerResize', () => {
  it('clamps manual height to the available view range', () => {
    expect(calculateComposerMaxHeight(800)).toBe(800 * COMPOSER_MAX_HEIGHT_PERCENT);
    expect(clampComposerHeight(80, 800)).toBe(COMPOSER_MIN_HEIGHT);
    expect(clampComposerHeight(900, 800)).toBe(600);
  });

  it('grows upward while dragging and resets on double-click', () => {
    const { container, wrapper, handle } = createHarness(800, 200);
    const onResize = jest.fn();
    const controller = attachComposerResize(wrapper, handle, onResize);

    handle.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientY: 400,
    }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientY: 300 }));
    document.dispatchEvent(new MouseEvent('pointerup'));

    expect(wrapper.classList.contains('qoderian-input-wrapper--resized')).toBe(true);
    expect(wrapper.style.getPropertyValue('--qoderian-input-wrapper-height')).toBe('300px');
    expect(handle.getAttribute('aria-valuenow')).toBe('300');
    expect(document.body.classList.contains('qoderian-composer-resizing')).toBe(false);
    expect(onResize).toHaveBeenCalled();

    handle.dispatchEvent(new MouseEvent('dblclick'));

    expect(wrapper.classList.contains('qoderian-input-wrapper--resized')).toBe(false);
    expect(wrapper.style.getPropertyValue('--qoderian-input-wrapper-height')).toBe('');

    controller.destroy();
    container.remove();
  });

  it('supports keyboard resizing and Home to restore automatic height', () => {
    const { container, wrapper, handle } = createHarness(800, 200);
    const controller = attachComposerResize(wrapper, handle);

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(wrapper.style.getPropertyValue('--qoderian-input-wrapper-height'))
      .toBe(`${200 + COMPOSER_KEYBOARD_RESIZE_STEP}px`);

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(wrapper.classList.contains('qoderian-input-wrapper--resized')).toBe(false);

    controller.destroy();
    container.remove();
  });
});

function createHarness(viewHeight: number, wrapperHeight: number): {
  container: HTMLElement;
  wrapper: HTMLElement;
  handle: HTMLElement;
} {
  const container = document.createElement('div');
  const wrapper = document.createElement('div');
  const handle = document.createElement('div');
  container.classList.add('qoderian-container');
  wrapper.classList.add('qoderian-input-wrapper');
  wrapper.appendChild(handle);
  container.appendChild(wrapper);
  document.body.appendChild(container);

  Object.defineProperty(container, 'clientHeight', { configurable: true, value: viewHeight });
  Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: wrapperHeight });
  wrapper.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: wrapperHeight,
    left: 0,
    width: 0,
    height: wrapperHeight,
    toJSON: () => {},
  });

  return { container, wrapper, handle };
}
