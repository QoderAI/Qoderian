import type { SlashCommand } from '../../core/types';
import type { QoderCommandEntry } from './qoder-command-entry';

export interface QoderCommandDropdownConfig {
  triggerChars: string[];
}

export interface QoderCommandCatalogContract {
  listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<QoderCommandEntry[]>;
  listVaultEntries(): Promise<QoderCommandEntry[]>;
  saveVaultEntry(entry: QoderCommandEntry): Promise<void>;
  deleteVaultEntry(entry: QoderCommandEntry): Promise<void>;
  setRuntimeCommands(commands: SlashCommand[]): void;
  invalidateRuntimeCommands(): void;
  /** Notified whenever the dropdown entries may have changed. */
  subscribe(listener: () => void): () => void;
  getDropdownConfig(): QoderCommandDropdownConfig;
  refresh(): Promise<void>;
}
