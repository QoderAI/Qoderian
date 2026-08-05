import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { QoderCommandCatalogContract } from '../../../qoder/commands/qoder-command-catalog-contract';
import type {
  QoderCommandEntry,
  QoderCommandKind,
} from '../../../qoder/commands/qoder-command-entry';
import {
  validateCommandName,
  validateSkillName,
} from '../../../qoder/commands/slash-command';
import { confirmDelete } from '../../../shared/modals/confirm-modal';

const QODER_COMMANDS_DOCS = 'https://docs.qoder.com/cli/command';
const QODER_SKILLS_DOCS = 'https://docs.qoder.com/cli/Skills';

function getEntryLabel(kind: QoderCommandKind): string {
  return kind === 'skill'
    ? t('settings.slashCommands.skill')
    : t('settings.slashCommands.command');
}

class QoderEntryModal extends Modal {
  constructor(
    app: App,
    private readonly entries: QoderCommandEntry[],
    private readonly kind: QoderCommandKind,
    private readonly existingEntry: QoderCommandEntry | null,
    private readonly onSave: (entry: QoderCommandEntry) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const isSkill = this.kind === 'skill';
    this.setTitle(t(
      this.existingEntry
        ? 'settings.slashCommands.modal.titleEdit'
        : 'settings.slashCommands.modal.titleAdd',
      { type: getEntryLabel(this.kind) },
    ));
    this.modalEl.addClass('qoderian-sp-modal');

    let nameInput: HTMLInputElement;
    let descriptionInput: HTMLInputElement;

    new Setting(this.contentEl)
      .setName(t('settings.slashCommands.modal.name'))
      .setDesc(t('settings.slashCommands.modal.nameDesc'))
      .addText((text) => {
        nameInput = text.inputEl;
        text
          .setPlaceholder(isSkill ? 'code-review' : 'review-code')
          .setValue(this.existingEntry?.name ?? '');

        // A skill can contain scripts, references, and templates beside
        // SKILL.md. Renaming it as a simple file edit would orphan those assets.
        if (isSkill && this.existingEntry) {
          text.setDisabled(true);
        }
      });

    new Setting(this.contentEl)
      .setName(t('settings.slashCommands.modal.description'))
      .setDesc(t('settings.slashCommands.modal.descriptionDesc'))
      .addText((text) => {
        descriptionInput = text.inputEl;
        text.setValue(this.existingEntry?.description ?? '');
      });

    new Setting(this.contentEl)
      .setName(t('settings.slashCommands.modal.instructions'))
      .setDesc(t(
        isSkill
          ? 'settings.slashCommands.modal.skillInstructionsDesc'
          : 'settings.slashCommands.modal.commandInstructionsDesc',
      ));

    const contentArea = this.contentEl.createEl('textarea', {
      cls: 'qoderian-sp-content-area',
      attr: {
        rows: '12',
        placeholder: t(
          isSkill
            ? 'settings.slashCommands.modal.skillInstructionsPlaceholder'
            : 'settings.slashCommands.modal.commandInstructionsPlaceholder',
        ),
      },
    });
    contentArea.value = this.existingEntry?.content ?? '';

    const buttonContainer = this.contentEl.createDiv({ cls: 'qoderian-sp-modal-buttons' });
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => this.close());

    const saveButton = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta',
    });
    saveButton.addEventListener('click', () => {
      void this.save(nameInput, descriptionInput, contentArea);
    });

    this.contentEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async save(
    nameInput: HTMLInputElement,
    descriptionInput: HTMLInputElement,
    contentArea: HTMLTextAreaElement,
  ): Promise<void> {
    const name = nameInput.value.trim();
    const nameError = this.kind === 'skill'
      ? validateSkillName(name)
      : validateCommandName(name);
    if (nameError) {
      new Notice(nameError);
      return;
    }

    const description = descriptionInput.value.trim();
    if (!description) {
      new Notice(t('settings.slashCommands.descriptionRequired'));
      return;
    }

    const content = contentArea.value.trim();
    if (!content) {
      new Notice(t('settings.slashCommands.instructionsRequired'));
      return;
    }

    const duplicate = this.entries.find((entry) =>
      entry.name.toLowerCase() === name.toLowerCase()
      && entry.id !== this.existingEntry?.id
    );
    if (duplicate) {
      new Notice(t('settings.slashCommands.duplicateName', { name }));
      return;
    }

    const entry: QoderCommandEntry = {
      ...(this.existingEntry ?? {}),
      id: this.existingEntry?.id
        ?? (this.kind === 'skill'
          ? `skill-${name}`
          : `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`),
      kind: this.kind,
      name,
      description,
      content,
      scope: 'vault',
      source: this.existingEntry?.source ?? 'user',
      isEditable: true,
      isDeletable: true,
      displayPrefix: '/',
      insertPrefix: '/',
    };

    try {
      await this.onSave(entry);
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.error');
      new Notice(t('settings.slashCommands.saveFailed', { message }));
    }
  }
}

export class CommandSkillSettings {
  private commands: QoderCommandEntry[] = [];

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly app: App,
    private readonly catalog: QoderCommandCatalogContract | null,
  ) {
    void this.loadAndRender();
  }

  public refresh(): void {
    void this.loadAndRender();
  }

  private async loadAndRender(): Promise<void> {
    if (!this.catalog) {
      this.renderUnavailable();
      return;
    }

    try {
      this.commands = await this.catalog.listVaultEntries();
      this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.error');
      this.renderUnavailable(message);
    }
  }

  private renderUnavailable(message?: string): void {
    this.containerEl.empty();
    const emptyEl = this.containerEl.createDiv({ cls: 'qoderian-sp-empty-state' });
    emptyEl.setText(message ?? t('settings.slashCommands.unavailable'));
  }

  private render(): void {
    this.containerEl.empty();
    this.renderSection('command');
    this.renderSection('skill');
  }

  private renderSection(kind: QoderCommandKind): void {
    const isSkill = kind === 'skill';
    const sectionEl = this.containerEl.createDiv({ cls: 'qoderian-command-section' });
    const headerEl = sectionEl.createDiv({ cls: 'qoderian-command-section-header' });
    const copyEl = headerEl.createDiv({ cls: 'qoderian-command-section-copy' });
    copyEl.createEl('h4', {
      text: isSkill
        ? t('settings.slashCommands.skills')
        : t('settings.slashCommands.commands'),
    });

    const descriptionEl = copyEl.createEl('p', { cls: 'setting-item-description' });
    descriptionEl.appendText(t(
      isSkill
        ? 'settings.slashCommands.skillsDesc'
        : 'settings.slashCommands.commandsDesc',
    ));
    descriptionEl.appendText(' ');
    descriptionEl.createEl('a', {
      text: t('settings.slashCommands.learnMore'),
      href: isSkill ? QODER_SKILLS_DOCS : QODER_COMMANDS_DOCS,
    });

    const addButton = headerEl.createEl('button', {
      cls: 'qoderian-settings-action-btn',
      attr: {
        'aria-label': isSkill
          ? t('settings.slashCommands.modal.titleAdd', {
            type: t('settings.slashCommands.skill'),
          })
          : t('settings.slashCommands.modal.titleAdd', {
            type: t('settings.slashCommands.command'),
          }),
      },
    });
    setIcon(addButton, 'plus');
    addButton.addEventListener('click', () => this.openEntryModal(kind, null));

    const entries = this.commands.filter((entry) => entry.kind === kind);
    if (entries.length === 0) {
      const emptyEl = sectionEl.createDiv({ cls: 'qoderian-sp-empty-state' });
      emptyEl.setText(t(
        isSkill
          ? 'settings.slashCommands.noSkills'
          : 'settings.slashCommands.noCommands',
      ));
      return;
    }

    const listEl = sectionEl.createDiv({ cls: 'qoderian-sp-list' });
    for (const entry of entries) {
      this.renderEntry(listEl, entry);
    }
  }

  private renderEntry(listEl: HTMLElement, entry: QoderCommandEntry): void {
    const itemEl = listEl.createDiv({ cls: 'qoderian-sp-item' });
    const infoEl = itemEl.createDiv({ cls: 'qoderian-sp-info' });
    const nameEl = infoEl.createEl('code', { cls: 'qoderian-sp-item-name' });
    nameEl.setText(`/${entry.name}`);

    if (entry.description) {
      infoEl.createDiv({
        text: entry.description,
        cls: 'qoderian-sp-item-desc',
      });
    }

    const actionsEl = itemEl.createDiv({ cls: 'qoderian-sp-item-actions' });
    if (entry.isEditable) {
      const editButton = actionsEl.createEl('button', {
        cls: 'qoderian-settings-action-btn',
        attr: { 'aria-label': t('common.edit') },
      });
      setIcon(editButton, 'pencil');
      editButton.addEventListener('click', () => this.openEntryModal(entry.kind, entry));
    }

    if (entry.isDeletable) {
      const deleteButton = actionsEl.createEl('button', {
        cls: 'qoderian-settings-action-btn qoderian-settings-delete-btn',
        attr: { 'aria-label': t('common.delete') },
      });
      setIcon(deleteButton, 'trash-2');
      deleteButton.addEventListener('click', () => {
        void this.confirmAndDelete(entry);
      });
    }
  }

  private openEntryModal(kind: QoderCommandKind, existingEntry: QoderCommandEntry | null): void {
    new QoderEntryModal(
      this.app,
      this.commands,
      kind,
      existingEntry,
      async (entry) => this.saveEntry(entry, existingEntry),
    ).open();
  }

  private async saveEntry(
    entry: QoderCommandEntry,
    existingEntry: QoderCommandEntry | null,
  ): Promise<void> {
    if (!this.catalog) return;

    await this.catalog.saveVaultEntry(entry);
    if (existingEntry && existingEntry.name !== entry.name) {
      await this.catalog.deleteVaultEntry(existingEntry);
    }

    await this.reloadEntries();
    this.render();
    new Notice(t(
      existingEntry
        ? 'settings.slashCommands.updated'
        : 'settings.slashCommands.created',
      { type: getEntryLabel(entry.kind), name: entry.name },
    ));
  }

  private async confirmAndDelete(entry: QoderCommandEntry): Promise<void> {
    const confirmed = await confirmDelete(
      this.app,
      t('settings.slashCommands.deleteConfirm', {
        type: getEntryLabel(entry.kind),
        name: entry.name,
      }),
    );
    if (!confirmed || !this.catalog) return;

    try {
      await this.catalog.deleteVaultEntry(entry);
      await this.reloadEntries();
      this.render();
      new Notice(t('settings.slashCommands.deleted', {
        type: getEntryLabel(entry.kind),
        name: entry.name,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('common.error');
      new Notice(t('settings.slashCommands.deleteFailed', { message }));
    }
  }

  private async reloadEntries(): Promise<void> {
    this.commands = this.catalog
      ? await this.catalog.listVaultEntries()
      : [];
  }
}
