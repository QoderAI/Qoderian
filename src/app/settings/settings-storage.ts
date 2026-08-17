import type { VaultFileAdapter } from '../../core/storage/vault-file-adapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type KeyboardNavigationSettings,
  type PermissionMode,
  type QoderianSettings,
} from '../../core/types/settings';
import {
  DEFAULT_QODER_SETTINGS,
  getQoderSettings,
  updateQoderSettings,
} from '../../qoder/config/settings';
import { QODERIAN_SETTINGS_PATH } from '../storage/storage-paths';

export { QODERIAN_SETTINGS_PATH };

export type StoredQoderianSettings = QoderianSettings;

export const DEFAULT_QODERIAN_SETTINGS: QoderianSettings = {
  userName: '',

  permissionMode: 'acceptEdits',

  model: 'auto',
  enableAutoTitleGeneration: true,
  titleGenerationModel: 'auto',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  qoder: { ...DEFAULT_QODER_SETTINGS },

  maxTabs: 3,
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',
};

export interface SettingsRecoveryNotice {
  sourcePath: string;
  backupPath: string | null;
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(value: unknown): ChatViewPlacement {
  return isChatViewPlacement(value)
    ? value
    : DEFAULT_QODERIAN_SETTINGS.chatViewPlacement;
}

const PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'auto',
  'plan',
  'yolo',
]);

function normalizePermissionMode(
  value: unknown,
  storedQoder: unknown,
): PermissionMode {
  if (typeof value === 'string' && PERMISSION_MODES.has(value as PermissionMode)) {
    return value as PermissionMode;
  }

  // Before the explicit five-level selector, "normal" delegated to qoder.safeMode.
  if (value === 'normal' && storedQoder && typeof storedQoder === 'object') {
    const safeMode = (storedQoder as { safeMode?: unknown }).safeMode;
    if (safeMode === 'default' || safeMode === 'acceptEdits' || safeMode === 'auto') {
      return safeMode;
    }
  }

  return DEFAULT_QODERIAN_SETTINGS.permissionMode;
}

// Stored settings may carry a partial object (e.g. hand-edited JSON); a plain
// spread would erase the missing keys, so merge each key onto the defaults.
function normalizeKeyboardNavigation(value: unknown): KeyboardNavigationSettings {
  const defaults = DEFAULT_QODERIAN_SETTINGS.keyboardNavigation;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaults };
  }

  const candidate = value as Partial<Record<keyof KeyboardNavigationSettings, unknown>>;
  const pick = (key: keyof KeyboardNavigationSettings): string =>
    typeof candidate[key] === 'string' && candidate[key]
      ? candidate[key]
      : defaults[key];

  return {
    scrollUpKey: pick('scrollUpKey'),
    scrollDownKey: pick('scrollDownKey'),
    focusInputKey: pick('focusInputKey'),
  };
}

export class QoderianSettingsStorage {
  private canOverwriteSettings = true;

  constructor(
    private adapter: VaultFileAdapter,
    private onRecovery?: (notice: SettingsRecoveryNotice) => void,
  ) {}

  async load(): Promise<StoredQoderianSettings> {
    if (!(await this.adapter.exists(QODERIAN_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(QODERIAN_SETTINGS_PATH);
    let stored: Record<string, unknown>;
    try {
      stored = JSON.parse(content) as Record<string, unknown>;
    } catch {
      const backupPath = await this.backupInvalidSettings();
      this.canOverwriteSettings = backupPath !== null;
      this.onRecovery?.({
        sourcePath: QODERIAN_SETTINGS_PATH,
        backupPath,
      });
      return this.getDefaults();
    }

    // Drop removed settings instead of keeping invisible configuration active.
    const {
      customContextLimits: _removedContextLimits,
      sharedEnvironmentVariables: _removedSharedEnvironment,
      envSnippets: _removedEnvironmentSnippets,
      customModelAliases: _removedModelAliases,
      hiddenCommands: _removedHiddenCommands,
      ...storedWithoutRemovedSettings
    } = stored;
    const merged = {
      ...this.getDefaults(),
      ...storedWithoutRemovedSettings,
      permissionMode: normalizePermissionMode(stored.permissionMode, stored.qoder),
      chatViewPlacement: normalizeChatViewPlacement(stored.chatViewPlacement),
      keyboardNavigation: normalizeKeyboardNavigation(stored.keyboardNavigation),
    };

    updateQoderSettings(merged, getQoderSettings(stored));

    return merged;
  }

  async save(settings: StoredQoderianSettings): Promise<void> {
    if (!this.canOverwriteSettings) {
      throw new Error(`Refusing to overwrite invalid settings at ${QODERIAN_SETTINGS_PATH}.`);
    }
    const content = JSON.stringify(settings, null, 2);
    await this.adapter.write(QODERIAN_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(QODERIAN_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredQoderianSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  private getDefaults(): StoredQoderianSettings {
    // Callers receive an owned copy; handing out the module constant would let
    // any mutation silently poison the defaults for the rest of the session.
    return structuredClone(DEFAULT_QODERIAN_SETTINGS);
  }

  private async backupInvalidSettings(): Promise<string | null> {
    const backupPath = `${QODERIAN_SETTINGS_PATH}.corrupt-${Date.now()}.bak`;
    try {
      await this.adapter.rename(QODERIAN_SETTINGS_PATH, backupPath);
      return backupPath;
    } catch {
      return null;
    }
  }
}
