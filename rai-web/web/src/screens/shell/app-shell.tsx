// W1-07 (Lane B): the application shell of the design handoff: brand line, the locale switch (D12), the signed-in
// principal as the server described it, sign-out behind a confirmation dialog, and the primary navigation. It
// renders on every screen, including sign-in, so the language can be chosen before a session exists.

import { useCallback, useState, type JSX, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { Locale } from '@rai/shared/locales/keys';
import { api } from '../../api/client.js';
import { Dialog } from '../../components/dialog.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSession } from '../../session/session-provider.js';
import { ROUTES } from '../../routes.js';
import { RouteFocus } from '../../route-focus.js';

export const MAIN_CONTENT_ID = 'main-content';

function LocaleSwitch(): JSX.Element {
  const { locale, setLocale, t } = useLocale();
  const { state } = useSession();
  const choose = (next: Locale): void => {
    if (next === locale) return;
    setLocale(next);
    if (state.status === 'signed_in') {
      // Stored on the session (section 10 item 4); a failure leaves the local choice in place.
      void api.setSessionLocale({ locale: next }).catch(() => undefined);
    }
  };
  return (
    <div className={'locale-switch'} role={'group'} aria-label={t('shell.locale_label')}>
      <button type={'button'} aria-pressed={locale === 'th'} onClick={() => choose('th')} lang={'th'}>
        {t('shell.locale.th')}
      </button>
      <button type={'button'} aria-pressed={locale === 'en'} onClick={() => choose('en')} lang={'en'}>
        {t('shell.locale.en')}
      </button>
    </div>
  );
}

function SignOutControl(): JSX.Element {
  const { t } = useLocale();
  const { signedOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.signOut();
    } catch {
      // a 401 means the session was already gone; either way the local copy is dropped
    } finally {
      setBusy(false);
      setOpen(false);
      // RequireSession sends a protected route to the sign-in screen (no returnTo for a user sign-out); the
      // explicit navigation covers a public route such as the not-found page.
      signedOut('user');
      void navigate(ROUTES.signIn);
    }
  };

  return (
    <>
      <button type={'button'} className={'btn btn-secondary'} onClick={() => setOpen(true)}>
        {t('auth.sign_out')}
      </button>
      <Dialog open={open} labelledBy={'sign-out-title'} onClose={close}>
        <h2 id={'sign-out-title'}>{t('shell.sign_out.confirm_title')}</h2>
        <p className={'muted'}>{t('shell.sign_out.confirm_body')}</p>
        <div className={'dialog-actions'}>
          <button type={'button'} className={'btn btn-secondary'} onClick={close} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type={'button'}
            className={'btn btn-primary'}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {t('auth.sign_out')}
          </button>
        </div>
      </Dialog>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { t } = useLocale();
  const { state } = useSession();
  const signedIn = state.status === 'signed_in';
  return (
    <div className={'shell'}>
      <header>
        <a className={'skip-link'} href={`#${MAIN_CONTENT_ID}`}>
          {t('shell.skip_to_content')}
        </a>
        <div className={'shell-header'}>
          <Link to={signedIn ? ROUTES.cases : ROUTES.signIn} className={'brand'}>
            <span className={'brand-mark'} aria-hidden={true} />
            <span>{t('app.title')}</span>
          </Link>
          <div className={'shell-tools'}>
            <LocaleSwitch />
            {signedIn ? (
              <>
                <span className={'signed-in-as'}>
                  {t('auth.signed_in_as', { displayName: state.session.principal.displayName })}
                </span>
                <SignOutControl />
              </>
            ) : null}
          </div>
        </div>
        {import.meta.env.VITE_API_SUBSTITUTE ? (
          <p className={'banner-substitute'} data-testid={'substitute-banner'}>
            {t('shell.substitute_banner')}
          </p>
        ) : null}
      </header>
      {signedIn ? (
        <nav className={'shell-nav'} aria-label={t('shell.nav_label')}>
          <NavLink to={ROUTES.cases} end={true}>
            {t('shell.nav.cases')}
          </NavLink>
          <NavLink to={ROUTES.newCase}>{t('shell.nav.new_case')}</NavLink>
        </nav>
      ) : null}
      <main id={MAIN_CONTENT_ID} className={'shell-main'} tabIndex={-1}>
        <RouteFocus mainId={MAIN_CONTENT_ID} />
        {children}
      </main>
    </div>
  );
}
