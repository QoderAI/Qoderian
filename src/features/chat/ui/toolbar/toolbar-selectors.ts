import { Notice } from 'obsidian';

import type { QoderRuntimeStatus } from '../../../../core/types/services';
import type { PermissionMode, QoderModelOverride } from '../../../../core/types/settings';
import { t } from '../../../../i18n/i18n';
import type { TranslationKey } from '../../../../i18n/types';
import { getActiveQoderCliEdition, getQoderCliLoginCommand } from '../../../../qoder/config/cli-edition';
import { getQoderModelOverride } from '../../../../qoder/config/settings';
import type { QoderModelConfig } from '../../../../qoder/models/qoder-model-config';
import type {
  QoderLoginController,
  QoderLoginFailure,
} from '../../../../qoder/services/qoder-login-service';
import {
  CHECK_ICON,
  CHEVRON_LEFT_ICON,
  createIconSvg,
  PENCIL_ICON,
  QODER_ICON,
} from '../../../../shared/icons';
import { ClickPopover } from './click-popover';
import {
  modelDropdownMaxHeight,
  modelEditorPaneOffset,
  shouldFlipModelDropdown,
} from './model-dropdown-placement';

function runToolbarAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ToolbarSettings {
  model: string;
  permissionMode: PermissionMode;
  [key: string]: unknown;
}

export interface ToolbarCallbacks {
  onModelChange: (model: string) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  /** Per-model editor overrides (context window tier, thinking toggle). */
  onModelOverrideChange?: (model: string, override: Partial<QoderModelOverride>) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getModelConfig: () => QoderModelConfig;
  getRuntimeStatus?: () => QoderRuntimeStatus;
  retryRuntimeCatalog?: () => Promise<void>;
  subscribeRuntimeStatus?: (listener: (status: QoderRuntimeStatus) => void) => () => void;
  loginService?: QoderLoginController;
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

function getSignInFailureMessage(failure: QoderLoginFailure): string {
  switch (failure.kind) {
    case 'cliMissing': return t('chat.signIn.errorCliMissing');
    case 'nodeMissing': return t('chat.signIn.errorNodeMissing');
    case 'spawn': return t('chat.signIn.errorStartFailed');
    case 'process': return t('chat.signIn.errorProcessFailed');
  }
}

export class ModelSelector {
  private readonly container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private listPaneEl: HTMLElement | null = null;
  private editorPaneEl: HTMLElement | null = null;
  private popover: ClickPopover | null = null;
  private editingModel: string | null = null;
  private unsubscribeRuntimeStatus: (() => void) | null = null;
  private unsubscribeLoginState: (() => void) | null = null;

  constructor(parentEl: HTMLElement, private readonly callbacks: ToolbarCallbacks) {
    this.container = parentEl.createDiv({ cls: 'qoderian-model-selector' });
    this.render();
    this.unsubscribeRuntimeStatus = callbacks.subscribeRuntimeStatus?.(() => {
      this.updateDisplay();
      this.renderOptions();
    }) ?? null;
    this.unsubscribeLoginState = callbacks.loginService?.subscribe(() => {
      this.renderOptions();
    }) ?? null;
  }

  destroy(): void {
    this.popover?.destroy();
    this.popover = null;
    this.unsubscribeRuntimeStatus?.();
    this.unsubscribeRuntimeStatus = null;
    this.unsubscribeLoginState?.();
    this.unsubscribeLoginState = null;
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
    // IDE-style cascade: the model list stays visible in the left pane while
    // the per-model editor expands into the right pane.
    this.listPaneEl = this.dropdownEl.createDiv({ cls: 'qoderian-model-list-pane' });
    this.editorPaneEl = this.dropdownEl.createDiv({ cls: 'qoderian-model-editor-pane' });
    this.renderOptions();
    this.popover = new ClickPopover(
      this.container,
      this.buttonEl,
      this.dropdownEl,
      'qoderian-model-selector--open',
    );
    // Reopening the dropdown always returns to the model list view. The
    // popover toggles first, so the open class already reflects the new state.
    const resetEditingView = () => {
      if (this.editingModel !== null
        && this.container.hasClass('qoderian-model-selector--open')) {
        this.editingModel = null;
        this.renderOptions();
      }
      // Re-measure on every open/close so a resized window cannot leave a
      // stale placement behind.
      this.updateDropdownPlacement();
    };
    this.buttonEl.addEventListener('click', resetEditingView);
    this.buttonEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      resetEditingView();
    });
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
    const listPaneEl = this.listPaneEl;
    const editorPaneEl = this.editorPaneEl;
    if (!this.dropdownEl || !listPaneEl || !editorPaneEl) return;
    // Rebuilding the list must not yank the reader back to the top.
    const previousScrollTop = listPaneEl.scrollTop;
    listPaneEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const status = this.callbacks.getRuntimeStatus?.() ?? DEFAULT_RUNTIME_STATUS;
    let lastGroup: string | undefined;

    if (status.kind !== 'ready') {
      const statusEl = listPaneEl.createDiv({ cls: 'qoderian-model-runtime-status' });
      statusEl.createDiv({ cls: 'qoderian-model-runtime-title', text: getRuntimeStatusLabel(status) });
      statusEl.createDiv({ cls: 'qoderian-model-runtime-message', text: status.message });
      if (status.kind === 'authRequired') {
        this.renderSignInFlow(statusEl);
      }
      if (status.details) {
        statusEl.setAttribute('title', status.details);
      }
      const loginRunning = status.kind === 'authRequired'
        && (this.callbacks.loginService?.isRunning() ?? false);
      // When the in-app sign-in flow is available it owns authRequired
      // recovery (a successful sign-in refreshes the catalog), so the generic
      // Retry button would only add a redundant, misaligned second action.
      const signInOwnsAuth = status.kind === 'authRequired'
        && this.callbacks.loginService !== undefined;
      if (this.callbacks.retryRuntimeCatalog && !loginRunning && !signInOwnsAuth) {
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
    if (!shouldRenderModels) {
      // Degrading mid-edit must not strand the editor card behind the status view.
      this.editingModel = null;
      editorPaneEl.empty();
      this.dropdownEl.removeClass('qoderian-model-dropdown--editing');
      return;
    }

    for (const model of [...models].reverse()) {
      if (model.group && model.group !== lastGroup) {
        listPaneEl.createDiv({
          cls: 'qoderian-model-group',
          text: model.group,
        });
        lastGroup = model.group;
      }

      const option = listPaneEl.createDiv({ cls: 'qoderian-model-option' });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(model.value === currentModel));
      if (model.value === currentModel) option.addClass('selected');
      if (model.value === this.editingModel) option.addClass('editing');

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
      const editable = ((model.contextTiers?.length ?? 0) > 0
        || (model.thinkingEfforts?.length ?? 0) > 0
        || model.thinkingDisableable === true)
        && this.callbacks.onModelOverrideChange !== undefined;
      if (editable) {
        const editEl = option.createDiv({ cls: 'qoderian-model-edit' });
        editEl.setAttribute('role', 'button');
        editEl.setAttribute('tabindex', '0');
        editEl.setAttribute('aria-label', `${t('model.edit')} ${model.label}`);
        editEl.appendChild(createIconSvg(PENCIL_ICON, {
          className: 'qoderian-model-edit-icon',
          height: 11,
          ownerDocument: option.ownerDocument,
          width: 11,
        }));
        editEl.createSpan({ cls: 'qoderian-model-edit-label', text: t('model.edit') });
        const enterEditing = (event: Event) => {
          event.stopPropagation();
          this.editingModel = model.value;
          this.renderOptions();
        };
        editEl.addEventListener('click', enterEditing);
        editEl.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          enterEditing(event);
        });
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

    // The editor pane expands beside the list, mirroring the Qoder IDE.
    if (this.editingModel !== null) {
      this.renderEditor(this.editingModel);
      this.dropdownEl.addClass('qoderian-model-dropdown--editing');
    } else {
      editorPaneEl.empty();
      this.dropdownEl.removeClass('qoderian-model-dropdown--editing');
    }
    listPaneEl.scrollTop = previousScrollTop;
    this.updateDropdownPlacement();
  }

  private renderSignInFlow(statusEl: HTMLElement): void {
    const loginService = this.callbacks.loginService;
    if (!loginService) {
      statusEl.createEl('code', {
        cls: 'qoderian-model-runtime-command',
        text: getQoderCliLoginCommand(getActiveQoderCliEdition()),
      });
      return;
    }

    const state = loginService.getState();

    if (state.phase === 'waiting') {
      statusEl.createDiv({
        cls: 'qoderian-signin-waiting',
        text: t('chat.signIn.waiting'),
      });
    } else if (state.phase === 'succeeded') {
      statusEl.createDiv({
        cls: 'qoderian-signin-waiting',
        text: t('chat.signIn.verifying'),
      });
      return;
    } else if (state.phase === 'failed' && state.failure) {
      const errorEl = statusEl.createDiv({
        cls: 'qoderian-signin-error',
        text: getSignInFailureMessage(state.failure),
      });
      if (state.failure.details) {
        errorEl.setAttribute('title', state.failure.details);
      }
    }

    const actionsEl = statusEl.createDiv({ cls: 'qoderian-signin-actions' });

    if (state.phase === 'waiting') {
      if (state.authUrl) {
        const openButton = actionsEl.createEl('button', {
          cls: 'qoderian-signin-open mod-cta',
          text: t('chat.signIn.openLink'),
        });
        openButton.addEventListener('click', (event) => {
          event.stopPropagation();
          loginService.openAuthUrl();
        });
        const copyButton = actionsEl.createEl('button', {
          cls: 'qoderian-signin-copy',
          text: t('chat.signIn.copyLink'),
        });
        copyButton.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.copyAuthUrl(state.authUrl as string);
        });
      }
      const cancelButton = actionsEl.createEl('button', {
        cls: 'qoderian-signin-cancel',
        text: t('common.cancel'),
      });
      cancelButton.addEventListener('click', (event) => {
        event.stopPropagation();
        loginService.cancel();
      });
      return;
    }

    const signInButton = actionsEl.createEl('button', {
      cls: 'qoderian-signin-button mod-cta',
      text: state.phase === 'failed' ? t('chat.signIn.retry') : t('chat.signIn.button'),
    });
    if (state.phase === 'starting') {
      signInButton.setAttribute('disabled', 'true');
      signInButton.setText(t('chat.signIn.starting'));
    }
    signInButton.addEventListener('click', (event) => {
      event.stopPropagation();
      loginService.start();
    });
  }

  private async copyAuthUrl(authUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(authUrl);
      new Notice(t('chat.signIn.copied'));
    } catch {
      new Notice(t('chat.signIn.copyFailed'));
    }
  }

  /**
   * Places the dropdown against the real viewport: stay flush with the
   * trigger (inline-start) and flip only when the panel would overflow,
   * capping the height to the space above the toolbar. The decision rules
   * live in model-dropdown-placement.ts so they stay unit-testable.
   */
  private updateDropdownPlacement(): void {
    const dropdownEl = this.dropdownEl;
    if (!dropdownEl) return;
    const view = this.container.ownerDocument.defaultView;
    if (!view) return;
    const anchor = (dropdownEl.offsetParent ?? this.container).getBoundingClientRect();
    dropdownEl.toggleClass(
      'qoderian-model-dropdown--flip',
      shouldFlipModelDropdown(anchor, dropdownEl.offsetWidth, view.innerWidth),
    );
    dropdownEl.setCssProps({
      '--qoderian-model-dropdown-max-height': `${modelDropdownMaxHeight(anchor.top)}px`,
    });
    // Anchor the compact editor card to its edited row, IDE flyout style.
    if (this.editingModel !== null && this.listPaneEl && this.editorPaneEl) {
      const rowEl = this.listPaneEl.querySelector('.qoderian-model-option.editing');
      const rowVisibleTop = rowEl
        ? rowEl.getBoundingClientRect().top - this.listPaneEl.getBoundingClientRect().top
        : 0;
      this.editorPaneEl.setCssProps({
        '--qoderian-model-editor-offset': `${modelEditorPaneOffset(
          rowVisibleTop,
          this.editorPaneEl.offsetHeight,
          this.listPaneEl.clientHeight,
        )}px`,
      });
    }
  }

  /** IDE-style per-model editor: context window tiers + thinking toggle. */
  private renderEditor(modelValue: string): void {
    const editorPaneEl = this.editorPaneEl;
    if (!editorPaneEl) return;
    editorPaneEl.empty();

    const settings = this.callbacks.getSettings();
    const modelConfig = this.callbacks.getModelConfig();
    const model = this.getAvailableModels().find(candidate => candidate.value === modelValue);

    const head = editorPaneEl.createDiv({ cls: 'qoderian-model-editor-head' });
    const backEl = head.createDiv({ cls: 'qoderian-model-editor-back' });
    backEl.setAttribute('role', 'button');
    backEl.setAttribute('tabindex', '0');
    backEl.setAttribute('aria-label', t('model.backToList'));
    backEl.appendChild(createIconSvg(CHEVRON_LEFT_ICON, {
      className: 'qoderian-model-editor-back-icon',
      height: 12,
      ownerDocument: editorPaneEl.ownerDocument,
      width: 12,
    }));
    const exitEditing = (event: Event) => {
      event.stopPropagation();
      this.editingModel = null;
      this.renderOptions();
    };
    backEl.addEventListener('click', exitEditing);
    backEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      exitEditing(event);
    });
    head.createSpan({ cls: 'qoderian-model-editor-title', text: model?.label ?? modelValue });

    const tiers = modelConfig.getModelContextTiers(modelValue, settings);
    if (tiers.length > 0) {
      editorPaneEl.createDiv({
        cls: 'qoderian-model-editor-section',
        text: t('model.contextWindow'),
      });
      const effectiveWindow = modelConfig.getEffectiveContextWindowSize(modelValue, settings);
      for (const tier of tiers) {
        const selected = tier.tokenCount === effectiveWindow;
        const row = editorPaneEl.createDiv({ cls: 'qoderian-model-editor-tier' });
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(selected));
        if (selected) row.addClass('selected');
        row.createSpan({ cls: 'qoderian-model-editor-tier-label', text: tier.label });
        if (tier.isDefault) {
          row.createSpan({
            cls: 'qoderian-model-editor-tier-default',
            text: t('model.default'),
          });
        }
        if (selected) {
          row.appendChild(createIconSvg(CHECK_ICON, {
            className: 'qoderian-model-editor-check',
            height: 12,
            ownerDocument: editorPaneEl.ownerDocument,
            width: 12,
          }));
        }
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          if (selected) return;
          runToolbarAction(async () => {
            await this.callbacks.onModelOverrideChange?.(modelValue, {
              // Choosing the server default clears the override entirely.
              contextWindow: tier.isDefault ? undefined : tier.tokenCount,
            });
            this.renderOptions();
          }, 'Failed to update model settings');
        });
      }
    }

    if (modelConfig.isThinkingDisableable(modelValue, settings)) {
      const override = getQoderModelOverride(settings, modelValue);
      const enabled = override?.thinkingEnabled !== false;
      const row = editorPaneEl.createDiv({ cls: 'qoderian-model-editor-toggle-row' });
      row.createSpan({ cls: 'qoderian-model-editor-toggle-label', text: t('model.thinkingMode') });
      const toggleEl = row.createDiv({ cls: 'qoderian-model-editor-toggle' });
      toggleEl.setAttribute('role', 'switch');
      toggleEl.setAttribute('aria-checked', String(enabled));
      if (enabled) toggleEl.addClass('is-on');
      toggleEl.addEventListener('click', (event) => {
        event.stopPropagation();
        runToolbarAction(async () => {
          await this.callbacks.onModelOverrideChange?.(modelValue, {
            thinkingEnabled: !enabled,
          });
          this.renderOptions();
        }, 'Failed to update model settings');
      });
    }

    // Server-reported intensity levels render under the switch like the IDE:
    // models without efforts keep the bare on/off toggle.
    const efforts = modelConfig.getModelThinkingEfforts(modelValue, settings);
    const override = getQoderModelOverride(settings, modelValue);
    if (override?.thinkingEnabled !== false && efforts.length > 0) {
      editorPaneEl.createDiv({
        cls: 'qoderian-model-editor-section qoderian-model-editor-section--divided',
        text: t('model.thinkingEffort'),
      });
      const defaultEffort = efforts.find(effort => effort.isDefault)?.value
        ?? efforts[0]?.value;
      // Without an override the server default applies.
      const fallbackEffort = defaultEffort;
      const effectiveEffort = override?.thinkingEffort ?? fallbackEffort;
      for (const effort of efforts) {
        const selected = effort.value === effectiveEffort;
        const row = editorPaneEl.createDiv({ cls: 'qoderian-model-editor-tier' });
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(selected));
        if (selected) row.addClass('selected');
        row.createSpan({ cls: 'qoderian-model-editor-tier-label', text: effort.value });
        if (effort.isDefault) {
          row.createSpan({
            cls: 'qoderian-model-editor-tier-default',
            text: t('model.default'),
          });
        }
        if (selected) {
          row.appendChild(createIconSvg(CHECK_ICON, {
            className: 'qoderian-model-editor-check',
            height: 12,
            ownerDocument: editorPaneEl.ownerDocument,
            width: 12,
          }));
        }
        if (effort.description) row.setAttribute('title', effort.description);
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          if (selected) return;
          runToolbarAction(async () => {
            await this.callbacks.onModelOverrideChange?.(modelValue, {
              // Clearing only when the fallback already yields this value keeps
              // explicit choices (incl. the server default) effective.
              thinkingEffort: effort.value === fallbackEffort ? undefined : effort.value,
            });
            this.renderOptions();
          }, 'Failed to update model settings');
        });
      }
    }
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
    const descriptor = PERMISSION_MODE_DESCRIPTORS.find(candidate => candidate.value === mode)
      ?? PERMISSION_MODE_DESCRIPTORS[0];
    this.buttonEl.className = `qoderian-permission-button qoderian-permission-button--${descriptor.value}`;
    this.buttonEl.empty();
    this.buttonEl.createSpan({ cls: 'qoderian-permission-dot' });
    this.buttonEl.createSpan({ cls: 'qoderian-permission-label', text: t(descriptor.labelKey) });
    this.buttonEl.createSpan({ cls: 'qoderian-permission-chevron', text: '⌄' });
    this.buttonEl.setAttribute('title', t(descriptor.descriptionKey));
    // Tab switches and SDK-driven changes only reach updateDisplay, so the
    // option highlight has to follow the button or the two drift apart.
    this.renderOptions();
  }

  private renderOptions(): void {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();
    const current = this.callbacks.getSettings().permissionMode;

    for (const mode of PERMISSION_MODE_DESCRIPTORS) {
      if (!mode.selectable) continue;
      const option = this.dropdownEl.createDiv({
        cls: `qoderian-permission-option qoderian-permission-option--${mode.value}`,
      });
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(mode.value === current));
      if (mode.value === current) option.addClass('selected');
      option.createSpan({ cls: 'qoderian-permission-dot' });
      const copy = option.createDiv({ cls: 'qoderian-permission-option-copy' });
      copy.createDiv({ cls: 'qoderian-permission-option-label', text: t(mode.labelKey) });
      copy.createDiv({
        cls: 'qoderian-permission-option-description',
        text: t(mode.descriptionKey),
      });

      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this.popover?.close();
        if (mode.value === current) return;
        runToolbarAction(async () => {
          await this.callbacks.onPermissionModeChange(mode.value);
          this.updateDisplay();
        }, t('chat.permissionMode.changeFailed'));
      });
    }
  }
}

const PERMISSION_MODE_DESCRIPTORS: ReadonlyArray<{
  value: PermissionMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  selectable: boolean;
}> = [
  {
    value: 'default',
    labelKey: 'chat.permissionMode.default.label',
    descriptionKey: 'chat.permissionMode.default.desc',
    selectable: true,
  },
  {
    value: 'auto',
    labelKey: 'chat.permissionMode.auto.label',
    descriptionKey: 'chat.permissionMode.auto.desc',
    selectable: true,
  },
  {
    value: 'yolo',
    labelKey: 'chat.permissionMode.yolo.label',
    descriptionKey: 'chat.permissionMode.yolo.desc',
    selectable: true,
  },
  // Plan is entered through the CLI rather than this picker, but the SDK can
  // still push it back to us — keep it displayable so the button never lies.
  {
    value: 'plan',
    labelKey: 'chat.permissionMode.plan.label',
    descriptionKey: 'chat.permissionMode.plan.desc',
    selectable: false,
  },
];
