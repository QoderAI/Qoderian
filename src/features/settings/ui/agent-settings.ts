import type { App } from 'obsidian';
import { Modal, Notice, setIcon, Setting } from 'obsidian';

import type { AgentDefinition } from '../../../core/types';
import type {
  AppAgentCatalog,
  AppAgentStorage,
} from '../../../core/types/services';
import { t } from '../../../i18n/i18n';
import { validateAgentName } from '../../../qoder/agents/agent-definition';
import { confirmDelete } from '../../../shared/modals/confirm-modal';

class AgentModal extends Modal {
  private existingAgent: AgentDefinition | null;
  private findDuplicate: (name: string, excludeId?: string) => Promise<AgentDefinition | undefined>;
  private onSave: (agent: AgentDefinition) => Promise<void>;

  constructor(
    app: App,
    existingAgent: AgentDefinition | null,
    modelOptions: Array<{ value: string; label: string }>,
    findDuplicate: (name: string, excludeId?: string) => Promise<AgentDefinition | undefined>,
    onSave: (agent: AgentDefinition) => Promise<void>
  ) {
    super(app);
    this.existingAgent = existingAgent;
    this.findDuplicate = findDuplicate;
    this.onSave = onSave;
    this.modelOptions = [
      { value: 'inherit', label: 'Inherit' },
      ...modelOptions,
    ];
  }

  private readonly modelOptions: Array<{ value: string; label: string }>;

  onOpen() {
    this.setTitle(
      this.existingAgent
        ? t('settings.subagents.modal.titleEdit')
        : t('settings.subagents.modal.titleAdd')
    );
    this.modalEl.addClass('qoderian-sp-modal');

    const { contentEl } = this;

    let nameInput: HTMLInputElement;
    let descInput: HTMLInputElement;
    let modelValue: string = this.existingAgent?.model ?? 'inherit';
    let toolsInput: HTMLInputElement;
    let disallowedToolsInput: HTMLInputElement;
    let skillsInput: HTMLInputElement;

    new Setting(contentEl)
      .setName(t('settings.subagents.modal.name'))
      .setDesc(t('settings.subagents.modal.nameDesc'))
      .addText(text => {
        nameInput = text.inputEl;
        text.setValue(this.existingAgent?.name || '')
          .setPlaceholder(t('settings.subagents.modal.namePlaceholder'));
      });

    new Setting(contentEl)
      .setName(t('settings.subagents.modal.description'))
      .setDesc(t('settings.subagents.modal.descriptionDesc'))
      .addText(text => {
        descInput = text.inputEl;
        text.setValue(this.existingAgent?.description || '')
          .setPlaceholder(t('settings.subagents.modal.descriptionPlaceholder'));
      });

    const details = contentEl.createEl('details', { cls: 'qoderian-sp-advanced-section' });
    details.createEl('summary', {
      text: t('settings.subagents.modal.advancedOptions'),
      cls: 'qoderian-sp-advanced-summary',
    });
    if ((this.existingAgent?.model && this.existingAgent.model !== 'inherit') ||
        this.existingAgent?.tools?.length ||
        this.existingAgent?.disallowedTools?.length ||
        this.existingAgent?.skills?.length) {
      details.open = true;
    }

    new Setting(details)
      .setName(t('settings.subagents.modal.model'))
      .setDesc(t('settings.subagents.modal.modelDesc'))
      .addDropdown(dropdown => {
        for (const opt of this.modelOptions) {
          dropdown.addOption(opt.value, opt.label);
        }
        if (modelValue && !this.modelOptions.some(option => option.value === modelValue)) {
          dropdown.addOption(modelValue, modelValue);
        }
        dropdown
          .setValue(modelValue)
          .onChange(value => { modelValue = value; });
      });

    new Setting(details)
      .setName(t('settings.subagents.modal.tools'))
      .setDesc(t('settings.subagents.modal.toolsDesc'))
      .addText(text => {
        toolsInput = text.inputEl;
        text.setValue(this.existingAgent?.tools?.join(', ') || '');
      });

    new Setting(details)
      .setName(t('settings.subagents.modal.disallowedTools'))
      .setDesc(t('settings.subagents.modal.disallowedToolsDesc'))
      .addText(text => {
        disallowedToolsInput = text.inputEl;
        text.setValue(this.existingAgent?.disallowedTools?.join(', ') || '');
      });

    new Setting(details)
      .setName(t('settings.subagents.modal.skills'))
      .setDesc(t('settings.subagents.modal.skillsDesc'))
      .addText(text => {
        skillsInput = text.inputEl;
        text.setValue(this.existingAgent?.skills?.join(', ') || '');
      });

    new Setting(contentEl)
      .setName(t('settings.subagents.modal.prompt'))
      .setDesc(t('settings.subagents.modal.promptDesc'));

    const contentArea = contentEl.createEl('textarea', {
      cls: 'qoderian-sp-content-area',
      attr: {
        rows: '10',
        placeholder: t('settings.subagents.modal.promptPlaceholder'),
      },
    });
    contentArea.value = this.existingAgent?.prompt || '';

    const buttonContainer = contentEl.createDiv({ cls: 'qoderian-sp-modal-buttons' });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('common.cancel'),
      cls: 'qoderian-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'qoderian-save-btn',
    });
    saveBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      const name = nameInput.value.trim();
      const nameError = validateAgentName(name);
      if (nameError) {
        new Notice(nameError);
        return;
      }

      const description = descInput.value.trim();
      if (!description) {
        new Notice(t('settings.subagents.descriptionRequired'));
        return;
      }

      const prompt = contentArea.value;
      if (!prompt.trim()) {
        new Notice(t('settings.subagents.promptRequired'));
        return;
      }

      const duplicate = await this.findDuplicate(name, this.existingAgent?.id);
      if (duplicate) {
        new Notice(t('settings.subagents.duplicateName', { name }));
        return;
      }

      const parseList = (input: HTMLInputElement): string[] | undefined => {
        const val = input.value.trim();
        if (!val) return undefined;
        return val.split(',').map(s => s.trim()).filter(Boolean);
      };

      const agent: AgentDefinition = {
        id: name,
        name,
        description,
        prompt,
        tools: parseList(toolsInput),
        disallowedTools: parseList(disallowedToolsInput),
        model: (modelValue) || 'inherit',
        source: 'vault',
        filePath: this.existingAgent?.filePath,
        skills: parseList(skillsInput),
        permissionMode: this.existingAgent?.permissionMode,
        hooks: this.existingAgent?.hooks,
        extraFrontmatter: this.existingAgent?.extraFrontmatter,
      };

      try {
        await this.onSave(agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        new Notice(t('settings.subagents.saveFailed', { message }));
        return;
      }
      this.close();
      })();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export interface AgentSettingsDeps {
  app: App;
  agentCatalog: Pick<AppAgentCatalog, 'getAvailableAgents' | 'refresh'>;
  agentStorage: Pick<AppAgentStorage, 'loadAll' | 'load' | 'save' | 'delete'>;
  modelOptions: Array<{ value: string; label: string }>;
}

export class AgentSettings {
  private app: App;
  private containerEl: HTMLElement;
  private agentCatalog: Pick<AppAgentCatalog, 'getAvailableAgents' | 'refresh'>;
  private agentStorage: Pick<AppAgentStorage, 'loadAll' | 'load' | 'save' | 'delete'>;
  private modelOptions: Array<{ value: string; label: string }>;

  constructor(containerEl: HTMLElement, deps: AgentSettingsDeps) {
    this.app = deps.app;
    this.containerEl = containerEl;
    this.agentCatalog = deps.agentCatalog;
    this.agentStorage = deps.agentStorage;
    this.modelOptions = deps.modelOptions;
    this.render();
  }

  private render(): void {
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'qoderian-sp-header' });
    headerEl.createSpan({ text: t('settings.subagents.name'), cls: 'qoderian-sp-label' });

    const actionsEl = headerEl.createDiv({ cls: 'qoderian-sp-header-actions' });

    const refreshBtn = actionsEl.createEl('button', {
      cls: 'qoderian-settings-action-btn',
      attr: { 'aria-label': t('common.refresh') },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => { void this.refreshAgents(); });

    const addBtn = actionsEl.createEl('button', {
      cls: 'qoderian-settings-action-btn',
      attr: { 'aria-label': t('common.add') },
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', () => { void this.openAgentModal(null); });

    void this.renderAgentList();
  }

  /** Vault agents are edited via storage, so the list loads from disk. */
  private async renderAgentList(): Promise<void> {
    let vaultAgents: AgentDefinition[] = [];
    try {
      vaultAgents = await this.agentStorage.loadAll();
    } catch {
      // Non-critical: the list stays empty until the next render.
    }

    if (vaultAgents.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'qoderian-sp-empty-state' });
      emptyEl.setText(t('settings.subagents.noAgents'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'qoderian-sp-list' });

    for (const agent of vaultAgents) {
      this.renderAgentItem(listEl, agent);
    }
  }

  private renderAgentItem(listEl: HTMLElement, agent: AgentDefinition): void {
    const itemEl = listEl.createDiv({ cls: 'qoderian-sp-item' });

    const infoEl = itemEl.createDiv({ cls: 'qoderian-sp-info' });

    const headerRow = infoEl.createDiv({ cls: 'qoderian-sp-item-header' });

    const nameEl = headerRow.createSpan({ cls: 'qoderian-sp-item-name' });
    nameEl.setText(agent.name);

    if (agent.description) {
      const descEl = infoEl.createDiv({ cls: 'qoderian-sp-item-desc' });
      descEl.setText(agent.description);
    }

    const actionsEl = itemEl.createDiv({ cls: 'qoderian-sp-item-actions' });

    const editBtn = actionsEl.createEl('button', {
      cls: 'qoderian-settings-action-btn',
      attr: { 'aria-label': t('common.edit') },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => { void this.openAgentModal(agent); });

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'qoderian-settings-action-btn qoderian-settings-delete-btn',
      attr: { 'aria-label': t('common.delete') },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      const confirmed = await confirmDelete(
        this.app,
        t('settings.subagents.deleteConfirm', { name: agent.name })
      );
      if (!confirmed) return;
      try {
        await this.deleteAgent(agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        new Notice(t('settings.subagents.deleteFailed', { message }));
      }
      })();
    });
  }

  private async refreshAgents(): Promise<void> {
    try {
      await this.agentCatalog.refresh();
      this.render();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      new Notice(t('settings.subagents.refreshFailed', { message }));
    }
  }

  private async openAgentModal(existingAgent: AgentDefinition | null): Promise<void> {
    let fresh: AgentDefinition | null;
    if (existingAgent) {
      try {
        fresh = await this.agentStorage.load(existingAgent) ?? existingAgent;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        new Notice(`Failed to load subagent "${existingAgent.name}": ${message}`);
        return;
      }
    } else {
      fresh = null;
    }

    new AgentModal(
      this.app,
      fresh,
      this.modelOptions,
      (name, excludeId) => this.findDuplicate(name, excludeId),
      (agent) => this.saveAgent(agent, fresh)
    ).open();
  }

  /** Checks vault files first, then the runtime catalog reported by the CLI. */
  private async findDuplicate(
    name: string,
    excludeId?: string,
  ): Promise<AgentDefinition | undefined> {
    const lower = name.toLowerCase();
    const matches = (agent: AgentDefinition) =>
      agent.id.toLowerCase() === lower && agent.id !== excludeId;

    try {
      const vaultAgents = await this.agentStorage.loadAll();
      const vaultHit = vaultAgents.find(matches);
      if (vaultHit) return vaultHit;
    } catch {
      // Fall through to the catalog-only check.
    }

    return this.agentCatalog.getAvailableAgents().find(matches);
  }

  private async saveAgent(agent: AgentDefinition, existing: AgentDefinition | null): Promise<void> {
    if (existing && existing.name !== agent.name) {
      // Rename: save to new name-based path, then delete old file
      await this.agentStorage.save({ ...agent, filePath: undefined });
      try {
        await this.agentStorage.delete(existing);
      } catch {
        new Notice(t('settings.subagents.renameCleanupFailed', { name: existing.name }));
      }
    } else {
      await this.agentStorage.save(agent);
    }

    // The CLI picks up the new file on its own; refresh in the background.
    void this.agentCatalog.refresh();
    this.render();
    new Notice(
      existing
        ? t('settings.subagents.updated', { name: agent.name })
        : t('settings.subagents.created', { name: agent.name })
    );
  }

  private async deleteAgent(agent: AgentDefinition): Promise<void> {
    await this.agentStorage.delete(agent);

    void this.agentCatalog.refresh();
    this.render();
    new Notice(t('settings.subagents.deleted', { name: agent.name }));
  }

}
