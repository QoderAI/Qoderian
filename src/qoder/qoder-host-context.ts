import type { App } from 'obsidian';

import type { QoderianSettings } from '../core/types/settings';

/**
 * Narrow host surface required by the Qoder SDK/CLI integration.
 *
 * Keeping this contract inside qoder prevents adapters from reaching back into
 * the concrete Obsidian plugin entry point while still making Qoder-specific
 * requirements explicit.
 */
export interface QoderHostContext {
  app: App;
  settings: QoderianSettings;
  getResolvedQoderCliPath(): string | null;
  /** Persists the current settings bag; used after background discovery. */
  saveSettings?(): Promise<void>;
}
