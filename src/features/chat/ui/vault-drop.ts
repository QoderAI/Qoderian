import { statSync } from 'fs';
import type { App } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';
import { fileURLToPath } from 'url';

import { t } from '@/i18n/i18n';
import type { MentionInsertReference } from '@/shared/mention/types';

import { imageMediaTypeForFilename } from './image-context';

/** A vault file or folder reference extracted from an Obsidian drag payload. */
export interface VaultDropReference {
  path: string;
  kind: 'file' | 'folder';
}

export interface VaultDropOptions {
  /** Called for every inserted reference so consumers can chipify it. */
  onInsertReference?: (reference: MentionInsertReference) => void;
  /** Called for OS-level (e.g. Finder) directories and files dropped on the composer. */
  onAddExternalContext?: (
    path: string,
    options?: { allowFile?: boolean },
  ) => { success: boolean; error?: string };
}

interface DragManagerHost {
  dragManager?: unknown;
}

/**
 * Accepts Obsidian file-explorer drags on the composer and inserts them as
 * `@path` / `@path/ ` mention tokens at the caret position. Notes, folders,
 * and images are accepted; anything else is ignored.
 *
 * Also claims OS-level (e.g. Finder) drags: directories and non-image files
 * are routed to external context, while image files are left to
 * ImageContextManager. Claiming these drags preventDefaults them so the
 * dropped file's content is never pasted into the input as plain text.
 *
 * Must be attached before ImageContextManager so vault drags can be claimed
 * via stopImmediatePropagation before the image drop handlers run. The drop
 * listener runs in the capture phase so inner editors (CodeMirror) never see
 * vault drops and cannot paste the OS-level `obsidian://` URI payload.
 */
export class VaultDropController {
  private readonly dropOverlayEl: HTMLElement;
  private readonly onInsertReference?: (reference: MentionInsertReference) => void;
  private readonly onAddExternalContext?: VaultDropOptions['onAddExternalContext'];
  private readonly viewWindow: Window | null;

  constructor(
    private readonly app: App,
    private readonly inputWrapperEl: HTMLElement,
    private readonly inputEl: HTMLTextAreaElement,
    options: VaultDropOptions = {},
  ) {
    this.onInsertReference = options.onInsertReference;
    this.onAddExternalContext = options.onAddExternalContext;
    this.dropOverlayEl = this.createDropOverlay();
    const viewWindow = this.inputWrapperEl.ownerDocument?.defaultView ?? null;
    this.viewWindow = viewWindow && typeof viewWindow.addEventListener === 'function'
      ? viewWindow
      : null;
    this.inputWrapperEl.addEventListener('dragenter', this.handleDragEnter);
    this.inputWrapperEl.addEventListener('dragover', this.handleDragOver);
    this.inputWrapperEl.addEventListener('dragleave', this.handleDragLeave);
    this.inputWrapperEl.addEventListener('drop', this.handleDrop, true);
    // Real OS drops can be swallowed by host-level drop interceptors before the
    // wrapper's capture listener runs; the window capture phase is the earliest
    // point in the propagation path, so claim them here too.
    this.viewWindow?.addEventListener('drop', this.handleDrop, true);
  }

  destroy(): void {
    this.inputWrapperEl.removeEventListener('dragenter', this.handleDragEnter);
    this.inputWrapperEl.removeEventListener('dragover', this.handleDragOver);
    this.inputWrapperEl.removeEventListener('dragleave', this.handleDragLeave);
    this.inputWrapperEl.removeEventListener('drop', this.handleDrop, true);
    this.viewWindow?.removeEventListener('drop', this.handleDrop, true);
    this.dropOverlayEl.remove();
  }

  private readonly handleDragEnter = (event: DragEvent): void => {
    if (!this.hasClaimableDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dropOverlayEl.addClass('visible');
  };

  private readonly handleDragOver = (event: DragEvent): void => {
    if (!this.hasClaimableDrag(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    if (!this.hasClaimableDrag(event)) return;
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
    if (!this.isDropWithinInput(event)) return;
    const { references, ignoredCount } = this.collectDragged();
    const osDrag = this.collectOsDrag(event);
    const claimsAnything =
      references.length > 0 ||
      osDrag.dirs.length > 0 ||
      osDrag.files.length > 0 ||
      osDrag.images > 0;
    if (!claimsAnything) return;

    event.preventDefault();
    // Image-only OS drags stay owned by ImageContextManager, which attaches them.
    if (osDrag.images === 0) {
      event.stopImmediatePropagation();
    }
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

    for (const dir of osDrag.dirs) {
      this.onAddExternalContext?.(dir);
    }
    for (const file of osDrag.files) {
      this.onAddExternalContext?.(file, { allowFile: true });
    }

    // Mixed drags are claimed wholesale, so surface the items we dropped.
    const unsupported = ignoredCount + osDrag.unreadable;
    if (unsupported > 0) {
      new Notice(t('chat.drop.ignored', { count: unsupported }));
    }
    this.inputEl.focus();
  };

  private hasClaimableDrag(event: DragEvent): boolean {
    if (this.collectDragged().references.length > 0) return true;
    return event.dataTransfer?.types.includes('Files') === true;
  }

  private isDropWithinInput(event: DragEvent): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
    if (path) return path.includes(this.inputWrapperEl);
    // Synthetic events (unit tests) without a propagation path are assumed local.
    return event.target == null;
  }

  /** OS-level (Finder) drag payload, split by what each subsystem owns. */
  private collectOsDrag(event: DragEvent): {
    dirs: string[];
    files: string[];
    images: number;
    unreadable: number;
  } {
    const result = { dirs: [] as string[], files: [] as string[], images: 0, unreadable: 0 };
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !dataTransfer.types.includes('Files')) return result;
    const uriPaths = this.uriListPaths(dataTransfer);

    const droppedFiles = Array.from(dataTransfer.files);
    droppedFiles.forEach((file, index) => {
      // Some Electron builds expose no File.path on drops; the OS also ships
      // the dragged paths as file:// URLs in text/uri-list, aligned by index.
      const filePath = (file as File & { path?: string }).path || uriPaths[index];
      if (!filePath) {
        result.unreadable += 1;
        return;
      }
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(filePath);
      } catch {
        result.unreadable += 1;
        return;
      }
      if (stats.isDirectory()) {
        result.dirs.push(filePath);
      } else if (stats.isFile()) {
        if (file.type.startsWith('image/') && imageMediaTypeForFilename(file.name) !== null) {
          result.images += 1;
        } else {
          result.files.push(filePath);
        }
      } else {
        result.unreadable += 1;
      }
    });
    return result;
  }

  private uriListPaths(dataTransfer: DataTransfer): string[] {
    let raw: string;
    try {
      raw = dataTransfer.getData('text/uri-list') || '';
    } catch {
      return [];
    }
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('file://'))
      .map((line) => {
        try {
          return fileURLToPath(line);
        } catch {
          return null;
        }
      })
      .filter((value): value is string => value !== null);
  }

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

  private collectDragged(): { references: VaultDropReference[]; ignoredCount: number } {
    const references: VaultDropReference[] = [];
    const seenPaths = new Set<string>();
    let ignoredCount = 0;
    for (const item of this.getDraggedItems()) {
      const reference =
        item instanceof TFolder && item.path !== '/' && item.path !== ''
          ? { path: item.path, kind: 'folder' as const }
          : item instanceof TFile &&
              (item.extension.toLowerCase() === 'md' ||
                imageMediaTypeForFilename(item.name) !== null)
            ? { path: item.path, kind: 'file' as const }
            : null;
      if (!reference) {
        ignoredCount += 1;
        continue;
      }
      if (seenPaths.has(reference.path)) continue;
      seenPaths.add(reference.path);
      references.push(reference);
    }
    return { references, ignoredCount };
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
