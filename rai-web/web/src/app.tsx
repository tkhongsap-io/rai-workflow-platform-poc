// W1-07 (Lane B): the application root: locale provider (D12, Thai default), session provider, router and shell.
// Every user-facing string comes from the locale catalogue through t() (W0-02 section 10); the shell renders on
// every screen so the language can be chosen before sign-in.

import type { JSX } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { LocaleProvider } from './i18n/locale-provider.js';
import { AppRoutes } from './router.js';
import { AppShell } from './screens/shell/app-shell.js';
import { SessionProvider } from './session/session-provider.js';

export function App(): JSX.Element {
  return (
    <LocaleProvider>
      <SessionProvider>
        <BrowserRouter>
          <AppShell>
            <AppRoutes />
          </AppShell>
        </BrowserRouter>
      </SessionProvider>
    </LocaleProvider>
  );
}
