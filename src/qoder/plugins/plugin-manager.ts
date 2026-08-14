/**
 * PluginManager - Discover and manage Qoder CLI plugins.
 *
 * Plugins are discovered from two sources:
 * - installed_plugins.json: install paths for scanning agents
 * - settings.json: enabled state (project overrides global)
 */

import * as fs from 'fs';
import * as path from 'path';

import { resolvePathForComparison } from '../../core/fs/path';
import type { PluginInfo, PluginScope } from '../../core/types';
import { getActiveQoderCliEdition, getQoderCliHomeDir } from '../config/cli-edition';
import type { QoderCliSettingsStorage } from '../storage/qoder-cli-settings-storage';
import type { InstalledPluginEntry, InstalledPluginsFile } from '../types/plugins';

// Global plugin state lives under the active edition's config root
// (e.g. `~/.qoder-cn/plugins`), so resolve lazily on each read.
function getInstalledPluginsPath(): string {
  return path.join(
    getQoderCliHomeDir(getActiveQoderCliEdition()),
    'plugins',
    'installed_plugins.json',
  );
}

function getGlobalSettingsPath(): string {
  return path.join(getQoderCliHomeDir(getActiveQoderCliEdition()), 'settings.json');
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Bundled plugins are stored as a single object, marketplace installs as an array. */
function normalizeInstalledPluginEntries(
  entries: InstalledPluginEntry | InstalledPluginEntry[] | null | undefined
): InstalledPluginEntry[] {
  if (!entries) return [];
  const list = Array.isArray(entries) ? entries : [entries];
  return list.filter((entry) => Boolean(entry?.installPath));
}

/** Entries written without a scope are global installs. */
function resolveEntryScope(entry: InstalledPluginEntry): PluginScope {
  return entry.scope === 'project' ? 'project' : 'user';
}

function selectInstalledPluginEntry(
  entries: InstalledPluginEntry[],
  normalizedVaultPath: string
): InstalledPluginEntry | null {
  for (const entry of entries) {
    if (resolveEntryScope(entry) !== 'project') continue;
    if (!entry.projectPath) continue;
    if (resolvePathForComparison(entry.projectPath) === normalizedVaultPath) {
      return entry;
    }
  }

  return entries.find((e) => resolveEntryScope(e) === 'user') ?? null;
}

function extractPluginName(pluginId: string): string {
  const atIndex = pluginId.indexOf('@');
  if (atIndex > 0) {
    return pluginId.substring(0, atIndex);
  }
  return pluginId;
}

export class PluginManager {
  private qoderCliSettingsStorage: QoderCliSettingsStorage;
  private vaultPath: string;
  private plugins: PluginInfo[] = [];

  constructor(vaultPath: string, qoderCliSettingsStorage: QoderCliSettingsStorage) {
    this.vaultPath = vaultPath;
    this.qoderCliSettingsStorage = qoderCliSettingsStorage;
  }

  async loadPlugins(): Promise<void> {
    const installedPlugins = readJsonFile<InstalledPluginsFile>(getInstalledPluginsPath());
    const globalSettings = readJsonFile<SettingsFile>(getGlobalSettingsPath());
    const projectSettings = await this.loadProjectSettings();

    const globalEnabled = globalSettings?.enabledPlugins ?? {};
    const projectEnabled = projectSettings?.enabledPlugins ?? {};

    const plugins: PluginInfo[] = [];
    const normalizedVaultPath = resolvePathForComparison(this.vaultPath);

    if (installedPlugins?.plugins) {
      for (const [pluginId, entries] of Object.entries(installedPlugins.plugins)) {
        const entriesArray = normalizeInstalledPluginEntries(entries);
        if (entriesArray.length === 0) continue;

        const entry = selectInstalledPluginEntry(entriesArray, normalizedVaultPath);
        if (!entry) continue;

        const scope = resolveEntryScope(entry);

        // Project setting takes precedence, then global, then default enabled
        const enabled = projectEnabled[pluginId] ?? globalEnabled[pluginId] ?? true;

        plugins.push({
          id: pluginId,
          name: extractPluginName(pluginId),
          enabled,
          scope,
          installPath: entry.installPath,
        });
      }
    }

    this.plugins = plugins.sort((a, b) => {
      if (a.scope !== b.scope) {
        return a.scope === 'project' ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });
  }

  private async loadProjectSettings(): Promise<SettingsFile | null> {
    try {
      return await this.qoderCliSettingsStorage.load();
    } catch {
      return null;
    }
  }

  getPlugins(): PluginInfo[] {
    return [...this.plugins];
  }

  hasPlugins(): boolean {
    return this.plugins.length > 0;
  }

  hasEnabledPlugins(): boolean {
    return this.plugins.some((p) => p.enabled);
  }

  getEnabledCount(): number {
    return this.plugins.filter((p) => p.enabled).length;
  }

  /** Used to detect changes that require restarting the persistent query. */
  getPluginsKey(): string {
    const enabledPlugins = this.plugins
      .filter((p) => p.enabled)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (enabledPlugins.length === 0) {
      return '';
    }

    return enabledPlugins.map((p) => `${p.id}:${p.installPath}`).join('|');
  }

  /** Writes to project .qoder/settings.json so CLI respects the state. */
  async togglePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === pluginId);
    if (!plugin) {
      return;
    }

    const newEnabled = !plugin.enabled;
    plugin.enabled = newEnabled;

    await this.qoderCliSettingsStorage.setPluginEnabled(pluginId, newEnabled);
  }

  async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === pluginId);
    if (!plugin || plugin.enabled) {
      return;
    }

    plugin.enabled = true;
    await this.qoderCliSettingsStorage.setPluginEnabled(pluginId, true);
  }

  async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.find((p) => p.id === pluginId);
    if (!plugin || !plugin.enabled) {
      return;
    }

    plugin.enabled = false;
    await this.qoderCliSettingsStorage.setPluginEnabled(pluginId, false);
  }
}
