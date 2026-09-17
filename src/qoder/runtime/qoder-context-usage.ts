import type { SDKControlGetContextUsageResponse } from '@qoder-ai/qoder-agent-sdk';

import type {
  ContextUsageBreakdown,
  ContextUsageCategory,
  ContextUsageCategoryType,
} from '../../core/types';

const CATEGORY_TYPES = new Set<string>([
  'system_prompt',
  'system_tools',
  'skills',
  'messages',
  'other',
  'free_space',
  'auto_compact',
]);

function toPercentage(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(100, value)
    : 0;
}

function toCategory(entry: { type: string; percentage?: number }): ContextUsageCategory | null {
  return CATEGORY_TYPES.has(entry.type)
    ? { type: entry.type as ContextUsageCategoryType, percentage: toPercentage(entry.percentage) }
    : null;
}

/** Normalizes the CLI's `/context` control response into display data. */
export function mapContextUsageBreakdown(
  payload: SDKControlGetContextUsageResponse,
): ContextUsageBreakdown {
  const categories = Array.isArray(payload.categories)
    ? payload.categories.flatMap((entry) => {
      const category = toCategory(entry);
      return category ? [category] : [];
    })
    : [];

  return {
    usedPercentage: toPercentage(payload.contextWindow?.usedPercentage),
    categories,
    skills: {
      count: Math.max(0, Math.floor(payload.skills?.count ?? 0)),
      percentageOfContext: toPercentage(payload.skills?.percentageOfContext),
    },
  };
}
