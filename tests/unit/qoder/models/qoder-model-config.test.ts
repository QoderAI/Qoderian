import { qoderModelConfig } from '@/qoder/models/qoder-model-config';

describe('qoderModelConfig', () => {
  describe('getModelOptions', () => {
    it('uses only the SDK catalog when one is available', () => {
      const options = qoderModelConfig.getModelOptions({
        qoder: {
          discoveredModels: [
            { value: 'auto', displayName: 'Auto', description: '' },
            { value: 'gateway-large', displayName: 'Gateway Large', description: '', group: 'New models' },
          ],
        },
      });

      expect(options.map(option => option.value)).toEqual(['auto', 'gateway-large']);
    });

  });

  describe('getReasoningOptions', () => {
    it('hides xhigh on models that do not support it', () => {
      const options = qoderModelConfig.getReasoningOptions('qoder-sonnet-4-5');

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('includes xhigh for custom opus 4.7+ model ids', () => {
      const options = qoderModelConfig.getReasoningOptions('qoder-opus-4-7');

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('uses effort options for custom model ids', () => {
      const options = qoderModelConfig.getReasoningOptions('custom-model');

      expect(options.map(option => option.value)).toEqual(['low', 'medium', 'high', 'max']);
    });
  });

  describe('applyModelDefaults', () => {
    it('clamps stale effort and records a discovered SDK model as the last model', () => {
      const settings: Record<string, unknown> = {
        effortLevel: 'xhigh',
      };

      qoderModelConfig.applyModelDefaults('qoder-sonnet-4-5', settings);

      expect(settings.effortLevel).toBe('high');
      expect(settings.qoder).toEqual(expect.objectContaining({ lastModel: 'qoder-sonnet-4-5' }));
    });
  });

  describe('model editor metadata', () => {
    const settings: Record<string, unknown> = {
      qoder: {
        discoveredModels: [{
          value: 'qmodel_38max',
          displayName: 'Qwen 3.8 Max',
          description: '',
          contextTiers: [
            { label: '200K', tokenCount: 200000, isDefault: true },
            { label: '400K', tokenCount: 400000, isDefault: false },
            { label: '1M', tokenCount: 1000000, isDefault: false },
          ],
          thinkingDisableable: true,
        }],
      },
    };

    it('exposes context tiers for discovered models', () => {
      expect(qoderModelConfig.getModelContextTiers('qmodel_38max', settings)).toHaveLength(3);
      expect(qoderModelConfig.getModelContextTiers('unknown-model', settings)).toEqual([]);
    });

    it('sorts persisted tiers ascending so stale unsorted data renders in order', () => {
      const unsorted: Record<string, unknown> = {
        qoder: {
          discoveredModels: [{
            value: 'qmodel_38max',
            displayName: 'Qwen 3.8 Max',
            description: '',
            contextTiers: [
              { label: '1M', tokenCount: 1000000, isDefault: false },
              { label: '200K', tokenCount: 200000, isDefault: true },
              { label: '400K', tokenCount: 400000, isDefault: false },
            ],
          }],
        },
      };

      expect(qoderModelConfig.getModelContextTiers('qmodel_38max', unsorted)
        .map(tier => tier.label)).toEqual(['200K', '400K', '1M']);
    });

    it('sorts persisted efforts by intensity so stale unsorted data renders in order', () => {
      const unsorted: Record<string, unknown> = {
        qoder: {
          discoveredModels: [{
            value: 'cantus',
            displayName: 'Cantus',
            description: '',
            thinkingEfforts: [
              { value: 'xhigh', isDefault: false },
              { value: 'max', isDefault: false },
              { value: 'low', isDefault: false },
              { value: 'high', isDefault: true },
              { value: 'medium', isDefault: false },
            ],
          }],
        },
      };

      expect(qoderModelConfig.getModelThinkingEfforts('cantus', unsorted)
        .map(effort => effort.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('reports thinking disable support from the discovery metadata', () => {
      expect(qoderModelConfig.isThinkingDisableable('qmodel_38max', settings)).toBe(true);
      expect(qoderModelConfig.isThinkingDisableable('unknown-model', settings)).toBe(false);
    });

    it('uses the server default tier when no override exists', () => {
      expect(qoderModelConfig.getEffectiveContextWindowSize('qmodel_38max', settings)).toBe(200000);
    });

    it('honors a valid contextWindow override', () => {
      const overridden: Record<string, unknown> = {
        qoder: {
          ...settings.qoder as Record<string, unknown>,
          modelOverrides: { qmodel_38max: { contextWindow: 1000000 } },
        },
      };

      expect(qoderModelConfig.getEffectiveContextWindowSize('qmodel_38max', overridden))
        .toBe(1000000);
    });

    it('falls back to the default tier when the override matches no tier', () => {
      const stale: Record<string, unknown> = {
        qoder: {
          ...settings.qoder as Record<string, unknown>,
          modelOverrides: { qmodel_38max: { contextWindow: 123456 } },
        },
      };

      expect(qoderModelConfig.getEffectiveContextWindowSize('qmodel_38max', stale)).toBe(200000);
    });

    it('falls back to the static catalog window for models without tiers', () => {
      expect(qoderModelConfig.getEffectiveContextWindowSize('auto', settings))
        .toBe(qoderModelConfig.getContextWindowSize('auto'));
    });
  });
});
