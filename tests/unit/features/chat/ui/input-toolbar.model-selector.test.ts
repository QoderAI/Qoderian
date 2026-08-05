import { createMockEl } from '@test/helpers/mock-element';

import { EffortSelector, ModelSelector, PermissionToggle } from '@/features/chat/ui/input-toolbar';

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
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        effortLevel: 'high',
        permissionMode: 'acceptEdits',
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
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'qmodel',
        effortLevel: 'high',
        permissionMode: 'acceptEdits',
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
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        effortLevel: 'high',
        permissionMode: 'acceptEdits',
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
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        effortLevel: 'high',
        permissionMode: 'acceptEdits',
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

  it('keeps a cached model visible while a background refresh is running', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'auto',
        effortLevel: 'high',
        permissionMode: 'acceptEdits',
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
});

describe('EffortSelector', () => {
  it('opens only when clicked and closes after choosing an effort', () => {
    const parentEl = createMockEl();
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockReturnValue({
        model: 'qmodel',
        effortLevel: 'medium',
        permissionMode: 'acceptEdits',
      }),
      getModelConfig: jest.fn().mockReturnValue({
        getReasoningOptions: jest.fn().mockReturnValue([
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Med' },
          { value: 'high', label: 'High' },
        ]),
        getDefaultReasoningValue: jest.fn().mockReturnValue('medium'),
      }),
    };

    new EffortSelector(parentEl, callbacks);

    const gears = parentEl.querySelector('.qoderian-thinking-gears');
    const current = parentEl.querySelector('.qoderian-thinking-current');
    const option = parentEl.querySelectorAll('.qoderian-thinking-gear')[0];

    gears?.dispatchEvent('mouseenter', { type: 'mouseenter' });
    expect(gears?.hasClass('qoderian-thinking-gears--open')).toBe(false);

    current?.click();
    expect(gears?.hasClass('qoderian-thinking-gears--open')).toBe(true);

    option?.click();
    expect(gears?.hasClass('qoderian-thinking-gears--open')).toBe(false);
  });
});

describe('PermissionToggle', () => {
  it('renders all SDK permission levels and applies the selected level', async () => {
    const parentEl = createMockEl();
    const settings = {
      model: 'auto',
      effortLevel: 'high',
      permissionMode: 'default' as const,
    };
    const onPermissionModeChange = jest.fn(async (mode) => {
      (settings as { permissionMode: string }).permissionMode = mode;
    });
    const callbacks = {
      onModelChange: jest.fn().mockResolvedValue(undefined),
      onEffortLevelChange: jest.fn().mockResolvedValue(undefined),
      onPermissionModeChange,
      getSettings: jest.fn(() => settings),
      getModelConfig: jest.fn(),
    };

    new PermissionToggle(parentEl, callbacks);

    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Ask');
    expect(parentEl.querySelectorAll('.qoderian-permission-option').map((option: ReturnType<typeof createMockEl>) =>
      option.querySelector('.qoderian-permission-option-label')?.textContent
    )).toEqual(['Ask', 'Allow edits', 'Auto', 'Plan', 'YOLO']);

    parentEl.querySelector('.qoderian-permission-button')?.click();
    expect(parentEl.querySelector('.qoderian-permission-toggle')
      ?.hasClass('qoderian-permission-toggle--open')).toBe(true);

    parentEl.querySelectorAll('.qoderian-permission-option')[1]?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onPermissionModeChange).toHaveBeenCalledWith('acceptEdits');
    expect(parentEl.querySelector('.qoderian-permission-label')?.textContent).toBe('Allow edits');
  });
});
