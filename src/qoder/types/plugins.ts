/** Bundled installs only write `installPath`, so every other field is optional. */
export interface InstalledPluginEntry {
  installPath: string;
  scope?: 'user' | 'project';
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
  projectPath?: string;
}

export interface InstalledPluginsFile {
  version?: number;
  /** Qoder CLI stores either a single entry or one entry per scope. */
  plugins: Record<string, InstalledPluginEntry | InstalledPluginEntry[]>;
}
