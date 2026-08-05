import { type App, Notice } from 'obsidian';

import { VaultFileAdapter } from '../../core/storage/vault-file-adapter';
import { AgentVaultStorage } from './agent-vault-storage';
import { McpStorage } from './mcp-storage';
import { QoderCliSettingsStorage } from './qoder-cli-settings-storage';
import { SkillStorage } from './skill-storage';
import { SlashCommandStorage } from './slash-command-storage';

/** Qoder CLI workspace files stored under `.qoder/`. */
export class QoderStorage {
  readonly qoderCliSettings: QoderCliSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly mcp: McpStorage;
  readonly agents: AgentVaultStorage;

  constructor(plugin: { app: App }, adapter?: VaultFileAdapter) {
    const storageAdapter = adapter ?? new VaultFileAdapter(plugin.app);
    this.qoderCliSettings = new QoderCliSettingsStorage(storageAdapter, ({ sourcePath, backupPath }) => {
      const detail = backupPath
        ? `A backup was saved to ${backupPath}.`
        : 'The invalid file could not be backed up and will not be overwritten.';
      new Notice(`Could not read ${sourcePath}. Qoderian loaded safe defaults. ${detail}`);
    });
    this.commands = new SlashCommandStorage(storageAdapter);
    this.skills = new SkillStorage(storageAdapter);
    this.mcp = new McpStorage(storageAdapter);
    this.agents = new AgentVaultStorage(storageAdapter);
  }
}
