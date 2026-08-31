import type { App } from 'obsidian';
import { Modal } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { renderDiffContent, renderDiffStats } from '../rendering/diff-renderer';
import type { TurnChangesSummary, TurnFileChange, TurnFileDiff } from './turn-file-changes';
import { filePathName, turnFileDisplayPath, turnFileName } from './turn-file-path';

export class TurnChangesModal extends Modal {
  private selectedFile: TurnFileChange;

  constructor(app: App, private readonly changes: TurnChangesSummary) {
    super(app);
    this.selectedFile = changes.files[0];
  }

  onOpen(): void {
    this.modalEl.addClass('qoderian-turn-changes-modal');
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
      button.createSpan({ cls: 'qoderian-turn-changes-file-name', text: turnFileName(file) });
      const stats = button.createSpan({ cls: 'qoderian-turn-changes-file-stats' });
      renderDiffStats(stats, file.stats);
      button.addEventListener('click', () => {
        this.selectedFile = file;
        this.render();
      });
    }

    const detail = body.createDiv({ cls: 'qoderian-turn-changes-detail' });
    const detailHeader = detail.createDiv({ cls: 'qoderian-turn-changes-detail-header' });
    detailHeader.createSpan({
      cls: 'qoderian-turn-changes-path',
      text: turnFileDisplayPath(this.app, this.selectedFile),
    });

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

  private renderFileDiff(diffEl: HTMLElement, diff: TurnFileDiff): void {
    if (diff.operation === 'delete' && diff.diffLines.length === 0) {
      diffEl.createDiv({ cls: 'qoderian-diff-no-changes', text: t('chat.changes.deleted') });
      return;
    }
    if (diff.movedTo && diff.diffLines.length === 0) {
      diffEl.createDiv({
        cls: 'qoderian-diff-no-changes',
        text: t('chat.changes.renamed', { path: filePathName(diff.movedTo) }),
      });
      return;
    }
    renderDiffContent(diffEl, diff.diffLines, 3);
  }

}
