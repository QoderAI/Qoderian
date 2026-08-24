import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { t } from '@/i18n/i18n';
import type { MentionInsertReference } from '@/shared/mention/types';

/** A vault file or folder reference extracted from an Obsidian drag payload. */
export interface VaultDropReference {
  path: string;
  kind: 'file' | 'folder';
}

export interface VaultDropOptions {
  /** Called for every inserted reference so consumers can chipify it. */
  onInsertReference?: (reference: MentionInsertReference) => void;
}

interface DragManagerHost {
  dragManager?: unknown;
}

/**
 * Accepts Obsidian file-explorer drags on the composer and inserts them as
 * `@path` / `@path/ ` mention tokens at the caret position.
 *
 * Must be attached before ImageContextManager so vault drags can be claimed
 * via stopImmediatePropagation before the image drop handlers run. The drop
 * listener runs in the capture phase so inner editors (CodeMirror) never see
 * vault drops and cannot paste the OS-level `obsidian://` URI payload.
 */
export class VaultDropController {
  private readonly dropOverlayEl: HTMLElement;
  private readonly onInsertReference?: (reference: MentionInsertReference) => void;

  constructor(
    private readonly app: App,
    private readonly inputWrapperEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
    options: VaultDropOptions = {},
  ) {
    this.onInsertReference = options.onInsertReference;
    this.dropOverlayEl = this.createDropOverlay();
    this.inputWrapperEl.addEventListener('dragenter', this.handleDragEnter);
    this.inputWrapperEl.addEventListener('dragover', this.handleDragOver);
    this.inputWrapperEl.addEventListener('dragleave', this.handleDragLeave);
    this.inputWrapperEl.addEventListener('drop', this.handleDrop, true);
  }

  destroy(): void {
    this.inputWrapperEl.removeEventListener('dragenter', this.handleDragEnter);
    this.inputWrapperEl.removeEventListener('dragover', this.handleDragOver);
    this.inputWrapperEl.removeEventListener('dragleave', this.handleDragLeave);
    this.inputWrapperEl.removeEventListener('drop', this.handleDrop, true);
    this.dropOverlayEl.remove();
  }

  private readonly handleDragEnter = (event: DragEvent): void => {
    if (this.getDraggedReferences().length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dropOverlayEl.addClass('visible');
  };

  private readonly handleDragOver = (event: DragEvent): void => {
    if (this.getDraggedReferences().length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    if (this.getDraggedReferences().length === 0) return;
    event.stopImmediatePropagation();

    const rect = this.inputWrapperEl.getBoundingClientRect();
    if (
      event.clientX <= rect.left ||
      event.clientX >= rect.right ||
      event.clientY <= rect.top ||
      event.clientY >= rect.bottom
    ) {
      this.dropOverlayEl.removeClass('visible');
    }
  };

  private readonly handleDrop = (event: DragEvent): void => {
    const references = this.getDraggedReferences();
    if (references.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dropOverlayEl.removeClass('visible');

    const newReferences = references.filter((reference) => !this.inputContainsReference(reference));
    if (newReferences.length > 0) {
      this.insertReferences(newReferences);
      for (const reference of newReferences) {
        this.onInsertReference?.({
          token: this.mentionToken(reference),
          path: reference.path,
          kind: reference.kind,
        });
      }
      this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.inputEl.focus();
  };

  private getDraggedItems(): unknown[] {
    const host = this.app as unknown as DragManagerHost;
    const dragManager = host.dragManager;
    if (!this.isRecord(dragManager)) return [];

    const draggable = dragManager.draggable;
    if (!this.isRecord(draggable)) return [];

    return draggable.type === 'files' && Array.isArray(draggable.files)
      ? draggable.files
      : draggable.file
        ? [draggable.file]
        : [];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private getDraggedReferences(): VaultDropReference[] {
    const references: VaultDropReference[] = [];
    const seenPaths = new Set<string>();
    for (const item of this.getDraggedItems()) {
      const reference =
        item instanceof TFolder && item.path !== '/' && item.path !== ''
          ? { path: item.path, kind: 'folder' as const }
          : item instanceof TFile && item.extension.toLowerCase() === 'md'
            ? { path: item.path, kind: 'file' as const }
            : null;
      if (!reference || seenPaths.has(reference.path)) continue;
      seenPaths.add(reference.path);
      references.push(reference);
    }
    return references;
  }

  private mentionToken(reference: VaultDropReference): string {
    return `@${reference.path}${reference.kind === 'folder' ? '/' : ''}`;
  }

  private inputContainsReference(reference: VaultDropReference): boolean {
    const escapedToken = this.mentionToken(reference).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escapedToken}(?=\\s|$)`).test(this.inputEl.value);
  }

  private insertReferences(references: readonly VaultDropReference[]): void {
    const caret = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const before = this.inputEl.value.slice(0, caret);
    const after = this.inputEl.value.slice(caret);
    const tokens = references.map((reference) => this.mentionToken(reference)).join(' ');
    const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const suffix = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
    this.inputEl.value = `${before}${prefix}${tokens} ${suffix}${after}`;
    const newCaret = (before + prefix + tokens + ' ').length;
    this.inputEl.setSelectionRange(newCaret, newCaret);
  }

  private createDropOverlay(): HTMLElement {
    const overlayEl = this.inputWrapperEl.createDiv({ cls: 'qoderian-vault-drop-overlay' });
    const contentEl = overlayEl.createDiv({ cls: 'qoderian-vault-drop-content' });
    const svg = contentEl.createSvg('svg', {
      attr: {
        viewBox: '0 0 24 24',
        width: '32',
        height: '32',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
      },
    });
    // paperclip icon
    svg.createSvg('path', {
      attr: {
        d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
      },
    });
    contentEl.createSpan({ text: t('chat.drop.context') });
    return overlayEl;
  }
}
