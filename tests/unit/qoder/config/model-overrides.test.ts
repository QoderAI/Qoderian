import { getQoderModelOverride, getQoderSettings } from '@/qoder/config/settings';

describe('qoder settings model editor fields', () => {
  describe('modelOverrides normalization', () => {
    it('defaults to an empty map', () => {
      expect(getQoderSettings({}).modelOverrides).toEqual({});
    });

    it('keeps valid contextWindow and thinkingEnabled entries', () => {
      const settings = {
        qoder: {
          modelOverrides: {
            qmodel_38max: { contextWindow: 400000, thinkingEnabled: false },
          },
        },
      };

      expect(getQoderSettings(settings).modelOverrides).toEqual({
        qmodel_38max: { contextWindow: 400000, thinkingEnabled: false },
      });
    });

    it('drops non-positive or non-numeric contextWindow values', () => {
      const settings = {
        qoder: {
          modelOverrides: {
            a: { contextWindow: 0 },
            b: { contextWindow: -5 },
            c: { contextWindow: 'wide' },
          },
        },
      };

      expect(getQoderSettings(settings).modelOverrides).toEqual({});
    });

    it('drops entries that normalize to nothing', () => {
      const settings = {
        qoder: {
          modelOverrides: {
            a: {},
            b: 'garbage',
            c: null,
            d: { contextWindow: 1000000 },
          },
        },
      };

      expect(getQoderSettings(settings).modelOverrides).toEqual({
        d: { contextWindow: 1000000 },
      });
    });

    it('ignores non-object modelOverrides roots', () => {
      expect(getQoderSettings({ qoder: { modelOverrides: ['x'] } }).modelOverrides).toEqual({});
      expect(getQoderSettings({ qoder: { modelOverrides: 'x' } }).modelOverrides).toEqual({});
    });
  });

  describe('discoveredModels context/thinking metadata', () => {
    it('normalizes contextTiers and thinkingDisableable', () => {
      const settings = {
        qoder: {
          discoveredModels: [{
            value: 'qmodel_38max',
            displayName: 'Qwen 3.8 Max',
            description: '',
            contextTiers: [
              { label: '200K', tokenCount: 200000, isDefault: true },
              { label: ' 1M ', tokenCount: 1000000 },
            ],
            thinkingDisableable: true,
          }],
        },
      };

      const model = getQoderSettings(settings).discoveredModels[0];
      expect(model.contextTiers).toEqual([
        { label: '200K', tokenCount: 200000, isDefault: true },
        { label: '1M', tokenCount: 1000000, isDefault: false },
      ]);
      expect(model.thinkingDisableable).toBe(true);
    });

    it('drops invalid tier entries instead of failing', () => {
      const settings = {
        qoder: {
          discoveredModels: [{
            value: 'm',
            displayName: 'M',
            description: '',
            contextTiers: [
              'garbage',
              { label: '   ', tokenCount: 100 },
              { label: 'Zero', tokenCount: 0 },
              { label: 'OK', tokenCount: 100 },
            ],
          }],
        },
      };

      const model = getQoderSettings(settings).discoveredModels[0];
      expect(model.contextTiers).toEqual([{ label: 'OK', tokenCount: 100, isDefault: false }]);
    });

    it('omits contextTiers and thinkingDisableable when absent', () => {
      const settings = {
        qoder: {
          discoveredModels: [{ value: 'm', displayName: 'M', description: '' }],
        },
      };

      const model = getQoderSettings(settings).discoveredModels[0];
      expect(model.contextTiers).toBeUndefined();
      expect(model.thinkingDisableable).toBeUndefined();
    });
  });

  describe('getQoderModelOverride', () => {
    it('returns the override for a customized model', () => {
      const settings = {
        qoder: { modelOverrides: { auto: { thinkingEnabled: false } } },
      };

      expect(getQoderModelOverride(settings, 'auto')).toEqual({ thinkingEnabled: false });
    });

    it('returns undefined for untouched models and malformed settings', () => {
      expect(getQoderModelOverride({}, 'auto')).toBeUndefined();
      expect(getQoderModelOverride({ qoder: 42 }, 'auto')).toBeUndefined();
    });
  });
});
