import type { Component, WorkspaceLeaf } from 'obsidian';

import type { ChatRuntime } from '../../../core/runtime/chat-runtime';
import type { AppTabManagerState, InstructionRefineService, TitleGenerationService } from '../../../core/types/services';
import type { SlashCommandDropdown } from '../../../shared/components/slash-command-dropdown';
import type { BrowserSelectionController } from '../controllers/browser-selection-controller';
import type { CanvasSelectionController } from '../controllers/canvas-selection-controller';
import type { ContextRowOverflowController } from '../controllers/context-row-overflow';
import type { ConversationController } from '../controllers/conversation-controller';
import type { InputController } from '../controllers/input-controller';
import type { NavigationController } from '../controllers/navigation-controller';
import type { SelectionController } from '../controllers/selection-controller';
import type { StreamController } from '../controllers/stream-controller';
import type { MessageRenderer } from '../rendering/message-renderer';
import type { SubagentManager } from '../services/subagent-manager';
import type { ChatState } from '../state/chat-state';
import type { BangBashModeManager } from '../ui/bang-bash-mode-manager';
import type { ComposerActionButton } from '../ui/composer-action-button';
import type { FileContextManager } from '../ui/file-context/file-context-manager';
import type { ImageContextManager } from '../ui/image-context';
import type {
  ContextUsageMeter,
  ExternalContextSelector,
  McpServerSelector,
  ModelSelector,
  PermissionToggle,
} from '../ui/input-toolbar';
import type { InstructionModeManager } from '../ui/instruction-mode-manager';
import type { NavigationSidebar } from '../ui/navigation-sidebar';
import type { StatusPanel } from '../ui/status-panel';
import type { VaultDropController } from '../ui/vault-drop';

/**
 * Default number of tabs allowed.
 *
 * Set to 3 to balance usability with resource usage:
 * - Each tab has its own chat runtime and persistent query
 * - More tabs = more memory and potential SDK processes
 * - 3 tabs allows multi-tasking without excessive overhead
 */
export const DEFAULT_MAX_TABS = 3;

/**
 * Minimum number of tabs allowed (settings floor).
 */
export const MIN_TABS = 3;

/**
 * Maximum number of tabs allowed (settings ceiling).
 * Users can configure up to this many tabs via settings.
 */
export const MAX_TABS = 10;

/**
 * Minimal interface for the QoderianView methods used by TabManager and Tab.
 * Extends Component for Obsidian integration (event handling, cleanup).
 * Avoids circular dependency by not importing QoderianView directly.
 */
export interface TabManagerViewHost extends Component {
  /** Reference to the workspace leaf for revealing the view. */
  leaf: WorkspaceLeaf;

  /** Gets the tab manager instance (used for cross-view coordination). */
  getTabManager(): TabManagerInterface | null;

  /** Gets view-owned elements that should preserve active tab selection context. */
  getSharedSelectionFocusScopeEls?(): HTMLElement[];
}

/**
 * Minimal interface for TabManager methods used by external code.
 * Used to break circular dependencies.
 */
export interface TabManagerInterface {
  /** Switches to a specific tab. */
  switchToTab(tabId: TabId): Promise<void>;

  /** Gets all tabs. */
  getAllTabs(): TabData[];
}

/** Tab identifier type. */
export type TabId = string;

/** Generates a unique tab ID. */
export function generateTabId(): TabId {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Controllers managed per-tab.
 * Each tab has its own set of controllers for independent operation.
 */
export interface TabControllers {
  selectionController: SelectionController | null;
  browserSelectionController: BrowserSelectionController | null;
  canvasSelectionController: CanvasSelectionController | null;
  conversationController: ConversationController | null;
  streamController: StreamController | null;
  inputController: InputController | null;
  navigationController: NavigationController | null;
  contextRowOverflow: ContextRowOverflowController | null;
}

/**
 * Services managed per-tab.
 */
export interface TabServices {
  subagentManager: SubagentManager;
  instructionRefineService: InstructionRefineService | null;
  titleGenerationService: TitleGenerationService | null;
}

/**
 * UI components managed per-tab.
 */
export interface TabUIComponents {
  fileContextManager: FileContextManager | null;
  imageContextManager: ImageContextManager | null;
  vaultDropController: VaultDropController | null;
  modelSelector: ModelSelector | null;
  externalContextSelector: ExternalContextSelector | null;
  mcpServerSelector: McpServerSelector | null;
  permissionToggle: PermissionToggle | null;
  composerActionButton: ComposerActionButton | null;
  slashCommandDropdown: SlashCommandDropdown | null;
  instructionModeManager: InstructionModeManager | null;
  bangBashModeManager: BangBashModeManager | null;
  contextUsageMeter: ContextUsageMeter | null;
  statusPanel: StatusPanel | null;
  navigationSidebar: NavigationSidebar | null;
}

/**
 * DOM elements managed per-tab.
 */
export interface TabDOMElements {
  contentEl: HTMLElement;
  messagesEl: HTMLElement;
  welcomeEl: HTMLElement | null;

  /** Container for status panel (fixed between messages and input). */
  statusPanelContainerEl: HTMLElement;

  /** Per-tab composer root. Inline prompts render here as siblings of the input container. */
  inputComposerEl: HTMLElement;
  inputContainerEl: HTMLElement;
  queueIndicatorEl: HTMLElement;
  inputWrapper: HTMLElement;
  inputEl: HTMLTextAreaElement;

  /** Nav row for tab badges and header icons (above input wrapper). */
  navRowEl: HTMLElement;

  /** Context row for file chips and selection indicator (inside input wrapper). */
  contextRowEl: HTMLElement;

  selectionIndicatorEl: HTMLElement | null;
  browserIndicatorEl: HTMLElement | null;
  canvasIndicatorEl: HTMLElement | null;

  /** Cleanup functions for event listeners (prevents memory leaks). */
  eventCleanups: Array<() => void>;
}

/**
 * Tab lifecycle states:
 * - `blank`: No conversation binding, no runtime. Draft model selection only.
 * - `bound_cold`: Bound to a conversation, but runtime not started yet.
 * - `bound_active`: Bound to a conversation with a running runtime.
 * - `closing`: Tab is being torn down.
 */
export type TabLifecycleState = 'blank' | 'bound_cold' | 'bound_active' | 'closing';

/**
 * Represents a single tab in the multi-tab system.
 * Each tab is an independent chat session with its own runtime instance.
 */
export interface TabData {
  /** Unique tab identifier. */
  id: TabId;

  /** Explicit lifecycle state. */
  lifecycleState: TabLifecycleState;

  /**
   * Draft model selected in a blank tab (before first send).
   * Null after the first send binds a conversation.
   */
  draftModel: string | null;

  /** Conversation ID bound to this tab (null for new/empty tabs). */
  conversationId: string | null;

  /** Per-tab chat runtime instance for independent streaming. */
  service: ChatRuntime | null;

  /** Whether the service has been initialized (lazy start). */
  serviceInitialized: boolean;

  /** Per-tab chat state. */
  state: ChatState;

  /** Per-tab controllers. */
  controllers: TabControllers;

  /** Per-tab services. */
  services: TabServices;

  /** Per-tab UI components. */
  ui: TabUIComponents;

  /** Per-tab DOM elements. */
  dom: TabDOMElements;

  /** Per-tab renderer. */
  renderer: MessageRenderer | null;
}

export type TabQoderContext = Pick<TabData, 'conversationId' | 'service' | 'lifecycleState' | 'draftModel'>;

/**
 * Persisted tab state for restoration on plugin reload.
 * Aliases the app-level storage contract so the shape stays defined once.
 */
export type PersistedTabState = AppTabManagerState['openTabs'][number];

/**
 * Tab manager state persisted to data.json.
 */
export type PersistedTabManagerState = AppTabManagerState;

/**
 * Callbacks for tab state changes.
 */
export interface TabManagerCallbacks {
  /** Called when a tab is created. */
  onTabCreated?: (tab: TabData) => void;

  /** Called immediately after the active tab changes, before async tab loading completes. */
  onActiveTabChanged?: (fromTabId: TabId | null, toTabId: TabId) => void;

  /** Called when switching to a different tab. */
  onTabSwitched?: (fromTabId: TabId | null, toTabId: TabId) => void;

  /** Called when a tab is closed. */
  onTabClosed?: (tabId: TabId) => void;

  /** Called when tab streaming state changes. */
  onTabStreamingChanged?: (tabId: TabId, isStreaming: boolean) => void;

  /** Called when tab title changes. */
  onTabTitleChanged?: (tabId: TabId, title: string) => void;

  /** Called when tab attention state changes (approval pending, etc.). */
  onTabAttentionChanged?: (tabId: TabId, needsAttention: boolean) => void;

  /** Called when a tab's conversation changes (loaded different conversation in same tab). */
  onTabConversationChanged?: (tabId: TabId, conversationId: string | null) => void;

}

/**
 * Tab bar item representation for rendering.
 */
export interface TabBarItem {
  id: TabId;
  /** 1-based index for display. */
  index: number;
  title: string;
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
}
