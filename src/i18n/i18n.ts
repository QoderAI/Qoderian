/**
 * i18n - Internationalization service for Qoderian
 *
 * Provides translation functionality for all UI strings.
 * Supports 10 locales with English as the default fallback.
 */

import * as de from './locales/de.json';
import * as en from './locales/en.json';
import * as es from './locales/es.json';
import * as fr from './locales/fr.json';
import * as ja from './locales/ja.json';
import * as ko from './locales/ko.json';
import * as pt from './locales/pt.json';
import * as ru from './locales/ru.json';
import * as zhCN from './locales/zh-CN.json';
import * as zhTW from './locales/zh-TW.json';
import type { Locale, TranslationKey } from './types';

const translations: Record<Locale, typeof en> = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
  de,
  fr,
  es,
  ru,
  pt,
};

const DEFAULT_LOCALE: Locale = 'en';
export const FOLLOW_OBSIDIAN_LOCALE = 'auto';
let currentLocale: Locale = DEFAULT_LOCALE;

/**
 * Resolves a stored locale preference to one of Qoderian's supported locales.
 * Obsidian exposes regional language codes, while Qoderian intentionally uses
 * a smaller translation set and falls back to the base language where useful.
 */
export function resolveLocalePreference(
  preference: string,
  obsidianLanguage: string,
): Locale {
  if (preference !== FOLLOW_OBSIDIAN_LOCALE && preference in translations) {
    return preference as Locale;
  }

  const normalized = obsidianLanguage.trim().replaceAll('_', '-').toLowerCase();
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized.startsWith('zh-hant')) {
    return 'zh-TW';
  }
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized.startsWith('zh-hans')) {
    return 'zh-CN';
  }

  const baseLanguage = normalized.split('-')[0];
  const matchingLocale = getAvailableLocales().find(
    locale => locale.toLowerCase() === normalized || locale.toLowerCase() === baseLanguage,
  );
  return matchingLocale ?? DEFAULT_LOCALE;
}

/**
 * Get a translation by key with optional parameters
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale];

  const keys = key.split('.');
  let value: unknown = dict;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      if (currentLocale !== DEFAULT_LOCALE) {
        return tFallback(key, params);
      }
      return key;
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  if (params) {
    return value.replace(/\{(\w+)\}/g, (match: string, param: string): string => {
      const replacement = params[param];
      return replacement !== undefined ? `${replacement}` : match;
    });
  }

  return value;
}

function tFallback(key: TranslationKey, params?: Record<string, string | number>): string {
  const dict = translations[DEFAULT_LOCALE];
  const keys = key.split('.');
  let value: unknown = dict;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  if (typeof value !== 'string') {
    return key;
  }

  if (params) {
    return value.replace(/\{(\w+)\}/g, (match: string, param: string): string => {
      const replacement = params[param];
      return replacement !== undefined ? `${replacement}` : match;
    });
  }

  return value;
}

/**
 * Set the current locale
 * @returns true if locale was set successfully, false if locale is invalid
 */
export function setLocale(locale: Locale): boolean {
  if (!translations[locale]) {
    return false;
  }
  currentLocale = locale;
  return true;
}

/**
 * Get the current locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return Object.keys(translations) as Locale[];
}

/**
 * Get display name for a locale
 */
export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    'en': 'English',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    'ja': '日本語',
    'ko': '한국어',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'ru': 'Русский',
    'pt': 'Português',
  };
  return names[locale] || locale;
}
