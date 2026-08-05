import type { App, TFile } from 'obsidian';

import { VaultFileCache } from './vault-file-cache';
import { VaultFolderCache } from './vault-folder-cache';

export interface VaultMentionIndexOptions {
  onFileLoadError?: () => void;
}

export class VaultMentionIndex {
  private fileCache: VaultFileCache;
  private folderCache: VaultFolderCache;
  private hasReportedFileLoadError = false;

  constructor(
    app: App,
    options: VaultMentionIndexOptions = {}
  ) {
    this.fileCache = new VaultFileCache(app, {
      onLoadError: () => {
        if (this.hasReportedFileLoadError) return;
        this.hasReportedFileLoadError = true;
        options.onFileLoadError?.();
      },
    });
    this.folderCache = new VaultFolderCache(app);
  }

  initializeInBackground(): void {
    this.fileCache.initializeInBackground();
    this.folderCache.initializeInBackground();
  }

  markFilesDirty(): void {
    this.fileCache.markDirty();
  }

  markFoldersDirty(): void {
    this.folderCache.markDirty();
  }

  getCachedVaultFiles(): TFile[] {
    return this.fileCache.getFiles();
  }

  getCachedVaultFolders(): Array<{ name: string; path: string }> {
    return this.folderCache.getFolders().map(folder => ({
      name: folder.name,
      path: folder.path,
    }));
  }
}
