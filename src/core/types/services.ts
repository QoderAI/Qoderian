import type { CursorContext } from '../editor/editor-context';
import type {
  AgentDefinition,
  InstructionRefineResult,
  ManagedMcpServer,
  PluginInfo,
} from './index';
import type { ModelContextTier, ModelThinkingEffort } from './settings';
// ---------------------------------------------------------------------------
// App-level service interfaces
// ---------------------------------------------------------------------------

/** Tab manager state persisted across restarts. */
export interface AppTabManagerState {
  openTabs: Array<{ tabId: string; conversationId: string | null; draftModel?: string | null }>;
  activeTabId: string | null;
}

// Workspace ports shared by the application features and the Qoder adapter.

export interface AppMcpStorage {
  load(): Promise<ManagedMcpServer[]>;
  save(servers: ManagedMcpServer[]): Promise<void>;
  tryParseClipboardConfig?(text: string): unknown;
}

export interface AppAgentStorage {
  loadAll(): Promise<AgentDefinition[]>;
  load(agent: AgentDefinition): Promise<AgentDefinition | null>;
  save(agent: AgentDefinition): Promise<void>;
  delete(agent: AgentDefinition): Promise<void>;
}

export interface AgentMentionIndex {
  searchAgents(query: string): Array<{
    id: string;
    description?: string;
  }>;
}

/** Qoder workspace plugin manager interface consumed by the app layer. */
export interface AppPluginManager {
  loadPlugins(): Promise<void>;
  getPlugins(): PluginInfo[];
  hasPlugins(): boolean;
  hasEnabledPlugins(): boolean;
  getEnabledCount(): number;
  getPluginsKey(): string;
  togglePlugin(pluginId: string): Promise<void>;
  enablePlugin(pluginId: string): Promise<void>;
  disablePlugin(pluginId: string): Promise<void>;
}

/** One quota bucket of the account credits usage snapshot. */
export interface CreditsUsageQuota {
  total?: number;
  used?: number;
  remaining?: number;
  percentage?: number;
}

/**
 * Account credits usage snapshot as reported by the Qoder SDK.
 * Mirrors the SDK `UsageInfo` shape without coupling core types to the SDK.
 */
export interface CreditsUsageSnapshot {
  userType?: string;
  totalUsagePercentage?: number;
  expiresAt?: number;
  upgradeUrl?: string;
  isQuotaExceeded?: boolean;
  userQuota?: CreditsUsageQuota;
  addOnQuota?: CreditsUsageQuota;
  orgResourcePackage?: CreditsUsageQuota & { cap?: number; available?: boolean };
}

/** Runtime catalog of agents discovered from the Qoder CLI. */
export interface AppAgentCatalog extends AgentMentionIndex {
  /**
   * Re-probes the CLI; keeps the previous snapshot when the probe fails.
   * Resolves true when the probe succeeded.
   */
  refresh(): Promise<boolean>;
  getAvailableAgents(): AgentDefinition[];
  getAgentById(id: string): AgentDefinition | undefined;
  /** Merges agent names reported by a live session init into the catalog. */
  applySessionAgents(names: string[]): void;

  /** Current availability of the local Qoder runtime and its model catalog. */
  getRuntimeStatus(): QoderRuntimeStatus;
  /** Receives runtime availability changes, including background refreshes. */
  subscribeRuntimeStatus(listener: (status: QoderRuntimeStatus) => void): () => void;
  /** Latest account credits usage from the last successful probe, if any. */
  getUsageInfo(): CreditsUsageSnapshot | null;
}

export type QoderRuntimeStatusKind =
  | 'checking'
  | 'ready'
  | 'cliMissing'
  | 'nodeMissing'
  | 'authRequired'
  | 'incompatible'
  | 'offline'
  | 'noModels'
  | 'failed';

export interface QoderRuntimeStatus {
  kind: QoderRuntimeStatusKind;
  message: string;
  details?: string;
}

/** Option for model, reasoning, or other UI selectors. */
export interface UIOption {
  value: string;
  label: string;
  description?: string;
  /** Optional group label for visual separators in dropdowns. */
  group?: string;
  /** Trailing credit multiplier shown on the option row, e.g. '1.6x'. */
  priceLabel?: string;
  /** Trailing promotion badge shown on the option row, e.g. '错峰5折'. */
  promotionLabel?: string;
  /** Configurable context-window tiers for the model edit panel. */
  contextTiers?: ModelContextTier[];
  /** Whether the model edit panel may offer disabling thinking. */
  thinkingDisableable?: boolean;
  /** Configurable thinking effort levels for the model edit panel. */
  thinkingEfforts?: ModelThinkingEffort[];
}

export interface PathIconSvg {
  kind?: 'path';
  viewBox: string;
  path: string;
}

export interface SvgPathChild {
  tag: 'path';
  attributes: Record<string, string>;
}

export interface SvgGroupChild {
  tag: 'g';
  attributes: Record<string, string>;
  children: SvgPathChild[];
}

export type SvgChild = SvgGroupChild | SvgPathChild;

export interface CompositeIconSvg {
  kind: 'composite';
  viewBox: string;
  children: SvgChild[];
}

/** A complete inline SVG asset. */
export interface RawIconSvg {
  kind: 'raw';
  viewBox: string;
  svg: string;
}

/** SVG icon descriptor used by Qoderian UI. */
export type IconSvg = PathIconSvg | CompositeIconSvg | RawIconSvg;

/** Qoder reasoning-effort option. */
export type ReasoningOption = UIOption;

// ---------------------------------------------------------------------------
// Auxiliary service contracts
// ---------------------------------------------------------------------------

// -- Title generation --

export type TitleGenerationResult =
  | { success: true; title: string }
  | { success: false; error: string };

export type TitleGenerationCallback = (
  conversationId: string,
  result: TitleGenerationResult
) => Promise<void>;

export interface TitleGenerationService {
  generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback
  ): Promise<void>;
  cancel(): void;
}

// -- Instruction refinement --

export type RefineProgressCallback = (update: InstructionRefineResult) => void;

export interface InstructionRefineService {
  setModelOverride?(model?: string): void;
  resetConversation(): void;
  refineInstruction(
    rawInstruction: string,
    existingInstructions: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult>;
  continueConversation(
    message: string,
    onProgress?: RefineProgressCallback
  ): Promise<InstructionRefineResult>;
  cancel(): void;
}

// -- Inline edit --

export type InlineEditMode = 'selection' | 'cursor';

export interface InlineEditSelectionRequest {
  mode: 'selection';
  instruction: string;
  notePath: string;
  selectedText: string;
  startLine?: number;
  lineCount?: number;
  contextFiles?: string[];
}

export interface InlineEditCursorRequest {
  mode: 'cursor';
  instruction: string;
  notePath: string;
  cursorContext: CursorContext;
  contextFiles?: string[];
}

export type InlineEditRequest = InlineEditSelectionRequest | InlineEditCursorRequest;

export interface InlineEditResult {
  success: boolean;
  editedText?: string;
  insertedText?: string;
  clarification?: string;
  error?: string;
}

export interface InlineEditService {
  setModelOverride?(model?: string): void;
  resetConversation(): void;
  editText(request: InlineEditRequest): Promise<InlineEditResult>;
  continueConversation(message: string, contextFiles?: string[]): Promise<InlineEditResult>;
  cancel(): void;
}
