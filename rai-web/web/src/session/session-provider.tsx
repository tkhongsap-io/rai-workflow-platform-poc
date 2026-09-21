// W1-07 (Lane B): holds the SessionInfo the API returned (W0-02 7.2) and nothing else. There is no role or scope
// logic here: the shell shows the principal the server described, the list shows the rows the server returned,
// and a 401 on any call clears the session so the router sends the viewer to the sign-in screen with `returnTo`.

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
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { ApiError, api } from '../api/client.js';
import { useLocale } from '../i18n/locale-provider.js';

/** Why there is no session: first visit, the viewer signed out, or the server answered 401 during use. */
export type SignedOutReason = 'initial' | 'user' | 'revoked';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out'; reason: SignedOutReason }
  | { status: 'signed_in'; session: SessionInfo };

export interface SessionContextValue {
  state: SessionState;
  /** Called with the SessionInfo a sign-in route returned. */
  signedIn: (session: SessionInfo) => void;
  /** Drops the local copy; the caller has already revoked the server session (`user`) or received a 401 (`revoked`). */
  signedOut: (reason: SignedOutReason) => void;
  /** Re-reads GET /api/session. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const { setLocale } = useLocale();

  const signedIn = useCallback(
    (session: SessionInfo) => {
      setLocale(session.locale); // the stored preference wins over the localStorage mirror (section 10 item 4)
      setState({ status: 'signed_in', session });
    },
    [setLocale],
  );

  const signedOut = useCallback((reason: SignedOutReason) => setState({ status: 'signed_out', reason }), []);

  const refresh = useCallback(async () => {
    try {
      signedIn(await api.getSession());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut('revoked');
      else throw err;
    }
  }, [signedIn, signedOut]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSession()
      .then((session) => {
        if (!cancelled) signedIn(session);
      })
      .catch(() => {
        // 401 (no session) and a network failure both land on the sign-in screen; the screen reports the latter
        if (!cancelled) signedOut('initial');
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, signedOut]);

  const value = useMemo<SessionContextValue>(
    () => ({ state, signedIn, signedOut, refresh }),
    [state, signedIn, signedOut, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession outside SessionProvider');
  return value;
}

/** The signed-in session, for screens the router only renders behind RequireSession. */
export function useSignedInSession(): SessionInfo {
  const { state } = useSession();
  if (state.status !== 'signed_in') throw new Error('screen rendered without a session');
  return state.session;
}
