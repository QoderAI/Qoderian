import type { App, TFile } from 'obsidian';

export interface VaultFileCacheOptions {
  onLoadError?: (error: unknown) => void;
}

export class VaultFileCache {
  private cachedFiles: TFile[] = [];
  private dirty = true;
  private isInitialized = false;

  constructor(
    private app: App,
    private options: VaultFileCacheOptions = {}
  ) {}

  initializeInBackground(): void {
    if (this.isInitialized) return;

    window.setTimeout(() => {
      this.tryRefreshFiles();
    }, 0);
  }

  markDirty(): void {
    this.dirty = true;
  }

  getFiles(): TFile[] {
    if (this.dirty || !this.isInitialized) {
      this.tryRefreshFiles();
    }
    return this.cachedFiles;
  }

  private tryRefreshFiles(): void {
    try {
      this.cachedFiles = this.app.vault.getFiles();
      this.dirty = false;
    } catch (error) {
      this.options.onLoadError?.(error);
      // Keep stale cache on failure. If data exists, avoid retrying each call.
      if (this.cachedFiles.length > 0) {
        this.dirty = false;
      }
    } finally {
      this.isInitialized = true;
    }
  }
}
