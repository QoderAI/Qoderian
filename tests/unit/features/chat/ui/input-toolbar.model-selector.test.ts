import { createMockEl } from '@test/helpers/mock-element';

import type { PermissionMode } from '@/core/types/settings';
import { ModelSelector, PermissionToggle } from '@/features/chat/ui/input-toolbar';
import { getLocale, setLocale } from '@/i18n/i18n';

jest.mock('@/shared/icons', () => ({
  QODER_ICON: {},
  appendCheckIcon: jest.fn(),
  appendMcpIcon: jest.fn(),
  createIconSvg: jest.fn(() => ({ children: [] })),
}));

describe('ModelSelector', () => {
  it('renders the Qoder catalog group alongside new and enterprise models', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        permissionMode: 'auto',
      }),
      getEnvironmentVariables: jest.fn().mockReturnValue(''),
      getModelConfig: jest.fn().mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([
          { value: 'auto', label: 'Auto', group: 'Qoder' },
          { value: 'qmodel', label: 'Qwen3.7-Plus', group: 'New models' },
          { value: 'enterprise', label: 'Enterprise model', group: 'Enterprise' },
        ]),
      }),
    };

    new ModelSelector(parentEl, callbacks);

    const groupLabels = parentEl
      .querySelectorAll('.qoderian-model-group')
      .map((element: { textContent: string }) => element.textContent);

    expect(groupLabels).toEqual(['Enterprise', 'New models', 'Qoder']);
  });

  it('renders credit multipliers and promotion badges from model metadata', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'qmodel',
        permissionMode: 'auto',
      }),
      getEnvironmentVariables: jest.fn().mockReturnValue(''),
      getModelConfig: jest.fn().mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([
          {
            value: 'qmodel',
            label: 'Qwen3.7-Plus',
            group: 'New models',
            priceLabel: '0.1x',
            promotionLabel: 'Off-Peak 60% off',
          },
        ]),
      }),
    };

    new ModelSelector(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-model-price')?.textContent).toBe('0.1x');
    expect(parentEl.querySelector('.qoderian-model-promo')?.textContent).toBe('Off-Peak 60% off');
  });

  it('opens only when clicked and closes after choosing a model', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        permissionMode: 'auto',
      }),
      getEnvironmentVariables: jest.fn().mockReturnValue(''),
      getModelConfig: jest.fn().mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([
          { value: 'auto', label: 'Auto', group: 'Qoder' },
          { value: 'qmodel', label: 'Qwen3.7-Plus', group: 'New models' },
        ]),
      }),
    };

    new ModelSelector(parentEl, callbacks);

    const selector = parentEl.querySelector('.qoderian-model-selector');
    const button = parentEl.querySelector('.qoderian-model-btn');
    const option = parentEl.querySelectorAll('.qoderian-model-option')[0];

    selector?.dispatchEvent('mouseenter', { type: 'mouseenter' });
    expect(selector?.hasClass('qoderian-model-selector--open')).toBe(false);

    button?.click();
    expect(selector?.hasClass('qoderian-model-selector--open')).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('true');

    option?.click();
    expect(selector?.hasClass('qoderian-model-selector--open')).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows sign-in guidance and retries instead of displaying Unknown', async () => {
    const parentEl = createMockEl();
    const retryRuntimeCatalog = jest.fn().mockResolvedValue(undefined);
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        permissionMode: 'auto',
      }),
      getModelConfig: jest.fn().mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([]),
      }),
      getRuntimeStatus: jest.fn().mockReturnValue({
        kind: 'authRequired',
        message: 'Qoder CLI is not signed in. Run `qodercli login` in a terminal, then retry.',
      }),
      retryRuntimeCatalog,
    };

    new ModelSelector(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-model-label')?.textContent).toBe('Sign in required');
    expect(parentEl.querySelector('.qoderian-model-runtime-command')?.textContent).toBe('qodercli login');
    expect(parentEl.querySelector('.qoderian-model-label')?.textContent).not.toBe('Unknown');

    parentEl.querySelector('.qoderian-model-runtime-retry')?.click();
    await Promise.resolve();

    expect(retryRuntimeCatalog).toHaveBeenCalledTimes(1);
  });

  describe('in-app sign-in flow', () => {
    function buildAuthCallbacks(loginState: {
      phase: string;
      authUrl: string | null;
      failure: { kind: string; details?: string } | null;
    }) {
      const loginService = {
        getState: jest.fn().mockReturnValue(loginState),
        subscribe: jest.fn(() => () => {}),
        isRunning: jest.fn().mockReturnValue(loginState.phase === 'starting' || loginState.phase === 'waiting'),
        start: jest.fn(),
        cancel: jest.fn(),
        openAuthUrl: jest.fn(),
        reset: jest.fn(),
      };
      const callbacks = {
        onModelChange: jest.fn().mockResolvedValue(undefined),
        onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
        getSettings: jest.fn().mockReturnValue({ model: 'auto', permissionMode: 'auto' }),
        getModelConfig: jest.fn().mockReturnValue({
          getModelOptions: jest.fn().mockReturnValue([]),
        }),
        getRuntimeStatus: jest.fn().mockReturnValue({
          kind: 'authRequired',
          message: 'Qoder CLI is not signed in. Sign in to your Qoder account, then retry.',
        }),
        retryRuntimeCatalog: jest.fn().mockResolvedValue(undefined),
        loginService,
      };
      return { callbacks, loginService };
    }

    it('renders a Sign in button that starts the login service', () => {
      const parentEl = createMockEl();
      const { callbacks, loginService } = buildAuthCallbacks({
        phase: 'idle', authUrl: null, failure: null,
      });

      new ModelSelector(parentEl, callbacks);

      expect(parentEl.querySelector('.qoderian-model-runtime-command')).toBeNull();
      const signInButton = parentEl.querySelector('.qoderian-signin-button');
      expect(signInButton?.textContent).toBe('Sign in');

      signInButton?.click();
      expect(loginService.start).toHaveBeenCalledTimes(1);
      // The sign-in flow owns auth recovery; no redundant Retry button.
      expect(parentEl.querySelector('.qoderian-model-runtime-retry')).toBeNull();
    });

    it('shows the auth link with copy and cancel actions while waiting', () => {
      const parentEl = createMockEl();
      const { callbacks, loginService } = buildAuthCallbacks({
        phase: 'waiting',
        authUrl: 'https://qoder.com/device/selectAccounts?challenge=abc',
        failure: null,
      });

      new ModelSelector(parentEl, callbacks);

      const openButton = parentEl.querySelector('.qoderian-signin-open');
      expect(openButton).toBeTruthy();
      expect(parentEl.querySelector('.qoderian-signin-waiting')?.textContent)
        .toBe('Waiting for browser authorization…');
      // Descriptive text renders above the action row.
      const statusKids = (parentEl.querySelector('.qoderian-model-runtime-status') as any)
        ._children as Array<{ hasClass: (cls: string) => boolean }>;
      const waitingIdx = statusKids.findIndex(kid => kid.hasClass('qoderian-signin-waiting'));
      const actionsIdx = statusKids.findIndex(kid => kid.hasClass('qoderian-signin-actions'));
      expect(waitingIdx).toBeGreaterThanOrEqual(0);
      expect(actionsIdx).toBeGreaterThan(waitingIdx);
      expect(parentEl.querySelector('.qoderian-signin-copy')).toBeTruthy();

      // Retry is hidden while the sign-in flow owns the panel.
      expect(parentEl.querySelector('.qoderian-model-runtime-retry')).toBeNull();

      openButton?.click();
      expect(loginService.openAuthUrl).toHaveBeenCalledTimes(1);

      parentEl.querySelector('.qoderian-signin-cancel')?.click();
      expect(loginService.cancel).toHaveBeenCalledTimes(1);
    });

    it('renders the failure reason and offers signing in again', () => {
      const parentEl = createMockEl();
      const { callbacks, loginService } = buildAuthCallbacks({
        phase: 'failed',
        authUrl: null,
        failure: { kind: 'process', details: 'Device flow poll failed' },
      });

      new ModelSelector(parentEl, callbacks);

      expect(parentEl.querySelector('.qoderian-signin-error')?.textContent)
        .toBe('Sign-in failed. Check the details and try again.');
      expect(parentEl.querySelector('.qoderian-signin-error')?.getAttribute('title'))
        .toBe('Device flow poll failed');

      const retryButton = parentEl.querySelector('.qoderian-signin-button');
      expect(retryButton?.textContent).toBe('Sign in again');
      retryButton?.click();
      expect(loginService.start).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps a cached model visible while a background refresh is running', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        permissionMode: 'auto',
      }),
      getModelConfig: jest.fn().mockReturnValue({
        getModelOptions: jest.fn().mockReturnValue([
          { value: 'auto', label: 'Auto', group: 'Qoder' },
        ]),
      }),
      getRuntimeStatus: jest.fn().mockReturnValue({
        kind: 'checking',
        message: 'Checking Qoder CLI and loading models…',
      }),
    };

    new ModelSelector(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-model-label')?.textContent).toBe('Auto');
    expect(parentEl.querySelector('.qoderian-model-runtime-title')?.textContent).toBe('Loading models…');
  });

  describe('per-model editor', () => {
    const editableModel = {
      value: 'qmodel',
      label: 'Qwen 3.8 Max',
      group: 'New models',
      contextTiers: [
        { label: '200K', tokenCount: 200000, isDefault: true },
        { label: '400K', tokenCount: 400000, isDefault: false },
        { label: '1M', tokenCount: 1000000, isDefault: false },
      ],
      thinkingDisableable: true,
    };

    function buildCallbacks(
      extra: Record<string, unknown> = {},
      overrides: Record<string, Record<string, unknown>> = {},
      efforts: Array<Record<string, unknown>> = [],
    ) {
      const settings = {
        model: 'qmodel',
        permissionMode: 'auto',
        qoder: { modelOverrides: overrides },
      };
      return {
        onModelChange: jest.fn().mockResolvedValue(undefined),
        onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
        getSettings: jest.fn().mockReturnValue(settings),
        getEnvironmentVariables: jest.fn().mockReturnValue(''),
        getModelConfig: jest.fn().mockReturnValue({
          getModelOptions: jest.fn().mockReturnValue([
            { value: 'auto', label: 'Auto', group: 'Qoder' },
            editableModel,
          ]),
          getModelContextTiers: jest.fn().mockReturnValue(editableModel.contextTiers),
          isThinkingDisableable: jest.fn().mockReturnValue(true),
          getModelThinkingEfforts: jest.fn().mockReturnValue(efforts),
          // Stateful: reflects whatever override the editor just persisted.
          getEffectiveContextWindowSize: jest.fn(() =>
            overrides.qmodel?.contextWindow ?? 200000),
        }),
        ...extra,
      };
    }

    it('offers editing only for models with editable metadata', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      const edits = parentEl.querySelectorAll('.qoderian-model-edit');
      expect(edits).toHaveLength(1);
    });

    it('hides the edit affordance when the callback is missing', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks());

      expect(parentEl.querySelectorAll('.qoderian-model-edit')).toHaveLength(0);
    });

    it('opens the editor view with tiers, default tag, and thinking toggle', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      parentEl.querySelector('.qoderian-model-edit')?.click();

      expect(parentEl.querySelector('.qoderian-model-editor-title')?.textContent)
        .toBe('Qwen 3.8 Max');
      const tiers = parentEl.querySelectorAll('.qoderian-model-editor-tier');
      expect(tiers).toHaveLength(3);
      expect(tiers[0].hasClass('selected')).toBe(true);
      expect(tiers[0].getAttribute('aria-selected')).toBe('true');
      expect(tiers[1].hasClass('selected')).toBe(false);
      expect(parentEl.querySelector('.qoderian-model-editor-tier-default')?.textContent)
        .toBe('Default');
      const toggle = parentEl.querySelector('.qoderian-model-editor-toggle');
      expect(toggle?.hasClass('is-on')).toBe(true);
      expect(toggle?.getAttribute('aria-checked')).toBe('true');
    });

    it('persists a tier choice and clears the override for the default tier', async () => {
      const parentEl = createMockEl();
      const overrides: Record<string, Record<string, unknown>> = {
        qmodel: { contextWindow: 400000 },
      };
      const onModelOverrideChange = jest.fn(async (_model: string, patch: Record<string, unknown>) => {
        // Mirror tab.ts: undefined values delete the key, empty overrides vanish.
        const current = overrides.qmodel ?? {};
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete current[key];
          else current[key] = value;
        }
        if (Object.keys(current).length > 0) overrides.qmodel = current;
        else delete overrides.qmodel;
      });
      new ModelSelector(parentEl, buildCallbacks({ onModelOverrideChange }, overrides));

      parentEl.querySelector('.qoderian-model-edit')?.click();
      // Start from a 400K override: choose 1M, then back to the default tier.
      parentEl.querySelectorAll('.qoderian-model-editor-tier')[2]?.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { contextWindow: 1000000 });

      parentEl.querySelectorAll('.qoderian-model-editor-tier')[0]?.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { contextWindow: undefined });
    });

    it('toggles thinking mode off and back on', async () => {
      const parentEl = createMockEl();
      const overrides: Record<string, Record<string, unknown>> = {};
      const onModelOverrideChange = jest.fn(async (_model: string, patch: Record<string, unknown>) => {
        overrides.qmodel = { ...overrides.qmodel, ...patch };
      });
      new ModelSelector(parentEl, buildCallbacks({ onModelOverrideChange }, overrides));

      parentEl.querySelector('.qoderian-model-edit')?.click();
      parentEl.querySelector('.qoderian-model-editor-toggle')?.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { thinkingEnabled: false });

      const toggle = parentEl.querySelector('.qoderian-model-editor-toggle');
      expect(toggle?.hasClass('is-on')).toBe(false);
      toggle?.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { thinkingEnabled: true });
    });

    it('shows thinking as disabled when the override turns it off', () => {
      const parentEl = createMockEl();
      const callbacks = buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
        getSettings: jest.fn().mockReturnValue({
          model: 'qmodel',
          permissionMode: 'auto',
          qoder: { modelOverrides: { qmodel: { thinkingEnabled: false } } },
        }),
      });
      new ModelSelector(parentEl, callbacks);

      parentEl.querySelector('.qoderian-model-edit')?.click();

      const toggle = parentEl.querySelector('.qoderian-model-editor-toggle');
      expect(toggle?.hasClass('is-on')).toBe(false);
      expect(toggle?.getAttribute('aria-checked')).toBe('false');
    });

    it('returns to the model list via the back button', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      parentEl.querySelector('.qoderian-model-edit')?.click();
      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeTruthy();

      parentEl.querySelector('.qoderian-model-editor-back')?.click();
      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeNull();
      expect(parentEl.querySelectorAll('.qoderian-model-option').length).toBeGreaterThan(0);
    });

    it('keeps the model list scroll position across editor open and close', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      const listPane = parentEl.querySelector('.qoderian-model-list-pane');
      if (listPane) listPane.scrollTop = 42;

      parentEl.querySelector('.qoderian-model-edit')?.click();
      expect(parentEl.querySelector('.qoderian-model-list-pane')?.scrollTop).toBe(42);

      parentEl.querySelector('.qoderian-model-editor-back')?.click();
      expect(parentEl.querySelector('.qoderian-model-list-pane')?.scrollTop).toBe(42);
    });

    it('returns to the model list when the dropdown reopens after editing', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      const trigger = parentEl.querySelector('.qoderian-model-btn');
      trigger?.click();
      parentEl.querySelector('.qoderian-model-edit')?.click();
      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeTruthy();

      // Close, then reopen: the editor view must reset to the model list.
      trigger?.click();
      trigger?.click();

      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeNull();
      expect(parentEl.querySelector('.qoderian-model-dropdown')
        ?.hasClass('qoderian-model-dropdown--editing')).toBe(false);
    });

    it('also resets the editor view when reopened via keyboard', () => {
      const parentEl = createMockEl();
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
      }));

      const trigger = parentEl.querySelector('.qoderian-model-btn');
      const pressEnter = () => trigger?.dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      pressEnter();
      parentEl.querySelector('.qoderian-model-edit')?.click();
      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeTruthy();

      pressEnter(); // close
      pressEnter(); // reopen -> back to the model list

      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeNull();
    });

    it('drops a stale editor card when the runtime degrades mid-edit', () => {
      const parentEl = createMockEl();
      const notify: { current: (() => void) | null } = { current: null };
      const getRuntimeStatus = jest.fn().mockReturnValue({ kind: 'ready', message: '' });
      new ModelSelector(parentEl, buildCallbacks({
        onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
        getRuntimeStatus,
        subscribeRuntimeStatus: jest.fn((listener: () => void) => {
          notify.current = listener;
          return () => {};
        }),
      }));

      parentEl.querySelector('.qoderian-model-edit')?.click();
      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeTruthy();

      // Runtime drops while the editor is open: the card must not linger.
      getRuntimeStatus.mockReturnValue({ kind: 'authRequired', message: 'Sign in required' });
      notify.current?.();

      expect(parentEl.querySelector('.qoderian-model-editor-head')).toBeNull();
      expect(parentEl.querySelector('.qoderian-model-dropdown')
        ?.hasClass('qoderian-model-dropdown--editing')).toBe(false);
    });

    describe('thinking effort levels', () => {
      const thinkingEfforts = [
        { value: 'low', isDefault: false, description: 'Minimal reasoning' },
        { value: 'medium', isDefault: true },
        { value: 'xhigh', isDefault: false },
      ];

      it('renders server effort rows under the thinking toggle', () => {
        const parentEl = createMockEl();
        new ModelSelector(parentEl, buildCallbacks({
          onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
        }, {}, thinkingEfforts));

        parentEl.querySelector('.qoderian-model-edit')?.click();

        // The intensity list gets its own labeled section like the IDE.
        expect(parentEl.querySelector('.qoderian-model-editor-section--divided')?.textContent)
          .toBe('Thinking Effort');
        // 3 context tiers + 3 effort rows share the tier row style.
        const rows = parentEl.querySelectorAll('.qoderian-model-editor-tier');
        expect(rows).toHaveLength(6);
        expect(rows.slice(3).map((row: ReturnType<typeof createMockEl>) =>
          row.querySelector('.qoderian-model-editor-tier-label')?.textContent
        )).toEqual(['low', 'medium', 'xhigh']);
        expect(rows[3].getAttribute('title')).toBe('Minimal reasoning');
        // No override set → the server default is checked.
        expect(rows[4].hasClass('selected')).toBe(true);
        expect(rows[4].getAttribute('aria-selected')).toBe('true');
        expect(rows[3].hasClass('selected')).toBe(false);
        expect(rows[4].querySelector('.qoderian-model-editor-tier-default')?.textContent)
          .toBe('Default');
      });

      it('hides effort rows when thinking is turned off', () => {
        const parentEl = createMockEl();
        new ModelSelector(parentEl, buildCallbacks({
          onModelOverrideChange: jest.fn().mockResolvedValue(undefined),
        }, { qmodel: { thinkingEnabled: false } }, thinkingEfforts));

        parentEl.querySelector('.qoderian-model-edit')?.click();

        // Only the 3 context tiers remain.
        expect(parentEl.querySelectorAll('.qoderian-model-editor-tier')).toHaveLength(3);
      });

      it('persists an effort choice and clears the override for the default', async () => {
        const parentEl = createMockEl();
        const overrides: Record<string, Record<string, unknown>> = {};
        const onModelOverrideChange = jest.fn(async (_model: string, patch: Record<string, unknown>) => {
          const current = overrides.qmodel ?? {};
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete current[key];
            else current[key] = value;
          }
          if (Object.keys(current).length > 0) overrides.qmodel = current;
          else delete overrides.qmodel;
        });
        new ModelSelector(parentEl, buildCallbacks({ onModelOverrideChange }, overrides, thinkingEfforts));

        parentEl.querySelector('.qoderian-model-edit')?.click();
        // Choose xhigh (tier index 3 + effort index 2).
        parentEl.querySelectorAll('.qoderian-model-editor-tier')[5]?.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { thinkingEffort: 'xhigh' });
        expect(parentEl.querySelectorAll('.qoderian-model-editor-tier')[5]?.hasClass('selected'))
          .toBe(true);

        // Choosing the server default clears the override entirely.
        parentEl.querySelectorAll('.qoderian-model-editor-tier')[4]?.click();
        await Promise.resolve();
        await Promise.resolve();
        expect(onModelOverrideChange).toHaveBeenCalledWith('qmodel', { thinkingEffort: undefined });
        expect(overrides.qmodel?.thinkingEffort).toBeUndefined();
      });
    });
  });
});

describe('PermissionToggle', () => {
  it('renders the three selectable tiers and applies the chosen tier', async () => {
    const parentEl = createMockEl();
    const settings = {
      model: 'auto',
      permissionMode: 'default' as const,
    };
    const onPermissionModeChange = jest.fn(async (mode) => {
      (settings as { permissionMode: string }).permissionMode = mode;
    });
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange,
      getSettings: jest.fn(() => settings),
      getModelConfig: jest.fn(),
    };

    new PermissionToggle(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Ask approval');
    expect(parentEl.querySelectorAll('.qoderian-permission-option').map((option: ReturnType<typeof createMockEl>) =>
      option.querySelector('.qoderian-permission-option-label')?.textContent
    )).toEqual(['Ask approval', 'Auto approval', 'Full access']);

    parentEl.querySelector('.qoderian-permission-button')?.click();
    expect(parentEl.querySelector('.qoderian-permission-toggle')
      ?.hasClass('qoderian-permission-toggle--open')).toBe(true);

    parentEl.querySelectorAll('.qoderian-permission-option')[1]?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onPermissionModeChange).toHaveBeenCalledWith('auto');
    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Auto approval');
  });

  it('still labels plan mode when the SDK switches into it', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn(() => ({ model: 'auto', permissionMode: 'plan' as const })),
      getModelConfig: jest.fn(),
    };

    new PermissionToggle(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Plan');
    expect(parentEl.querySelectorAll('.qoderian-permission-option').length).toBe(3);
  });

  it('moves the option highlight when the mode changes outside the dropdown', () => {
    const parentEl = createMockEl();
    const settings = { model: 'auto', permissionMode: 'default' as PermissionMode };
    const toggle = new PermissionToggle(parentEl, {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn(() => settings),
      getModelConfig: jest.fn(),
    });

    const selectedLabels = () => parentEl.querySelectorAll('.qoderian-permission-option')
      .filter((option: ReturnType<typeof createMockEl>) => option.hasClass('selected'))
      .map((option: ReturnType<typeof createMockEl>) =>
        option.querySelector('.qoderian-permission-option-label')?.textContent);

    expect(selectedLabels()).toEqual(['Ask approval']);

    settings.permissionMode = 'yolo';
    toggle.updateDisplay();

    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Full access');
    expect(selectedLabels()).toEqual(['Full access']);
  });

  it('resolves the tier copy from the active locale', () => {
    const previousLocale = getLocale();
    setLocale('zh-CN');

    try {
      const parentEl = createMockEl();
      const callbacks = {
        onModelChange: jest.fn().mockResolvedValue(undefined),
        onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
        getSettings: jest.fn(() => ({ model: 'auto', permissionMode: 'auto' as const })),
        getModelConfig: jest.fn(),
      };

      new PermissionToggle(parentEl, callbacks);

      expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('自动审批');
      expect(parentEl.querySelectorAll('.qoderian-permission-option').map(
        (option: ReturnType<typeof createMockEl>) =>
          option.querySelector('.qoderian-permission-option-label')?.textContent,
      )).toEqual(['询问审批', '自动审批', '完全访问']);
      expect(parentEl.querySelectorAll('.qoderian-permission-option-description').map(
        (description: ReturnType<typeof createMockEl>) => description.textContent,
      )).toEqual([
        '执行命令、修改库外文件或访问网络前，始终询问',
        '仅在检测到潜在风险时询问',
        '不再询问，可自由访问你的文件、终端和网络',
      ]);
    } finally {
      setLocale(previousLocale);
    }
  });
});
