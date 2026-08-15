/**
 * Model type definitions and constants.
 */

import { toQoderRuntimeModelId } from './model-selection';

/** Model identifier returned by qodercli, including account-specific models. */
export type QoderModel = string;

/** Effort levels for adaptive thinking models. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

/**
 * Order server effort keys by the canonical intensity scale (matching the
 * Qoder IDE selector). Unknown keys keep their server order at the end.
 */
export function sortThinkingEfforts<T extends { value: string }>(efforts: T[]): T[] {
  const rank = new Map<string, number>(
    EFFORT_LEVELS.map((level, index) => [level.value, index]),
  );
  return [...efforts].sort((a, b) =>
    (rank.get(a.value) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(b.value) ?? Number.MAX_SAFE_INTEGER));
}

/** Default effort level per model tier. */
export const DEFAULT_EFFORT_LEVEL: Record<string, EffortLevel> = {
  'auto': 'high',
  'ultimate': 'high',
  'performance': 'high',
  'efficient': 'high',
  'lite': 'medium',
};

const ONE_M_SUFFIX = '[1m]';
const BUILT_IN_MODEL_IDS = new Set(['auto', 'ultimate', 'performance', 'efficient', 'lite']);

function normalizeModelId(model: string): string {
  return toQoderRuntimeModelId(model).trim().toLowerCase();
}

function has1MContextSuffix(model: string): boolean {
  return normalizeModelId(model).endsWith(ONE_M_SUFFIX);
}

function isBuiltInFamilyVariant(model: string, family: 'sonnet' | 'opus'): boolean {
  const normalized = normalizeModelId(model);
  return normalized === family || normalized === `${family}${ONE_M_SUFFIX}`;
}

export function isDefaultQoderModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  return BUILT_IN_MODEL_IDS.has(normalized)
    || /^(haiku|sonnet|opus)(?:\[1m\])?$/.test(
      toQoderRuntimeModelId(model) === normalized
        ? normalized
        : model.trim().toLowerCase(),
    );
}

/**
 * Whether the model supports the `xhigh` effort level. The SDK silently falls
 * back to `high` for model IDs outside the compatible Qoder family/version.
 */
export function supportsXHighEffort(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  return /qoder-opus-(4-[7-9]|[5-9])/.test(normalized);
}

/** Clamp stored effort values to what the selected model actually supports. */
export function normalizeEffortLevel(
  model: string,
  effortLevel: unknown,
): EffortLevel {
  const allowsXHigh = supportsXHighEffort(model);
  const isSupported = EFFORT_LEVELS.some((level) =>
    level.value === effortLevel && (allowsXHigh || level.value !== 'xhigh')
  );

  if (isSupported) {
    return effortLevel as EffortLevel;
  }

  return DEFAULT_EFFORT_LEVEL[normalizeModelId(model)] ?? 'high';
}

export function resolveEffortLevel(
  model: string,
  effortLevel: unknown,
): EffortLevel {
  return normalizeEffortLevel(model, effortLevel);
}

export const CONTEXT_WINDOW_STANDARD = 200_000;
export const CONTEXT_WINDOW_1M = 1_000_000;

export function getContextWindowSize(model: string): number {
  if (has1MContextSuffix(model)) {
    return CONTEXT_WINDOW_1M;
  }

  return CONTEXT_WINDOW_STANDARD;
}
