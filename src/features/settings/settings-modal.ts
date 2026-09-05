import { Modal } from 'obsidian';

import { t } from '../../i18n/i18n';
import type QoderianPlugin from '../../main';
import { QoderianSettingTab } from './settings-tab';

/** Qoderian-owned settings window that does not navigate into Obsidian settings. */
export class QoderianSettingsModal extends Modal {
  private settingsTab: QoderianSettingTab | null = null;

  constructor(private readonly plugin: QoderianPlugin) {
    super(plugin.app);
  }

  onOpen(): void {
    this.modalEl.addClass('qoderian-settings-modal');
    this.contentEl.addClass('qoderian-settings-modal-content');
    this.titleEl.setText(t('settings.title'));

    const settingsTab = new QoderianSettingTab(this.app, this.plugin);
    settingsTab.containerEl = this.contentEl;
    settingsTab.display();
    this.settingsTab = settingsTab;
  }

  onClose(): void {
    (this.settingsTab as { hide?: () => void } | null)?.hide?.();
    this.settingsTab = null;
    this.contentEl.empty();
  }
}
