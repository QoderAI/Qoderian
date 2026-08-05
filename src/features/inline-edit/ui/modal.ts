import { StateEffect, StateField, type Text } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { App, Editor, MarkdownView } from 'obsidian';
import { Notice } from 'obsidian';

import { getBuiltInCommandsForDropdown } from '../../../core/commands/built-in-commands';
import {
  createExternalContextLookupGetter,
  findBestMentionLookupMatch,
  isMentionStart,
  normalizeForPlatformLookup,
  normalizeMentionPath,
  resolveExternalMentionAtIndex,
} from '../../../core/context/context-mention-resolver';
import { buildExternalContextDisplayEntries } from '../../../core/context/external-context';
import {
  type ExternalContextFile,
  externalContextScanner,
} from '../../../core/context/external-context-scanner';
import { type CursorContext, getEditorView } from '../../../core/editor/editor-context';
import { getVaultPath, normalizePathForVault as normalizePathForVaultUtil } from '../../../core/fs/path';
import type { InlineEditMode, InlineEditService } from '../../../core/types/services';
import type QoderianPlugin from '../../../main';
import { hideSelectionHighlight, showSelectionHighlight } from '../../../shared/components/selection-highlight';
import {
  SlashCommandDropdown,
  toSlashCommandDropdownEntries,
} from '../../../shared/components/slash-command-dropdown';
import { MentionDropdownController } from '../../../shared/mention/mention-dropdown-controller';
import { VaultMentionIndex } from '../../../shared/mention/vault-mention-index';
import { renderInlineEditMarkdownPreview } from './markdown-preview';

export type InlineEditContext =
  | { mode: 'selection'; selectedText: string }
  | { mode: 'cursor'; cursorContext: CursorContext };

/** Trims leading and trailing blank lines from cursor insertion text. */
export function normalizeInsertionText(text: string): string {
  return text.replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, '');
}

const showInlineEdit = StateEffect.define<{
  inputPos: number;
  selFrom: number;
  selTo: number;
  widget: InlineEditController;
  isInbetween?: boolean;
}>();
const showDiff = StateEffect.define<{
  from: number;
  to: number;
  diffOps: DiffOp[];
  previewPos: number;
  widget: InlineEditController;
}>();
const showInsertion = StateEffect.define<{
  diffOps: DiffOp[];
  previewPos: number;
  widget: InlineEditController;
}>();
const hideInlineEdit = StateEffect.define<null>();

let activeController: InlineEditController | null = null;

class InputWidget extends WidgetType {
  constructor(private controller: InlineEditController) {
    super();
  }
  toDOM(): HTMLElement {
    return this.controller.createInputDOM();
  }
  eq(): boolean {
    return false;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class MarkdownDiffWidget extends WidgetType {
  constructor(private diffOps: DiffOp[], private controller: InlineEditController) {
    super();
  }
  toDOM(): HTMLElement {
    return this.controller.createDiffPreviewDOM(this.diffOps);
  }
  eq(other: MarkdownDiffWidget): boolean {
    return diffOpsEqual(this.diffOps, other.diffOps);
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export function buildInlineEditInputDecorations(options: {
  doc: Text;
  inputPos: number;
  isInbetween?: boolean;
  widget: WidgetType;
}): DecorationSet {
  // Decoration.set(..., true) sorts line and widget decorations by CodeMirror's
  // internal range ordering, including equal-position block widgets at line start.
  const isInbetween = options.isInbetween ?? false;
  const lineStart = options.doc.lineAt(options.inputPos).from;
  return Decoration.set([
    Decoration.line({
      class: 'qoderian-inline-input-line',
    }).range(lineStart),
    Decoration.widget({
      widget: options.widget,
      block: !isInbetween,
      side: isInbetween ? 1 : -1,
    }).range(options.inputPos),
  ], true);
}

const inlineEditField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (deco, tr) => {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(showInlineEdit)) {
        // Block above line for selection/inline mode, inline widget for inbetween mode
        deco = buildInlineEditInputDecorations({
          doc: tr.state.doc,
          inputPos: e.value.inputPos,
          isInbetween: e.value.isInbetween,
          widget: new InputWidget(e.value.widget),
        });
      } else if (e.is(showDiff)) {
        deco = Decoration.set([
          Decoration.widget({
            widget: new MarkdownDiffWidget(e.value.diffOps, e.value.widget),
            block: true,
            side: -1,
          }).range(e.value.previewPos),
          Decoration.replace({}).range(e.value.from, e.value.to),
        ], true);
      } else if (e.is(showInsertion)) {
        deco = Decoration.set([
          Decoration.widget({
            widget: new MarkdownDiffWidget(e.value.diffOps, e.value.widget),
            block: true,
            side: -1,
          }).range(e.value.previewPos),
        ], true);
      } else if (e.is(hideInlineEdit)) {
        deco = Decoration.none;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const installedEditors = new WeakSet<EditorView>();

interface DiffOp { type: 'equal' | 'insert' | 'delete'; text: string; }

function splitLinesPreservingEndings(text: string): string[] {
  if (!text) return [];
  return text.match(/[^\n]*(?:\n|$)/g)?.filter(line => line.length > 0) ?? [];
}

function computeMarkdownDiff(oldText: string, newText: string): DiffOp[] {
  const oldLines = splitLinesPreservingEndings(oldText);
  const newLines = splitLinesPreservingEndings(newText);
  const m = oldLines.length, n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i-1] === newLines[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }

  const temp: DiffOp[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i-1] === newLines[j-1]) {
      temp.push({ type: 'equal', text: oldLines[i-1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      temp.push({ type: 'insert', text: newLines[j-1] });
      j--;
    } else {
      temp.push({ type: 'delete', text: oldLines[i-1] });
      i--;
    }
  }

  return mergeAdjacentDiffOps(temp.reverse());
}

function mergeAdjacentDiffOps(ops: DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = [];
  for (const op of ops) {
    if (merged.length > 0 && merged[merged.length-1].type === op.type) {
      merged[merged.length-1].text += op.text;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

function getDiffBlockClass(type: DiffOp['type']): string {
  switch (type) {
    case 'delete':
      return 'qoderian-diff-del';
    case 'insert':
      return 'qoderian-diff-ins';
    default:
      return 'qoderian-diff-equal';
  }
}

function buildMarkdownDiffDocuments(diffOps: DiffOp[]): Array<{ type: DiffOp['type']; markdown: string }> {
  const oldMarkdown = diffOps
    .filter(op => op.type !== 'insert')
    .map(op => op.text)
    .join('');
  const newMarkdown = diffOps
    .filter(op => op.type !== 'delete')
    .map(op => op.text)
    .join('');
  const hasDeletion = diffOps.some(op => op.type === 'delete');
  const hasInsertion = diffOps.some(op => op.type === 'insert');

  const documents: Array<{ type: DiffOp['type']; markdown: string }> = [];

  if (hasDeletion && oldMarkdown) {
    documents.push({ type: 'delete', markdown: oldMarkdown });
  }

  if (hasInsertion && newMarkdown) {
    documents.push({ type: 'insert', markdown: newMarkdown });
  }

  if (documents.length === 0 && newMarkdown) {
    documents.push({ type: 'equal', markdown: newMarkdown });
  }

  return documents;
}

function diffOpsEqual(left: DiffOp[], right: DiffOp[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((op, index) => {
    const other = right[index];
    return op.type === other.type && op.text === other.text;
  });
}

export type InlineEditDecision = 'accept' | 'edit' | 'reject';

export class InlineEditModal {
  private controller: InlineEditController | null = null;

  constructor(
    private app: App,
    private plugin: QoderianPlugin,
    private editor: Editor,
    private view: MarkdownView,
    private editContext: InlineEditContext,
    private notePath: string,
    private getExternalContexts: () => string[] = () => []
  ) {}

  async openAndWait(): Promise<{ decision: InlineEditDecision; editedText?: string }> {
    if (activeController) {
      activeController.reject();
      return { decision: 'reject' };
    }

    // Use the editor/view provided by Obsidian's editorCallback.
    // This avoids timing issues during leaf/view transitions (e.g., navigating via Search in the same tab).
    let editor = this.editor;
    let editorView = getEditorView(editor);

    // Fallback: in rare cases Obsidian may re-initialize the editor between callback and modal open.
    if (!editorView) {
      editor = this.view.editor;
      editorView = getEditorView(editor);
    }

    if (!editorView) {
      new Notice('Inline edit unavailable: could not access the active editor. Try reopening the note.');
      return { decision: 'reject' };
    }

    return new Promise((resolve) => {
      this.controller = new InlineEditController(
        this.app,
        this.plugin,
        editorView,
        editor,
        this.editContext,
        this.notePath,
        this.getExternalContexts,
        resolve
      );
      activeController = this.controller;
      this.controller.show();
    });
  }
}

class InlineEditController {
  private inputEl: HTMLInputElement | null = null;
  private spinnerEl: HTMLElement | null = null;
  private agentReplyEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private editedText: string | null = null;
  private insertedText: string | null = null;
  private selFrom = 0;
  private selTo = 0;
  private selectedText: string;
  private startLine: number = 0; // 1-indexed
  private mode: InlineEditMode;
  private cursorContext: CursorContext | null = null;
  private inlineEditService: InlineEditService;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private selectionListener: ((e: Event) => void) | null = null;
  private isConversing = false;
  private slashCommandDropdown: SlashCommandDropdown | null = null;
  private mentionDropdown: MentionDropdownController | null = null;
  private mentionIndex: VaultMentionIndex;
  private agentReplyRenderVersion = 0;

  constructor(
    private app: App,
    private plugin: QoderianPlugin,
    private editorView: EditorView,
    private editor: Editor,
    editContext: InlineEditContext,
    private notePath: string,
    private getExternalContexts: () => string[],
    private resolve: (result: { decision: InlineEditDecision; editedText?: string }) => void
  ) {
    const activeView = typeof plugin.getView === 'function'
      ? plugin.getView()
      : null;
    const activeTab = activeView?.getActiveTab();
    this.inlineEditService = plugin.qoderServices.createInlineEditService();
    const auxiliaryModel = activeTab?.service?.getAuxiliaryModel?.()
      ?? activeTab?.draftModel
      ?? null;
    this.inlineEditService.setModelOverride?.(auxiliaryModel ?? undefined);
    this.mentionIndex = new VaultMentionIndex(this.app, {
      onFileLoadError: () => {
        new Notice('Failed to load vault files. Vault @-mentions may be unavailable.');
      },
    });
    this.mentionIndex.initializeInBackground();
    this.mode = editContext.mode;
    if (editContext.mode === 'cursor') {
      this.cursorContext = editContext.cursorContext;
      this.selectedText = '';
    } else {
      this.selectedText = editContext.selectedText;
    }

    this.updatePositionsFromEditor();
  }

  getOwnerDocument(): Document {
    return this.editorView.dom.ownerDocument ?? window.document;
  }

  private updatePositionsFromEditor() {
    const doc = this.editorView.state.doc;

    if (this.mode === 'cursor') {
      const ctx = this.cursorContext as CursorContext;
      const line = doc.line(ctx.line + 1);
      this.selFrom = line.from + ctx.column;
      this.selTo = this.selFrom;
    } else {
      const from = this.editor.getCursor('from');
      const to = this.editor.getCursor('to');
      const fromLine = doc.line(from.line + 1);
      const toLine = doc.line(to.line + 1);
      this.selFrom = fromLine.from + from.ch;
      this.selTo = toLine.from + to.ch;
      this.selectedText = this.editor.getSelection() || this.selectedText;
      this.startLine = from.line + 1; // 1-indexed
    }
  }

  show() {
    if (!installedEditors.has(this.editorView)) {
      this.editorView.dispatch({
        effects: StateEffect.appendConfig.of(inlineEditField),
      });
      installedEditors.add(this.editorView);
    }

    this.updateHighlight();

    if (this.mode === 'selection') {
      this.attachSelectionListeners();
    }

    // !e.isComposing: skip during IME composition (Chinese, Japanese, Korean, etc.)
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        this.reject();
      }
    };
    this.getOwnerDocument().addEventListener('keydown', this.escHandler);
  }

  private updateHighlight() {
    const doc = this.editorView.state.doc;
    const line = doc.lineAt(this.selFrom);
    const isInbetween = this.mode === 'cursor' && this.cursorContext?.isInbetween;

    this.editorView.dispatch({
      effects: showInlineEdit.of({
        inputPos: isInbetween ? this.selFrom : line.from,
        selFrom: this.selFrom,
        selTo: this.selTo,
        widget: this,
        isInbetween,
      }),
    });
    this.updateSelectionHighlight();
  }

  private updateSelectionHighlight(): void {
    if (this.mode === 'selection' && this.selFrom !== this.selTo) {
      showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
    } else {
      hideSelectionHighlight(this.editorView);
    }
  }

  private attachSelectionListeners() {
    this.removeSelectionListeners();
    this.selectionListener = (e: Event) => {
      const target = e.target as Node | null;
      if (target && this.inputEl && (target === this.inputEl || this.inputEl.contains(target))) {
        return;
      }
      const prevFrom = this.selFrom;
      const prevTo = this.selTo;
      const newSelection = this.editor.getSelection();
      if (newSelection && newSelection.length > 0) {
        this.updatePositionsFromEditor();
        if (prevFrom !== this.selFrom || prevTo !== this.selTo) {
          this.updateHighlight();
        }
      }
    };
    this.editorView.dom.addEventListener('mouseup', this.selectionListener);
    this.editorView.dom.addEventListener('keyup', this.selectionListener);
  }

  createInputDOM(): HTMLElement {
    const ownerDocument = this.getOwnerDocument();
    const container = createDiv({ cls: 'qoderian-inline-input-container' });
    this.containerEl = container;

    this.agentReplyEl = container.createDiv({ cls: 'qoderian-inline-agent-reply qoderian-hidden' });

    const inputWrap = container.createDiv({ cls: 'qoderian-inline-input-wrap' });

    this.inputEl = inputWrap.createEl('input', { cls: 'qoderian-inline-input', type: 'text' });
    this.inputEl.placeholder = this.mode === 'cursor' ? 'Insert instructions...' : 'Edit instructions...';
    this.inputEl.spellcheck = false;

    this.spinnerEl = inputWrap.createDiv({ cls: 'qoderian-inline-spinner qoderian-hidden' });

    const inlineCatalog = this.plugin.qoderServices.commandCatalog;
    this.slashCommandDropdown = new SlashCommandDropdown(
      ownerDocument.body,
      this.inputEl,
      {
        onSelect: () => {},
        onHide: () => {},
      },
      {
        fixed: true,
        staticEntries: toSlashCommandDropdownEntries(getBuiltInCommandsForDropdown()),
        ...(inlineCatalog ? {
          catalogConfig: inlineCatalog.getDropdownConfig(),
          getEntries: () => inlineCatalog.listDropdownEntries({ includeBuiltIns: false }),
          subscribeCatalogChanges: (listener: () => void) => inlineCatalog.subscribe(listener),
        } : {}),
      }
    );

    this.mentionDropdown = new MentionDropdownController(
      ownerDocument.body,
      this.inputEl,
      {
        // Inline-edit resolves @mentions at send time from input text.
        onAttachFile: () => {},
        getExternalContexts: this.getExternalContexts,
        getCachedVaultFolders: () => this.mentionIndex.getCachedVaultFolders(),
        getCachedVaultFiles: () => this.mentionIndex.getCachedVaultFiles(),
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath),
      },
      { fixed: true }
    );

    this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.inputEl.addEventListener('input', () => this.mentionDropdown?.handleInputChange());

    window.setTimeout(() => this.inputEl?.focus(), 50);
    return container;
  }

  createDiffPreviewDOM(diffOps: DiffOp[]): HTMLElement {
    const previewEl = createDiv({ cls: 'qoderian-inline-diff-preview' });

    const bodyEl = previewEl.createDiv({ cls: 'qoderian-inline-diff-preview-body markdown-rendered' });

    const actionsEl = previewEl.createDiv({ cls: 'qoderian-inline-preview-actions' });
    actionsEl.appendChild(this.createPreviewActionButton('Reject', 'reject', () => this.reject()));
    actionsEl.appendChild(this.createPreviewActionButton('Accept', 'accept', () => this.accept()));

    void this.renderMarkdownDiffPreview(bodyEl, diffOps);
    return previewEl;
  }

  private createPreviewActionButton(
    label: string,
    variant: 'accept' | 'reject',
    onClick: () => void
  ): HTMLButtonElement {
    const button = createEl('button', { cls: `qoderian-inline-preview-action ${variant}`, type: 'button' });
    button.textContent = label;
    button.title = variant === 'accept' ? 'Accept (enter)' : 'Reject (esc)';
    button.addEventListener('click', (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      onClick();
    });
    return button;
  }

  private async renderMarkdownPreview(container: HTMLElement, markdown: string): Promise<void> {
    await renderInlineEditMarkdownPreview({
      app: this.app,
      component: this.plugin,
      container,
      markdown,
      sourcePath: this.notePath,
      mediaFolder: this.plugin.settings?.mediaFolder ?? '',
    });
  }

  private async renderMarkdownDiffPreview(container: HTMLElement, diffOps: DiffOp[]): Promise<void> {
    container.empty();
    for (const document of buildMarkdownDiffDocuments(diffOps)) {
      if (!document.markdown) continue;

      const opEl = container.createDiv({ cls: `qoderian-diff-block ${getDiffBlockClass(document.type)}` });
      await this.renderMarkdownPreview(opEl, document.markdown);
    }
  }

  private replaceRenderedPreview(target: HTMLElement, rendered: HTMLElement): void {
    target.empty();

    if (rendered.childNodes) {
      for (const child of Array.from(rendered.childNodes)) {
        target.appendChild(child);
      }
      return;
    }

    for (const child of Array.from(rendered.children)) {
      target.appendChild(child);
    }
  }

  private async generate() {
    if (!this.inputEl || !this.spinnerEl) return;
    const userMessage = this.inputEl.value.trim();
    if (!userMessage) return;

    // Slash commands are passed directly to SDK for handling

    this.removeSelectionListeners();

    this.inputEl.disabled = true;
    this.spinnerEl.removeClass('qoderian-hidden');

    const contextFiles = await this.resolveContextFilesFromMessage(userMessage);

    let result;
    if (this.isConversing) {
      result = await this.inlineEditService.continueConversation(userMessage, contextFiles);
    } else {
      if (this.mode === 'cursor') {
        result = await this.inlineEditService.editText({
          mode: 'cursor',
          instruction: userMessage,
          notePath: this.notePath,
          cursorContext: this.cursorContext as CursorContext,
          contextFiles,
        });
      } else {
        const lineCount = this.selectedText.split(/\r?\n/).length;
        result = await this.inlineEditService.editText({
          mode: 'selection',
          instruction: userMessage,
          notePath: this.notePath,
          selectedText: this.selectedText,
          startLine: this.startLine,
          lineCount,
          contextFiles,
        });
      }
    }

    this.spinnerEl.addClass('qoderian-hidden');

    if (result.success) {
      if (result.editedText !== undefined) {
        this.editedText = result.editedText;
        this.showDiffInPlace();
      } else if (result.insertedText !== undefined) {
        this.insertedText = result.insertedText;
        this.showInsertionInPlace();
      } else if (result.clarification) {
        this.showAgentReply(result.clarification);
        this.isConversing = true;
        this.inputEl.disabled = false;
        this.inputEl.value = '';
        this.inputEl.placeholder = 'Reply to continue...';
        this.inputEl.focus();
      } else {
        this.handleError('No response from agent');
      }
    } else {
      this.handleError(result.error || 'Error - try again');
    }
  }

  private showAgentReply(message: string) {
    if (!this.agentReplyEl || !this.containerEl) return;
    const replyEl = this.agentReplyEl;
    const renderVersion = ++this.agentReplyRenderVersion;
    const renderedEl = createDiv();

    replyEl.removeClass('qoderian-hidden');
    replyEl.empty();
    void this.renderMarkdownPreview(renderedEl, message).then(() => {
      if (renderVersion !== this.agentReplyRenderVersion || replyEl !== this.agentReplyEl) {
        return;
      }
      this.replaceRenderedPreview(replyEl, renderedEl);
    });
    this.containerEl.classList.add('has-agent-reply');
  }

  private handleError(errorMessage: string) {
    if (!this.inputEl) return;
    this.inputEl.disabled = false;
    this.inputEl.placeholder = errorMessage;
    this.updatePositionsFromEditor();
    this.updateHighlight();
    this.attachSelectionListeners();
    this.inputEl.focus();
  }

  private showDiffInPlace() {
    if (this.editedText === null) return;

    hideSelectionHighlight(this.editorView);

    const diffOps = computeMarkdownDiff(this.selectedText, this.editedText);
    const previewPos = this.editorView.state.doc.lineAt(this.selFrom).from;

    this.editorView.dispatch({
      effects: showDiff.of({
        from: this.selFrom,
        to: this.selTo,
        diffOps,
        previewPos,
        widget: this,
      }),
    });

    this.installAcceptRejectHandler();
  }

  private showInsertionInPlace() {
    if (this.insertedText === null) return;

    hideSelectionHighlight(this.editorView);

    const trimmedText = normalizeInsertionText(this.insertedText);
    this.insertedText = trimmedText;

    const diffOps: DiffOp[] = [{ type: 'insert', text: trimmedText }];
    const previewPos = this.editorView.state.doc.lineAt(this.selFrom).from;

    this.editorView.dispatch({
      effects: showInsertion.of({
        diffOps,
        previewPos,
        widget: this,
      }),
    });

    this.installAcceptRejectHandler();
  }

  private installAcceptRejectHandler() {
    if (this.escHandler) {
      this.getOwnerDocument().removeEventListener('keydown', this.escHandler);
    }
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        this.reject();
      } else if (e.key === 'Enter' && !e.isComposing) {
        this.accept();
      }
    };
    this.getOwnerDocument().addEventListener('keydown', this.escHandler);
  }

  accept() {
    const textToInsert = this.editedText ?? this.insertedText;
    if (textToInsert !== null) {
      // Convert CM6 positions back to Obsidian Editor positions
      const doc = this.editorView.state.doc;
      const fromLine = doc.lineAt(this.selFrom);
      const toLine = doc.lineAt(this.selTo);
      const from = { line: fromLine.number - 1, ch: this.selFrom - fromLine.from };
      const to = { line: toLine.number - 1, ch: this.selTo - toLine.from };

      this.cleanup();
      this.editor.replaceRange(textToInsert, from, to);
      this.resolve({ decision: 'accept', editedText: textToInsert });
    } else {
      this.cleanup();
      this.resolve({ decision: 'reject' });
    }
  }

  reject() {
    this.cleanup({ keepSelectionHighlight: true });
    this.restoreSelectionHighlight();
    this.resolve({ decision: 'reject' });
  }

  private removeSelectionListeners() {
    if (this.selectionListener) {
      this.editorView.dom.removeEventListener('mouseup', this.selectionListener);
      this.editorView.dom.removeEventListener('keyup', this.selectionListener);
      this.selectionListener = null;
    }
  }

  private cleanup(options?: { keepSelectionHighlight?: boolean }) {
    this.inlineEditService.cancel();
    this.inlineEditService.resetConversation();
    this.isConversing = false;
    this.removeSelectionListeners();
    if (this.escHandler) {
      this.getOwnerDocument().removeEventListener('keydown', this.escHandler);
    }
    this.slashCommandDropdown?.destroy();
    this.slashCommandDropdown = null;

    this.mentionDropdown?.destroy();
    this.mentionDropdown = null;

    if (activeController === this) {
      activeController = null;
    }
    this.editorView.dispatch({
      effects: hideInlineEdit.of(null),
    });
    if (!options?.keepSelectionHighlight) {
      hideSelectionHighlight(this.editorView);
    }
  }

  private restoreSelectionHighlight(): void {
    if (this.mode !== 'selection' || this.selFrom === this.selTo) {
      return;
    }
    showSelectionHighlight(this.editorView, this.selFrom, this.selTo);
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.mentionDropdown?.handleKeydown(e)) {
      return;
    }

    if (this.slashCommandDropdown?.handleKeydown(e)) {
      return;
    }

    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void this.generate();
    }
  }

  private normalizePathForVault(rawPath: string | undefined | null): string | null {
    try {
      const vaultPath = getVaultPath(this.app);
      return normalizePathForVaultUtil(rawPath, vaultPath);
    } catch {
      new Notice('Failed to attach file: invalid path');
      return null;
    }
  }

  private async resolveContextFilesFromMessage(message: string): Promise<string[]> {
    if (!message.includes('@')) return [];

    const vaultFiles = this.mentionIndex.getCachedVaultFiles();

    const pathLookup = new Map<string, string>();
    for (const file of vaultFiles) {
      const normalized = this.normalizePathForVault(file.path);
      if (!normalized) continue;
      const lookupKey = normalizeForPlatformLookup(normalizeMentionPath(normalized));
      if (!pathLookup.has(lookupKey)) {
        pathLookup.set(lookupKey, normalized);
      }
    }

    const resolved = new Set<string>();
    const externalEntries = buildExternalContextDisplayEntries(this.getExternalContexts())
      .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length);
    const externalContexts = this.getExternalContexts();
    let scannedFiles: ExternalContextFile[] = [];
    try {
      scannedFiles = await externalContextScanner.scanPaths(externalContexts);
    } catch {
      // Ignore unavailable external contexts and keep resolving vault mentions.
    }
    const filesByRoot = new Map<string, typeof scannedFiles>();
    for (const file of scannedFiles) {
      const files = filesByRoot.get(file.contextRoot) ?? [];
      files.push(file);
      filesByRoot.set(file.contextRoot, files);
    }
    const getExternalLookup = createExternalContextLookupGetter(
      contextRoot => filesByRoot.get(contextRoot) ?? []
    );

    for (let index = 0; index < message.length; index++) {
      if (!isMentionStart(message, index)) continue;

      const externalMatch = resolveExternalMentionAtIndex(
        message, index, externalEntries, getExternalLookup
      );
      if (externalMatch) {
        resolved.add(externalMatch.resolvedPath);
        index = externalMatch.endIndex - 1;
        continue;
      }

      const vaultMatch = findBestMentionLookupMatch(
        message, index + 1, pathLookup, normalizeMentionPath, normalizeForPlatformLookup
      );
      if (vaultMatch) {
        resolved.add(vaultMatch.resolvedPath);
        index = vaultMatch.endIndex - 1;
      }
    }

    return [...resolved];
  }

}
