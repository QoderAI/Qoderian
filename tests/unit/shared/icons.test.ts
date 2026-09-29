import { createQoderianIconContent, QODERIAN_ICON_ID } from '@/shared/icons';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" fill="none">`
  + `<path fill-rule="evenodd" clip-rule="evenodd" d="M10 20 L30 40 Z" fill="currentColor"/>`
  + `<path fill="none" stroke="currentColor" stroke-width="1.7" d="M50 60 L70 80 Z"/></svg>`;

describe('createQoderianIconContent', () => {
  it('lifts the mark paths verbatim, keeping their paint attributes', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content).toContain('<path fill-rule="evenodd" clip-rule="evenodd" d="M10 20 L30 40 Z" fill="currentColor"/>');
    expect(content).toContain('<path fill="none" stroke="currentColor" stroke-width="1.7" d="M50 60 L70 80 Z"/>');
    expect(content).not.toContain('rect');
    expect(content).not.toContain('clip-path');
  });

  it('renders the mark in one theme color inside the ribbon viewport', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content).toContain('fill="currentColor"');
    expect(content).toContain('stroke="currentColor"');
    expect(content).toMatch(/^<g transform="translate\(-[\d.]+ -[\d.]+\) scale\([\d.]+\)"?>/);
  });

  it('draws the filled body before the outlined contour', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content.indexOf('M10 20')).toBeLessThan(content.indexOf('M50 60'));
  });

  it('exposes a stable icon id for ribbon and view registration', () => {
    expect(QODERIAN_ICON_ID).toBe('qoderian-logo');
  });
});
