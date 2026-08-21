import type { App, TAbstractFile, TFile, TFolder, Workspace, WorkspaceLeaf } from 'obsidian';
import { Notice } from 'obsidian';

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

/**
 * Opens a vault file or folder the way users expect from a reference chip:
 * files open in a leaf, folders are revealed in the file explorer.
 * `openLinkText` cannot be used here — it treats folder paths as missing
 * notes and offers to create a file.
 */
export function openVaultEntry(app: App, path: string): void {
  const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return;

  if (isVaultFolder(entry)) {
    revealInFileExplorer(app, entry);
    return;
  }
  if (isVaultFile(entry)) {
    void (async (): Promise<void> => {
      try {
        await app.workspace.getLeaf().openFile(entry);
      } catch (error) {
        new Notice(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }
}

/** Internal file-explorer API used by community plugins to locate an entry. */
interface FileExplorerPluginApi {
  instance?: {
    revealInFolder?: (entry: TAbstractFile) => void;
  };
}

function revealInFileExplorer(app: App, folder: TFolder): void {
  try {
    const internalPlugins = (app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => FileExplorerPluginApi | undefined };
    }).internalPlugins;
    const explorer = internalPlugins?.getPluginById?.('file-explorer');
    const reveal = explorer?.instance?.revealInFolder;
    if (typeof reveal === 'function') {
      reveal.call(explorer?.instance, folder);
      return;
    }
  } catch {
    // File explorer unavailable or API changed; fall through to the notice.
  }
  new Notice(`Cannot reveal folder: ${folder.path}`);
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
