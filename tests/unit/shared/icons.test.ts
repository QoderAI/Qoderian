import { createQoderianIconContent, QODERIAN_ICON_ID } from '@/shared/icons';

const SOURCE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">`
  + `<defs><clipPath id="mask"><rect x="0" y="0" width="180" height="180" rx="40"/></clipPath></defs>`
  + `<g clip-path="url(#mask)"><rect x="0" y="0" width="180" height="180" fill="#111113"/>`
  + `<path d="M10 20 L30 40 Z" fill="#2ADB5C"/><path d="M50 60 L70 80 Z" fill="#FFFFFF"/></g></svg>`;

describe('createQoderianIconContent', () => {
  it('keeps only the mark paths, dropping the artwork backdrop and clip ids', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content).toContain('d="M10 20 L30 40 Z"');
    expect(content).toContain('<path d="M50 60 L70 80 Z"/>');
    expect(content).not.toContain('rect');
    expect(content).not.toContain('clip-path');
  });

  it('renders the mark in one theme color, dimming the body behind the front ring', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content).toContain('fill="currentColor"');
    expect(content).toContain('<path opacity="0.32" d="M10 20 L30 40 Z"/>');
    expect(content).toMatch(/transform="translate\([-\d. ]+\) scale\(0?\.\d+\)"/);
    expect(content).not.toContain('#2ADB5C');
    expect(content).not.toContain('#FFFFFF');
  });

  it('draws the front ring after the body so it stays on top', () => {
    const content = createQoderianIconContent(SOURCE_SVG);

    expect(content.indexOf('M10 20')).toBeLessThan(content.indexOf('M50 60'));
  });

  it('exposes a stable icon id for ribbon and view registration', () => {
    expect(QODERIAN_ICON_ID).toBe('qoderian-logo');
  });
});
