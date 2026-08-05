/** Qoder CLI settings-file types. */

/**
 * Permissions stored in `.qoder/settings.json`.
 */
export interface QoderCliPermissions {
  /** Rules that auto-approve tool actions */
  allow?: string[];
  /** Rules that auto-deny tool actions (highest persistent priority) */
  deny?: string[];
  /** Rules that always prompt for confirmation */
  ask?: string[];
  /** Default permission mode */
  defaultMode?: 'acceptEdits' | 'auto' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
  /** Additional directories to include in permission scope */
  additionalDirectories?: string[];
}

/**
 * Qoder CLI settings stored in `.qoder/settings.json`.
 */
export interface QoderCliSettingsFile {
  /** JSON Schema reference */
  $schema?: string;
  /** Tool permissions in Qoder CLI format. */
  permissions?: QoderCliPermissions;
  /** Model override */
  model?: string;
  /** Environment variables (object format) */
  env?: Record<string, string>;
  /** MCP server settings */
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  /** Plugin enabled state: `{ "plugin-id": true/false }`. */
  enabledPlugins?: Record<string, boolean>;
  /** Allow additional Qoder CLI settings that this plugin does not manage. */
  [key: string]: unknown;
}

/** Default Qoder CLI settings file. */
export const DEFAULT_QODER_CLI_SETTINGS: QoderCliSettingsFile = {
  $schema: 'https://json.schemastore.org/qoder-code-settings.json',
  permissions: {
    allow: [],
    deny: [],
    ask: [],
  },
};
