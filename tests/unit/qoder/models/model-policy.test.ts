import type { ModelPolicyContext } from '@qoder-ai/qoder-agent-sdk';

import { createQoderModelPolicyProvider } from '@/qoder/models/model-policy';

function createContext(overrides: Partial<ModelPolicyContext> = {}): ModelPolicyContext {
  return {
    purpose: 'main',
    sessionId: 'session-1',
    turnIndex: 0,
    availableModels: [],
    ...overrides,
  } as ModelPolicyContext;
}

function settingsWith(
  modelOverrides: Record<string, unknown>,
  discoveredModels: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    qoder: { modelOverrides, discoveredModels },
  };
}

describe('createQoderModelPolicyProvider', () => {
  it('returns the bare model when no override exists', () => {
    const provider = createQoderModelPolicyProvider(() => 'auto', settingsWith({}));

    expect(provider(createContext())).toEqual({ model: 'auto' });
  });

  it('normalizes the selected model id like the rest of the runtime', () => {
    const provider = createQoderModelPolicyProvider(() => '  Auto ', settingsWith({}));

    expect(provider(createContext()).model).toBe('auto');
  });

  it('keeps custom model ids verbatim', () => {
    const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settingsWith({}));

    expect(provider(createContext()).model).toBe('qmodel_38max');
  });

  describe('contextWindow override', () => {
    it('emits contextWindow when it matches a discovered tier', () => {
      const settings = settingsWith(
        { qmodel_38max: { contextWindow: 400000 } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          contextTiers: [
            { label: '200K', tokenCount: 200000, isDefault: true },
            { label: '400K', tokenCount: 400000, isDefault: false },
          ],
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({
        model: 'qmodel_38max',
        parameters: { contextWindow: 400000 },
      });
    });

    it('drops contextWindow when it matches no known tier', () => {
      const settings = settingsWith(
        { qmodel_38max: { contextWindow: 123456 } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          contextTiers: [{ label: '200K', tokenCount: 200000, isDefault: true }],
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({ model: 'qmodel_38max' });
    });

    it('passes contextWindow through when no catalog data is available', () => {
      const settings = settingsWith({ qmodel_38max: { contextWindow: 1000000 } });
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({
        model: 'qmodel_38max',
        parameters: { contextWindow: 1000000 },
      });
    });

    it('prefers the live catalog over persisted tiers', () => {
      const settings = settingsWith(
        { qmodel_38max: { contextWindow: 400000 } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          contextTiers: [{ label: '400K', tokenCount: 400000, isDefault: false }],
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);
      const liveOnly200K = createContext({
        availableModels: [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          context_config: {
            '200K': { token_count: 200000, is_default: true },
          },
        }] as ModelPolicyContext['availableModels'],
      });

      // The live catalog no longer offers 400K, so the override is withheld.
      expect(provider(liveOnly200K)).toEqual({ model: 'qmodel_38max' });
    });
  });

  describe('thinking override', () => {
    it('emits reasoningEffort none when the model supports disabling thinking', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEnabled: false } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          thinkingDisableable: true,
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({
        model: 'qmodel_38max',
        parameters: { reasoningEffort: 'none' },
      });
    });

    it('withholds reasoningEffort none when disabling is unsupported', () => {
      const settings = settingsWith(
        { 'custom-model': { thinkingEnabled: false } },
        [{ value: 'custom-model', displayName: 'Custom', description: '' }],
      );
      const provider = createQoderModelPolicyProvider(() => 'custom-model', settings);

      expect(provider(createContext())).toEqual({ model: 'custom-model' });
    });

    it('honors the live thinking_config over the persisted flag', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEnabled: false } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          thinkingDisableable: true,
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);
      const live = createContext({
        availableModels: [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          thinking_config: { enabled: { efforts: {}, is_default: true } },
        }] as ModelPolicyContext['availableModels'],
      });

      // Live catalog has no thinking_config.disabled → refusing is the safe path.
      expect(provider(live)).toEqual({ model: 'qmodel_38max' });
    });

    it('does not emit reasoningEffort when thinking stays enabled', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEnabled: true } },
        [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          thinkingDisableable: true,
        }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({ model: 'qmodel_38max' });
    });
  });

  describe('thinking effort override', () => {
    const discoveredWithEfforts = [{
      value: 'qmodel_38max',
      displayName: 'Qwen 3.8 Max',
      description: '',
      thinkingEfforts: [
        { value: 'low', isDefault: false },
        { value: 'medium', isDefault: true },
        { value: 'xhigh', isDefault: false },
      ],
    }];

    it('emits reasoningEffort when it matches a discovered effort', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEffort: 'xhigh' } },
        discoveredWithEfforts,
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({
        model: 'qmodel_38max',
        parameters: { reasoningEffort: 'xhigh' },
      });
    });

    it('drops reasoningEffort when it matches no known effort', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEffort: 'ultra' } },
        discoveredWithEfforts,
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({ model: 'qmodel_38max' });
    });

    it('passes reasoningEffort through when no catalog data is available', () => {
      const settings = settingsWith({ 'custom-model': { thinkingEffort: 'high' } });
      const provider = createQoderModelPolicyProvider(() => 'custom-model', settings);

      expect(provider(createContext())).toEqual({
        model: 'custom-model',
        parameters: { reasoningEffort: 'high' },
      });
    });

    it('prefers the live thinking_config efforts over the persisted ones', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEffort: 'xhigh' } },
        discoveredWithEfforts,
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);
      const live = createContext({
        availableModels: [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          thinking_config: {
            enabled: { efforts: { low: {}, medium: { is_default: true } } },
          },
        }] as ModelPolicyContext['availableModels'],
      });

      // The live catalog no longer offers xhigh, so the override is withheld.
      expect(provider(live)).toEqual({ model: 'qmodel_38max' });
    });

    it('prefers disabling thinking over a stored effort', () => {
      const settings = settingsWith(
        { qmodel_38max: { thinkingEnabled: false, thinkingEffort: 'low' } },
        [{ ...discoveredWithEfforts[0], thinkingDisableable: true }],
      );
      const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

      expect(provider(createContext())).toEqual({
        model: 'qmodel_38max',
        parameters: { reasoningEffort: 'none' },
      });
    });
  });

  it('combines both parameters when both overrides apply', () => {
    const settings = settingsWith(
      { qmodel_38max: { contextWindow: 1000000, thinkingEnabled: false } },
      [{
        value: 'qmodel_38max',
        displayName: 'Qwen 3.8 Max',
        description: '',
        contextTiers: [{ label: '1M', tokenCount: 1000000, isDefault: false }],
        thinkingDisableable: true,
      }],
    );
    const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

    expect(provider(createContext())).toEqual({
      model: 'qmodel_38max',
      parameters: { contextWindow: 1000000, reasoningEffort: 'none' },
    });
  });

  it('reads overrides live so settings edits apply to the next call', () => {
    const settings = settingsWith({}, [{
      value: 'qmodel_38max',
      displayName: 'Qwen 3.8 Max',
      description: '',
      thinkingDisableable: true,
    }]);
    const provider = createQoderModelPolicyProvider(() => 'qmodel_38max', settings);

    expect(provider(createContext())).toEqual({ model: 'qmodel_38max' });

    (settings.qoder as Record<string, unknown>).modelOverrides = {
      qmodel_38max: { thinkingEnabled: false },
    };
    expect(provider(createContext())).toEqual({
      model: 'qmodel_38max',
      parameters: { reasoningEffort: 'none' },
    });
  });

  it('never throws on malformed settings', () => {
    const provider = createQoderModelPolicyProvider(() => 'auto', {
      qoder: { modelOverrides: 'garbage', discoveredModels: { not: 'an array' } },
    });

    expect(() => provider(createContext())).not.toThrow();
    expect(provider(createContext())).toEqual({ model: 'auto' });
  });
});
