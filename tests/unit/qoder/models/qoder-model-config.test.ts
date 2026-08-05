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
});
