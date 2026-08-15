import type { UIOption } from '../../core/types/services';
import { getQoderSettings } from '../config/settings';
import { buildPricingDescription, resolvePriceLabel, resolvePromotionLabel } from './model-pricing';
import { toQoderRuntimeModelId } from './model-selection';

/** Default qodercli catalog tab for first-party model tiers. */
const QODER_MODEL_GROUP = 'Qoder';

export function getQoderModelOptions(settings: Record<string, unknown>): UIOption[] {
  const qoderSettings = getQoderSettings(settings);
  return qoderSettings.discoveredModels.map((model) => {
    const priceLabel = resolvePriceLabel(model, model.description);
    const promotionLabel = resolvePromotionLabel(model);
    return {
      description: buildPricingDescription(model.description, model) || 'Discovered from qodercli',
      label: model.displayName,
      value: model.value,
      group: model.group ?? QODER_MODEL_GROUP,
      ...(priceLabel ? { priceLabel } : {}),
      ...(promotionLabel ? { promotionLabel } : {}),
      ...(model.contextTiers ? { contextTiers: model.contextTiers } : {}),
      ...(model.thinkingDisableable ? { thinkingDisableable: true } : {}),
      ...(model.thinkingEfforts ? { thinkingEfforts: model.thinkingEfforts } : {}),
    };
  });
}

export function resolveQoderModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const modelOptions = getQoderModelOptions(settings);
  if (currentModel) {
    const currentRuntimeModel = toQoderRuntimeModelId(currentModel);
    const currentOption = modelOptions.find(option =>
      option.value === currentModel
      || toQoderRuntimeModelId(option.value) === currentRuntimeModel
    );
    if (currentOption) {
      return currentOption.value;
    }
  }

  const lastModel = getQoderSettings(settings).lastModel;
  if (lastModel) {
    const lastRuntimeModel = toQoderRuntimeModelId(lastModel);
    const lastOption = modelOptions.find(option =>
      option.value === lastModel
      || toQoderRuntimeModelId(option.value) === lastRuntimeModel
    );
    if (lastOption) {
      return lastOption.value;
    }
  }

  return modelOptions[0]?.value ?? null;
}
