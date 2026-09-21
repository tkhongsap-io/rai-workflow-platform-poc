// W1-13: the in-memory API substitute (dev/test only; W0-02 section 1, `fixtures/src/substitutes/api/`).
// - createApiSubstitute(): the transport-agnostic handler over the W1-09 fixture state.
// - startApiSubstitute(): the loopback node:http server a Playwright config or a dev session uses.
// - createSubstituteFetch(): a fetch-shaped in-process adapter with a cookie jar.
// The substitute carries SUBSTITUTE_MARKER; `npm run check:substitute-absent` proves it never reaches a build.
export { createApiSubstitute, routeTable, type ApiSubstitute, type RouteDefinition } from './handler.js';
export {
  startApiSubstitute,
  assertSubstituteAllowed,
  SubstituteRefused,
  SUBSTITUTE_NODE_ENVS,
  type RunningSubstitute,
  type StartOptions,
} from './server.js';
export { createSubstituteFetch, type SubstituteFetch } from './fetch.js';
export { SubstituteStore, FIXTURE_LOADED_AT, FIXTURE_CONFIGURATION_REVISION_ID } from './store.js';
export { SESSION_COOKIE, SUBSTITUTE_HEADER } from './support.js';
export type { ApiSubstituteOptions, SubstituteRequest, SubstituteResponse } from './types.js';
export { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
