import type {
  HostnameCliPaths,
  ModelContextTier,
  ModelThinkingEffort,
  QoderModelOverride,
  QoderSettings,
} from '../../core/types/settings';
import { normalizeQoderCliEdition } from './cli-edition';

export type QoderSettingSource = 'user' | 'project' | 'local';

export interface QoderDiscoveredModel {
  value: string;
  displayName: string;
  description: string;
  /** Selector group label mirroring the Qoder IDE tabs (e.g. 'New models'). */
  group?: string;
  priceFactor?: number;
  originalPriceFactor?: number;
  /** Configurable context-window tiers reported by the server. */
  contextTiers?: ModelContextTier[];
  /** Whether the server allows explicitly disabling thinking. */
  thinkingDisableable?: boolean;
  /** Configurable thinking effort levels reported by the server. */
  thinkingEfforts?: ModelThinkingEffort[];
  promotion?: {
    active?: boolean;
    badge?: Record<string, string>;
    discountFactor?: number;
    window?: string;
  };
}

/** Agent entry reported by the Qoder CLI initialization response. */
export interface QoderDiscoveredAgent {
  name: string;
  description?: string;
  model?: string;
}

export const DEFAULT_QODER_SETTINGS: Readonly<QoderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  edition: 'global',
  loadUserSettings: true,
  enableBangBash: false,
  discoveredModels: [],
  discoveredAgents: [],
  lastModel: 'auto',
  modelOverrides: {},
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeLocalizedBadge(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const badge: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text === 'string' && text.trim()) {
      badge[locale] = text.trim();
    }
  }

  return Object.keys(badge).length > 0 ? badge : undefined;
}

function normalizeContextTiers(value: unknown): ModelContextTier[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const tiers = value.flatMap((entry): ModelContextTier[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const tokenCount = normalizeFiniteNumber(record.tokenCount);
    if (!label || tokenCount === undefined || tokenCount === 0) return [];
    return [{ label, tokenCount, isDefault: record.isDefault === true }];
  });

  return tiers.length > 0 ? tiers : undefined;
}

function normalizeThinkingEfforts(value: unknown): ModelThinkingEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const efforts = value.flatMap((entry): ModelThinkingEffort[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const effortValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (!effortValue || seen.has(effortValue)) return [];
    seen.add(effortValue);
    return [{
      value: effortValue,
      isDefault: record.isDefault === true,
      ...(typeof record.description === 'string' && record.description.trim()
        ? { description: record.description.trim() }
        : {}),
    }];
  });

  return efforts.length > 0 ? efforts : undefined;
}

function normalizeModelOverride(value: unknown): QoderModelOverride | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const override: QoderModelOverride = {};
  const contextWindow = normalizeFiniteNumber(record.contextWindow);
  if (contextWindow !== undefined && contextWindow > 0) override.contextWindow = contextWindow;
  if (typeof record.thinkingEnabled === 'boolean') override.thinkingEnabled = record.thinkingEnabled;
  if (typeof record.thinkingEffort === 'string' && record.thinkingEffort.trim()) {
    override.thinkingEffort = record.thinkingEffort.trim();
  }
  return Object.keys(override).length > 0 ? override : undefined;
}

function normalizeModelOverrides(value: unknown): Record<string, QoderModelOverride> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, QoderModelOverride> = {};
  for (const [model, override] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeModelOverride(override);
    if (normalized) result[model] = normalized;
  }
  return result;
}

function normalizeQoderModelPromotion(value: unknown): QoderDiscoveredModel['promotion'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const promotion: NonNullable<QoderDiscoveredModel['promotion']> = {};
  if (typeof record.active === 'boolean') promotion.active = record.active;

  const badge = normalizeLocalizedBadge(record.badge);
  if (badge) promotion.badge = badge;

  const discountFactor = normalizeFiniteNumber(record.discountFactor);
  if (discountFactor !== undefined) promotion.discountFactor = discountFactor;

  if (typeof record.window === 'string' && record.window.trim()) {
    promotion.window = record.window.trim();
  }

  return Object.keys(promotion).length > 0 ? promotion : undefined;
}

function normalizeQoderDiscoveredModels(value: unknown): QoderDiscoveredModel[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const modelId = typeof record.value === 'string' ? record.value.trim() : '';
    if (!modelId || seen.has(modelId)) return [];
    seen.add(modelId);
    const displayName = typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim()
      : modelId;
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    const group = typeof record.group === 'string' && record.group.trim()
      ? record.group.trim()
      : undefined;
    const priceFactor = normalizeFiniteNumber(record.priceFactor);
    const originalPriceFactor = normalizeFiniteNumber(record.originalPriceFactor);
    const promotion = normalizeQoderModelPromotion(record.promotion);
    const contextTiers = normalizeContextTiers(record.contextTiers);
    const thinkingEfforts = normalizeThinkingEfforts(record.thinkingEfforts);
    return [{
      value: modelId,
      displayName,
      description,
      ...(group ? { group } : {}),
      ...(priceFactor !== undefined ? { priceFactor } : {}),
      ...(originalPriceFactor !== undefined ? { originalPriceFactor } : {}),
      ...(promotion ? { promotion } : {}),
      ...(contextTiers ? { contextTiers } : {}),
      ...(record.thinkingDisableable === true ? { thinkingDisableable: true } : {}),
      ...(thinkingEfforts ? { thinkingEfforts } : {}),
    }];
  });
}

function normalizeQoderDiscoveredAgents(value: unknown): QoderDiscoveredAgent[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const description = typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : undefined;
    const model = typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : undefined;
    return [{
      name,
      ...(description ? { description } : {}),
      ...(model ? { model } : {}),
    }];
  });
}

export function getQoderSettings(
  settings: Record<string, unknown>,
): QoderSettings {
  const config = settings.qoder && typeof settings.qoder === 'object' && !Array.isArray(settings.qoder)
    ? settings.qoder as Record<string, unknown>
    : {};

  return {
    cliPath: (config.cliPath as string | undefined) ?? DEFAULT_QODER_SETTINGS.cliPath,
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    edition: normalizeQoderCliEdition(config.edition),
    loadUserSettings: (config.loadUserSettings as boolean | undefined)
      ?? DEFAULT_QODER_SETTINGS.loadUserSettings,
    enableBangBash: (config.enableBangBash as boolean | undefined)
      ?? DEFAULT_QODER_SETTINGS.enableBangBash,
    discoveredModels: normalizeQoderDiscoveredModels(config.discoveredModels),
    discoveredAgents: normalizeQoderDiscoveredAgents(config.discoveredAgents),
    lastModel: (config.lastModel as string | undefined) ?? DEFAULT_QODER_SETTINGS.lastModel,
    modelOverrides: normalizeModelOverrides(config.modelOverrides),
  };
}

/** Editor override for a model, when the user customized it. */
export function getQoderModelOverride(
  settings: Record<string, unknown>,
  model: string,
): QoderModelOverride | undefined {
  return getQoderSettings(settings).modelOverrides[model];
}

export function resolveQoderSettingSources(
  loadUserSettings: boolean,
): QoderSettingSource[] {
  return loadUserSettings
    ? ['user', 'project', 'local']
    : ['project', 'local'];
}

export function updateQoderSettings(
  settings: Record<string, unknown>,
  updates: Partial<QoderSettings>,
): QoderSettings {
  const current = getQoderSettings(settings);
  const next = {
    ...current,
    ...updates,
  };
  settings.qoder = next;
  return next;
}
