// W1-07 (Lane B): the locale provider of W0-02 section 10 (D12: bilingual, Thai default). Every screen renders
// copy through `t()` from this context; the choice mirrors to localStorage for the sign-in screen (rule 4) and
// the caller persists it on the session with POST /api/session/locale. <html lang> and the document title follow.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import {
  DEFAULT_LOCALE,
  isLocaleKey,
  t as render,
  type Locale,
  type LocaleKey,
} from '@rai/shared/locales/keys';

export const LOCALE_STORAGE_KEY = 'rai.locale';

export type Translate = (key: LocaleKey, params?: Record<string, string | number>) => string;

export interface LocaleContextValue {
  locale: Locale;
  t: Translate;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function isLocale(value: unknown): value is Locale {
  return value === 'th' || value === 'en';
}

export function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // storage may be unavailable (private mode); the session still holds the preference
  }
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? readStoredLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = render(locale, 'app.title');
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    storeLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: (key, params) => render(locale, key, params),
      setLocale,
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error('useLocale outside LocaleProvider');
  return value;
}

/**
 * Renders a key the API sent as a string (a W0-06 envelope's messageKey, guidanceKey or a field's messageKey;
 * section 10 item 3): through the catalogue when it knows the key, verbatim otherwise so it is visible, never blank.
 */
export function translateApiKey(t: Translate, key: string, params?: Record<string, string | number>): string {
  return isLocaleKey(key) ? t(key, params) : key;
}
