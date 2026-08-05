import { Notice, setIcon } from 'obsidian';

import type { PluginInfo } from '../../../core/types';
import type {
  AppAgentCatalog,
  AppPluginManager,
} from '../../../core/types/services';

export interface PluginSettingsManagerDeps {
  pluginManager: AppPluginManager;
  agentCatalog: Pick<AppAgentCatalog, 'refresh'>;
  restartTabs: () => Promise<void>;
}

export class PluginSettingsManager {
  private containerEl: HTMLElement;
  private pluginManager: AppPluginManager;
  private agentCatalog: Pick<AppAgentCatalog, 'refresh'>;
  private restartTabs: () => Promise<void>;

  constructor(containerEl: HTMLElement, deps: PluginSettingsManagerDeps) {
    this.containerEl = containerEl;
    this.pluginManager = deps.pluginManager;
    this.agentCatalog = deps.agentCatalog;
    this.restartTabs = deps.restartTabs;
    this.render();
  }

  private render() {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'qoderian-plugin-header' });
    headerEl.createSpan({ text: 'Qoder CLI Plugins', cls: 'qoderian-plugin-label' });

    const refreshBtn = headerEl.createEl('button', {
      cls: 'qoderian-settings-action-btn',
      attr: { 'aria-label': 'Refresh' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      void this.refreshPlugins();
    });

    const plugins = this.pluginManager.getPlugins();

    if (plugins.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'qoderian-plugin-empty' });
      emptyEl.setText('No Qoder CLI plugins found. Enable plugins via the Qoder CLI.');
      return;
    }

    const projectPlugins = plugins.filter(p => p.scope === 'project');
    const userPlugins = plugins.filter(p => p.scope === 'user');

    const listEl = this.containerEl.createDiv({ cls: 'qoderian-plugin-list' });

    if (projectPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'qoderian-plugin-section-header' });
      sectionHeader.setText('Project plugins');

      for (const plugin of projectPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }

    if (userPlugins.length > 0) {
      const sectionHeader = listEl.createDiv({ cls: 'qoderian-plugin-section-header' });
      sectionHeader.setText('User plugins');

      for (const plugin of userPlugins) {
        this.renderPluginItem(listEl, plugin);
      }
    }
  }

  private renderPluginItem(listEl: HTMLElement, plugin: PluginInfo) {
    const itemEl = listEl.createDiv({ cls: 'qoderian-plugin-item' });
    if (!plugin.enabled) {
      itemEl.addClass('qoderian-plugin-item-disabled');
    }

    const statusEl = itemEl.createDiv({ cls: 'qoderian-plugin-status' });
    if (plugin.enabled) {
      statusEl.addClass('qoderian-plugin-status-enabled');
    } else {
      statusEl.addClass('qoderian-plugin-status-disabled');
    }

    const infoEl = itemEl.createDiv({ cls: 'qoderian-plugin-info' });

    const nameRow = infoEl.createDiv({ cls: 'qoderian-plugin-name-row' });

    const nameEl = nameRow.createSpan({ cls: 'qoderian-plugin-name' });
    nameEl.setText(plugin.name);

    const actionsEl = itemEl.createDiv({ cls: 'qoderian-plugin-actions' });

    const toggleBtn = actionsEl.createEl('button', {
      cls: 'qoderian-plugin-action-btn',
      attr: { 'aria-label': plugin.enabled ? 'Disable' : 'Enable' },
    });
    setIcon(toggleBtn, plugin.enabled ? 'toggle-right' : 'toggle-left');
    toggleBtn.addEventListener('click', () => {
      void this.togglePlugin(plugin.id);
    });
  }

  private async togglePlugin(pluginId: string) {
    const plugin = this.pluginManager.getPlugins().find(p => p.id === pluginId);
    const wasEnabled = plugin?.enabled ?? false;

    try {
      await this.pluginManager.togglePlugin(pluginId);
      // The CLI re-discovers plugin agents on its own; refresh in the background.
      void this.agentCatalog.refresh();

      try {
        await this.restartTabs();
      } catch {
        new Notice('Plugin toggled, but some tabs failed to restart.');
      }

      new Notice(`Plugin "${pluginId}" ${wasEnabled ? 'disabled' : 'enabled'}`);
    } catch (err) {
      await this.pluginManager.togglePlugin(pluginId);
      const message = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Failed to toggle plugin: ${message}`);
    } finally {
      this.render();
    }
  }

  private async refreshPlugins() {
    try {
      await this.pluginManager.loadPlugins();
      void this.agentCatalog.refresh();

      new Notice('Plugin list refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      new Notice(`Failed to refresh plugins: ${message}`);
    } finally {
      this.render();
    }
  }

  public refresh() {
    this.render();
  }
}
