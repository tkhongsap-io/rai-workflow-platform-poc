// The routes of the case flow (W1-06). W1-07's router mounts these; until it lands, app.tsx mounts them
// directly. Deep links resolve inside the SPA and still require a session (A05: a link alone grants nothing).

import type { JSX } from 'react';
import { Route } from 'react-router-dom';
import { CaseScreen } from './case-screen.js';

export function caseRoutes(): JSX.Element[] {
  return [
    <Route key="case" path="/cases/:caseId" element={<CaseScreen />} />,
    <Route key="case-version" path="/cases/:caseId/versions/:versionId" element={<CaseScreen />} />,
  ];
}
