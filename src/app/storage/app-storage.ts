import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';

import { VaultFileAdapter } from '../../core/storage/vault-file-adapter';
import type { AppTabManagerState } from '../../core/types/services';
import {
  QoderianSettingsStorage,
  type StoredQoderianSettings,
} from '../settings/settings-storage';
import { SESSIONS_PATH, SessionStorage } from './session-storage';
import { QODERIAN_STORAGE_PATH } from './storage-paths';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class QoderianStorage {
  readonly qoderianSettings: QoderianSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private dataWriteQueue: Promise<void> = Promise.resolve();
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.qoderianSettings = new QoderianSettingsStorage(this.adapter, ({ sourcePath, backupPath }) => {
      const detail = backupPath
        ? `A backup was saved to ${backupPath}.`
        : 'The invalid file could not be backed up and will not be overwritten.';
      new Notice(`Could not read ${sourcePath}. Qoderian loaded safe defaults. ${detail}`);
    });
    this.sessions = new SessionStorage(this.adapter);
  }

  async initialize(): Promise<{ qoderian: StoredQoderianSettings }> {
    await this.ensureDirectories();
    const qoderian = await this.qoderianSettings.load();
    return { qoderian };
  }

  async saveQoderianSettings(settings: Record<string, unknown>): Promise<void> {
    await this.qoderianSettings.save(settings as StoredQoderianSettings);
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    this.dataWriteQueue = this.dataWriteQueue
      .then(async () => {
        const loaded: unknown = await this.plugin.loadData();
        const data = isRecord(loaded) ? loaded : {};
        data.tabManagerState = state;
        await this.plugin.saveData(data);
      })
      .catch(() => {
        new Notice('Failed to save tab layout');
      });
    await this.dataWriteQueue;
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return this.validateTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(QODERIAN_STORAGE_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }

  private validateTabManagerState(data: unknown): AppTabManagerState | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const state = data as Record<string, unknown>;
    if (!Array.isArray(state.openTabs)) {
      return null;
    }

    const validatedTabs: AppTabManagerState['openTabs'] = [];
    for (const tab of state.openTabs) {
      if (!tab || typeof tab !== 'object') {
        continue;
      }

      const tabObj = tab as Record<string, unknown>;
      if (typeof tabObj.tabId !== 'string') {
        continue;
      }

      validatedTabs.push({
        tabId: tabObj.tabId,
        conversationId: typeof tabObj.conversationId === 'string' ? tabObj.conversationId : null,
        ...(typeof tabObj.draftModel === 'string'
          ? { draftModel: tabObj.draftModel }
          : {}),
      });
    }

    return {
      openTabs: validatedTabs,
      activeTabId: typeof state.activeTabId === 'string' ? state.activeTabId : null,
    };
  }
}
