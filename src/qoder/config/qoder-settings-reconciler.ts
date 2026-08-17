import { getQoderSettings, updateQoderSettings } from '../config/settings';
import { resolveQoderModelSelection } from '../models/model-options';
import { toQoderRuntimeModelId } from '../models/model-selection';
import { qoderModelConfig } from '../models/qoder-model-config';

function normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
  let changed = false;

  const normalize = (model: string): string => qoderModelConfig.normalizeModelVariant(model, settings);

  const model = settings.model as string;
  const normalizedModel = normalize(model);
  if (model !== normalizedModel) {
    settings.model = normalizedModel;
    changed = true;
  }

  const titleModel = typeof settings.titleGenerationModel === 'string'
    ? settings.titleGenerationModel
    : 'auto';
  const normalizedTitleModel = normalize(titleModel || 'auto');
  if (titleModel !== normalizedTitleModel) {
    settings.titleGenerationModel = normalizedTitleModel;
    changed = true;
  }

  const lastQoderModel = getQoderSettings(settings).lastModel;
  if (lastQoderModel) {
    const normalizedLastQoderModel = normalize(lastQoderModel);
    if (lastQoderModel !== normalizedLastQoderModel) {
      updateQoderSettings(settings, { lastModel: normalizedLastQoderModel });
      changed = true;
    }
  }

  return changed;
}

export function reconcileQoderTitleGenerationModelSelection(
  settings: Record<string, unknown>,
): boolean {
  const currentModel = typeof settings.titleGenerationModel === 'string'
    ? settings.titleGenerationModel || 'auto'
    : 'auto';
  const normalizedModel = qoderModelConfig.normalizeModelVariant(currentModel, settings);
  const runtimeModel = toQoderRuntimeModelId(currentModel);
  const isValid = qoderModelConfig.getModelOptions(settings).some((option) => (
    option.value === normalizedModel
    && toQoderRuntimeModelId(option.value) === runtimeModel
  ));
  const nextModel = isValid ? normalizedModel : 'auto';
  if (nextModel === settings.titleGenerationModel) {
    return false;
  }

  settings.titleGenerationModel = nextModel;
  return true;
}

export function normalizeQoderSettings(settings: Record<string, unknown>): boolean {
  let changed = normalizeModelVariantSettings(settings);
  const currentModel = typeof settings.model === 'string' ? settings.model : '';
  const model = resolveQoderModelSelection(settings, currentModel);
  if (model && model !== currentModel) {
    settings.model = model;
    changed = true;
  }

  if (model) {
    // The global effort selector was removed; per-model editor overrides now
    // own the reasoning effort. Drop the legacy field so it does not linger.
    if ('effortLevel' in settings) {
      delete settings.effortLevel;
      changed = true;
    }
  }

  if (settings.permissionMode === 'normal') {
    const qoder = settings.qoder && typeof settings.qoder === 'object'
      ? settings.qoder as Record<string, unknown>
      : {};
    settings.permissionMode = ['default', 'acceptEdits', 'auto'].includes(String(qoder.safeMode))
      ? qoder.safeMode
      : 'acceptEdits';
    changed = true;
  } else if (!['default', 'acceptEdits', 'auto', 'yolo', 'plan'].includes(String(settings.permissionMode))) {
    settings.permissionMode = 'acceptEdits';
    changed = true;
  }

  return reconcileQoderTitleGenerationModelSelection(settings) || changed;
}
