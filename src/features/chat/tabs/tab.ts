import type { Component } from 'obsidian';
import { Notice } from 'obsidian';

import { getBuiltInCommandsForDropdown } from '../../../core/commands/built-in-commands';
import { getEnhancedPath } from '../../../core/env/environment';
import { getVaultPath } from '../../../core/fs/path';
import type { ChatRuntime } from '../../../core/runtime/chat-runtime';
import type { ChatMessage, Conversation, QoderState } from '../../../core/types';
import type { QoderModelOverride } from '../../../core/types/settings';
import { t } from '../../../i18n/i18n';
import type QoderianPlugin from '../../../main';
import { getQoderSettings, updateQoderSettings } from '../../../qoder/config/settings';
import {
  SlashCommandDropdown,
  toSlashCommandDropdownEntries,
} from '../../../shared/components/slash-command-dropdown';
import { openVaultEntry } from '../../../shared/obsidian/compat';
import { BrowserSelectionController } from '../controllers/browser-selection-controller';
import { CanvasSelectionController } from '../controllers/canvas-selection-controller';
import { ContextRowOverflowController } from '../controllers/context-row-overflow';
import { ConversationController } from '../controllers/conversation-controller';
import { InputController } from '../controllers/input-controller';
import { NavigationController } from '../controllers/navigation-controller';
import { createSelectionChip } from '../controllers/selection-chip';
import { SelectionController } from '../controllers/selection-controller';
import { StreamController } from '../controllers/stream-controller';
import { MessageRenderer } from '../rendering/message-renderer';
import { BangBashService } from '../services/bang-bash-service';
import { SubagentManager } from '../services/subagent-manager';
import { ChatState } from '../state/chat-state';
import { BangBashModeManager as BangBashModeManagerClass } from '../ui/bang-bash-mode-manager';
import { ComposerBridge } from '../ui/composer/composer-bridge';
import { ComposerActionButton } from '../ui/composer-action-button';
import { FileContextManager } from '../ui/file-context/file-context-manager';
import { ImageContextManager } from '../ui/image-context';
import { createInputToolbar } from '../ui/input-toolbar';
import { InstructionModeManager as InstructionModeManagerClass } from '../ui/instruction-mode-manager';
import { NavigationSidebar } from '../ui/navigation-sidebar';
import { StatusPanel } from '../ui/status-panel';
import { autoResizeTextarea } from '../ui/textarea-resize';
import { findRewindContext } from '../utils/rewind';
import { recalculateUsageForModel } from '../utils/usage-info';
import { generateMessageId } from './message-id';
import { buildTabDOM } from './tab-dom';
import {
  applyQoderUIGating,
  cleanupTabRuntime,
  ensureTitleGenerationService,
  getQoderMcpManager,
  getSharedSelectionFocusScopeEls,
  getTabModelConfig,
  getTabPermissionMode,
  getTabSettingsSnapshot,
  type QoderCatalogInfo,
  refreshTabQoderUI,
  resolveBlankTabModel,
  syncSlashCommandDropdownForQoder,
  syncTabQoderServices,
  updateTabQoderSettings,
} from './tab-qoder-context';
import { setupServiceCallbacks, updatePlanModeUI } from './tab-runtime-callbacks';
import type { TabData, TabId } from './types';
import { generateTabId } from './types';

export { sendTabInputMessageFromExplicitEnterShortcut } from './input-shortcuts';
export { wireTabInputEvents } from './tab-input-events';
export { activateTab, deactivateTab, destroyTab, getTabTitle } from './tab-lifecycle';
export { updatePlanModeUI } from './tab-runtime-callbacks';

export interface TabCreateOptions {
  plugin: QoderianPlugin;

  containerEl: HTMLElement;
  conversation?: Conversation;
  tabId?: TabId;
  /** Restored draft model for blank tabs. */
  draftModel?: string | null;
  onStreamingChanged?: (isStreaming: boolean) => void;
  onTitleChanged?: (title: string) => void;
  onAttentionChanged?: (needsAttention: boolean) => void;
  onConversationIdChanged?: (conversationId: string | null) => void;
}

/**
 * Creates a new Tab instance with all required state.
 */
export function createTab(options: TabCreateOptions): TabData {
  const {
    plugin,
    containerEl,
    conversation,
    tabId,
    onStreamingChanged,
    onAttentionChanged,
    onConversationIdChanged,
  } = options;

  const id = tabId ?? generateTabId();

  const contentEl = containerEl.createDiv({ cls: 'qoderian-tab-content qoderian-hidden' });

  const state = new ChatState({
    onStreamingStateChanged: onStreamingChanged,
    onAttentionChanged: onAttentionChanged,
    onConversationChanged: onConversationIdChanged,
  });

  // Create subagent manager with no-op callback.
  // This placeholder is replaced in initializeTabControllers() with the actual
  // callback that updates the StreamController. We defer the real callback
  // because StreamController doesn't exist until controllers are initialized.
  const subagentManager = new SubagentManager(
    () => {},
    plugin.qoderServices.taskResultInterpreter,
  );

  const dom = buildTabDOM(contentEl);
  state.queueIndicatorEl = dom.queueIndicatorEl;

  const isBound = !!conversation?.id;
  const restoredDraftModel = typeof options.draftModel === 'string'
    ? options.draftModel.trim()
    : '';
  const draftModel = isBound
    ? null
    : (restoredDraftModel || resolveBlankTabModel(plugin));
  const tab: TabData = {
    id,
    lifecycleState: isBound ? 'bound_cold' : 'blank',
    draftModel,
    conversationId: conversation?.id ?? null,
    service: null,
    serviceInitialized: false,
    state,
    controllers: {
      selectionController: null,
      browserSelectionController: null,
      canvasSelectionController: null,
      conversationController: null,
      streamController: null,
      inputController: null,
      navigationController: null,
      contextRowOverflow: null,
    },
    services: {
      subagentManager,
      instructionRefineService: null,
      titleGenerationService: null,
    },
    ui: {
      composerBridge: null,
      fileContextManager: null,
      imageContextManager: null,
      modelSelector: null,
      externalContextSelector: null,
      mcpServerSelector: null,
      permissionToggle: null,
      composerActionButton: null,
      slashCommandDropdown: null,
      instructionModeManager: null,
      bangBashModeManager: null,
      contextUsageMeter: null,
      statusPanel: null,
      navigationSidebar: null,
    },
    dom,
    renderer: null,
  };

  return tab;
}

/**
 * Initializes the tab's chat runtime for the send path.
 *
 * This is the ONLY place a runtime is created. Called from:
 * - ensureServiceInitialized() in InputController.sendMessage()
 *
 * Session sync is passive (state update only). The runtime is started
 * on demand by query() inside the send path.
 */
export async function initializeTabService(
  tab: TabData,
  plugin: QoderianPlugin,
  conversationOverride?: Conversation | null,
): Promise<void> {
  if (tab.lifecycleState === 'closing') {
    return;
  }

  const conversation = conversationOverride ?? (
    tab.conversationId
      ? await plugin.getConversationById(tab.conversationId)
      : null
  );
  if (tab.serviceInitialized && tab.service) {
    return;
  }

  let service: ChatRuntime | null = null;
  let unsubscribeReadyState: (() => void) | null = null;
  const previousService = tab.service;

  try {
    if (typeof previousService?.cleanup === 'function') {
      await previousService.cleanup();
    }
    tab.service = null;
    tab.serviceInitialized = false;

    const runtime = plugin.qoderServices.createRuntime();
    service = runtime;
    unsubscribeReadyState = runtime.onReadyStateChange(() => {});
    tab.dom.eventCleanups.push(() => unsubscribeReadyState?.());

    // Passive sync: set session state without starting the runtime process.
    // The runtime starts on demand when query() is called.
    if (conversation) {
      const hasMessages = conversation.messages.length > 0;
      const externalContextPaths = hasMessages
        ? conversation.externalContextPaths || []
        : (plugin.settings.persistentExternalContextPaths || []);

      runtime.syncConversationState(conversation, externalContextPaths);
    }

    // Re-check after async operations — tab may have been closed during init
    if (isClosingLifecycleState(tab.lifecycleState)) {
      unsubscribeReadyState?.();
      await service?.cleanup();
      return;
    }


    tab.service = service;
    tab.serviceInitialized = true;

    // Update lifecycle state
    if (tab.lifecycleState === 'blank') {
      tab.draftModel = null;
    }
    tab.lifecycleState = 'bound_active';
  } catch (error) {
    // Clean up partial state on failure
    unsubscribeReadyState?.();
    await service?.cleanup();
    tab.service = null;
    tab.serviceInitialized = false;

    // Re-throw to let caller handle (e.g., show error to user)
    throw error;
  }
}

function initializeContextManagers(tab: TabData, plugin: QoderianPlugin): void {
  const { dom } = tab;
  const app = plugin.app;

  // Live composer bridge - must exist before other input consumers so its
  // textarea interceptors cover every later listener/programmatic access.
  tab.ui.composerBridge = new ComposerBridge(dom.inputEl, {
    onOpenReference: (reference) => {
      openVaultEntry(app, reference.path);
    },
  });

  // File context manager - chips in contextRowEl, dropdown in inputContainerEl
  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.inputEl,
    {
      getExcludedTags: () => plugin.settings.excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
      },
      onReferencesChanged: (references) => {
        tab.ui.composerBridge?.setReferences(references);
      },
      getExternalContexts: () => tab.ui.externalContextSelector?.getExternalContexts() || [],
    },
    dom.inputContainerEl
  );
  tab.ui.fileContextManager.setMcpManager(getQoderMcpManager(plugin));

  // Image context manager - drag/drop uses inputContainerEl, preview in contextRowEl
  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.inputEl);
        tab.renderer?.scrollToBottomIfNeeded();
        updateComposerSendAvailability(tab);
      },
    },
    dom.contextRowEl
  );
}

function initializeSlashCommands(
  tab: TabData,
  catalogInfo?: QoderCatalogInfo,
): void {
  const { dom } = tab;

  tab.ui.slashCommandDropdown = new SlashCommandDropdown(
    dom.inputContainerEl,
    dom.inputEl,
    {
      onSelect: () => {},
      onHide: () => {},
    },
    {
      staticEntries: toSlashCommandDropdownEntries(getBuiltInCommandsForDropdown()),
      catalogConfig: catalogInfo?.config,
      getEntries: catalogInfo?.getEntries,
      subscribeCatalogChanges: catalogInfo?.subscribe,
    }
  );
}

/**
 * Initializes instruction and command modes for a tab.
 */
function initializeInputModes(tab: TabData, plugin: QoderianPlugin): void {
  const { dom } = tab;

  syncTabQoderServices(tab, plugin);
  ensureTitleGenerationService(tab, plugin);
  tab.ui.instructionModeManager = new InstructionModeManagerClass(
    dom.inputEl,
    {
      onSubmit: async (rawInstruction) => {
        await tab.controllers.inputController?.handleInstructionSubmit(rawInstruction);
      },
      getInputWrapper: () => dom.inputWrapper,
    }
  );

  // Bang bash mode (! command execution)
  if (isBangBashEnabled(plugin)) {
    const vaultPath = getVaultPath(plugin.app);
    if (vaultPath) {
      const enhancedPath = getEnhancedPath();
      const bashService = new BangBashService(vaultPath, enhancedPath);

      tab.ui.bangBashModeManager = new BangBashModeManagerClass(
        dom.inputEl,
        {
          onSubmit: async (command) => {
            const statusPanel = tab.ui.statusPanel;
            if (!statusPanel) return;

            const id = `bash-${Date.now()}`;
            statusPanel.addBashOutput({ id, command, status: 'running', output: '' });

            const result = await bashService.execute(command);
            const output = [result.stdout, result.stderr, result.error].filter(Boolean).join('\n').trim();
            const status = result.exitCode === 0 ? 'completed' : 'error';
            statusPanel.updateBashOutput(id, { status, output, exitCode: result.exitCode });
          },
          getInputWrapper: () => dom.inputWrapper,
        }
      );
    }
  }

  tab.ui.statusPanel = new StatusPanel();
  tab.ui.statusPanel.mount(dom.statusPanelContainerEl);
}

function isBangBashEnabled(plugin: QoderianPlugin): boolean {
  return getQoderSettings(plugin.settings).enableBangBash;
}

/** Refreshes the send button's enabled state based on composer content. */
function updateComposerSendAvailability(tab: TabData): void {
  const hasContent =
    tab.dom.inputEl.value.trim().length > 0 ||
    (tab.ui.imageContextManager?.hasImages() ?? false);
  tab.ui.composerActionButton?.updateSendAvailability(hasContent);
}

/**
 * Creates and wires the input toolbar for a tab.
 */
function initializeInputToolbar(
  tab: TabData,
  plugin: QoderianPlugin,
  getQoderCatalogConfig?: () => QoderCatalogInfo,
): void {
  const { dom } = tab;

  const inputToolbar = dom.inputWrapper.createDiv({ cls: 'qoderian-input-toolbar' });

  const toolbarComponents = createInputToolbar(inputToolbar, {
    getModelConfig: () => getTabModelConfig(tab, plugin),
    getSettings: () => getTabSettingsSnapshot(tab, plugin),
    getRuntimeStatus: () => plugin.qoderServices.agentCatalog.getRuntimeStatus(),
    subscribeRuntimeStatus: (listener) =>
      plugin.qoderServices.agentCatalog.subscribeRuntimeStatus(listener),
    retryRuntimeCatalog: async () => {
      await plugin.qoderServices.agentCatalog.refresh();
    },
    onModelChange: async (model: string) => {
      // Blank tabs keep their model choice until the first message binds them.
      if (tab.lifecycleState === 'blank') {
        tab.draftModel = model;
        // draftModel is part of the persisted tab state but no TabManager
        // callback fires for it — request persistence explicitly so a
        // restart can't silently drop the selection.
        plugin.requestPersistTabState();
        if (tab.service) {
          cleanupTabRuntime(tab);
        }
        syncSlashCommandDropdownForQoder(tab, plugin, getQoderCatalogConfig);

        const modelConfig = plugin.qoderServices.modelConfig;
        await updateTabQoderSettings(tab, plugin, (settings) => {
          settings.model = model;
          modelConfig.applyModelDefaults(model, settings);
        });
        tab.ui.modelSelector?.updateDisplay();
        tab.ui.modelSelector?.renderOptions();
        applyQoderUIGating(tab, plugin);
        return;
      }

      const modelConfig = getTabModelConfig(tab, plugin);
      await updateTabQoderSettings(tab, plugin, (settings) => {
        settings.model = model;
        modelConfig.applyModelDefaults(model, settings);
      });
      tab.ui.modelSelector?.updateDisplay();
      tab.ui.modelSelector?.renderOptions();

      // Recalculate context usage percentage for the new model's context window
      const currentUsage = tab.state.usage;
      if (currentUsage) {
        const newContextWindow = modelConfig.getContextWindowSize(model);
        tab.state.usage = recalculateUsageForModel(currentUsage, model, newContextWindow);
      }
    },
    onModelOverrideChange: async (model: string, override: Partial<QoderModelOverride>) => {
      await updateTabQoderSettings(tab, plugin, (settings) => {
        const current = getQoderSettings(settings).modelOverrides;
        const merged: QoderModelOverride = { ...current[model] };
        for (const [key, value] of Object.entries(override)) {
          if (value === undefined) {
            delete merged[key as keyof QoderModelOverride];
          } else {
            (merged as Record<string, unknown>)[key] = value;
          }
        }
        const next = { ...current };
        if (Object.keys(merged).length > 0) next[model] = merged;
        else delete next[model];
        updateQoderSettings(settings, { modelOverrides: next });
      });

      // The context meter tracks the effective window of the edited model.
      // Overrides for other models must not rewrite this conversation's
      // usage, which belongs to the currently selected model.
      const currentUsage = tab.state.usage;
      if (currentUsage && model === plugin.settings.model) {
        const modelConfig = getTabModelConfig(tab, plugin);
        const newContextWindow = modelConfig.getEffectiveContextWindowSize(
          model,
          plugin.settings,
        );
        tab.state.usage = recalculateUsageForModel(currentUsage, model, newContextWindow);
        tab.ui.contextUsageMeter?.update(tab.state.usage);
      }
    },
    onPermissionModeChange: async (mode) => {
      await updateTabQoderSettings(tab, plugin, (settings) => {
        settings.permissionMode = mode;
      });
      tab.ui.permissionToggle?.updateDisplay();
      dom.inputWrapper.toggleClass(
        'qoderian-input-plan-mode',
        mode === 'plan',
      );
    },
  });

  tab.ui.modelSelector = toolbarComponents.modelSelector;
  tab.ui.contextUsageMeter = toolbarComponents.contextUsageMeter;
  tab.ui.externalContextSelector = toolbarComponents.externalContextSelector;
  tab.ui.mcpServerSelector = toolbarComponents.mcpServerSelector;
  tab.ui.permissionToggle = toolbarComponents.permissionToggle;

  // Send/stop action button pinned to the end of the toolbar row.
  // Clicking it is equivalent to pressing Enter (or Esc while streaming).
  tab.ui.composerActionButton = new ComposerActionButton(inputToolbar, {
    onSend: () => {
      // Instruction/bang modes own the Enter key; route through the same
      // keydown path so their submit logic applies.
      if (
        tab.ui.instructionModeManager?.isActive() ||
        tab.ui.bangBashModeManager?.isActive()
      ) {
        dom.inputEl.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
        return;
      }
      void tab.controllers.inputController?.sendMessage();
    },
    onStop: () => {
      tab.controllers.inputController?.cancelStreaming();
    },
  });

  const updateSendAvailability = () => updateComposerSendAvailability(tab);
  dom.inputEl.addEventListener('input', updateSendAvailability);
  dom.eventCleanups.push(() => dom.inputEl.removeEventListener('input', updateSendAvailability));
  updateSendAvailability();

  tab.ui.mcpServerSelector.setMcpManager(getQoderMcpManager(plugin));

  // Sync @-mentions to UI selector
  tab.ui.fileContextManager?.setOnMcpMentionChange((servers) => {
    tab.ui.mcpServerSelector?.addMentionedServers(servers);
  });

  // Wire external context changes
  tab.ui.externalContextSelector.setOnChange(() => {
    tab.ui.fileContextManager?.preScanExternalContexts();
  });

  // Initialize persistent paths
  tab.ui.externalContextSelector.setPersistentPaths(
    plugin.settings.persistentExternalContextPaths || []
  );

  // Wire persistence changes
  tab.ui.externalContextSelector.setOnPersistenceChange((paths) => {
    plugin.settings.persistentExternalContextPaths = paths;
    void plugin.saveSettings();
  });

  refreshTabQoderUI(tab, plugin);

  // Gate Qoder UI elements.
  applyQoderUIGating(tab, plugin);
}

export interface InitializeTabUIOptions {
  getQoderCatalogConfig?: () => QoderCatalogInfo;
}

/**
 * Initializes the tab's UI components.
 * Call this after the tab is created and before it becomes active.
 */
export function initializeTabUI(
  tab: TabData,
  plugin: QoderianPlugin,
  options: InitializeTabUIOptions = {}
): void {
  const { dom, state } = tab;

  // Initialize context managers (file/image)
  initializeContextManagers(tab, plugin);

  // Selection chips - add to contextRowEl (pill style: icon + label + remove)
  dom.selectionIndicatorEl = createSelectionChip(
    dom.contextRowEl,
    'qoderian-selection-indicator',
    'text-select'
  );

  dom.browserIndicatorEl = createSelectionChip(
    dom.contextRowEl,
    'qoderian-browser-selection-indicator',
    'globe'
  );

  dom.canvasIndicatorEl = createSelectionChip(
    dom.contextRowEl,
    'qoderian-canvas-indicator',
    'network'
  );

  // Collapse chips into "+N more" when the sidebar is too narrow.
  tab.controllers.contextRowOverflow = new ContextRowOverflowController(dom.contextRowEl);

  const catalogInfo = options.getQoderCatalogConfig?.() ?? null;
  initializeSlashCommands(
    tab,
    catalogInfo,
  );

  if (dom.messagesEl.parentElement) {
    tab.ui.navigationSidebar = new NavigationSidebar(
      dom.messagesEl.parentElement,
      dom.messagesEl
    );
  }

  initializeInputModes(tab, plugin);
  initializeInputToolbar(tab, plugin, options.getQoderCatalogConfig);

  // Chain onto the previously registered streaming callback (tab bar
  // indicator) so the action button tracks streaming state too.
  const previousStreamingCallback = state.callbacks.onStreamingStateChanged;
  state.callbacks = {
    ...state.callbacks,
    onStreamingStateChanged: (isStreaming) => {
      previousStreamingCallback?.(isStreaming);
      tab.ui.composerActionButton?.setStreaming(isStreaming);
      if (!isStreaming) {
        // The composer may have been cleared programmatically (no input
        // event); re-evaluate send availability when streaming ends.
        updateComposerSendAvailability(tab);
      }
    },
    onUsageChanged: (usage) => {
      tab.ui.contextUsageMeter?.update(usage);
    },
    onAutoScrollChanged: () => tab.ui.navigationSidebar?.updateVisibility(),
  };

  // ResizeObserver to detect overflow changes (e.g., content growth)
  const resizeObserver = new ResizeObserver(() => {
    tab.ui.navigationSidebar?.updateVisibility();
  });
  resizeObserver.observe(dom.messagesEl);
  dom.eventCleanups.push(() => resizeObserver.disconnect());
}

export interface ForkContext {
  messages: ChatMessage[];
  sourceSessionId: string;
  sourceQoderState?: QoderState;
  resumeAt: string;
  sourceTitle?: string;
  /** 1-based index used for fork title suffix (counts only non-interrupt user messages). */
  forkAtUserMessage?: number;
  currentNote?: string;
}

function deepCloneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (typeof structuredClone === 'function') {
    return structuredClone(messages);
  }
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

function isClosingLifecycleState(state: TabData['lifecycleState']): boolean {
  return state === 'closing';
}

function countUserMessagesForForkTitle(messages: ChatMessage[]): number {
  // Keep fork numbering stable by excluding non-semantic user messages.
  return messages.filter(m => m.role === 'user' && !m.isInterrupt && !m.isRebuiltContext).length;
}

interface ForkSource {
  sourceSessionId: string;
  sourceQoderState?: QoderState;
  sourceTitle?: string;
  currentNote?: string;
}

/**
 * Resolves session ID and conversation metadata needed for forking.
 * Prefers the live service session ID; falls back to persisted conversation metadata.
 * Shows a notice and returns null when no session can be resolved.
 */
function resolveForkSource(tab: TabData, plugin: QoderianPlugin): ForkSource | null {
  const conversation = tab.conversationId
    ? plugin.getConversationSync(tab.conversationId)
    : null;

  // Delegate session ID resolution to the runtime when available;
  // fall back to persisted conversation metadata when no runtime is active.
  const sourceSessionId = tab.service
    ? tab.service.resolveSessionIdForFork(conversation ?? null)
    : plugin.qoderServices.historyService.resolveSessionIdForConversation(conversation);

  if (!sourceSessionId) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorNoSession') }));
    return null;
  }

  return {
    sourceSessionId,
    sourceQoderState: conversation?.qoderState,
    sourceTitle: conversation?.title,
    currentNote: conversation?.currentNote,
  };
}

async function handleForkRequest(
  tab: TabData,
  plugin: QoderianPlugin,
  userMessageId: string,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  const userIdx = msgs.findIndex(m => m.id === userMessageId);
  if (userIdx === -1) {
    new Notice(t('chat.fork.failed', { error: t('chat.fork.errorMessageNotFound') }));
    return;
  }

  if (!msgs[userIdx].userMessageId) {
    new Notice(t('chat.fork.unavailableNoUuid'));
    return;
  }

  const rewindCtx = findRewindContext(msgs, userIdx);
  if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
    new Notice(t('chat.fork.unavailableNoResponse'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs.slice(0, userIdx)),
    sourceSessionId: source.sourceSessionId,
    sourceQoderState: source.sourceQoderState,
    resumeAt: rewindCtx.prevAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs.slice(0, userIdx + 1)),
    currentNote: source.currentNote,
  });
}

async function handleForkAll(
  tab: TabData,
  plugin: QoderianPlugin,
  forkRequestCallback: (forkContext: ForkContext) => Promise<void>,
): Promise<void> {
  const { state } = tab;

  if (state.isStreaming) {
    new Notice(t('chat.fork.unavailableStreaming'));
    return;
  }

  const msgs = state.messages;
  if (msgs.length === 0) {
    new Notice(t('chat.fork.commandNoMessages'));
    return;
  }

  let lastAssistantUuid: string | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].assistantMessageId) {
      lastAssistantUuid = msgs[i].assistantMessageId;
      break;
    }
  }

  if (!lastAssistantUuid) {
    new Notice(t('chat.fork.commandNoAssistantUuid'));
    return;
  }

  const source = resolveForkSource(tab, plugin);
  if (!source) return;

  await forkRequestCallback({
    messages: deepCloneMessages(msgs),
    sourceSessionId: source.sourceSessionId,
    sourceQoderState: source.sourceQoderState,
    resumeAt: lastAssistantUuid,
    sourceTitle: source.sourceTitle,
    forkAtUserMessage: countUserMessagesForForkTitle(msgs) + 1,
    currentNote: source.currentNote,
  });
}

export function initializeTabControllers(
  tab: TabData,
  plugin: QoderianPlugin,
  component: Component,
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>,
  openConversation?: (conversationId: string) => Promise<void>,
  getQoderCatalogConfig?: () => QoderCatalogInfo,
): void {
  const { dom, state, services, ui } = tab;

  // Create renderer
  tab.renderer = new MessageRenderer(
    plugin,
    component,
    dom.messagesEl,
    (id, mode) => tab.controllers.conversationController!.rewind(id, mode),
    forkRequestCallback
      ? (id) => handleForkRequest(tab, plugin, id, forkRequestCallback)
      : undefined,
  );

  // Selection controller
  tab.controllers.selectionController = new SelectionController(
    plugin.app,
    dom.selectionIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl),
    [dom.contentEl, dom.inputComposerEl, ...getSharedSelectionFocusScopeEls(component)],
  );

  tab.controllers.browserSelectionController = new BrowserSelectionController(
    plugin.app,
    dom.browserIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.canvasSelectionController = new CanvasSelectionController(
    plugin.app,
    dom.canvasIndicatorEl!,
    dom.inputEl,
    dom.contextRowEl,
    () => autoResizeTextarea(dom.inputEl)
  );

  tab.controllers.streamController = new StreamController({
    plugin,
    state,
    renderer: tab.renderer,
    subagentManager: services.subagentManager,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    updateQueueIndicator: () => tab.controllers.inputController?.updateQueueIndicator(),
    getAgentService: () => tab.service,
  });

  // Wire subagent callback now that StreamController exists
  // DOM updates for async subagents are handled by SubagentManager directly;
  // this callback handles message persistence.
  services.subagentManager.setCallback(
    (subagent) => {
      tab.controllers.streamController?.onAsyncSubagentStateChange(subagent);

      // During active stream, regular end-of-turn save captures latest state.
      if (!tab.state.isStreaming && tab.state.currentConversationId) {
        void tab.controllers.conversationController?.save(false).catch(() => {
          // Best-effort persistence; avoid surfacing background-save failures here.
        });
      }
    }
  );

  tab.controllers.conversationController = new ConversationController(
    {
      plugin,
      state,
      renderer: tab.renderer,
      subagentManager: services.subagentManager,
      getHistoryDropdown: () => null, // Tab doesn't have its own history dropdown
      getWelcomeEl: () => dom.welcomeEl,
      setWelcomeEl: (el) => { dom.welcomeEl = el; },
      getMessagesEl: () => dom.messagesEl,
      getInputEl: () => dom.inputEl,
      getFileContextManager: () => ui.fileContextManager,
      getImageContextManager: () => ui.imageContextManager,
      getMcpServerSelector: () => ui.mcpServerSelector,
      getExternalContextSelector: () => ui.externalContextSelector,
      clearQueuedMessage: () => tab.controllers.inputController?.clearQueuedMessage(),
      getTitleGenerationService: () => services.titleGenerationService,
      getStatusPanel: () => ui.statusPanel,
      getAgentService: () => tab.service, // Use tab's service instead of plugin's
      dismissPendingInlinePrompts: () => tab.controllers.inputController?.dismissPendingApproval(),
      ensureServiceForConversation: async (conversation) => {
        // Bind session state only — runtime starts on send
        tab.conversationId = conversation?.id ?? null;
        tab.draftModel = null;
        tab.lifecycleState = conversation ? 'bound_cold' : 'blank';
        syncSlashCommandDropdownForQoder(tab, plugin, getQoderCatalogConfig);

        // If the runtime already exists, sync it passively.
        if (tab.service && conversation) {
          const hasMessages = conversation.messages.length > 0;
          const externalContextPaths = hasMessages
            ? conversation.externalContextPaths || []
            : (plugin.settings.persistentExternalContextPaths || []);
          tab.service.syncConversationState(conversation, externalContextPaths);
        }

        refreshTabQoderUI(tab, plugin);
        applyQoderUIGating(tab, plugin);
      },
    },
    {
      onNewConversation: () => {
        // Reset to blank state and drop the bound runtime so the next send
        // reinitializes with the blank tab's selected model.
        cleanupTabRuntime(tab);
        tab.lifecycleState = 'blank';
        tab.draftModel = resolveBlankTabModel(plugin);
        tab.conversationId = null;
        refreshTabQoderUI(tab, plugin);
        applyQoderUIGating(tab, plugin);
        syncSlashCommandDropdownForQoder(tab, plugin, getQoderCatalogConfig);
      },
      onConversationLoaded: () => ui.slashCommandDropdown?.resetCatalogCache(),
      onConversationSwitched: () => ui.slashCommandDropdown?.resetCatalogCache(),
    }
  );

  tab.controllers.inputController = new InputController({
    plugin,
    state,
    renderer: tab.renderer,
    streamController: tab.controllers.streamController,
    selectionController: tab.controllers.selectionController,
    browserSelectionController: tab.controllers.browserSelectionController,
    canvasSelectionController: tab.controllers.canvasSelectionController,
    conversationController: tab.controllers.conversationController,
    getInputEl: () => dom.inputEl,
    getInputContainerEl: () => dom.inputContainerEl,
    getWelcomeEl: () => dom.welcomeEl,
    getMessagesEl: () => dom.messagesEl,
    getFileContextManager: () => ui.fileContextManager,
    getImageContextManager: () => ui.imageContextManager,
    getMcpServerSelector: () => ui.mcpServerSelector,
    getExternalContextSelector: () => ui.externalContextSelector,
    getInstructionModeManager: () => ui.instructionModeManager,
    getInstructionRefineService: () => services.instructionRefineService,
    getTitleGenerationService: () => services.titleGenerationService,
    getStatusPanel: () => ui.statusPanel,
    generateId: generateMessageId,
    resetInputHeight: () => {
      // Per-tab input height is managed by CSS, no dynamic adjustment needed
    },
    getAuxiliaryModel: () => tab.service?.getAuxiliaryModel?.() ?? tab.draftModel ?? null,
    getAgentService: () => tab.service,
    getSubagentManager: () => services.subagentManager,
    ensureServiceInitialized: async () => {
      if (tab.serviceInitialized && tab.lifecycleState === 'bound_active') {
        return true;
      }

      try {
        await initializeTabService(tab, plugin);
        setupServiceCallbacks(tab, plugin);

        // Transition: bind the draft model to the new conversation.
        refreshTabQoderUI(tab, plugin);
        applyQoderUIGating(tab, plugin);
        return true;
      } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Failed to initialize chat service');
        return false;
      }
    },
    openConversation,
    onForkAll: forkRequestCallback
      ? () => handleForkAll(tab, plugin, forkRequestCallback)
      : undefined,
    restorePrePlanPermissionModeIfNeeded: () => {
      if (getTabPermissionMode(tab, plugin) === 'plan') {
        updatePlanModeUI(tab, plugin, 'default');
      }
    },
  });

  tab.controllers.navigationController = new NavigationController({
    getMessagesEl: () => dom.messagesEl,
    getInputEl: () => dom.inputEl,
    getSettings: () => plugin.settings.keyboardNavigation,
    isStreaming: () => state.isStreaming,
    shouldSkipEscapeHandling: () => {
      if (ui.instructionModeManager?.isActive()) return true;
      if (ui.bangBashModeManager?.isActive()) return true;
      if (tab.controllers.inputController?.isResumeDropdownVisible()) return true;
      if (ui.slashCommandDropdown?.isVisible()) return true;
      if (ui.fileContextManager?.isMentionDropdownVisible()) return true;
      return false;
    },
  });
  tab.controllers.navigationController.initialize();
}
