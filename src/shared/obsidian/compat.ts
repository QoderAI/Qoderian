import type { App, MarkdownView, TAbstractFile, TFile, TFolder, Workspace, WorkspaceLeaf } from 'obsidian';
import { Notice } from 'obsidian';
import { isAbsolute } from 'path';

import type { ReferenceChipKind } from '../mention/types';

export function getVaultFileByPath(app: App, filePath: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (isVaultFile(file)) {
    return file;
  }
  return null;
}

export async function revealWorkspaceLeaf(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
  await workspace.revealLeaf(leaf);
}

export type ReferenceChipAction = (app: App, path: string, token?: string) => void;

/**
 * Click behaviors per chip kind. Extend `ReferenceChipKind` and add an entry
 * here to support new reference targets (e.g. files outside the vault).
 */
const referenceChipActions: Record<ReferenceChipKind, ReferenceChipAction> = {
  file: openReferenceFile,
  folder: revealReferenceFolder,
  selection: openSelectionReference,
  'canvas-selection': openReferenceFile,
  'browser-selection': openBrowserReference,
};

/**
 * Dispatches a reference chip click by its declared kind. Actions re-resolve
 * the path against the vault, so a stale kind (renamed or replaced entry)
 * falls through to the actual entry's behavior instead of misfiring.
 * `openLinkText` must not be used here — it treats folder paths as missing
 * notes and offers to create a file.
 */
export function openReferenceChip(app: App, kind: ReferenceChipKind, path: string, token?: string): void {
  if (isAbsolute(path)) {
    revealExternalPath(path);
    return;
  }
  referenceChipActions[kind]?.(app, path, token);
}

/** Parses the `#L<a>` / `#L<a>-<b>` suffix of an editor-selection token. */
export function parseSelectionLineRange(token: string): { from: number; to: number } | null {
  const match = /#L(\d+)(?:-(\d+))?$/.exec(token);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1) return null;
  return to >= from ? { from, to } : { from: to, to: from };
}

interface ElectronRemoteShellApi {
  remote?: {
    shell?: {
      /** Reveals the item (file or folder) in the OS file manager. */
      showItemInFolder?: (fullPath: string) => void;
    };
  };
}

/**
 * Reveals an absolute path — an external context root or one of its files —
 * in the OS file manager. Vault chips keep using Obsidian's own reveal.
 */
function revealExternalPath(path: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron remote is exposed only at runtime in Obsidian's renderer.
    const { remote } = require('electron') as ElectronRemoteShellApi;
    const showItemInFolder = remote?.shell?.showItemInFolder;
    if (typeof showItemInFolder === 'function') {
      showItemInFolder.call(remote?.shell, path);
      return;
    }
  } catch {
    // Electron remote is unavailable outside the desktop app; fall through.
  }
  new Notice(`Cannot reveal path: ${path}`);
}

function openReferenceFile(app: App, path: string): void {
  const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return;

  if (isVaultFolder(entry)) {
    referenceChipActions.folder(app, path);
    return;
  }
  if (!isVaultFile(entry)) return;

  void (async (): Promise<void> => {
    try {
      await app.workspace.getLeaf().openFile(entry);
    } catch (error) {
      new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

/**
 * Opens an editor-selection chip's note and re-selects the referenced lines,
 * so clicking a sent chip points back at the exact highlighted range.
 */
function openSelectionReference(app: App, path: string, token?: string): void {
  const range = token ? parseSelectionLineRange(token) : null;
  const entry = app.vault.getAbstractFileByPath(path);
  if (!entry || !isVaultFile(entry)) {
    openReferenceFile(app, path);
    return;
  }

  void (async (): Promise<void> => {
    try {
      const leaf = app.workspace.getLeaf();
      await leaf.openFile(entry);
      if (!range) return;
      const editor = (leaf.view as MarkdownView | null)?.editor;
      if (!editor) return;
      const lastLine = Math.min(range.to, editor.lineCount());
      const from = { line: range.from - 1, ch: 0 };
      const to = { line: lastLine - 1, ch: editor.getLine(lastLine - 1)?.length ?? 0 };
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, true);
    } catch (error) {
      new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

function revealReferenceFolder(app: App, path: string): void {  const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return;

  if (isVaultFile(entry)) {
    referenceChipActions.file(app, path);
    return;
  }
  if (!isVaultFolder(entry)) return;

  revealInFileExplorer(app, entry);
}

/** Opens a browser-selection chip's stored URL in a new external tab. */
function openBrowserReference(_app: App, url: string): void {
  if (!url) return;
  window.open(url, '_blank');
}

/** Internal file-explorer API used by community plugins to locate an entry. */
interface FileExplorerPluginApi {
  instance?: {
    revealInFolder?: (entry: TAbstractFile) => void;
    /** FileExplorerView extends View, which exposes its container element. */
    containerEl?: HTMLElement;
  };
}

function revealInFileExplorer(app: App, folder: TFolder): void {
  try {
    const internalPlugins = (app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => FileExplorerPluginApi | undefined };
    }).internalPlugins;
    const instance = internalPlugins?.getPluginById?.('file-explorer')?.instance;
    const reveal = instance?.revealInFolder;
    if (typeof reveal === 'function') {
      reveal.call(instance, folder);
      flashRevealedEntry(instance?.containerEl, folder.path);
      return;
    }
  } catch {
    // File explorer unavailable or API changed; fall through to the notice.
  }
  new Notice(`Cannot reveal folder: ${folder.path}`);
}

/**
 * Adds a short flash to the revealed tree entry so the chip click has a
 * visible landing point. Scoped to our own class, so the explorer's normal
 * active styling (and the user's theme) stays untouched.
 */
function flashRevealedEntry(containerEl: HTMLElement | undefined, path: string): void {
  if (!containerEl) return;

  const escapedPath = typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(path)
    : path.replace(/"/g, '\\"');
  const item = containerEl.querySelector(`.tree-item-self[data-path="${escapedPath}"]`);
  if (!item) return;

  item.classList.add('qoderian-reveal-flash');
  window.setTimeout(() => {
    item.classList.remove('qoderian-reveal-flash');
  }, 1800);
}

function isVaultFile(value: unknown): value is TFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFile>;
  return typeof candidate.path === 'string'
    && typeof candidate.basename === 'string';
}

function isVaultFolder(value: unknown): value is TFolder {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<TFolder>;
  return typeof candidate.path === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.children);
}
