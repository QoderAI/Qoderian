/**
 * Pure reference-matching logic for the live composer.
 *
 * A reference is a token inserted into the composer text by the mention
 * dropdown (e.g. `@folder/note.md` or `@folder/`). The composer renders
 * matching tokens as inline chips, while the text itself remains the single
 * source of truth that gets sent to the agent.
 */

export type ComposerReferenceKind = 'file' | 'folder';

export interface ComposerReference {
  /** Full token text including the leading `@`; folders keep the trailing slash. */
  token: string;
  /** Path used for the chip label and open actions. */
  path: string;
  kind: ComposerReferenceKind;
}

export interface ComposerReferenceRange {
  reference: ComposerReference;
  from: number;
  to: number;
}

export const COMPOSER_REFERENCE_LABEL_MAX_LENGTH = 20;

// Label formatting is shared with message-bubble chips; re-export for composer consumers.
export { formatReferenceLabel } from '../../../../shared/markdown/mention-chip';

function isTokenBoundary(text: string, index: number): boolean {
  return index <= 0 || index >= text.length || /\s/.test(text[index]);
}

/**
 * Finds every occurrence of a known reference token in the text.
 * Occurrences only count when surrounded by token boundaries (whitespace or
 * the start/end of the text), so a token inside a longer word is ignored.
 */
export function findReferenceRanges(
  text: string,
  references: readonly ComposerReference[],
): ComposerReferenceRange[] {
  const ranges: ComposerReferenceRange[] = [];
  for (const reference of references) {
    if (!reference.token) continue;
    let from = text.indexOf(reference.token);
    while (from >= 0) {
      const to = from + reference.token.length;
      if (isTokenBoundary(text, from - 1) && isTokenBoundary(text, to)) {
        ranges.push({ reference, from, to });
      }
      from = text.indexOf(reference.token, from + reference.token.length);
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return ranges;
}

export interface AtomicDeleteQuery {
  key: 'Backspace' | 'Delete';
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Returns the reference range an atomic delete should remove as a whole,
 * or null when the deletion does not touch a reference chip.
 *
 * - Empty selection: Backspace removes the chip ending at the caret;
 *   Delete removes the chip starting at the caret.
 * - Range selection: any chip overlapping the selection is removed.
 */
export function findAtomicDeleteRange(
  text: string,
  references: readonly ComposerReference[],
  query: AtomicDeleteQuery,
): ComposerReferenceRange | null {
  const { key, selectionFrom, selectionTo } = query;
  const selectionEmpty = selectionFrom === selectionTo;
  return findReferenceRanges(text, references).find(range => {
    if (!selectionEmpty) {
      return selectionFrom < range.to && selectionTo > range.from;
    }
    return key === 'Backspace'
      ? selectionFrom === range.to
      : selectionFrom === range.from;
  }) ?? null;
}
