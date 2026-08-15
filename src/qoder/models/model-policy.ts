import type {
  ModelPolicyContext,
  ModelPolicyResult,
} from '@qoder-ai/qoder-agent-sdk';

import { getQoderSettings } from '../config/settings';
import { toQoderRuntimeModelId } from './model-selection';

/**
 * Pull-mode model policy provider factory.
 *
 * Registered through `Options.resolveModel`, the CLI asks for the model
 * before every LLM call (purposes include `main` and `compact`). The
 * provider returns the selected model plus per-request parameters carrying
 * the per-model editor overrides: a context-window tier (`contextWindow`),
 * disabled thinking (`reasoningEffort: 'none'`) or a per-model reasoning
 * effort, mirroring the Qoder IDE model edit panel.
 */
export function createQoderModelPolicyProvider(
  getModel: () => string,
  settings: Record<string, unknown>,
): (context: ModelPolicyContext) => ModelPolicyResult {
  return (context) => {
    const model = toQoderRuntimeModelId(getModel());
    try {
      const override = getQoderSettings(settings).modelOverrides[model];
      if (!override) return { model };

      const live = context.availableModels?.find(candidate => candidate.value === model);
      const discovered = getQoderSettings(settings).discoveredModels
        .find(candidate => candidate.value === model
          || toQoderRuntimeModelId(candidate.value) === model);

      const parameters: Record<string, unknown> = {};
      if (override.contextWindow !== undefined) {
        const knownWindows = live?.context_config
          ? Object.values(live.context_config).map(entry => entry.token_count)
          : discovered?.contextTiers?.map(tier => tier.tokenCount);
        if (!knownWindows || knownWindows.includes(override.contextWindow)) {
          parameters.contextWindow = override.contextWindow;
        }
      }
      const canDisableThinking = live
        ? live.thinking_config?.disabled !== undefined
        : discovered?.thinkingDisableable === true;
      if (override.thinkingEnabled === false && canDisableThinking) {
        parameters.reasoningEffort = 'none';
      } else if (override.thinkingEffort !== undefined) {
        const knownEfforts = live?.thinking_config?.enabled?.efforts
          ? Object.keys(live.thinking_config.enabled.efforts)
          : discovered?.thinkingEfforts?.map(effort => effort.value);
        if (!knownEfforts || knownEfforts.includes(override.thinkingEffort)) {
          parameters.reasoningEffort = override.thinkingEffort;
        }
      }

      return Object.keys(parameters).length > 0 ? { model, parameters } : { model };
    } catch {
      // The provider must never fail a turn — fall back to the bare model.
      return { model };
    }
  };
}
