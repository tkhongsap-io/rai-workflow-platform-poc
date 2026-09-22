// Browser-only rehearsal entry, served by Vite through @fs. Never imported by product code.
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider, useSession } from '../../../web/src/session/session-provider.tsx';
import { LocaleProvider } from '../../../web/src/i18n/locale-provider.tsx';
import { DeskHealthScreen } from '../../../web/src/screens/operator/desk-health.tsx';
const h = React.createElement;
const document = globalThis.document;
const { admin, recipient } = JSON.parse(document.getElementById('session-data').textContent);
function Harness() {
  const { state, signedIn, signedOut } = useSession();
  useLayoutEffect(() => {
    const nonAdmin =
      state.status !== 'signed_in' || !state.session.principal.roles.some((r) => r.role === 'admin');
    if (nonAdmin && document.querySelector('.operator-health')?.textContent.includes(recipient))
      document.body.dataset.leaked = 'true';
  }, [state]);
  return h(
    React.Fragment,
    null,
    h('button', { onClick: () => signedIn(globalThis.structuredClone(admin)) }, 'Replace admin'),
    h(
      'button',
      {
        onClick: () =>
          signedIn({
            ...admin,
            principal: { ...admin.principal, roles: [{ role: 'owner', scope: { kind: 'own_cases' } }] },
          }),
      },
      'Become owner',
    ),
    h('button', { onClick: () => signedOut('user') }, 'Drop session'),
    h(DeskHealthScreen),
  );
}
createRoot(document.getElementById('root')).render(
  h(LocaleProvider, { initialLocale: 'th' }, h(MemoryRouter, null, h(SessionProvider, null, h(Harness)))),
);
