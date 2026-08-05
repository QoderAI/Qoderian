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

/** Renders the host-specific CLI path at the top of the complete settings page. */
export function renderQoderCliPathSetting(
  container: HTMLElement,
  context: QoderCliPathSettingContext,
): void {
    const qoderWorkspace = context.plugin.qoderServices;
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const qoderSettings = getQoderSettings(settingsBag);
    new Setting(container).setName(t('settings.setup')).setHeading();

    const hostnameKey = getHostnameKey();
    const platformDesc = process.platform === 'win32'
      ? t('settings.cliPath.descWindows')
      : t('settings.cliPath.descUnix');
    const cliPathDescription = `${t('settings.cliPath.desc')} ${platformDesc}`;

    const cliPathSetting = new Setting(container)
      .setName(t('settings.cliPath.name'))
      .setDesc(cliPathDescription);

    const validationEl = container.createDiv({
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

    cliPathSetting.addText((text) => {
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
}

export function renderQoderSettingsTab(container: HTMLElement, context: QoderSettingsTabContext): void {
    const qoderWorkspace = context.plugin.qoderServices;
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
    new CommandSkillSettings(
      slashCommandsContainer,
      context.plugin.app,
      qoderWorkspace.commandCatalog,
    );

    // --- Subagents ---

    new Setting(container).setName(t('settings.subagents.name')).setHeading();

    const agentsDesc = container.createDiv({ cls: 'qoderian-sp-settings-desc' });
    agentsDesc.createEl('p', {
      text: t('settings.subagents.desc'),
      cls: 'setting-item-description',
    });

    const agentsContainer = container.createDiv({ cls: 'qoderian-agents-container' });
    new AgentSettings(agentsContainer, {
      app: context.plugin.app,
      agentCatalog: qoderWorkspace.agentCatalog,
      agentStorage: qoderWorkspace.agentStorage,
      modelOptions: qoderWorkspace.modelConfig.getModelOptions(settingsBag),
    });

    // --- MCP Servers ---

    new Setting(container).setName(t('settings.mcpServers.name')).setHeading();

    const mcpDesc = container.createDiv({ cls: 'qoderian-mcp-settings-desc' });
    mcpDesc.createEl('p', {
      text: t('settings.mcpServers.desc'),
      cls: 'setting-item-description',
    });

    const mcpContainer = container.createDiv({ cls: 'qoderian-mcp-container' });
    context.renderMcpSettings(mcpContainer, qoderWorkspace.mcpStorage);

    // --- Plugins ---

    new Setting(container).setName(t('settings.plugins.name')).setHeading();

    const pluginsDesc = container.createDiv({ cls: 'qoderian-plugin-settings-desc' });
    pluginsDesc.createEl('p', {
      text: t('settings.plugins.desc'),
      cls: 'setting-item-description',
    });

    const pluginsContainer = container.createDiv({ cls: 'qoderian-plugins-container' });
    new PluginSettingsManager(pluginsContainer, {
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

    // --- Experimental ---

    new Setting(container).setName(t('settings.experimental')).setHeading();

    new Setting(container)
      .setName(t('settings.enableBangBash.name'))
      .setDesc(t('settings.enableBangBash.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(qoderSettings.enableBangBash)
          .onChange(async (value) => {
            bangBashValidationEl.toggleClass('qoderian-hidden', true);
            if (value) {
              const { findNodeExecutable, getEnhancedPath } = await import('../../../core/env/environment');
              const nodePath = findNodeExecutable(getEnhancedPath());
              if (!nodePath) {
                bangBashValidationEl.setText(t('settings.enableBangBash.validation.noNode'));
                bangBashValidationEl.toggleClass('qoderian-hidden', false);
                toggle.setValue(false);
                return;
              }
            }
            updateQoderSettings(settingsBag, { enableBangBash: value });
            await context.plugin.saveSettings();
          })
      );

    const bangBashValidationEl = container.createDiv({
      cls: 'qoderian-bang-bash-validation qoderian-setting-validation qoderian-setting-validation-error qoderian-hidden',
    });
}
