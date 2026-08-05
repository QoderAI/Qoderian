import { setLocale } from '@/i18n/i18n';
import {
  buildPricingDescription,
  formatPriceFactor,
  resolvePriceLabel,
  resolvePromotionLabel,
} from '@/qoder/models/model-pricing';

const OFF_PEAK = {
  active: false,
  badge: { en: 'Off-Peak 50% off', zh: '错峰 5 折' },
  discountFactor: 0.5,
  window: '22:00-08:00 Asia/Singapore',
};

describe('formatPriceFactor', () => {
  it('matches the IDE multiplier formatting', () => {
    expect(formatPriceFactor(1)).toBe('1.0x');
    expect(formatPriceFactor(1.6)).toBe('1.6x');
    expect(formatPriceFactor(0.3)).toBe('0.3x');
    expect(formatPriceFactor(0.05)).toBe('0.05x');
    expect(formatPriceFactor(0)).toBe('0.0x');
    expect(formatPriceFactor(0.8333)).toBe('0.83x');
  });
});

describe('resolvePriceLabel', () => {
  it('formats a reported multiplier, including free tiers', () => {
    expect(resolvePriceLabel({ priceFactor: 1.6 })).toBe('1.6x');
    expect(resolvePriceLabel({ priceFactor: 0 })).toBe('0.0x');
  });

  it('omits the label when the server reported no usable multiplier', () => {
    expect(resolvePriceLabel({})).toBeUndefined();
    expect(resolvePriceLabel({ priceFactor: Number.NaN })).toBeUndefined();
    expect(resolvePriceLabel({ priceFactor: -1 })).toBeUndefined();
  });
});

describe('resolvePromotionLabel', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('picks the badge for the active locale', () => {
    setLocale('zh-CN');
    expect(resolvePromotionLabel({ promotion: OFF_PEAK })).toBe('错峰 5 折');

    setLocale('en');
    expect(resolvePromotionLabel({ promotion: OFF_PEAK })).toBe('Off-Peak 50% off');
  });

  it('falls back to English for locales the server does not localize', () => {
    setLocale('ja');
    expect(resolvePromotionLabel({ promotion: OFF_PEAK })).toBe('Off-Peak 50% off');
  });

  it('returns nothing without a promotion badge', () => {
    expect(resolvePromotionLabel({})).toBeUndefined();
    expect(resolvePromotionLabel({ promotion: { active: true } })).toBeUndefined();
  });
});

describe('buildPricingDescription', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('keeps the server description untouched without pricing extras', () => {
    expect(buildPricingDescription('Vision · 1.00x Credit', {})).toBe('Vision · 1.00x Credit');
  });

  it('spells out a standing discount', () => {
    expect(buildPricingDescription('Vision · 0.30x Credit', {
      priceFactor: 0.3,
      originalPriceFactor: 0.5,
    })).toBe('Vision · 0.30x Credit · Discounted 0.5x → 0.3x');
  });

  it('reports an off-peak promotion with its window and state', () => {
    expect(buildPricingDescription('0.50x Credit', {
      priceFactor: 0.5,
      promotion: OFF_PEAK,
    })).toBe('0.50x Credit · Off-Peak 50% off · 0.5x · 22:00-08:00 Asia/Singapore · not active yet');
  });

  it('marks a running promotion as active', () => {
    expect(buildPricingDescription('', {
      promotion: { ...OFF_PEAK, active: true },
    })).toBe('Off-Peak 50% off · 0.5x · 22:00-08:00 Asia/Singapore · active now');
  });
});
