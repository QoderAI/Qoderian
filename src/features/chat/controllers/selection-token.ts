/**
 * Selection tokens are the inline-chip surface for captured selections.
 *
 * Each selection kind maps to a distinct token shape so the composer, the
 * sent message text, and the bubble renderer can all recognize it:
 * - editor:   `@path/to/note.md#L10-15` (single line `#L10`)
 * - browser:  `@browser:<encodeURIComponent(title)>`
 * - canvas:   `@canvas:<encodeURIComponent(canvasPath)>`
 *
 * These are pure helpers so the token grammar stays unit-testable and the
 * controllers only orchestrate append/remove against the composer input.
 */

import type { ReferenceChipKind } from '../../../shared/mention/types';

const BROWSER_TITLE_MAX_LENGTH = 80;
const LABEL_MAX_LENGTH = 20;

/** Minimal input surface the token helpers write to (the hidden textarea). */
export interface SelectionTokenInput {
  value: string;
  dispatchEvent(event: Event): boolean;
}

/** Bridges a captured selection into the composer's inline-chip registry. */
export interface SelectionTokenSink {
  register(reference: SelectionTokenReference): void;
  unregister(token: string): void;
}

/** A composer reference token plus its chip presentation overrides. */
export interface SelectionTokenReference {
  token: string;
  path: string;
  kind: ReferenceChipKind;
  label?: string;
  icon?: string;
}

function truncate(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max ? characters.slice(0, max).join('') : text;
}

/** Last path segment, used for chip labels. */
export function basename(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  return segments[segments.length - 1] || path;
}

/** Truncates a chip label with an ellipsis, matching file-chip labels. */
export function truncateLabel(text: string, max: number = LABEL_MAX_LENGTH): string {
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, max).join('')}…`
    : text;
}

/** Builds the editor-selection token; omits the line fragment when unknown. */
export function buildEditorSelectionToken(
  path: string,
  fromLine?: number,
  toLine?: number,
): string {
  if (fromLine === undefined) return `@${path}`;
  if (toLine === undefined || toLine === fromLine) return `@${path}#L${fromLine}`;
  return `@${path}#L${fromLine}-${toLine}`;
}

/** Builds the browser-selection token from a (raw) page title. */
export function buildBrowserSelectionToken(title: string): string {
  return `@browser:${encodeURIComponent(truncate(title, BROWSER_TITLE_MAX_LENGTH))}`;
}

/** Builds the canvas-selection token from the canvas file's vault path. */
export function buildCanvasSelectionToken(canvasPath: string): string {
  return `@canvas:${encodeURIComponent(canvasPath)}`;
}

function dispatchInput(inputEl: SelectionTokenInput): void {
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Appends a token to the input text unless it is already present. */
export function appendSelectionToken(inputEl: SelectionTokenInput, token: string): void {
  if (!token) return;
  const current = inputEl.value;
  if (current.includes(token)) return;

  const trimmed = current.replace(/\s+$/, '');
  inputEl.value = trimmed.length === 0 ? token : `${trimmed} ${token}`;
  dispatchInput(inputEl);
}

/** Removes a token from the input text, tidying the surrounding whitespace. */
export function removeSelectionToken(inputEl: SelectionTokenInput, token: string): void {
  if (!token) return;
  const current = inputEl.value;
  if (!current.includes(token)) return;

  const next = current
    .split(token).join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+$/, '');
  inputEl.value = next;
  dispatchInput(inputEl);
}
