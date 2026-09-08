import type { App, SettingDefinitionItem, SettingGroup } from 'obsidian';
import { Notice, PluginSettingTab, requireApiVersion, Setting } from 'obsidian';

import type { ChatViewPlacement } from '../../core/types/settings';
import { getAvailableLocales, getLocaleDisplayName, setLocale, t } from '../../i18n/i18n';
import type { Locale } from '../../i18n/types';
import type QoderianPlugin from '../../main';
import { getQoderSettings, updateQoderSettings } from '../../qoder/config/settings';
import { buildNavMappingText, parseNavMappings } from './keyboard-navigation';
import { McpSettingsManager } from './ui/mcp-settings-manager';
import {
  getCliPathDescription,
  renderBangBashControl,
  renderMcpSection,
  renderPluginsSection,
  renderQoderCliEditionControl,
  renderQoderCliPathControl,
  renderQoderCliPathSetting,
  renderQoderSettingsTab,
  renderSlashCommandsSection,
  renderSubagentsSection,
} from './ui/qoder-settings-tab';

/** Keys whose edits affect the prompt and require a debounced service restart. */
const PROMPT_SETTING_KEYS = new Set(['userName', 'systemPrompt', 'mediaFolder']);

export class QoderianSettingTab extends PluginSettingTab {
  plugin: QoderianPlugin;
  private promptRestartTimer: number | null = null;

  constructor(app: App, plugin: QoderianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings for Obsidian 1.13.0+. When this returns a
   * non-empty array, Obsidian renders the tab from these definitions and
   * never calls display(); simple values bind through getControlValue /
   * setControlValue, while rows with custom validation or rich components
   * use `render` callbacks that share the imperative builders with the
   * pre-1.13 display() fallback below.
   *
   * The new-API usages below only execute on Obsidian >= 1.13 (Obsidian
   * never invokes this method on older versions) and are guarded with
   * requireApiVersion() so they stay compatible with the lower
   * minAppVersion.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    setLocale(this.plugin.settings.locale as Locale);

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const qoderSettings = getQoderSettings(settingsBag);

    const localeOptions: Record<string, string> = {};
    for (const locale of getAvailableLocales()) {
      localeOptions[locale] = getLocaleDisplayName(locale);
    }

    const modelOptions: Record<string, string> = {};
    for (const model of this.plugin.qoderServices.modelConfig.getModelOptions(settingsBag)) {
      modelOptions[model.value] = model.label;
    }

    return [
      {
        type: 'group',
        heading: t('settings.setup'),
        items: [
          {
            name: t('settings.cliEdition.name'),
            desc: t('settings.cliEdition.desc'),
            render: (setting) => {
              renderQoderCliEditionControl(setting, { plugin: this.plugin });
            },
          },
          {
            name: t('settings.cliPath.name'),
            desc: getCliPathDescription(),
            render: (setting, group) => {
              let injected: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                injected = renderQoderCliPathControl(setting, host, { plugin: this.plugin });
              });
              return () => { injected?.remove(); };
            },
          },
        ],
      },
      {
        name: t('settings.language.name'),
        desc: t('settings.language.desc'),
        control: {
          type: 'dropdown',
          key: 'locale',
          options: localeOptions,
          defaultValue: this.plugin.settings.locale,
          validate: (value: string) => {
            const locales: string[] = getAvailableLocales();
            if (!locales.includes(value)) {
              return t('common.error');
            }
          },
        },
      },
      {
        type: 'group',
        heading: t('settings.display'),
        items: [
          {
            name: t('settings.maxTabs.name'),
            desc: t('settings.maxTabs.desc'),
            render: (setting, group) => {
              let injected: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                injected = this.renderMaxTabsControl(setting, host);
              });
              return () => { injected?.remove(); };
            },
          },
          {
            name: t('settings.chatViewPlacement.name'),
            desc: t('settings.chatViewPlacement.desc'),
            render: (setting) => this.renderChatViewPlacementControl(setting),
          },
          {
            name: t('settings.enableAutoScroll.name'),
            desc: t('settings.enableAutoScroll.desc'),
            control: {
              type: 'toggle',
              key: 'enableAutoScroll',
              defaultValue: true,
            },
          },
          {
            name: t('settings.deferMathRenderingDuringStreaming.name'),
            desc: t('settings.deferMathRenderingDuringStreaming.desc'),
            control: {
              type: 'toggle',
              key: 'deferMathRenderingDuringStreaming',
              defaultValue: true,
            },
          },
          {
            name: t('settings.expandFileEditsByDefault.name'),
            desc: t('settings.expandFileEditsByDefault.desc'),
            control: {
              type: 'toggle',
              key: 'expandFileEditsByDefault',
              defaultValue: false,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.conversations'),
        items: [
          {
            name: t('settings.autoTitle.name'),
            desc: t('settings.autoTitle.desc'),
            control: {
              type: 'toggle',
              key: 'enableAutoTitleGeneration',
              defaultValue: false,
            },
          },
          {
            name: t('settings.titleModel.name'),
            desc: t('settings.titleModel.desc'),
            visible: () => this.plugin.settings.enableAutoTitleGeneration,
            control: {
              type: 'dropdown',
              key: 'titleGenerationModel',
              options: modelOptions,
              defaultValue: 'auto',
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.content'),
        items: [
          {
            name: t('settings.userName.name'),
            desc: t('settings.userName.desc'),
            control: {
              type: 'text',
              key: 'userName',
              placeholder: t('settings.userName.name'),
              defaultValue: '',
            },
          },
          {
            name: t('settings.systemPrompt.name'),
            desc: t('settings.systemPrompt.desc'),
            control: {
              type: 'textarea',
              key: 'systemPrompt',
              placeholder: t('settings.systemPrompt.name'),
              defaultValue: '',
              rows: 6,
            },
          },
          {
            name: t('settings.excludedTags.name'),
            desc: t('settings.excludedTags.desc'),
            control: {
              type: 'textarea',
              key: 'excludedTags',
              placeholder: 'System\nprivate\ndraft',
              defaultValue: '',
              rows: 4,
            },
          },
          {
            name: t('settings.mediaFolder.name'),
            desc: t('settings.mediaFolder.desc'),
            control: {
              type: 'text',
              key: 'mediaFolder',
              placeholder: 'Attachments',
              defaultValue: '',
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.input'),
        items: [
          {
            name: t('settings.requireCommandOrControlEnterToSend.name'),
            desc: t('settings.requireCommandOrControlEnterToSend.desc'),
            control: {
              type: 'toggle',
              key: 'requireCommandOrControlEnterToSend',
              defaultValue: false,
            },
          },
          {
            name: t('settings.navMappings.name'),
            desc: t('settings.navMappings.desc'),
            render: (setting) => this.renderNavMappingsControl(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.safety'),
        items: [
          {
            name: t('settings.loadUserSettings.name'),
            desc: t('settings.loadUserSettings.desc'),
            control: {
              type: 'toggle',
              key: 'loadUserSettings',
              defaultValue: qoderSettings.loadUserSettings,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.slashCommands.name'),
        cls: 'qoderian-slash-commands-group',
        items: [
          {
            name: t('settings.slashCommands.name'),
            aliases: [
              t('settings.slashCommands.commands'),
              t('settings.slashCommands.skills'),
            ],
            render: (setting, group) => {
              let wrapper: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                wrapper = host.createDiv({
                  cls: 'qoderian-slash-commands-container',
                });
                renderSlashCommandsSection(wrapper, { plugin: this.plugin });
              });
              return () => { wrapper?.remove(); };
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.subagents.name'),
        cls: 'qoderian-agents-group',
        items: [
          {
            name: t('settings.subagents.name'),
            desc: t('settings.subagents.desc'),
            render: (setting, group) => {
              let wrapper: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                wrapper = host.createDiv({
                  cls: 'qoderian-agents-container',
                });
                renderSubagentsSection(wrapper, { plugin: this.plugin });
              });
              return () => { wrapper?.remove(); };
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.mcpServers.name'),
        cls: 'qoderian-mcp-group',
        items: [
          {
            name: t('settings.mcpServers.name'),
            desc: t('settings.mcpServers.desc'),
            render: (setting, group) => {
              let wrapper: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                wrapper = host.createDiv({
                  cls: 'qoderian-mcp-container',
                });
                renderMcpSection(wrapper, {
                  plugin: this.plugin,
                  renderMcpSettings: (target, storage) => {
                    new McpSettingsManager(target, {
                      app: this.plugin.app,
                      mcpStorage: storage,
                      broadcastMcpReload: async () => {
                        for (const view of this.plugin.getAllViews()) {
                          await view.getTabManager()?.broadcastToAllTabs(
                            (service) => service.reloadMcpServers(),
                          );
                        }
                      },
                    });
                  },
                });
              });
              return () => { wrapper?.remove(); };
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.plugins.name'),
        cls: 'qoderian-plugins-group',
        items: [
          {
            name: t('settings.plugins.name'),
            desc: t('settings.plugins.desc'),
            render: (setting, group) => {
              let wrapper: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                wrapper = host.createDiv({
                  cls: 'qoderian-plugins-container',
                });
                renderPluginsSection(wrapper, { plugin: this.plugin });
              });
              return () => { wrapper?.remove(); };
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.experimental'),
        items: [
          {
            name: t('settings.enableBangBash.name'),
            desc: t('settings.enableBangBash.desc'),
            render: (setting, group) => {
              let injected: HTMLElement | null = null;
              this.deferIntoList(group, (host) => {
                injected = renderBangBashControl(setting, host, { plugin: this.plugin });
              });
              return () => { injected?.remove(); };
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (requireApiVersion('1.13.0')) {
      if (key === 'excludedTags') {
        return this.plugin.settings.excludedTags.join('\n');
      }
      if (key === 'loadUserSettings') {
        const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
        return getQoderSettings(settingsBag).loadUserSettings;
      }
      if (key === 'titleGenerationModel') {
        return this.plugin.settings.titleGenerationModel || 'auto';
      }
      return super.getControlValue(key);
    }
    // Unreachable: Obsidian < 1.13 never calls getControlValue.
    return undefined;
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    if (requireApiVersion('1.13.0')) {
      if (key === 'excludedTags') {
        this.plugin.settings.excludedTags = String(value)
          .split(/\r?\n/)
          .map((entry) => entry.trim().replace(/^#/, ''))
          .filter((entry) => entry.length > 0);
        return this.plugin.saveSettings();
      }

      if (key === 'loadUserSettings') {
        const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
        updateQoderSettings(settingsBag, { loadUserSettings: Boolean(value) });
        return this.plugin.saveSettings();
      }

      return this.persistControlValue(key, value);
    }
    // Unreachable: Obsidian < 1.13 never calls setControlValue.
  }

  /**
   * The declarative base class persists into the plugin data file, but
   * Qoderian keeps its settings in .qoderian/qoderian-settings.json, so per
   * the API contract ("override to write to a different data source") we
   * mutate the settings bag ourselves and save once through the store that
   * loadSettings() actually reads — no duplicate write to data.json.
   */
  private async persistControlValue(key: string, value: unknown): Promise<void> {
    // Only reached from setControlValue on Obsidian 1.13+; re-checked here so
    // the 1.13-only view-refresh calls stay behind an explicit version guard.
    if (requireApiVersion('1.13.0')) {
      const settings = this.plugin.settings as unknown as Record<string, unknown>;
      settings[key] = key === 'mediaFolder' ? String(value).trim() : value;
      await this.plugin.saveSettings();

      if (key === 'locale') {
        const previousName = t('settings.language.name');
        const previousDesc = t('settings.language.desc');
        setLocale(this.plugin.settings.locale as Locale);
        this.update();
        this.refreshLocalizedLanguageRow(previousName, previousDesc);
        this.refreshViewChrome();
      } else if (key === 'maxTabs') {
        for (const view of this.plugin.getAllViews()) {
          view.refreshTabControls();
        }
      } else if (key === 'enableAutoTitleGeneration') {
        this.refreshDomState();
      } else if (PROMPT_SETTING_KEYS.has(key)) {
        this.schedulePromptRestart();
      }
    }
  }

  /** Re-applies locale-dependent text in open chat views after a language change. */
  private refreshViewChrome(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshLocalizedChrome();
    }
  }

  /**
   * Obsidian's declarative reconciler refreshes every row except the one
   * whose control triggered the change, so after a live language switch the
   * language row would keep the previous locale's labels until the tab is
   * reopened. Patch its leaf text nodes directly; any later full render
   * produces the same strings, so this cannot conflict.
   */
  private refreshLocalizedLanguageRow(previousName: string, previousDesc: string): void {
    const newName = t('settings.language.name');
    const newDesc = t('settings.language.desc');
    for (const el of Array.from(this.containerEl.querySelectorAll('*'))) {
      if (el.children.length !== 0) continue;
      if (el.textContent === previousName) {
        el.setText(newName);
      } else if (el.textContent === previousDesc) {
        el.setText(newDesc);
      }
    }
  }

  /**
   * The declarative renderer reconciles `group.listEl` synchronously after
   * every `render` callback returns, removing children it does not own.
   * Deferring to a microtask lets injected content (validation messages,
   * rich section managers) survive that reconciliation. The guard covers
   * `listEl`, which only exists on newer Obsidian versions.
   */
  private deferIntoList(
    group: SettingGroup,
    mount: (host: HTMLElement) => void,
  ): void {
    if (requireApiVersion('1.13.0')) {
      const listEl = group.listEl;
      if (listEl) {
        queueMicrotask(() => mount(listEl));
      }
    }
  }

  /**
   * Imperative entry point for Obsidian versions older than 1.13.0, which
   * never consult getSettingDefinitions(). Kept as the documented fallback
   * and sharing the same builders as the declarative render rows.
   */
  display(): void {
    this.renderLegacySettings();
  }

  /** Rebuilds the legacy page; re-invoked directly after a locale change. */
  private renderLegacySettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('qoderian-settings');

    setLocale(this.plugin.settings.locale as Locale);

    // CLI availability determines whether the rest of the plugin can work, so
    // keep its host-specific path at the very top of the settings page.
    renderQoderCliPathSetting(containerEl, { plugin: this.plugin });

    // Qoder CLI is the only integration, so general and Qoder settings share a
    // single scrolling page instead of being split across tabs.
    this.renderGeneralSettings(containerEl);

    renderQoderSettingsTab(containerEl, {
      plugin: this.plugin,
      renderMcpSettings: (target, storage) => {
        new McpSettingsManager(target, {
          app: this.plugin.app,
          mcpStorage: storage,
          broadcastMcpReload: async () => {
            for (const view of this.plugin.getAllViews()) {
              await view.getTabManager()?.broadcastToAllTabs(
                (service) => service.reloadMcpServers(),
              );
            }
          },
        });
      },
    });
  }

  private renderGeneralSettings(container: HTMLElement): void {
    new Setting(container)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) => {
        const locales = getAvailableLocales();
        for (const locale of locales) {
          dropdown.addOption(locale, getLocaleDisplayName(locale));
        }
        dropdown
          .setValue(this.plugin.settings.locale)
          .onChange(async (value) => {
            const locale = value as Locale;
            if (!setLocale(locale)) {
              dropdown.setValue(this.plugin.settings.locale);
              return;
            }
            this.plugin.settings.locale = locale;
            await this.plugin.saveSettings();
            this.renderLegacySettings();
            this.refreshViewChrome();
          });
      });

    // --- Display ---

    new Setting(container).setName(t('settings.display')).setHeading();

    const maxTabsSetting = new Setting(container)
      .setName(t('settings.maxTabs.name'))
      .setDesc(t('settings.maxTabs.desc'));
    this.renderMaxTabsControl(maxTabsSetting, container);

    const placementSetting = new Setting(container)
      .setName(t('settings.chatViewPlacement.name'))
      .setDesc(t('settings.chatViewPlacement.desc'));
    this.renderChatViewPlacementControl(placementSetting);

    new Setting(container)
      .setName(t('settings.enableAutoScroll.name'))
      .setDesc(t('settings.enableAutoScroll.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoScroll ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoScroll = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t('settings.deferMathRenderingDuringStreaming.name'))
      .setDesc(t('settings.deferMathRenderingDuringStreaming.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.deferMathRenderingDuringStreaming ?? true)
          .onChange(async (value) => {
            this.plugin.settings.deferMathRenderingDuringStreaming = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName(t('settings.expandFileEditsByDefault.name'))
      .setDesc(t('settings.expandFileEditsByDefault.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandFileEditsByDefault ?? false)
          .onChange(async (value) => {
            this.plugin.settings.expandFileEditsByDefault = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Conversations ---

    new Setting(container).setName(t('settings.conversations')).setHeading();

    new Setting(container)
      .setName(t('settings.autoTitle.name'))
      .setDesc(t('settings.autoTitle.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.renderTitleModelSetting(titleModelContainer);
          })
      );

    const titleModelContainer = container.createDiv({ cls: 'qoderian-title-model-setting' });
    this.renderTitleModelSetting(titleModelContainer);

    // --- Content ---

    new Setting(container).setName(t('settings.content')).setHeading();

    new Setting(container)
      .setName(t('settings.userName.name'))
      .setDesc(t('settings.userName.desc'))
      .addText((text) => {
        text
          .setPlaceholder(t('settings.userName.name'))
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t('settings.systemPrompt.name'))
      .setDesc(t('settings.systemPrompt.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder(t('settings.systemPrompt.name'))
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    new Setting(container)
      .setName(t('settings.excludedTags.name'))
      .setDesc(t('settings.excludedTags.desc'))
      .addTextArea((text) => {
        text
          .setPlaceholder('System\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(container)
      .setName(t('settings.mediaFolder.name'))
      .setDesc(t('settings.mediaFolder.desc'))
      .addText((text) => {
        text
          .setPlaceholder('Attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('qoderian-settings-media-input');
        text.inputEl.addEventListener('blur', () => {
          void this.restartServiceForPromptChange();
        });
      });

    // --- Input ---

    new Setting(container).setName(t('settings.input')).setHeading();

    new Setting(container)
      .setName(t('settings.requireCommandOrControlEnterToSend.name'))
      .setDesc(t('settings.requireCommandOrControlEnterToSend.desc'))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.requireCommandOrControlEnterToSend ?? false)
          .onChange(async (value) => {
            this.plugin.settings.requireCommandOrControlEnterToSend = value;
            await this.plugin.saveSettings();
          });
      });

    const navMappingsSetting = new Setting(container)
      .setName(t('settings.navMappings.name'))
      .setDesc(t('settings.navMappings.desc'));
    this.renderNavMappingsControl(navMappingsSetting);
  }

  /** Builds the max tabs slider with its over-limit warning. */
  private renderMaxTabsControl(setting: Setting, warningHost: HTMLElement): HTMLElement {
    const maxTabsWarningEl = warningHost.createDiv({
      cls: 'qoderian-max-tabs-warning qoderian-setting-validation qoderian-setting-validation-warning qoderian-hidden',
    });
    maxTabsWarningEl.setText(t('settings.maxTabs.warning'));

    const updateMaxTabsWarning = (value: number): void => {
      maxTabsWarningEl.toggleClass('qoderian-hidden', value <= 5);
    };

    setting.addSlider((slider) => {
      slider
        .setLimits(3, 10, 1)
        .setValue(this.plugin.settings.maxTabs ?? 3)
        .onChange(async (value) => {
          this.plugin.settings.maxTabs = value;
          await this.plugin.saveSettings();
          updateMaxTabsWarning(value);
          for (const view of this.plugin.getAllViews()) {
            view.refreshTabControls();
          }
        });
      updateMaxTabsWarning(this.plugin.settings.maxTabs ?? 3);
    });

    return maxTabsWarningEl;
  }

  /** Builds the chat view placement dropdown with error rollback. */
  private renderChatViewPlacementControl(setting: Setting): void {
    setting.addDropdown((dropdown) => {
      dropdown
        .addOption('right-sidebar', t('settings.chatViewPlacement.rightSidebar'))
        .addOption('left-sidebar', t('settings.chatViewPlacement.leftSidebar'))
        .addOption('main-tab', t('settings.chatViewPlacement.mainTab'))
        .setValue(this.plugin.settings.chatViewPlacement)
        .onChange(async (value) => {
          const previousPlacement = this.plugin.settings.chatViewPlacement;
          try {
            await this.plugin.updateChatViewPlacement(value as ChatViewPlacement);
          } catch (error) {
            dropdown.setValue(previousPlacement);
            const message = error instanceof Error
              ? error.message
              : 'Could not move the Qoderian view.';
            new Notice(message);
          }
        });
    });
  }

  /** Builds the keyboard navigation mappings editor with debounced validation. */
  private renderNavMappingsControl(setting: Setting): void {
    setting.addTextArea((text) => {
      let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
      let saveTimeout: number | null = null;

      const commitValue = async (showError: boolean): Promise<void> => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
          saveTimeout = null;
        }

        const result = parseNavMappings(pendingValue);
        if (!result.settings) {
          if (showError) {
            new Notice(`${t('common.error')}: ${result.error}`);
            pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
            text.setValue(pendingValue);
          }
          return;
        }

        this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
        this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
        this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
        await this.plugin.saveSettings();
        pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        text.setValue(pendingValue);
      };

      const scheduleSave = (): void => {
        if (saveTimeout !== null) {
          window.clearTimeout(saveTimeout);
        }
        saveTimeout = window.setTimeout(() => {
          void commitValue(false);
        }, 500);
      };

      text
        .setPlaceholder('Map w scrollup\nmap s scrolldown\nmap i focusinput')
        .setValue(pendingValue)
        .onChange((value) => {
          pendingValue = value;
          scheduleSave();
        });

      text.inputEl.rows = 3;
      text.inputEl.addEventListener('blur', () => {
        void commitValue(true);
      });
    });
  }

  private renderTitleModelSetting(container: HTMLElement): void {
    container.empty();
    if (!this.plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    new Setting(container)
      .setName(t('settings.titleModel.name'))
      .setDesc(t('settings.titleModel.desc'))
      .addDropdown((dropdown) => {
        const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
        const modelConfig = this.plugin.qoderServices.modelConfig;
        for (const model of modelConfig.getModelOptions(settingsBag)) {
          dropdown.addOption(model.value, model.label);
        }

        dropdown
          .setValue(this.plugin.settings.titleGenerationModel || 'auto')
          .onChange(async (value) => {
            this.plugin.settings.titleGenerationModel = value;
            await this.plugin.saveSettings();
          });
      });
  }

  /** Debounced service restart so prompt edits apply after typing settles. */
  private schedulePromptRestart(): void {
    if (this.promptRestartTimer !== null) {
      window.clearTimeout(this.promptRestartTimer);
    }
    this.promptRestartTimer = window.setTimeout(() => {
      this.promptRestartTimer = null;
      void this.restartServiceForPromptChange();
    }, 1000);
  }

  private async restartServiceForPromptChange(): Promise<void> {
    const view = this.plugin.getView();
    const tabManager = view?.getTabManager();
    if (!tabManager) return;

    try {
      await tabManager.broadcastToAllTabs(
        async (service) => { await service.ensureReady({ force: true }); }
      );
    } catch {
      // Changes will apply on the next conversation if the restart fails.
    }
  }
}
