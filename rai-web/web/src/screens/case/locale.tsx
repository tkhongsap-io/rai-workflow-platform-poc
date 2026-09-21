// Interim locale context for the case flow (W1-06). W0-02 section 10 puts the locale provider in `web/src/i18n/`,
// which W1-07 creates with the shell; this shim wraps the shared `t()` so the screens never render a bare string
// (D12) and is replaced by the W1-07 provider when this branch rebases onto it. The value is the session's
// `locale` (7.2 SessionInfo), Thai by default.

import { createContext, useContext, type JSX, type ReactNode } from 'react';
import {
  DEFAULT_LOCALE,
  isLocaleKey,
  t as render,
  type Locale,
  type LocaleKey,
} from '@rai/shared/locales/keys';

export type Translate = (key: LocaleKey, params?: Record<string, string | number>) => string;
/** For keys the API sent (section 10.3): rendered when the catalogue knows them, shown verbatim otherwise. */
export type TranslateApiKey = (key: string, params?: Record<string, string | number>) => string;

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }): JSX.Element {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** The only string renderer the screens use (section 10.2). */
export function useT(): Translate {
  const locale = useContext(LocaleContext);
  return (key, params) => render(locale, key, params);
}

/** Renders a `messageKey` from a W0-06 envelope; an unknown key is shown as itself so it is visible, never blank. */
export function useApiT(): TranslateApiKey {
  const locale = useContext(LocaleContext);
  return (key, params) => (isLocaleKey(key) ? render(locale, key, params) : key);
}
