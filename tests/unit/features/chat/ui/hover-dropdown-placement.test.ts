import { createMockEl } from '@test/helpers/mock-element';

import { positionHoverDropdown } from '@/features/chat/ui/input-toolbar';
import {
  HOVER_DROPDOWN_EDGE_INSET,
  placeHoverDropdown,
} from '@/features/chat/ui/toolbar/hover-dropdown-placement';

describe('placeHoverDropdown', () => {
  it('centers on the icon when the dropdown fits', () => {
    const placement = placeHoverDropdown(200, 280, 600);
    expect(placement).toEqual({ center: 200, maxWidth: null });
  });

  it('clamps the center at the leading edge', () => {
    const placement = placeHoverDropdown(80, 320, 600);
    expect(placement).toEqual({ center: HOVER_DROPDOWN_EDGE_INSET + 160, maxWidth: null });
  });

  it('clamps the center at the trailing edge', () => {
    const placement = placeHoverDropdown(560, 320, 600);
    expect(placement).toEqual({ center: 600 - HOVER_DROPDOWN_EDGE_INSET - 160, maxWidth: null });
  });

  it('treats an exact fit at both insets as fitting', () => {
    const toolbarWidth = 320 + HOVER_DROPDOWN_EDGE_INSET * 2;
    const placement = placeHoverDropdown(135, 320, toolbarWidth);
    expect(placement).toEqual({ center: HOVER_DROPDOWN_EDGE_INSET + 160, maxWidth: null });
  });

  it('caps the width and centers when the toolbar is barely narrower than the dropdown', () => {
    const placement = placeHoverDropdown(135, 320, 324);
    expect(placement).toEqual({ center: 162, maxWidth: 324 - HOVER_DROPDOWN_EDGE_INSET * 2 });
  });

  it('caps the width down to the inset-bounded space in a narrow sidebar', () => {
    const placement = placeHoverDropdown(135, 320, 300);
    expect(placement).toEqual({ center: 150, maxWidth: 284 });
  });

  it('still centers symmetrically when wider than the whole toolbar', () => {
    const placement = placeHoverDropdown(135, 320, 200);
    expect(placement).toEqual({ center: 100, maxWidth: 184 });
  });

  it('centers symmetrically when the toolbar is smaller than the insets', () => {
    const placement = placeHoverDropdown(135, 320, 12);
    expect(placement).toEqual({ center: 6, maxWidth: null });
  });

  it('returns null for unusable measurements', () => {
    expect(placeHoverDropdown(Number.NaN, 320, 600)).toBeNull();
    expect(placeHoverDropdown(200, Number.NaN, 600)).toBeNull();
    expect(placeHoverDropdown(200, 320, Number.NaN)).toBeNull();
    expect(placeHoverDropdown(200, 0, 600)).toBeNull();
    expect(placeHoverDropdown(200, 320, 0)).toBeNull();
  });
});

describe('positionHoverDropdown', () => {
  interface RectInit {
    left: number;
    width: number;
  }

  const rect = ({ left, width }: RectInit) => ({
    top: 0,
    left,
    width,
    height: 40,
    right: left + width,
    bottom: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });

  function createTree(toolbar: RectInit, icon: RectInit, dropdownWidth: number) {
    const toolbarEl = createMockEl();
    const selectorEl = createMockEl();
    const iconEl = createMockEl();
    const dropdownEl = createMockEl();

    toolbarEl.getBoundingClientRect = () => rect(toolbar);
    selectorEl.getBoundingClientRect = () => rect({ left: icon.left, width: icon.width });
    iconEl.getBoundingClientRect = () => rect(icon);
    dropdownEl.getBoundingClientRect = () => rect({ left: 0, width: dropdownWidth });
    selectorEl.closest = () => toolbarEl;

    return { toolbarEl, selectorEl, iconEl, dropdownEl };
  }

  it('keeps the dropdown centered on the icon in a wide toolbar', () => {
    const { selectorEl, iconEl, dropdownEl } = createTree(
      { left: 0, width: 600 },
      { left: 188, width: 24 },
      280,
    );

    positionHoverDropdown(selectorEl, iconEl, dropdownEl);

    expect(dropdownEl.style['--qoderian-hover-dropdown-left']).toBe('12px');
    expect(dropdownEl.style['--qoderian-hover-dropdown-max-width']).toBe('');
    expect(dropdownEl.style['--qoderian-hover-dropdown-min-width']).toBe('');
  });

  it('shifts the dropdown inwards when the icon sits near the leading edge', () => {
    const { selectorEl, iconEl, dropdownEl } = createTree(
      { left: 100, width: 324 },
      { left: 223, width: 24 },
      320,
    );

    positionHoverDropdown(selectorEl, iconEl, dropdownEl);

    // Center 162 relative to the toolbar -> 39px relative to the selector.
    expect(dropdownEl.style['--qoderian-hover-dropdown-left']).toBe('39px');
    expect(dropdownEl.style['--qoderian-hover-dropdown-max-width']).toBe('308px');
    expect(dropdownEl.style['--qoderian-hover-dropdown-min-width']).toBe('0');
  });

  it('releases a stale width cap once the toolbar fits the natural width again', () => {
    const { selectorEl, iconEl, dropdownEl } = createTree(
      { left: 0, width: 600 },
      { left: 188, width: 24 },
      280,
    );
    dropdownEl.style['--qoderian-hover-dropdown-min-width'] = '0';
    dropdownEl.style['--qoderian-hover-dropdown-max-width'] = '200px';

    positionHoverDropdown(selectorEl, iconEl, dropdownEl);

    expect(dropdownEl.style['--qoderian-hover-dropdown-min-width']).toBe('');
    expect(dropdownEl.style['--qoderian-hover-dropdown-max-width']).toBe('');
  });

  it('skips layout-less shims that cannot report a toolbar rect', () => {
    const selectorEl = createMockEl();
    const iconEl = createMockEl();
    const dropdownEl = createMockEl();

    expect(() => positionHoverDropdown(selectorEl, iconEl, dropdownEl)).not.toThrow();
    expect(dropdownEl.style['--qoderian-hover-dropdown-left']).toBeUndefined();
  });
});
