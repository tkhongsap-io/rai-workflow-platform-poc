// W1-07 (Lane B): the route table. RequireSession sends a viewer without a session to the sign-in screen with
// `returnTo` set (W0-02 7.2 deep links); it never decides scope: an in-scope check is the API's 200 or 403 on
// the screen behind it. W1-06 renders the case flow at `/cases/:caseId` (the open draft, or the latest version)
// and `/cases/:caseId/versions/:versionId` (a frozen version); W2 and W3 add their screens here.

import type { JSX, ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useLocale } from './i18n/locale-provider.js';
import { useSession } from './session/session-provider.js';
import { RETURN_TO_PARAM, ROUTES } from './routes.js';
import { QueueScreen } from './screens/queue/queue-screen.js';
import { DashboardScreen } from './screens/dashboard/dashboard-screen.js';

import { DeskHealthScreen } from './screens/operator/desk-health.js';
import { CaseScreen } from './screens/case/case-screen.js';
import { CaseListScreen } from './screens/cases/case-list-screen.js';
import { NewCaseScreen } from './screens/cases/new-case-screen.js';
import { NotFoundScreen } from './screens/not-found-screen.js';
import { SignInScreen } from './screens/sign-in/sign-in-screen.js';

export function RequireSession({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useSession();
  const { t } = useLocale();
  const location = useLocation();
  if (state.status === 'loading') {
    return (
      <p role={'status'} className={'muted'}>
        {t('common.loading')}
      </p>
    );
  }
  if (state.status === 'signed_out') {
    if (state.reason === 'user') return <Navigate to={ROUTES.signIn} replace={true} />;
    const returnTo = `${location.pathname}${location.search}`;
    const params = new URLSearchParams({ [RETURN_TO_PARAM]: returnTo });
    return <Navigate to={`${ROUTES.signIn}?${params.toString()}`} replace={true} />;
  }
  return <>{children}</>;
}

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path={ROUTES.root} element={<Navigate to={ROUTES.cases} replace={true} />} />
      <Route path={ROUTES.signIn} element={<SignInScreen />} />
      <Route
        path={ROUTES.dashboard}
        element={
          <RequireSession>
            <DashboardScreen />
          </RequireSession>
        }
      />
      <Route
        path={ROUTES.queue}
        element={
          <RequireSession>
            <QueueScreen />
          </RequireSession>
        }
      />
      <Route
        path={ROUTES.cases}
        element={
          <RequireSession>
            <CaseListScreen />
          </RequireSession>
        }
      />
      <Route
        path={ROUTES.newCase}
        element={
          <RequireSession>
            <NewCaseScreen />
          </RequireSession>
        }
      />
      <Route
        path={'/cases/:caseId'}
        element={
          <RequireSession>
            <CaseScreen />
          </RequireSession>
        }
      />
      <Route
        path={'/cases/:caseId/versions/:versionId'}
        element={
          <RequireSession>
            <CaseScreen />
          </RequireSession>
        }
      />
      <Route
        path={ROUTES.operatorDeskHealth}
        element={
          <RequireSession>
            <DeskHealthScreen />
          </RequireSession>
        }
      />
      <Route path={'*'} element={<NotFoundScreen />} />
    </Routes>
  );
}
