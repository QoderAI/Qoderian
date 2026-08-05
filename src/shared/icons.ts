import qoderIconSvg from '../assets/qoder-icon.svg';
import type { IconSvg, SvgChild } from '../core/types/services';

export const MCP_ICON_SVG = `<svg fill="currentColor" fill-rule="evenodd" height="1em" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>MCP</title><path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z"></path><path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z"></path></svg>`;

export const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MCP_ICON_PATHS = [
  'M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z',
  'M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z',
];

function createSvgElement(ownerDocument: Document, tagName: string): SVGElement {
  return ownerDocument.createElementNS(SVG_NS, tagName);
}

export function appendMcpIcon(container: HTMLElement): void {
  container.empty();

  const svg = createSvgElement(container.ownerDocument, 'svg');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('height', '1em');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');

  const title = createSvgElement(container.ownerDocument, 'title');
  title.textContent = 'MCP';
  svg.appendChild(title);

  for (const pathData of MCP_ICON_PATHS) {
    const path = createSvgElement(container.ownerDocument, 'path');
    path.setAttribute('d', pathData);
    svg.appendChild(path);
  }

  container.appendChild(svg);
}

export function appendCheckIcon(container: HTMLElement): void {
  container.empty();

  const svg = createSvgElement(container.ownerDocument, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const polyline = createSvgElement(container.ownerDocument, 'polyline');
  polyline.setAttribute('points', '20 6 9 17 4 12');
  svg.appendChild(polyline);

  container.appendChild(svg);
}


export const QODER_ICON: IconSvg = {
  kind: 'raw',
  viewBox: '0 0 180 180',
  svg: qoderIconSvg,
};

export const QODERIAN_ICON_ID = 'qoderian-logo';

// Obsidian draws registered icons inside a `0 0 100 100` viewport, so the mark
// of the 180x180 app artwork (bounding box 32.4..147.6 x 30.2..148.4) is
// re-centered and scaled down to leave the padding ribbon icons expect.
const QODER_MARK_TRANSFORM = 'translate(-14.8 -14.29) scale(0.72)';
// `addIcon` takes markup as a string and the artwork is a build-time asset, so
// the mark paths are lifted textually instead of through a DOM round-trip.
const QODER_MARK_PATH_PATTERN = /<path[^>]*\sd="([^"]+)"/g;
// Ribbon and tab icons follow a single theme color, so the artwork's white
// front ring and green extruded body both become `currentColor`. Drawing them
// at the same strength collapses the mark into one blob, so the body behind
// the ring is dimmed to keep the depth the two-tone original conveys.
const QODER_MARK_BODY_OPACITY = '0.32';

export function createQoderianIconContent(sourceSvg: string = qoderIconSvg): string {
  // The artwork draws the extruded body first and the front ring second; that
  // order is preserved so the ring stays on top of the dimmed body.
  const paths = Array.from(sourceSvg.matchAll(QODER_MARK_PATH_PATTERN))
    .map(([, pathData], index) => (index === 0
      ? `<path opacity="${QODER_MARK_BODY_OPACITY}" d="${pathData}"/>`
      : `<path d="${pathData}"/>`))
    .join('');

  return `<g transform="${QODER_MARK_TRANSFORM}" fill="currentColor">${paths}</g>`;
}

export interface CreateIconSvgOptions {
  className?: string;
  height?: number | string;
  ownerDocument?: Document;
  width?: number | string;
}

export function createIconSvg(
  icon: IconSvg,
  options: CreateIconSvgOptions = {},
): SVGElement {
  const ownerDocument = options.ownerDocument ?? window.document;
  const svg = ownerDocument.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', icon.viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('qoderian-icon');

  if (options.width !== undefined) {
    svg.setAttribute('width', String(options.width));
  }
  if (options.height !== undefined) {
    svg.setAttribute('height', String(options.height));
  }
  if (options.className) {
    svg.classList.add(...options.className.split(/\s+/).filter(Boolean));
  }
  if (icon.kind === 'raw') {
    const template = ownerDocument.createElement('template');
    template.innerHTML = icon.svg.trim();
    const sourceSvg = template.content.querySelector('svg');
    if (sourceSvg) {
      for (const child of Array.from(sourceSvg.children)) {
        const clone = child.cloneNode(true) as SVGElement;
        // The source artwork is an app-icon variant with a dark rounded-square
        // backdrop. In a compact model selector that backdrop turns into the
        // grey block seen on every option, so keep only the Qoder mark.
        if (clone.tagName.toLowerCase() === 'g') {
          clone.querySelector(':scope > rect')?.remove();
        }
        svg.appendChild(clone);
      }
    }
    return svg;
  }

  if (icon.kind === 'composite') {
    for (const child of icon.children) {
      svg.appendChild(createSvgChild(child, ownerDocument));
    }
    return svg;
  }

  const path = ownerDocument.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', icon.path);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function createSvgChild(child: SvgChild, ownerDocument: Document): SVGElement {
  const element = ownerDocument.createElementNS(SVG_NS, child.tag);
  for (const [name, value] of Object.entries(child.attributes)) {
    element.setAttribute(name, value);
  }

  if (child.tag === 'g') {
    for (const nestedChild of child.children) {
      element.appendChild(createSvgChild(nestedChild, ownerDocument));
    }
  }

  return element;
}
