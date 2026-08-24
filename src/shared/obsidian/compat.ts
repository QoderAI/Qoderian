import type { App, TAbstractFile, TFile, TFolder, Workspace, WorkspaceLeaf } from 'obsidian';
import { Notice } from 'obsidian';

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

export type ReferenceChipAction = (app: App, path: string) => void;

/**
 * Click behaviors per chip kind. Extend `ReferenceChipKind` and add an entry
 * here to support new reference targets (e.g. files outside the vault).
 */
const referenceChipActions: Record<ReferenceChipKind, ReferenceChipAction> = {
  file: openReferenceFile,
  folder: revealReferenceFolder,
};

/**
 * Dispatches a reference chip click by its declared kind. Actions re-resolve
 * the path against the vault, so a stale kind (renamed or replaced entry)
 * falls through to the actual entry's behavior instead of misfiring.
 * `openLinkText` must not be used here — it treats folder paths as missing
 * notes and offers to create a file.
 */
export function openReferenceChip(app: App, kind: ReferenceChipKind, path: string): void {
  referenceChipActions[kind]?.(app, path);
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

function revealReferenceFolder(app: App, path: string): void {
  const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return;

  if (isVaultFile(entry)) {
    referenceChipActions.file(app, path);
    return;
  }
  if (!isVaultFolder(entry)) return;

  revealInFileExplorer(app, entry);
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
