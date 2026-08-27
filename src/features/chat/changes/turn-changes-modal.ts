import type { App } from 'obsidian';
import { FileSystemAdapter, Modal, normalizePath } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { renderDiffContent, renderDiffStats } from '../rendering/diff-renderer';
import type { TurnChangesSummary, TurnFileChange, TurnFileDiff } from './turn-file-changes';

export class TurnChangesModal extends Modal {
  private selectedFile: TurnFileChange;

  constructor(app: App, private readonly changes: TurnChangesSummary) {
    super(app);
    this.selectedFile = changes.files[0];
  }

  onOpen(): void {
    this.modalEl.addClass('qoderian-turn-changes-modal');
    this.preventBackgroundClose();
    this.scope.register([], 'Escape', () => false);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    const header = this.contentEl.createDiv({ cls: 'qoderian-turn-changes-header' });
    header.createEl('h2', { text: t('chat.changes.title') });
    const summary = header.createDiv({ cls: 'qoderian-turn-changes-summary' });
    summary.createSpan({ text: t('chat.changes.files', { count: this.changes.files.length }) });
    renderDiffStats(summary, this.changes.stats);

    const body = this.contentEl.createDiv({ cls: 'qoderian-turn-changes-body' });
    const fileList = body.createDiv({ cls: 'qoderian-turn-changes-files' });
    for (const file of this.changes.files) {
      const button = fileList.createEl('button', {
        cls: `qoderian-turn-changes-file${file === this.selectedFile ? ' is-selected' : ''}`,
        attr: {
          'aria-current': file === this.selectedFile ? 'true' : 'false',
          type: 'button',
        },
      });
      button.createSpan({ cls: 'qoderian-turn-changes-file-name', text: this.fileLabel(file) });
      const stats = button.createSpan({ cls: 'qoderian-turn-changes-file-stats' });
      renderDiffStats(stats, file.stats);
      button.addEventListener('click', () => {
        this.selectedFile = file;
        this.render();
      });
    }

    const detail = body.createDiv({ cls: 'qoderian-turn-changes-detail' });
    const detailHeader = detail.createDiv({ cls: 'qoderian-turn-changes-detail-header' });
    detailHeader.createSpan({ cls: 'qoderian-turn-changes-path', text: this.fileDisplayPath(this.selectedFile) });

    const diffList = detail.createDiv({ cls: 'qoderian-turn-changes-diffs' });
    this.selectedFile.diffs.forEach((diff, index) => {
      if (this.selectedFile.diffs.length > 1) {
        diffList.createDiv({
          cls: 'qoderian-turn-changes-edit-label',
          text: t('chat.changes.edit', { count: index + 1 }),
        });
      }
      const diffEl = diffList.createDiv({ cls: 'qoderian-diff-content' });
      this.renderFileDiff(diffEl, diff);
    });
  }

  private preventBackgroundClose(): void {
    const consumeOutsidePointer = (event: Event): void => {
      const target = event.target;
      if (target && !this.modalEl.contains(target as Node)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    this.containerEl.addEventListener('pointerdown', consumeOutsidePointer, true);
    this.containerEl.addEventListener('mousedown', consumeOutsidePointer, true);
    this.containerEl.addEventListener('click', consumeOutsidePointer, true);
  }

  private renderFileDiff(diffEl: HTMLElement, diff: TurnFileDiff): void {
    if (diff.operation === 'delete' && diff.diffLines.length === 0) {
      diffEl.createDiv({ cls: 'qoderian-diff-no-changes', text: t('chat.changes.deleted') });
      return;
    }
    if (diff.movedTo && diff.diffLines.length === 0) {
      diffEl.createDiv({
        cls: 'qoderian-diff-no-changes',
        text: t('chat.changes.renamed', { path: this.displayPath(diff.movedTo) }),
      });
      return;
    }
    renderDiffContent(diffEl, diff.diffLines, 3);
  }

  private toVaultRelativePath(filePath: string): string {
    const normalized = normalizePath(filePath);
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return normalized;

    const basePath = normalizePath(adapter.getBasePath());
    return normalized.startsWith(`${basePath}/`)
      ? normalized.slice(basePath.length + 1)
      : normalized;
  }

  private displayPath(filePath: string): string {
    const relativePath = this.toVaultRelativePath(filePath);
    return isAbsolutePath(relativePath) ? fileNameOnly(relativePath) : relativePath;
  }

  private fileLabel(file: TurnFileChange): string {
    const movedTo = latestMoveTarget(file);
    return movedTo
      ? `${fileNameOnly(file.filePath)} → ${fileNameOnly(movedTo)}`
      : fileNameOnly(file.filePath);
  }

  private fileDisplayPath(file: TurnFileChange): string {
    const movedTo = latestMoveTarget(file);
    return movedTo
      ? `${this.displayPath(file.filePath)} → ${this.displayPath(movedTo)}`
      : this.displayPath(file.filePath);
  }

}

function fileNameOnly(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

function latestMoveTarget(file: TurnFileChange): string | undefined {
  return [...file.diffs].reverse().find(diff => diff.movedTo)?.movedTo;
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath);
}
