import type {
  ReasoningOption,
  UIOption,
} from '../../core/types/services';
import type { ModelContextTier, ModelThinkingEffort } from '../../core/types/settings';
import { getQoderSettings, updateQoderSettings } from '../config/settings';
import {
  DEFAULT_EFFORT_LEVEL,
  EFFORT_LEVELS,
  getContextWindowSize,
  normalizeEffortLevel,
  sortThinkingEfforts,
  supportsXHighEffort,
} from './model-catalog';
import { getQoderModelOptions } from './model-options';
import { toQoderRuntimeModelId } from './model-selection';

export interface QoderModelConfig {
  getModelOptions(settings: Record<string, unknown>): UIOption[];
  isKnownModel(model: string, settings: Record<string, unknown>): boolean;
  getReasoningOptions(model: string): ReasoningOption[];
  getDefaultReasoningValue(model: string): string;
  getContextWindowSize(model: string): number;
  getModelContextTiers(model: string, settings: Record<string, unknown>): ModelContextTier[];
  isThinkingDisableable(model: string, settings: Record<string, unknown>): boolean;
  getModelThinkingEfforts(model: string, settings: Record<string, unknown>): ModelThinkingEffort[];
  getEffectiveContextWindowSize(model: string, settings: Record<string, unknown>): number;
  applyModelDefaults(model: string, settings: unknown): void;
  normalizeModelVariant(model: string, settings: Record<string, unknown>): string;
}

export const qoderModelConfig: QoderModelConfig = {
  getModelOptions(settings) {
    return getQoderModelOptions(settings);
  },

  isKnownModel(model: string, settings: Record<string, unknown>): boolean {
    const runtimeModel = toQoderRuntimeModelId(model);
    return getQoderModelOptions(settings).some((option: UIOption) =>
      option.value === model || toQoderRuntimeModelId(option.value) === runtimeModel
    );
  },

  getReasoningOptions(model: string): ReasoningOption[] {
    const runtimeModel = toQoderRuntimeModelId(model);
    const levels = supportsXHighEffort(runtimeModel)
      ? EFFORT_LEVELS
      : EFFORT_LEVELS.filter(e => e.value !== 'xhigh');
    return levels.map(e => ({ value: e.value, label: e.label }));
  },

  getDefaultReasoningValue(model: string): string {
    return DEFAULT_EFFORT_LEVEL[toQoderRuntimeModelId(model)] ?? 'high';
  },

  getContextWindowSize(model: string): number {
    return getContextWindowSize(toQoderRuntimeModelId(model));
  },

  getModelContextTiers(model, settings): ModelContextTier[] {
    const runtimeModel = toQoderRuntimeModelId(model);
    const discovered = getQoderSettings(settings).discoveredModels
      .find(candidate => candidate.value === runtimeModel
        || toQoderRuntimeModelId(candidate.value) === runtimeModel);
    // Older persisted data may predate tier sorting; normalize on read.
    return [...(discovered?.contextTiers ?? [])]
      .sort((a, b) => a.tokenCount - b.tokenCount);
  },

  isThinkingDisableable(model, settings): boolean {
    const runtimeModel = toQoderRuntimeModelId(model);
    const discovered = getQoderSettings(settings).discoveredModels
      .find(candidate => candidate.value === runtimeModel
        || toQoderRuntimeModelId(candidate.value) === runtimeModel);
    return discovered?.thinkingDisableable === true;
  },

  getModelThinkingEfforts(model, settings): ModelThinkingEffort[] {
    const runtimeModel = toQoderRuntimeModelId(model);
    const discovered = getQoderSettings(settings).discoveredModels
      .find(candidate => candidate.value === runtimeModel
        || toQoderRuntimeModelId(candidate.value) === runtimeModel);
    // Older persisted data may predate effort sorting; normalize on read.
    return sortThinkingEfforts(discovered?.thinkingEfforts ?? []);
  },

  getEffectiveContextWindowSize(model, settings): number {
    const runtimeModel = toQoderRuntimeModelId(model);
    const tiers = qoderModelConfig.getModelContextTiers(runtimeModel, settings);
    const override = getQoderSettings(settings).modelOverrides[runtimeModel];
    if (override?.contextWindow !== undefined
      && tiers.some(tier => tier.tokenCount === override.contextWindow)) {
      return override.contextWindow;
    }
    const defaultTier = tiers.find(tier => tier.isDefault);
    if (defaultTier) return defaultTier.tokenCount;
    if (tiers.length > 0) return tiers[0].tokenCount;
    return getContextWindowSize(runtimeModel);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const target = settings as Record<string, unknown>;

    const runtimeModel = toQoderRuntimeModelId(model);
    target.effortLevel = normalizeEffortLevel(runtimeModel, target.effortLevel);
    updateQoderSettings(target, { lastModel: runtimeModel });
  },

  normalizeModelVariant(model: string, settings) {
    const normalizedRuntimeModel = toQoderRuntimeModelId(model);
    const option = getQoderModelOptions(settings).find(candidate =>
      candidate.value === normalizedRuntimeModel
      || toQoderRuntimeModelId(candidate.value) === normalizedRuntimeModel
    );
    return option?.value ?? normalizedRuntimeModel;
  },

};

/** Re-export for type-only use elsewhere in the settings UI. */
export type { UIOption };
