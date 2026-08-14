import { Notice } from 'obsidian';

import type { QoderRuntimeStatus } from '../../../../core/types/services';
import type { PermissionMode } from '../../../../core/types/settings';
import { getActiveQoderCliEdition, getQoderCliLoginCommand } from '../../../../qoder/config/cli-edition';
import type { QoderModelConfig } from '../../../../qoder/models/qoder-model-config';
import { createIconSvg, QODER_ICON } from '../../../../shared/icons';
import { ClickPopover } from './click-popover';

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  effortLevel: string;
  permissionMode: PermissionMode;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onEffortLevelChange: (effort: string) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getModelConfig: () => QoderModelConfig;
  getRuntimeStatus?: () => QoderRuntimeStatus;
  retryRuntimeCatalog?: () => Promise<void>;
  subscribeRuntimeStatus?: (listener: (status: QoderRuntimeStatus) => void) => () => void;
}

const DEFAULT_RUNTIME_STATUS: QoderRuntimeStatus = {
  kind: 'ready',
  message: 'Qoder CLI is ready.',
};

function getRuntimeStatusLabel(status: QoderRuntimeStatus): string {
  switch (status.kind) {
    case 'checking': return 'Loading models…';
    case 'cliMissing': return 'Setup required';
    case 'nodeMissing': return 'Node.js required';
    case 'authRequired': return 'Sign in required';
    case 'incompatible': return 'Update required';
    case 'offline': return 'Models unavailable';
    case 'noModels': return 'No models';
    case 'failed': return 'Setup issue';
    case 'ready': return 'Models unavailable';
  }
}

function canUseCachedModels(status: QoderRuntimeStatus): boolean {
  return status.kind === 'checking' || status.kind === 'offline' || status.kind === 'failed';
}

export class ModelSelector {
  private readonly container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private popover: ClickPopover | null = null;
  private unsubscribeRuntimeStatus: (() => void) | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'qoderian-model-selector' });
    this.render();
    this.unsubscribeRuntimeStatus = callbacks.subscribeRuntimeStatus?.(() => {
      this.updateDisplay();
      this.renderOptions();
    }) ?? null;
  }

  destroy(): void {
    this.popover?.destroy();
    this.popover = null;
    this.unsubscribeRuntimeStatus?.();
    this.unsubscribeRuntimeStatus = null;
  }

  private getAvailableModels() {
    const settings = this.callbacks.getSettings();
    const modelConfig = this.callbacks.getModelConfig();
    return modelConfig.getModelOptions(settings);
  }

  private render(): void {
    this.popover?.destroy();
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'qoderian-model-btn' });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'qoderian-model-dropdown' });
    this.renderOptions();
    this.popover = new ClickPopover(
      this.container,
      this.buttonEl,
      this.dropdownEl,
      'qoderian-model-selector--open',
    );
  }

  updateDisplay(): void {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find(model => model.value === currentModel);
    const displayModel = modelInfo || models[0];
    const status = this.callbacks.getRuntimeStatus?.() ?? DEFAULT_RUNTIME_STATUS;
    const showCachedModel = displayModel && canUseCachedModels(status);
    const showReadyModel = displayModel && status.kind === 'ready';

    this.buttonEl.empty();
    this.buttonEl.toggleClass('qoderian-model-btn--warning', status.kind !== 'ready');
    this.buttonEl.setAttribute('title', status.kind === 'ready' ? '' : status.message);
    this.buttonEl.createSpan({
      cls: 'qoderian-model-label',
      text: showReadyModel || showCachedModel
        ? displayModel.label
        : getRuntimeStatusLabel(status),
    });
  }

  renderOptions(): void {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const status = this.callbacks.getRuntimeStatus?.() ?? DEFAULT_RUNTIME_STATUS;
    let lastGroup: string | undefined;

    if (status.kind !== 'ready') {
      const statusEl = this.dropdownEl.createDiv({ cls: 'qoderian-model-runtime-status' });
      statusEl.createDiv({ cls: 'qoderian-model-runtime-title', text: getRuntimeStatusLabel(status) });
      statusEl.createDiv({ cls: 'qoderian-model-runtime-message', text: status.message });
      if (status.kind === 'authRequired') {
        statusEl.createEl('code', {
          cls: 'qoderian-model-runtime-command',
          text: getQoderCliLoginCommand(getActiveQoderCliEdition()),
        });
      }
      if (status.details) {
        statusEl.setAttribute('title', status.details);
      }
      if (this.callbacks.retryRuntimeCatalog) {
        const retryButton = statusEl.createEl('button', {
          cls: 'qoderian-model-runtime-retry',
          text: status.kind === 'checking' ? 'Checking…' : 'Retry',
        });
        if (status.kind === 'checking') {
          retryButton.setAttribute('disabled', 'true');
        }
        retryButton.addEventListener('click', (event) => {
          event.stopPropagation();
          runToolbarAction(async () => {
            await this.callbacks.retryRuntimeCatalog?.();
          }, 'Failed to recheck Qoder CLI');
        });
      }
    }

    const shouldRenderModels = status.kind === 'ready' || canUseCachedModels(status);
    if (!shouldRenderModels) return;

    for (const model of [...models].reverse()) {
      if (model.group && model.group !== lastGroup) {
        this.dropdownEl.createDiv({
          cls: 'qoderian-model-group',
          text: model.group,
        });
        lastGroup = model.group;
      }

      const option = this.dropdownEl.createDiv({ cls: 'qoderian-model-option' });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(model.value === currentModel));
      if (model.value === currentModel) option.addClass('selected');

      option.appendChild(createIconSvg(QODER_ICON, {
        className: 'qoderian-model-icon',
        height: 12,
        ownerDocument: option.ownerDocument,
        width: 12,
      }));
      option.createSpan({ cls: 'qoderian-model-option-label', text: model.label });
      if (model.promotionLabel || model.priceLabel) {
        const meta = option.createSpan({ cls: 'qoderian-model-meta' });
        if (model.promotionLabel) {
          meta.createSpan({ cls: 'qoderian-model-promo', text: model.promotionLabel });
        }
        if (model.priceLabel) {
          meta.createSpan({ cls: 'qoderian-model-price', text: model.priceLabel });
        }
      }
      if (model.description) option.setAttribute('title', model.description);

      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.popover?.close();
        runToolbarAction(async () => {
          await this.callbacks.onModelChange(model.value);
          this.updateDisplay();
          this.renderOptions();
        }, 'Failed to change model');
      });
    }
  }
}

export class EffortSelector {
  private readonly container: HTMLElement;
  private effortEl: HTMLElement | null = null;
  private effortGearsEl: HTMLElement | null = null;
  private popover: ClickPopover | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'qoderian-thinking-selector' });
    this.render();
  }

  destroy(): void {
    this.popover?.destroy();
    this.popover = null;
  }

  private render(): void {
    this.container.empty();
    this.effortEl = this.container.createDiv({ cls: 'qoderian-thinking-effort' });
    this.effortEl.createSpan({ cls: 'qoderian-thinking-label-text', text: 'Effort:' });
    this.effortGearsEl = this.effortEl.createDiv({ cls: 'qoderian-thinking-gears' });
    this.updateDisplay();
  }

  private renderEffortGears(): void {
    if (!this.effortGearsEl) return;
    this.popover?.destroy();
    this.effortGearsEl.empty();

    const currentEffort = this.callbacks.getSettings().effortLevel;
    const modelConfig = this.callbacks.getModelConfig();
    const model = this.callbacks.getSettings().model;
    const options = modelConfig.getReasoningOptions(model);
    const currentInfo = options.find(effort => effort.value === currentEffort);

    const currentEl = this.effortGearsEl.createDiv({
      cls: 'qoderian-thinking-current',
      text: currentInfo?.label || options[0]?.label || 'High',
    });
    const optionsEl = this.effortGearsEl.createDiv({ cls: 'qoderian-thinking-options' });

    for (const effort of [...options].reverse()) {
      const option = optionsEl.createDiv({ cls: 'qoderian-thinking-gear', text: effort.label });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(effort.value === currentEffort));
      if (effort.value === currentEffort) option.addClass('selected');

      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.popover?.close();
        runToolbarAction(async () => {
          await this.callbacks.onEffortLevelChange(effort.value);
          this.updateDisplay();
        }, 'Failed to change effort level');
      });
    }

    this.popover = new ClickPopover(
      this.effortGearsEl,
      currentEl,
      optionsEl,
      'qoderian-thinking-gears--open',
    );
  }

  updateDisplay(): void {
    const settings = this.callbacks.getSettings();
    const modelConfig = this.callbacks.getModelConfig();
    const options = modelConfig.getReasoningOptions(settings.model);
    const defaultValue = modelConfig.getDefaultReasoningValue(settings.model);
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);

    if (shouldHide) {
      this.popover?.close();
      this.effortEl?.addClass('qoderian-hidden');
      return;
    }

    this.effortEl?.removeClass('qoderian-hidden');
    this.renderEffortGears();
  }
}

export class PermissionToggle {
  private readonly container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private popover: ClickPopover | null = null;
  private visible = true;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'qoderian-permission-toggle' });
    this.render();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updateDisplay();
  }

  destroy(): void {
    this.popover?.destroy();
    this.popover = null;
  }

  private render(): void {
    this.popover?.destroy();
    this.container.empty();
    this.buttonEl = this.container.createDiv({ cls: 'qoderian-permission-button' });
    this.dropdownEl = this.container.createDiv({ cls: 'qoderian-permission-dropdown' });
    this.updateDisplay();
    this.renderOptions();
    this.popover = new ClickPopover(
      this.container,
      this.buttonEl,
      this.dropdownEl,
      'qoderian-permission-toggle--open',
    );
  }

  updateDisplay(): void {
    if (!this.buttonEl) return;

    if (!this.visible) {
      this.container.addClass('qoderian-hidden');
      return;
    }

    this.container.removeClass('qoderian-hidden');
    const mode = this.callbacks.getSettings().permissionMode;
    const option = PERMISSION_MODE_OPTIONS.find(candidate => candidate.value === mode)
      ?? PERMISSION_MODE_OPTIONS[0];
    this.buttonEl.className = `qoderian-permission-button qoderian-permission-button--${option.value}`;
    this.buttonEl.empty();
    this.buttonEl.createSpan({ cls: 'qoderian-permission-dot' });
    this.buttonEl.createSpan({ cls: 'qoderian-permission-label', text: option.label });
    this.buttonEl.createSpan({ cls: 'qoderian-permission-chevron', text: '⌄' });
    this.buttonEl.setAttribute('title', option.description);
  }

  private renderOptions(): void {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();
    const current = this.callbacks.getSettings().permissionMode;

    for (const mode of PERMISSION_MODE_OPTIONS) {
      const option = this.dropdownEl.createDiv({
        cls: `qoderian-permission-option qoderian-permission-option--${mode.value}`,
      });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(mode.value === current));
      if (mode.value === current) option.addClass('selected');
      option.createSpan({ cls: 'qoderian-permission-dot' });
      const copy = option.createDiv({ cls: 'qoderian-permission-option-copy' });
      copy.createDiv({ cls: 'qoderian-permission-option-label', text: mode.label });
      copy.createDiv({ cls: 'qoderian-permission-option-description', text: mode.description });

      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.popover?.close();
        if (mode.value === current) return;
        runToolbarAction(async () => {
          await this.callbacks.onPermissionModeChange(mode.value);
          this.updateDisplay();
          this.renderOptions();
        }, 'Failed to change permission mode');
      });
    }
  }
}

const PERMISSION_MODE_OPTIONS: ReadonlyArray<{
  value: PermissionMode;
  label: string;
  description: string;
}> = [
  { value: 'default', label: 'Ask', description: 'Ask before sensitive operations' },
  { value: 'acceptEdits', label: 'Allow edits', description: 'Use the SDK accept-edits policy' },
  { value: 'auto', label: 'Auto', description: 'Let the SDK decide without prompting' },
  { value: 'plan', label: 'Plan', description: 'Explore and create a plan without implementing' },
  { value: 'yolo', label: 'YOLO', description: 'Bypass SDK permission checks' },
];
