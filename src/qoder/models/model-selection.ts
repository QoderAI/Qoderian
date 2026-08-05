const QODER_MODEL_IDS = new Set(['auto', 'ultimate', 'performance', 'efficient', 'lite']);

export function toQoderRuntimeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const normalized = trimmed.toLowerCase();
  return QODER_MODEL_IDS.has(normalized) ? normalized : trimmed;
}
