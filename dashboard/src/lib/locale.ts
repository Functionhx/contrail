import { safeGetItem, safeSetItem } from "./safe-browser";

export const LOCALE_STORAGE_KEY = "tokentracker-locale";
export const SYSTEM_LOCALE = "system";
export const EN_LOCALE = "en";
export const ZH_CN_LOCALE = "zh-CN";

// Contrail 只提供简体中文与英文：任何 zh-* 都解析为简体中文，其余为英文。
function classifyLanguageTag(tag: string): string | null {
  return /^zh(?:[-_]|$)/i.test(tag) ? ZH_CN_LOCALE : null;
}

export function normalizeResolvedLocale(value: any) {
  if (typeof value !== "string") return EN_LOCALE;
  return classifyLanguageTag(value.trim()) || EN_LOCALE;
}

export function normalizeLocalePreference(value: any) {
  if (value === SYSTEM_LOCALE) return SYSTEM_LOCALE;
  return normalizeResolvedLocale(value);
}

function getBrowserLanguages() {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) {
    return navigator.languages.filter((value) => typeof value === "string");
  }
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

export function resolvePreferredLocale(preference: any, languages = getBrowserLanguages()) {
  const normalized = normalizeLocalePreference(preference);
  if (normalized !== SYSTEM_LOCALE) return normalized;
  // Use only the primary (most preferred) language, not any zh entry in the list.
  // Many English macOS users keep zh-Hans-CN as a secondary language for input methods or
  // fallback menus — scanning the whole array mis-resolves their primary "en" to Chinese.
  // See issue #54.
  const primary = languages
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0);
  if (!primary) return EN_LOCALE;
  return classifyLanguageTag(primary) || EN_LOCALE;
}

export function getInitialLocalePreference() {
  return normalizeLocalePreference(safeGetItem(LOCALE_STORAGE_KEY) || SYSTEM_LOCALE);
}

export function persistLocalePreference(preference: any) {
  return safeSetItem(LOCALE_STORAGE_KEY, normalizeLocalePreference(preference));
}
