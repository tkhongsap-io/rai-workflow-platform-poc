// W1-07 (Lane B): the SPA paths. Case and version paths are the `refreshPath` targets of the W0-06 8.2 stale
// envelope and the deep links of W3 mail (relative SPA paths, never a host).

export const ROUTES = Object.freeze({
  root: '/',
  signIn: '/sign-in',
  cases: '/cases',
  queue: '/queue',
  operatorDeskHealth: '/operator/desk-health',
  newCase: '/cases/new',
  case: (caseId: string) => `/cases/${encodeURIComponent(caseId)}`,
  /** A frozen submitted version of a case (W1-06; W0-02 7.6 deep link). */
  caseVersion: (caseId: string, versionId: string) =>
    `/cases/${encodeURIComponent(caseId)}/versions/${encodeURIComponent(versionId)}`,
});

export const RETURN_TO_PARAM = 'returnTo';

/** Only a same-origin SPA path is ever followed after sign-in (W0-02 7.2 `returnTo`: path only, same-origin). */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  if (value === ROUTES.signIn || value.startsWith(`${ROUTES.signIn}?`)) return undefined;
  return value;
}
