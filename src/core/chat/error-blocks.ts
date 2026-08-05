import type { ChatMessage, ContentBlock } from '../types';

export interface ChatErrorInput {
  content: string;
  /** Machine-readable SDK/runtime code when one is available. */
  code?: string;
}

export interface ErrorReconcileResult {
  changed: boolean;
  replacedText: boolean;
}

function normalizeErrorContent(content: string): string {
  return content.trim();
}

/** Stable within a turn; formatting-only differences do not create duplicate errors. */
export function getErrorFingerprint(content: string): string {
  return normalizeErrorContent(content)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isErrorCodeOnly(content: string): boolean {
  const normalized = normalizeErrorContent(content);
  return normalized.length > 0
    && normalized.length <= 80
    && !/\s/.test(normalized)
    && /^[a-z0-9][a-z0-9_.:-]*$/i.test(normalized);
}

function removeDisplayedText(message: ChatMessage, removedBlocks: ContentBlock[]): void {
  let content = message.content;
  for (const block of removedBlocks) {
    if (block.type !== 'text' || !block.content) continue;
    const index = content.indexOf(block.content);
    if (index >= 0) {
      content = content.slice(0, index) + content.slice(index + block.content.length);
    } else if (getErrorFingerprint(content) === getErrorFingerprint(block.content)) {
      content = '';
    }
  }
  message.content = content;
}

/**
 * Per-turn error presentation state. It records fingerprints for already displayed
 * assistant text and formal error blocks, then reconciles later error sources.
 */
export class TurnErrorAccumulator {
  private readonly displayedTextFingerprints = new Map<string, number>();
  private readonly errorFingerprints = new Set<string>();

  constructor(message?: ChatMessage) {
    if (message) this.refresh(message);
  }

  reconcile(message: ChatMessage, input: ChatErrorInput): ErrorReconcileResult {
    const content = normalizeErrorContent(input.content);
    if (!content) {
      return { changed: false, replacedText: false };
    }

    message.contentBlocks = message.contentBlocks || [];
    this.refresh(message);

    const blocks = message.contentBlocks;
    const fingerprint = getErrorFingerprint(content);
    const hasMatchingDisplayedText = this.displayedTextFingerprints.has(fingerprint);
    const hasMatchingError = this.errorFingerprints.has(fingerprint);
    const matchingTextIndexes: number[] = [];
    const matchingErrorIndexes: number[] = [];

    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (
        hasMatchingDisplayedText
        && block.type === 'text'
        && getErrorFingerprint(block.content) === fingerprint
      ) {
        matchingTextIndexes.push(index);
      } else if (
        hasMatchingError
        && block.type === 'error'
        && getErrorFingerprint(block.content) === fingerprint
      ) {
        matchingErrorIndexes.push(index);
      }
    }

    const readableContent = !isErrorCodeOnly(content);
    const replaceableCodeIndex = readableContent
      ? blocks.findIndex(block => block.type === 'error' && isErrorCodeOnly(block.content))
      : -1;
    const inheritedCodeBlock = replaceableCodeIndex >= 0 ? blocks[replaceableCodeIndex] : undefined;
    const inheritedCode = inheritedCodeBlock?.type === 'error'
      ? (inheritedCodeBlock.code ?? inheritedCodeBlock.content)
      : undefined;
    const existingMatchingError = matchingErrorIndexes.length > 0
      ? blocks[matchingErrorIndexes[0]]
      : undefined;
    const existingCode = existingMatchingError?.type === 'error' ? existingMatchingError.code : undefined;
    const code = input.code ?? existingCode ?? inheritedCode;
    const replacement: ContentBlock = {
      type: 'error',
      content,
      ...(code ? { code } : {}),
    };

    const primaryIndex = matchingTextIndexes[0]
      ?? matchingErrorIndexes[0]
      ?? (replaceableCodeIndex >= 0 ? replaceableCodeIndex : blocks.length);
    const removedIndexes = new Set([...matchingTextIndexes, ...matchingErrorIndexes]);
    if (replaceableCodeIndex >= 0) {
      removedIndexes.add(replaceableCodeIndex);
    }

    const removedTextBlocks = matchingTextIndexes.map(index => blocks[index]);
    const nextBlocks: ContentBlock[] = [];
    for (let index = 0; index <= blocks.length; index++) {
      if (index === primaryIndex) {
        nextBlocks.push(replacement);
      }
      if (index === blocks.length || removedIndexes.has(index)) continue;
      nextBlocks.push(blocks[index]);
    }

    const wasAlreadyCanonical = matchingTextIndexes.length === 0
      && replaceableCodeIndex < 0
      && matchingErrorIndexes.length === 1
      && existingMatchingError?.type === 'error'
      && existingMatchingError.content === replacement.content
      && existingMatchingError.code === replacement.code;

    if (wasAlreadyCanonical) {
      return { changed: false, replacedText: false };
    }

    message.contentBlocks = nextBlocks;
    removeDisplayedText(message, removedTextBlocks);
    this.refresh(message);
    return { changed: true, replacedText: matchingTextIndexes.length > 0 };
  }

  private refresh(message: ChatMessage): void {
    this.displayedTextFingerprints.clear();
    this.errorFingerprints.clear();

    for (const block of message.contentBlocks || []) {
      if (block.type === 'text') {
        const fingerprint = getErrorFingerprint(block.content);
        if (fingerprint) {
          this.displayedTextFingerprints.set(
            fingerprint,
            (this.displayedTextFingerprints.get(fingerprint) ?? 0) + 1,
          );
        }
      } else if (block.type === 'error') {
        const fingerprint = getErrorFingerprint(block.content);
        if (fingerprint) this.errorFingerprints.add(fingerprint);
      }
    }
  }
}

export function hasErrorContentBlock(message: Pick<ChatMessage, 'contentBlocks'>): boolean {
  return message.contentBlocks?.some(block => block.type === 'error') === true;
}
