// Placeholder application root (W1-00). Every user-facing string comes from the locale catalogue (D12, W0-02
// section 10); W1-07 replaces this with the shell, the locale provider and the router.
import { useEffect, type JSX } from 'react';
import { DEFAULT_LOCALE, t } from '@rai/shared/locales/keys';

export function App(): JSX.Element {
  useEffect(() => {
    document.title = t(DEFAULT_LOCALE, 'app.title');
    document.documentElement.lang = DEFAULT_LOCALE;
  }, []);
  return <main aria-label={t(DEFAULT_LOCALE, 'app.title')} />;
}
