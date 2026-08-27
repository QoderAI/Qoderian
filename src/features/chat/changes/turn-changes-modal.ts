import type { App } from 'obsidian';
import { FileSystemAdapter, MarkdownView, Modal, normalizePath, Notice, setIcon, TFile } from 'obsidian';

import { t } from '../../../i18n/i18n';
import { renderDiffContent, renderDiffStats } from '../rendering/diff-renderer';
import type { TurnChangesSummary, TurnFileChange } from './turn-file-changes';

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
        attr: { type: 'button' },
      });
      button.createSpan({ cls: 'qoderian-turn-changes-file-name', text: fileNameOnly(file.filePath) });
      const stats = button.createSpan({ cls: 'qoderian-turn-changes-file-stats' });
      renderDiffStats(stats, file.stats);
      button.addEventListener('click', () => {
        this.selectedFile = file;
        this.render();
      });
    }

    const detail = body.createDiv({ cls: 'qoderian-turn-changes-detail' });
    const detailHeader = detail.createDiv({ cls: 'qoderian-turn-changes-detail-header' });
    detailHeader.createSpan({ cls: 'qoderian-turn-changes-path', text: this.selectedFile.filePath });
    const openButton = detailHeader.createEl('button', {
      cls: 'clickable-icon',
      attr: {
        'aria-label': t('chat.changes.openFile'),
        title: t('chat.changes.openFile'),
        type: 'button',
      },
    });
    setIcon(openButton, 'external-link');
    openButton.addEventListener('click', () => void this.openFile(this.selectedFile.filePath));

    const diffList = detail.createDiv({ cls: 'qoderian-turn-changes-diffs' });
    this.selectedFile.diffs.forEach((diff, index) => {
      if (this.selectedFile.diffs.length > 1) {
        diffList.createDiv({
          cls: 'qoderian-turn-changes-edit-label',
          text: t('chat.changes.edit', { count: index + 1 }),
        });
      }
      const diffEl = diffList.createDiv({ cls: 'qoderian-diff-content' });
      renderDiffContent(diffEl, diff.diffLines, 3);
      diffEl.addEventListener('click', event => {
        const lineEl = (event.target as HTMLElement).closest<HTMLElement>('.qoderian-diff-line');
        if (!lineEl) return;
        const line = Number(lineEl.dataset.newLine ?? lineEl.dataset.oldLine);
        if (Number.isFinite(line)) void this.openFile(this.selectedFile.filePath, line);
      });
    });
  }

  private async openFile(filePath: string, line?: number): Promise<void> {
    const relativePath = this.toVaultRelativePath(filePath);
    const file = this.app.vault.getAbstractFileByPath(relativePath);
    if (!(file instanceof TFile)) {
      new Notice(t('chat.changes.fileUnavailable'));
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    if (line !== undefined && leaf.view instanceof MarkdownView) {
      const position = { line: Math.max(0, line - 1), ch: 0 };
      leaf.view.editor.setCursor(position);
      leaf.view.editor.scrollIntoView({ from: position, to: position }, true);
    }
    this.close();
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
}

function fileNameOnly(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}
