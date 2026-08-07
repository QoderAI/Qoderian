import * as fs from 'fs';
import { Setting } from 'obsidian';

import { getHostnameKey } from '../../../core/env/environment';
import { expandHomePath } from '../../../core/fs/path';
import type { AppMcpStorage } from '../../../core/types/services';
import { t } from '../../../i18n/i18n';
import type QoderianPlugin from '../../../main';
import {
  getQoderSettings,
  updateQoderSettings,
} from '../../../qoder/config/settings';
import { AgentSettings } from './agent-settings';
import { CommandSkillSettings } from './command-skill-settings';
import { PluginSettingsManager } from './plugin-settings-manager';

export interface QoderSettingsTabContext {
  plugin: QoderianPlugin;
  renderMcpSettings(container: HTMLElement, storage: AppMcpStorage): void;
}

export interface QoderCliPathSettingContext {
  plugin: QoderianPlugin;
}

export interface SlashCommandsSectionContext {
  plugin: QoderianPlugin;
}

export interface SubagentsSectionContext {
  plugin: QoderianPlugin;
}

export interface McpSectionContext {
  plugin: QoderianPlugin;
  renderMcpSettings(container: HTMLElement, storage: AppMcpStorage): void;
}

export interface PluginsSectionContext {
  plugin: QoderianPlugin;
}

export interface BangBashSectionContext {
  plugin: QoderianPlugin;
}

/** Builds the CLI path description for the current platform. */
export function getCliPathDescription(): string {
  const platformDesc = process.platform === 'win32'
    ? t('settings.cliPath.descWindows')
    : t('settings.cliPath.descUnix');
  return `${t('settings.cliPath.desc')} ${platformDesc}`;
}

/**
 * Attaches the host-specific CLI path input to `setting` and its validation
 * message to `validationHost`. Shared by the imperative display() fallback
 * and the 1.13+ declarative render row. Returns the injected validation
 * element so declarative callers can remove it on teardown.
 */
export function renderQoderCliPathControl(
  setting: Setting,
  validationHost: HTMLElement,
  context: QoderCliPathSettingContext,
): HTMLElement {
    const qoderWorkspace = context.plugin.qoderServices;
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const qoderSettings = getQoderSettings(settingsBag);

    const hostnameKey = getHostnameKey();

    const validationEl = validationHost.createDiv({
      cls: 'qoderian-cli-path-validation qoderian-setting-validation qoderian-setting-validation-error qoderian-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const expandedPath = expandHomePath(trimmed);

      if (!fs.existsSync(expandedPath)) {
        return t('settings.cliPath.validation.notExist');
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return t('settings.cliPath.validation.isDirectory');
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('qoderian-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('qoderian-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('qoderian-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('qoderian-input-error', false);
      }
      return true;
    };

    const currentValue = qoderSettings.cliPathsByHost[hostnameKey] || '';
    const cliPathsByHost = { ...qoderSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateQoderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      await context.plugin.saveSettings();
      qoderWorkspace.cliResolver.reset();
      const view = context.plugin.getView();
      await view?.getTabManager()?.broadcastToAllTabs(
        (service) => Promise.resolve(service.cleanup())
      );
      void qoderWorkspace.agentCatalog.refresh();
      return true;
    };

    setting.addText((text) => {
      const placeholder = process.platform === 'win32'
        ? 'C:\\Users\\<user>\\.local\\bin\\qodercli.exe'
        : '~/.local/bin/qodercli';

      text
        .setPlaceholder(placeholder)
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('qoderian-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    return validationEl;
}

/** Renders the "Setup" heading plus the CLI path row (imperative fallback). */
export function renderQoderCliPathSetting(
  container: HTMLElement,
  context: QoderCliPathSettingContext,
): void {
  new Setting(container).setName(t('settings.setup')).setHeading();
  const cliPathSetting = new Setting(container)
    .setName(t('settings.cliPath.name'))
    .setDesc(getCliPathDescription());
  renderQoderCliPathControl(cliPathSetting, container, context);
}

/** Renders the slash commands/skills manager into `container`. */
export function renderSlashCommandsSection(
  container: HTMLElement,
  context: SlashCommandsSectionContext,
): void {
  new CommandSkillSettings(
    container,
    context.plugin.app,
    context.plugin.qoderServices.commandCatalog,
  );
}

/** Renders the subagents manager into `container`. */
export function renderSubagentsSection(
  container: HTMLElement,
  context: SubagentsSectionContext,
): void {
  const qoderWorkspace = context.plugin.qoderServices;
  const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
  new AgentSettings(container, {
    app: context.plugin.app,
    agentCatalog: qoderWorkspace.agentCatalog,
    agentStorage: qoderWorkspace.agentStorage,
    modelOptions: qoderWorkspace.modelConfig.getModelOptions(settingsBag),
  });
}

/** Renders the MCP servers manager into `container`. */
export function renderMcpSection(
  container: HTMLElement,
  context: McpSectionContext,
): void {
  context.renderMcpSettings(container, context.plugin.qoderServices.mcpStorage);
}

/** Renders the plugins manager into `container`. */
export function renderPluginsSection(
  container: HTMLElement,
  context: PluginsSectionContext,
): void {
  const qoderWorkspace = context.plugin.qoderServices;
  new PluginSettingsManager(container, {
    pluginManager: qoderWorkspace.pluginManager,
    agentCatalog: qoderWorkspace.agentCatalog,
    restartTabs: async () => {
      const view = context.plugin.getView();
      const tabManager = view?.getTabManager();
      if (!tabManager) {
        return;
      }

      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); },
      );
    },
  });
}

/**
 * Attaches the `!bash` toggle to `setting` and its validation message to
 * `validationHost`. Shared by the imperative display() fallback and the
 * 1.13+ declarative render row. Returns the injected validation element so
 * declarative callers can remove it on teardown.
 */
export function renderBangBashControl(
  setting: Setting,
  validationHost: HTMLElement,
  context: BangBashSectionContext,
): HTMLElement {
  const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
  const qoderSettings = getQoderSettings(settingsBag);

  const validationEl = validationHost.createDiv({
    cls: 'qoderian-bang-bash-validation qoderian-setting-validation qoderian-setting-validation-error qoderian-hidden',
  });

  setting.addToggle((toggle) =>
      toggle
        .setValue(qoderSettings.enableBangBash)
        .onChange(async (value) => {
          validationEl.toggleClass('qoderian-hidden', true);
          if (value) {
            const { findNodeExecutable, getEnhancedPath } = await import('../../../core/env/environment');
            const nodePath = findNodeExecutable(getEnhancedPath());
            if (!nodePath) {
              validationEl.setText(t('settings.enableBangBash.validation.noNode'));
              validationEl.toggleClass('qoderian-hidden', false);
              toggle.setValue(false);
              return;
            }
          }
          updateQoderSettings(settingsBag, { enableBangBash: value });
          await context.plugin.saveSettings();
        })
  );

  return validationEl;
}

export function renderQoderSettingsTab(container: HTMLElement, context: QoderSettingsTabContext): void {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const qoderSettings = getQoderSettings(settingsBag);

    // --- Safety ---

    new Setting(container).setName(t('settings.safety')).setHeading();

    new Setting(container)
      .setName(t('settings.loadUserSettings.name'))
      .setDesc(t('settings.loadUserSettings.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(qoderSettings.loadUserSettings)
          .onChange(async (value) => {
            updateQoderSettings(settingsBag, { loadUserSettings: value });
            await context.plugin.saveSettings();
          })
      );

    // --- Commands and Skills ---

    new Setting(container).setName(t('settings.slashCommands.name')).setHeading();

    const slashCommandsContainer = container.createDiv({ cls: 'qoderian-slash-commands-container' });
    renderSlashCommandsSection(slashCommandsContainer, context);

    // --- Subagents ---

    new Setting(container).setName(t('settings.subagents.name')).setHeading();

    const agentsDesc = container.createDiv({ cls: 'qoderian-sp-settings-desc' });
    agentsDesc.createEl('p', {
      text: t('settings.subagents.desc'),
      cls: 'setting-item-description',
    });

    const agentsContainer = container.createDiv({ cls: 'qoderian-agents-container' });
    renderSubagentsSection(agentsContainer, context);

    // --- MCP Servers ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    const mcpDesc = container.createDiv({ cls: 'qoderian-mcp-settings-desc' });
    mcpDesc.createEl('p', {
      text: t('settings.mcpServers.desc'),
      cls: 'setting-item-description',
    });

    const mcpContainer = container.createDiv({ cls: 'qoderian-mcp-container' });
    renderMcpSection(mcpContainer, context);

    // --- Plugins ---

    new Setting(container).setName(t('settings.plugins.name')).setHeading();

    const pluginsDesc = container.createDiv({ cls: 'qoderian-plugin-settings-desc' });
    pluginsDesc.createEl('p', {
      text: t('settings.plugins.desc'),
      cls: 'setting-item-description',
    });

    const pluginsContainer = container.createDiv({ cls: 'qoderian-plugins-container' });
    renderPluginsSection(pluginsContainer, context);

    // --- Experimental ---

    new Setting(container).setName(t('settings.experimental')).setHeading();

    const bangBashSetting = new Setting(container)
      .setName(t('settings.enableBangBash.name'))
      .setDesc(t('settings.enableBangBash.desc'));
    renderBangBashControl(bangBashSetting, container, context);
}
