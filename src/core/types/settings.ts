export interface ApprovalSelectionDecision {
  type: 'select-option';
  value: string;
}

/** User decision from the approval modal. */
export type ApprovalDecision =
  | 'allow'
  | 'allow-always'
  | 'deny'
  | 'cancel'
  | ApprovalSelectionDecision;

/** Source of a slash command. */
export type SlashCommandSource = 'builtin' | 'user' | 'plugin' | 'sdk';

/** Slash command configuration shared by the UI, storage, and runtime boundary. */
export interface SlashCommand {
  id: string;
  name: string;                // Command name used after / (e.g., "review-code")
  description?: string;        // Optional description shown in dropdown
  argumentHint?: string;       // Placeholder text for arguments (e.g., "[file] [focus]")
  allowedTools?: string[];     // Restrict tools when command is used
  model?: string;              // Optional Qoder model override
  content: string;             // Prompt template with placeholders
  source?: SlashCommandSource; // Origin of the command (builtin, user, plugin, sdk)
  kind?: 'command' | 'skill';  // Explicit type — replaces id-prefix heuristic
  // Qoder command metadata that the UI preserves and round-trips.
  disableModelInvocation?: boolean;  // Disable model invocation for this skill
  userInvocable?: boolean;           // Whether user can invoke this skill directly
  context?: 'fork';                  // Subagent execution mode
  agent?: string;                    // Subagent type when context='fork'
  hooks?: Record<string, unknown>;   // Pass-through to SDK
}

/** Keyboard navigation settings for vim-style scrolling. */
export interface KeyboardNavigationSettings {
  scrollUpKey: string;         // Key to scroll up when focused on messages (default: 'w')
  scrollDownKey: string;       // Key to scroll down when focused on messages (default: 's')
  focusInputKey: string;       // Key to focus input (default: 'i', like vim insert mode)
}

export const CHAT_VIEW_PLACEMENTS = [
  'right-sidebar',
  'left-sidebar',
  'main-tab',
] as const;

/** Workspace location used when opening the Qoderian chat view. */
export type ChatViewPlacement = typeof CHAT_VIEW_PLACEMENTS[number];

/** Result from instruction refinement agent query. */
export interface InstructionRefineResult {
  success: boolean;
  refinedInstruction?: string;  // The refined instruction text
  clarification?: string;       // Agent's clarifying question (if any)
  error?: string;               // Error message (if failed)
}

/**
 * Permission mode for tool execution, mapped directly to Qoder SDK policies.
 * Only default/auto/yolo are user-selectable; plan can arrive from the SDK.
 */
export type PermissionMode = 'default' | 'auto' | 'plan' | 'yolo';

/** Opaque device-keyed CLI paths for per-device configuration. */
export type HostnameCliPaths = Record<string, string>;

/** Supported Qoder CLI distribution builds. */
export const QODER_CLI_EDITIONS = ['global', 'cn'] as const;

/**
 * Qoder CLI distribution edition: the international build (`qodercli`,
 * config under `~/.qoder`) or the China build (`qoderclicn`, config under
 * `~/.qoder-cn`).
 */
export type QoderCliEdition = typeof QODER_CLI_EDITIONS[number];

/** Server context-window tier, e.g. the 200K/400K/1M editor choices. */
export interface ModelContextTier {
  /** Display tier label from the server, e.g. '200K'. */
  label: string;
  tokenCount: number;
  isDefault: boolean;
}

/** Server thinking effort level, e.g. the low/medium/xhigh editor choices. */
export interface ModelThinkingEffort {
  /** Effort value accepted by the CLI, e.g. 'xhigh'. */
  value: string;
  isDefault: boolean;
  /** Server description of the level, shown as a tooltip in the IDE. */
  description?: string;
}

/** Per-model editor overrides mirroring the Qoder IDE model edit panel. */
export interface QoderModelOverride {
  /** Selected context-window tier in tokens; absent means server default. */
  contextWindow?: number;
  /** False disables thinking for models that support it. */
  thinkingEnabled?: boolean;
  /** Per-model reasoning effort; absent means server default. */
  thinkingEffort?: string;
}

/** Qoder CLI settings stored alongside Qoderian's general preferences. */
export interface QoderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  /** Selected Qoder CLI distribution build. */
  edition: QoderCliEdition;
  loadUserSettings: boolean;
  enableBangBash: boolean;
  discoveredModels: Array<{
    value: string;
    displayName: string;
    description: string;
    /** Selector group label mirroring the Qoder IDE tabs (e.g. 'New models'). */
    group?: string;
    /** Credit multiplier reported by the server. */
    priceFactor?: number;
    /** Pre-discount multiplier, when the server prices this model down. */
    originalPriceFactor?: number;
    /** Configurable context-window tiers reported by the server. */
    contextTiers?: ModelContextTier[];
    /** Whether the server allows explicitly disabling thinking. */
    thinkingDisableable?: boolean;
    /** Configurable thinking effort levels reported by the server. */
    thinkingEfforts?: ModelThinkingEffort[];
    promotion?: {
      active?: boolean;
      /** Server-localized badge text keyed by `en` / `zh`. */
      badge?: Record<string, string>;
      discountFactor?: number;
      /** Human-readable off-peak window, e.g. '22:00-08:00 Asia/Singapore'. */
      window?: string;
    };
  }>;
  /** Last successful agent snapshot reported by the Qoder CLI. */
  discoveredAgents: Array<{
    name: string;
    description?: string;
    model?: string;
  }>;
  lastModel: string;
  /** Per-model editor overrides keyed by runtime model id. */
  modelOverrides: Record<string, QoderModelOverride>;
}

/**
 * Application settings stored in .qoderian/qoderian-settings.json.
 *
 * Qoder model identifiers and effort levels remain strings because the SDK
 * catalog is dynamic and may add models without a plugin schema migration.
 */
export interface QoderianSettings {
  // User preferences
  userName: string;

  // Security
  permissionMode: PermissionMode;

  // Qoder model and reasoning effort
  model: string;
  enableAutoTitleGeneration: boolean;
  titleGenerationModel: string;

  // Content settings
  excludedTags: string[];
  mediaFolder: string;
  systemPrompt: string;
  persistentExternalContextPaths: string[];

  // UI settings
  keyboardNavigation: KeyboardNavigationSettings;
  requireCommandOrControlEnterToSend: boolean;

  // Internationalization
  locale: string;

  // Qoder CLI
  qoder: QoderSettings;

  // UI preferences
  maxTabs: number;
  enableAutoScroll: boolean;
  deferMathRenderingDuringStreaming: boolean;
  expandFileEditsByDefault: boolean;
  chatViewPlacement: ChatViewPlacement;

  // Allow forward-compatible settings fields
  [key: string]: unknown;
}
