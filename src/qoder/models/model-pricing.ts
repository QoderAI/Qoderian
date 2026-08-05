/**
 * Credit multiplier and promotion formatting for the model catalog.
 *
 * The server reports pricing as a multiplier (`priceFactor`) plus an optional
 * off-peak `promotion` block whose labels are already localized by the server.
 */

import { getLocale } from '../../i18n/i18n';

export interface QoderModelPromotion {
  active?: boolean;
  /** Server-localized badge text keyed by locale prefix (`en` / `zh`). */
  badge?: Record<string, string>;
  discountFactor?: number;
  window?: string;
}

export interface QoderModelPricing {
  priceFactor?: number;
  originalPriceFactor?: number;
  promotion?: QoderModelPromotion;
}

/** Matches the Qoder IDE selector: `1.0x`, `1.6x`, `0.05x`. */
export function formatPriceFactor(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded * 10) ? rounded.toFixed(1) : rounded.toFixed(2);
  return `${text}x`;
}

export function resolvePriceLabel(
  pricing: QoderModelPricing,
  legacyDescription?: string,
): string | undefined {
  const { priceFactor } = pricing;
  if (typeof priceFactor === 'number' && isFinite(priceFactor) && priceFactor >= 0) {
    return formatPriceFactor(priceFactor);
  }

  // Catalogs saved by older Qoderian versions only kept the SDK description.
  // Preserve their multiplier until the next successful structured refresh.
  const legacyMatch = legacyDescription?.match(/\b(\d+(?:\.\d+)?)x\s+Credit\b/i);
  if (!legacyMatch) return undefined;

  const legacyPriceFactor = Number(legacyMatch[1]);
  return isFinite(legacyPriceFactor) ? formatPriceFactor(legacyPriceFactor) : undefined;
}

/** Server badges only ship `en` / `zh`, so every Chinese locale maps to `zh`. */
function resolveBadgeText(badge: Record<string, string> | undefined): string | undefined {
  if (!badge) return undefined;
  const localeKey = getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const text = badge[localeKey] ?? badge.en ?? badge.zh;
  return text?.trim() || undefined;
}

export function resolvePromotionLabel(pricing: QoderModelPricing): string | undefined {
  return resolveBadgeText(pricing.promotion?.badge);
}

/**
 * Builds the option tooltip: the server description plus any discount detail
 * that does not fit in the compact dropdown row.
 */
export function buildPricingDescription(
  description: string,
  pricing: QoderModelPricing,
): string {
  const parts = description ? [description] : [];
  const { priceFactor, originalPriceFactor, promotion } = pricing;

  if (
    typeof originalPriceFactor === 'number'
    && typeof priceFactor === 'number'
    && originalPriceFactor > priceFactor
  ) {
    parts.push(`Discounted ${formatPriceFactor(originalPriceFactor)} → ${formatPriceFactor(priceFactor)}`);
  }

  const badge = resolveBadgeText(promotion?.badge);
  if (badge) {
    const detail: string[] = [badge];
    if (typeof promotion?.discountFactor === 'number') {
      detail.push(formatPriceFactor(promotion.discountFactor));
    }
    if (promotion?.window) {
      detail.push(promotion.window);
    }
    detail.push(promotion?.active ? 'active now' : 'not active yet');
    parts.push(detail.join(' · '));
  }

  return parts.join(' · ');
}
