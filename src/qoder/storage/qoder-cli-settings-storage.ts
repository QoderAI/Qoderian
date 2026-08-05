import type { VaultFileAdapter } from '../../core/storage/vault-file-adapter';
import type { QoderCliSettingsFile } from '../types/settings';
import { DEFAULT_QODER_CLI_SETTINGS } from '../types/settings';

export const QODER_CLI_SETTINGS_PATH = '.qoder/settings.json';

const QODER_CLI_SETTINGS_SCHEMA = 'https://json.schemastore.org/qoder-code-settings.json';

interface QoderCliSettingsRecoveryNotice {
  sourcePath: string;
  backupPath: string | null;
}

export class QoderCliSettingsStorage {
  private canOverwriteSettings = true;

  constructor(
    private adapter: VaultFileAdapter,
    private onRecovery?: (notice: QoderCliSettingsRecoveryNotice) => void,
  ) { }

  async load(): Promise<QoderCliSettingsFile> {
    if (!(await this.adapter.exists(QODER_CLI_SETTINGS_PATH))) {
      return { ...DEFAULT_QODER_CLI_SETTINGS };
    }

    const content = await this.adapter.read(QODER_CLI_SETTINGS_PATH);
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(content) as Record<string, unknown>;
    } catch {
      const backupPath = await this.backupInvalidSettings();
      this.canOverwriteSettings = backupPath !== null;
      this.onRecovery?.({
        sourcePath: QODER_CLI_SETTINGS_PATH,
        backupPath,
      });
      return { ...DEFAULT_QODER_CLI_SETTINGS };
    }

    return {
      ...DEFAULT_QODER_CLI_SETTINGS,
      ...stored,
      $schema: QODER_CLI_SETTINGS_SCHEMA,
    };
  }

  async save(settings: QoderCliSettingsFile): Promise<void> {
    if (!this.canOverwriteSettings) {
      throw new Error(`Refusing to overwrite invalid settings at ${QODER_CLI_SETTINGS_PATH}.`);
    }
    // Preserve Qoder CLI fields we do not manage.
    let existing: Record<string, unknown> = {};
    if (await this.adapter.exists(QODER_CLI_SETTINGS_PATH)) {
      try {
        const content = await this.adapter.read(QODER_CLI_SETTINGS_PATH);
        existing = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Parse error - start fresh with default settings
      }
    }

    // Merge existing Qoder CLI fields with our updates.
    const merged: QoderCliSettingsFile = {
      ...existing,
      $schema: QODER_CLI_SETTINGS_SCHEMA,
    };

    if (settings.permissions !== undefined) {
      merged.permissions = settings.permissions;
    }

    if (settings.enabledPlugins !== undefined) {
      merged.enabledPlugins = settings.enabledPlugins;
    }

    const content = JSON.stringify(merged, null, 2);
    await this.adapter.write(QODER_CLI_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(QODER_CLI_SETTINGS_PATH);
  }

  async getEnabledPlugins(): Promise<Record<string, boolean>> {
    const settings = await this.load();
    return settings.enabledPlugins ?? {};
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const settings = await this.load();
    const enabledPlugins = settings.enabledPlugins ?? {};

    enabledPlugins[pluginId] = enabled;
    settings.enabledPlugins = enabledPlugins;

    await this.save(settings);
  }

  async getExplicitlyEnabledPluginIds(): Promise<string[]> {
    const enabledPlugins = await this.getEnabledPlugins();
    return Object.entries(enabledPlugins)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);
  }

  async isPluginDisabled(pluginId: string): Promise<boolean> {
    const enabledPlugins = await this.getEnabledPlugins();
    return enabledPlugins[pluginId] === false;
  }

  private async backupInvalidSettings(): Promise<string | null> {
    const backupPath = `${QODER_CLI_SETTINGS_PATH}.corrupt-${Date.now()}.bak`;
    try {
      await this.adapter.rename(QODER_CLI_SETTINGS_PATH, backupPath);
      return backupPath;
    } catch {
      return null;
    }
  }
}
