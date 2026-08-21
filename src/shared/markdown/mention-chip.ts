/**
 * Qoderian - Mention Chip Utilities
 *
 * Replaces `@path` reference tokens in user message markdown with inline
 * chip HTML before MarkdownRenderer processes the content. Mirrors the
 * composer reference chips so sent bubbles match what the user typed.
 *
 * Note: This is display-only - the agent still receives the raw `@path` text.
 */

import type { App, TAbstractFile } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import type { ReferenceChipKind } from '../mention/types';
import { escapeHtml } from './html';

/** Trailing punctuation stripped from a candidate token before vault lookup. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}"'”»›）》」』】…]+$/;

/** Code fences and inline code are skipped so snippets keep their raw text. */
const CODE_SEGMENTS = /(```[\s\S]*?(?:```|$)|`[^`\n]+`)/g;

export interface MentionCandidate {
  /** Token text including the leading `@` (before punctuation stripping). */
  raw: string;
  /** Path to look up in the vault (no `@`, no trailing slash/punctuation). */
  path: string;
  /** True when the raw token ended with a folder slash. */
  hasTrailingSlash: boolean;
  start: number;
  end: number;
}

/**
 * Formats a chip label from a path: the basename, truncated with an ellipsis.
 * Shared with the live composer so both surfaces show identical labels.
 */
export function formatReferenceLabel(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  const basename = segments[segments.length - 1] || path;
  const characters = Array.from(basename);
  return characters.length > 20
    ? `${characters.slice(0, 20).join('')}…`
    : basename;
}

function isTokenBoundary(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/** Finds `@path` candidates outside code spans; verification is left to the caller. */
export function findMentionCandidates(text: string): MentionCandidate[] {
  const candidates: MentionCandidate[] = [];
  const segments = text.split(CODE_SEGMENTS);
  let offset = 0;
  let isCodeSegment = false;

  for (const segment of segments) {
    if (!isCodeSegment) {
      collectSegmentCandidates(segment, offset, candidates);
    }
    offset += segment.length;
    isCodeSegment = !isCodeSegment;
  }

  return candidates;
}

function collectSegmentCandidates(
  segment: string,
  segmentOffset: number,
  candidates: MentionCandidate[],
): void {
  for (let index = 0; index < segment.length; index++) {
    if (segment[index] !== '@') continue;
    if (!isTokenBoundary(segment[index - 1])) continue;

    let end = index + 1;
    while (end < segment.length && !/\s/.test(segment[end])) {
      end++;
    }
    const raw = segment.slice(index, end);
    if (raw.length <= 1) continue;

    const stripped = raw.slice(1).replace(TRAILING_PUNCTUATION, '');
    if (stripped.length === 0) continue;

    const hasTrailingSlash = stripped.endsWith('/');
    const path = hasTrailingSlash ? stripped.slice(0, -1) : stripped;
    if (!path) continue;

    candidates.push({
      raw: stripped,
      path,
      hasTrailingSlash,
      start: segmentOffset + index,
      // +1 covers the leading `@` that `stripped` no longer includes.
      end: segmentOffset + index + stripped.length + 1,
    });

    index = end - 1;
  }
}

function createChipHtml(path: string, kind: ReferenceChipKind): string {
  const label = escapeHtml(formatReferenceLabel(path));
  const escapedPath = escapeHtml(path);
  const title = escapeHtml(`@${path}${kind === 'folder' ? '/' : ''}`);
  return (
    `<span class="qoderian-composer-reference qoderian-msg-reference"`
    + ` data-kind="${kind}" data-path="${escapedPath}" title="${title}">`
    + `<span class="qoderian-composer-reference-icon"></span>`
    + `<span class="qoderian-composer-reference-label">${label}</span>`
    + `</span>`
  );
}

/**
 * Call before MarkdownRenderer.render(). Every `@path` token that resolves to
 * an existing vault file or folder becomes a chip; unknown tokens and code
 * spans pass through unchanged.
 */
export function replaceMentionTokensWithHtml(markdown: string, app: App): string {
  if (!app?.vault || !markdown.includes('@')) {
    return markdown;
  }

  const candidates = findMentionCandidates(markdown);
  if (candidates.length === 0) {
    return markdown;
  }

  const chunks: string[] = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;

    let resolved: TAbstractFile | null = null;
    try {
      resolved = app.vault.getAbstractFileByPath(candidate.path);
    } catch {
      // Vault lookup failures leave the token untouched.
    }
    const kind: ReferenceChipKind | null = resolved instanceof TFolder
      ? 'folder'
      : resolved instanceof TFile
        ? 'file'
        : null;
    if (!kind || !resolved) {
      continue;
    }

    chunks.push(markdown.slice(cursor, candidate.start));
    chunks.push(createChipHtml(candidate.path, kind));
    cursor = candidate.end;
  }
  if (chunks.length === 0) {
    return markdown;
  }

  chunks.push(markdown.slice(cursor));
  return chunks.join('');
}
