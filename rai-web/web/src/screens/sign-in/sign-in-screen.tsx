// W1-07 (Lane B): the sign-in screen of W0-02 7.2. It asks GET /auth/fixture/users: 200 shows the fixture picker
// (the server runs in `fixture` mode), 404 shows the provider button (POST /auth/sign-in returns the redirect the
// browser follows). After a successful fixture sign-in the viewer lands on `returnTo` (a same-origin path) or the
// case list; whether that page is in scope is the server's answer, not this screen's (A05 "link alone grants
// nothing"). Every string is a locale key (D12).

import { useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { FixtureUsersResponse, RoleScope } from '@rai/shared/schemas/auth';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale, type Translate } from '../../i18n/locale-provider.js';
import { useSession } from '../../session/session-provider.js';
import { RETURN_TO_PARAM, ROUTES, safeReturnTo } from '../../routes.js';

type PickerState =
  | { kind: 'loading' }
  | { kind: 'fixture'; users: FixtureUsersResponse['users'] }
  | { kind: 'provider' }
  | { kind: 'failed'; error: unknown };

const ROLE_KEY: Readonly<Record<RoleScope['role'], LocaleKey>> = Object.freeze({
  owner: 'role.owner',
  bu_spoc: 'role.bu_spoc',
  ai_coe: 'role.ai_coe',
  dpo: 'role.dpo',
  it_security: 'role.it_security',
  admin: 'role.admin',
});

/** "DPO, BU SPOC (HR)": the (role, scope) pairs the server listed, rendered for the picker only. */
export function describeRoles(t: Translate, roles: readonly RoleScope[]): string {
  return roles
    .map((r) =>
      r.scope.kind === 'business_unit'
        ? `${t(ROLE_KEY[r.role])} (${r.scope.businessUnit})`
        : t(ROLE_KEY[r.role]),
    )
    .join(', ');
}

export function SignInScreen(): JSX.Element {
  const { t } = useLocale();
  const { state, signedIn } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get(RETURN_TO_PARAM));
  const [picker, setPicker] = useState<PickerState>({ kind: 'loading' });
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const selectId = useId();
  const signedOutReason = state.status === 'signed_out' ? state.reason : undefined;

  useEffect(() => {
    let cancelled = false;
    api
      .getFixtureUsers()
      .then((response) => {
        if (cancelled) return;
        setPicker(response === null ? { kind: 'provider' } : { kind: 'fixture', users: response.users });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPicker({ kind: 'failed', error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Already signed in (for example the browser Back button): go where the viewer was heading.
    if (state.status === 'signed_in') void navigate(returnTo ?? ROUTES.cases, { replace: true });
  }, [state.status, navigate, returnTo]);

  const submitFixture = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (chosen === '') return;
    setBusy(true);
    setError(undefined);
    try {
      const session = await api.fixtureSignIn({ fixtureUserId: chosen });
      signedIn(session);
      void navigate(returnTo ?? ROUTES.cases, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const startProvider = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const body = returnTo === undefined ? {} : { returnTo };
      const { redirectUrl } = await api.startSignIn(body);
      window.location.assign(redirectUrl);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const chosenUser =
    picker.kind === 'fixture' ? picker.users.find((u) => u.fixtureUserId === chosen) : undefined;

  return (
    <div className={'sign-in'}>
      <h1>{t('sign_in.title')}</h1>
      <p className={'lede'}>{t('sign_in.intro')}</p>
      {signedOutReason === 'user' ? (
        <p className={'notice notice-success'} role={'status'}>
          {t('sign_in.signed_out')}
        </p>
      ) : null}
      {signedOutReason === 'revoked' ? (
        <p className={'notice'} role={'status'}>
          {t('auth.session_expired')}
        </p>
      ) : null}
      {returnTo !== undefined ? <p className={'notice'}>{t('sign_in.return_notice')}</p> : null}
      {error !== undefined ? <ErrorNotice error={error} /> : null}
      <section className={'card'} aria-labelledby={'sign-in-method'}>
        {picker.kind === 'loading' ? <p role={'status'}>{t('common.loading')}</p> : null}
        {picker.kind === 'failed' ? <ErrorNotice error={picker.error} /> : null}
        {picker.kind === 'fixture' ? (
          <form onSubmit={(event) => void submitFixture(event)}>
            <h2 id={'sign-in-method'}>{t('sign_in.fixture_heading')}</h2>
            <p className={'lede'}>{t('sign_in.fixture_note')}</p>
            <div className={'field'} style={{ marginTop: 16 }}>
              <label htmlFor={selectId}>{t('auth.fixture_user_select')}</label>
              <select
                id={selectId}
                name={'fixtureUserId'}
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              >
                <option value={''}>{t('sign_in.choose_user')}</option>
                {picker.users.map((user) => (
                  <option key={user.fixtureUserId} value={user.fixtureUserId}>
                    {user.displayName}
                  </option>
                ))}
              </select>
              {chosenUser !== undefined ? (
                <p className={'user-roles'}>
                  {t('sign_in.roles', { roles: describeRoles(t, chosenUser.roles) })}
                </p>
              ) : null}
            </div>
            <div className={'form-actions'} style={{ marginTop: 18 }}>
              <button type={'submit'} className={'btn btn-primary'} disabled={busy || chosen === ''}>
                {t('auth.sign_in')}
              </button>
            </div>
          </form>
        ) : null}
        {picker.kind === 'provider' ? (
          <div>
            <h2 id={'sign-in-method'}>{t('auth.sign_in')}</h2>
            <p className={'lede'}>{t('sign_in.google_note')}</p>
            <div className={'form-actions'} style={{ marginTop: 18 }}>
              <button
                type={'button'}
                className={'btn btn-primary'}
                onClick={() => void startProvider()}
                disabled={busy}
              >
                {t('auth.sign_in_with_google')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
