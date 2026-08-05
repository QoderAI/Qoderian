import type { QoderDiscoveredModel } from '@/qoder/config/settings';
import { getQoderModelOptions } from '@/qoder/models/model-options';

function settingsWithDiscovered(
  discoveredModels: QoderDiscoveredModel[],
): Record<string, unknown> {
  return { qoder: { discoveredModels } };
}

describe('getQoderModelOptions', () => {
  it('does not fabricate a fallback catalog when SDK discovery is empty', () => {
    const options = getQoderModelOptions({});

    expect(options).toEqual([]);
  });

  it('surfaces the whole discovered catalog and keeps selector groups', () => {
    const options = getQoderModelOptions(settingsWithDiscovered([
      { value: 'auto', displayName: 'Auto', description: 'Vision · 1.00x Credit' },
      { value: 'lite', displayName: 'Lite', description: '0.00x Credit' },
      { value: 'cmodel', displayName: 'Cantus', description: '3.20x Credit', group: 'New models' },
      { value: 'gm51model', displayName: 'GLM-5.2', description: '0.60x Credit', group: 'New models' },
      {
        value: 'qwen3.8-max-preview',
        displayName: 'Peach-07-17-DogFooding',
        description: '0.00x Credit',
        group: 'Enterprise',
      },
    ]));

    expect(options).toEqual([
      { value: 'auto', label: 'Auto', description: 'Vision · 1.00x Credit', group: 'Qoder', priceLabel: '1.0x' },
      { value: 'lite', label: 'Lite', description: '0.00x Credit', group: 'Qoder', priceLabel: '0.0x' },
      { value: 'cmodel', label: 'Cantus', description: '3.20x Credit', group: 'New models', priceLabel: '3.2x' },
      { value: 'gm51model', label: 'GLM-5.2', description: '0.60x Credit', group: 'New models', priceLabel: '0.6x' },
      {
        value: 'qwen3.8-max-preview',
        label: 'Peach-07-17-DogFooding',
        description: '0.00x Credit',
        group: 'Enterprise',
        priceLabel: '0.0x',
      },
    ]);
  });

  it('keeps discovered models available for selection reconciliation', () => {
    const settings = settingsWithDiscovered([
      { value: 'auto', displayName: 'Auto', description: '' },
      { value: 'kmodel_latest', displayName: 'Kimi-K3', description: '', group: 'New models' },
    ]);

    const options = getQoderModelOptions(settings);

    expect(options.map((option) => option.value)).toContain('kmodel_latest');
  });

  it('exposes credit multipliers and promotion badges to the selector', () => {
    const options = getQoderModelOptions(settingsWithDiscovered([
      {
        value: 'ultimate',
        displayName: 'Ultimate',
        description: 'Reasoning · 1.60x Credit',
        priceFactor: 1.6,
      },
      {
        value: 'qmodel_latest',
        displayName: 'Qwen3.7-Max',
        description: '0.50x Credit',
        group: 'New models',
        priceFactor: 0.5,
        originalPriceFactor: 0.5,
        promotion: {
          active: false,
          badge: { en: 'Off-Peak 80% off', zh: '错峰2折' },
          discountFactor: 0.2,
          window: '22:00-08:00 Asia/Singapore',
        },
      },
    ]));

    expect(options[0].priceLabel).toBe('1.6x');
    expect(options[0].promotionLabel).toBeUndefined();
    expect(options[1].priceLabel).toBe('0.5x');
    expect(options[1].promotionLabel).toBe('Off-Peak 80% off');
    expect(options[1].description).toContain('Off-Peak 80% off');
    expect(options[1].description).toContain('22:00-08:00 Asia/Singapore');
  });
});
