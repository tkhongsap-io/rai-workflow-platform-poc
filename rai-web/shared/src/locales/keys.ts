// W0-02 section 10: keys.ts derives the LocaleKey union from th.json (the default locale, D12), so a key missing
// from either catalogue is a type error; locales.test.ts checks both files hold the same keys and no empty value.

import th from './th.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };

export type LocaleKey = keyof typeof th;
export type Locale = 'th' | 'en';

export const DEFAULT_LOCALE: Locale = 'th';

export const LOCALE_CATALOGUES: Readonly<Record<Locale, Readonly<Record<LocaleKey, string>>>> = Object.freeze(
  {
    th,
    en: en,
  },
);

export const LOCALE_KEYS: readonly LocaleKey[] = Object.freeze(Object.keys(th) as LocaleKey[]);

export function isLocaleKey(value: string): value is LocaleKey {
  return Object.hasOwn(th, value);
}

/**
 * Renders a key in a locale with `{param}` substitution. The only string renderer the SPA and mail templates use;
 * a missing key is a programming error and renders as the key itself so it is visible, never silently blank.
 */
export function t(locale: Locale, key: LocaleKey, params?: Record<string, string | number>): string {
  const template = LOCALE_CATALOGUES[locale][key] ?? key;
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
