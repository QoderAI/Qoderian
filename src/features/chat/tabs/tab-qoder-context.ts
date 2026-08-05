import type { Component } from 'obsidian';

import type { QoderianSettings } from '../../../core/types';
import type QoderianPlugin from '../../../main';
import type { QoderModelConfig } from '../../../qoder/models/qoder-model-config';
import type {
  SlashCommandDropdownConfig,
  SlashCommandDropdownEntry,
} from '../../../shared/components/slash-command-dropdown';
import type { TabData, TabManagerViewHost, TabQoderContext } from './types';

export type TabQoderSettings = Record<string, unknown> & {
  model: string;
  effortLevel: string;
  permissionMode: QoderianSettings['permissionMode'];
};

export type QoderCatalogInfo = {
  config: SlashCommandDropdownConfig;
  getEntries: () => Promise<SlashCommandDropdownEntry[]>;
  subscribe: (listener: () => void) => () => void;
} | null;

export function getSharedSelectionFocusScopeEls(component: Component): HTMLElement[] {
  const host = component as Partial<TabManagerViewHost>;
  return host.getSharedSelectionFocusScopeEls?.() ?? [];
}

export function resolveBlankTabModel(plugin: QoderianPlugin): string {
  return plugin.settings.model;
}

export function getTabModelConfig(
  _tab: TabQoderContext,
  plugin: QoderianPlugin,
): QoderModelConfig {
  return plugin.qoderServices.modelConfig;
}

export function getTabSettingsSnapshot(
  _tab: TabQoderContext,
  plugin: QoderianPlugin,
): TabQoderSettings {
  return plugin.settings as TabQoderSettings;
}

export function getTabPermissionMode(
  tab: TabQoderContext,
  plugin: QoderianPlugin,
): QoderianSettings['permissionMode'] {
  return getTabSettingsSnapshot(tab, plugin).permissionMode;
}

export function getQoderCatalogInfo(plugin: QoderianPlugin): QoderCatalogInfo {
  const catalog = plugin.qoderServices.commandCatalog;
  return {
    config: catalog.getDropdownConfig(),
    getEntries: () => catalog.listDropdownEntries({ includeBuiltIns: false }),
    subscribe: (listener: () => void) => catalog.subscribe(listener),
  };
}

export function getQoderMcpManager(plugin: QoderianPlugin) {
  return plugin.qoderServices.mcpManager;
}

export function syncSlashCommandDropdownForQoder(
  tab: TabData,
  plugin: QoderianPlugin,
  getQoderCatalogConfig?: () => QoderCatalogInfo,
): void {
  const dropdown = tab.ui.slashCommandDropdown;
  if (!dropdown) return;

  const catalogInfo = getQoderCatalogConfig?.() ?? getQoderCatalogInfo(plugin);
  if (catalogInfo) {
    dropdown.setCatalog(catalogInfo.config, catalogInfo.getEntries, catalogInfo.subscribe);
  } else {
    dropdown.resetCatalogCache();
  }
}

export async function updateTabQoderSettings(
  tab: TabQoderContext,
  plugin: QoderianPlugin,
  update: (settings: TabQoderSettings) => void,
): Promise<TabQoderSettings> {
  const snapshot = getTabSettingsSnapshot(tab, plugin);
  update(snapshot);
  await plugin.saveSettings();
  return snapshot;
}

export function refreshTabQoderUI(tab: TabData, plugin: QoderianPlugin): void {
  const permissionMode = getTabPermissionMode(tab, plugin);
  tab.ui.modelSelector?.updateDisplay();
  tab.ui.modelSelector?.renderOptions();
  tab.ui.effortSelector?.updateDisplay();
  tab.ui.permissionToggle?.updateDisplay();
  tab.dom.inputWrapper.toggleClass('qoderian-input-plan-mode', permissionMode === 'plan');
}

export function applyQoderUIGating(tab: TabData, plugin: QoderianPlugin): void {
  tab.ui.mcpServerSelector?.setVisible(true);
  tab.ui.permissionToggle?.setVisible(true);
  tab.ui.fileContextManager?.setMcpManager(getQoderMcpManager(plugin));
  tab.ui.fileContextManager?.setAgentService(plugin.qoderServices.agentCatalog);
  tab.ui.imageContextManager?.setEnabled(true);
  tab.ui.contextUsageMeter?.update(tab.state.usage);
}

export function syncTabQoderServices(tab: TabData, plugin: QoderianPlugin): void {
  tab.services.instructionRefineService?.cancel();
  tab.services.instructionRefineService?.resetConversation();
  tab.services.instructionRefineService = plugin.qoderServices.createInstructionRefineService();
  tab.services.subagentManager.setTaskResultInterpreter?.(
    plugin.qoderServices.taskResultInterpreter,
  );
}

export function ensureTitleGenerationService(tab: TabData, plugin: QoderianPlugin): void {
  if (!tab.services.titleGenerationService) {
    tab.services.titleGenerationService = plugin.qoderServices.createTitleGenerationService();
  }
}

export function cleanupTabRuntime(tab: TabData): void {
  if (tab.service && typeof tab.service.cleanup === 'function') {
    void tab.service.cleanup();
  }
  tab.service = null;
  tab.serviceInitialized = false;
}
