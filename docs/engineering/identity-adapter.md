# Identity adapter (W0-03)

Status: **W0 interface spec, human review required.** Ticket W0-03 (issue #8), lane Lead. Proves A01 and R1 through the tickets that consume it (W1-01, W1-07, W1-08, W2-02, W3-07, W7-00, W8). Recorded decisions carried as written: D04 (stack, [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md)), D05 (no self-approval; the dual-role fixture exists to exercise it), D12 (locale keys). D07-D10 stay open; this spec records the configuration shape only where the [W0 contract](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) says so and never a value that D10 owns.

Source rules this spec implements, unchanged: [source spec](../product/source-spec.md) L4 (production identity is True AD), L11 (any Google account on localhost only; networked URL needs allow-list or AD; production is AD), the six roles in "Roles and access", and the non-goal "Google/social login on a True URL". Acceptance: [A01](../acceptance.md). Threat-model row: "Networked test exposed with arbitrary Google login" ([threat model](../security/threat-model.md)).

The boundaries in sections 1-4 are stack-neutral in intent; sections 5-11 make them concrete for the D04 stack (Fastify, Drizzle on Postgres 16, `openid-client`, `node:test`, Playwright). Paths are proposed under the layout ADR-0003 offered to W0-02; the [W0-02 file-level plan](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan) fixes the layout, and on any conflict W0-02's paths win. The W0-09 exit review reconciles variable names between this spec and W0-02's environment list; for `RAI_IDENTITY_*` and the secret names in section 8 this spec is the source, for bind, port and base URL W0-02 is.

## 1. What the adapter is and is not

The identity adapter answers one question for the server: **who is making this request and in which roles, over which scope.** It takes a verified login from an identity provider and returns a `Principal`: subject ID, display name, email and a non-empty list of (role, scope) pairs. Nothing else in the server talks to an identity provider.

The adapter is not authorization. Scope enforcement lives in the server authorization middleware and the [W0-05 policy matrix](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix), which consume the `Principal` on every request (case read, list, search, download, deep link, lane decision). The adapter never decides whether a principal may do something; it only says who the principal is. The SPA receives the `Principal` for display and navigation only; no client-side check decides access ([design-to-build map](../delivery/design-to-build-map.md), ADR-0003 risk table).

Identity provider output (ID-token claims, group lists, allow-list files) is data, never instructions. The adapter reads named claims, validates their types and discards the rest.

## 2. Interface

Type notation is TypeScript because the stack is (D04); the shapes are the contract for any implementation. The shared types live in `rai-web/shared` so the server, the W1-13 substitute and the SPA see one definition.

```ts
// rai-web/shared/src/identity.ts  (proposed path; W0-02 fixes it)

/** The six source-spec roles. No seventh role (D05, D06). */
export type Role = 'owner' | 'bu_spoc' | 'ai_coe' | 'dpo' | 'it_security' | 'admin';

/** Fixture and production BU identifiers are opaque strings; the value list is configuration (W6). */
export type BusinessUnitId = string;

/** Stable, issuer-qualified subject key. Never the email. See section 2.2. */
export type SubjectId = string;

/**
 * Scope per role, as the W0 contract states it: the BU for BU SPOC,
 * owned cases for owner, all cases for the three reviewer roles and Admin.
 */
export type Scope =
  | { kind: 'owned_cases'; ownerSubjectId: SubjectId }   // owner
  | { kind: 'business_unit'; businessUnit: BusinessUnitId } // bu_spoc
  | { kind: 'all_cases' };                                // ai_coe, dpo, it_security, admin

export type RoleScope =
  | { role: 'owner';       scope: Extract<Scope, { kind: 'owned_cases' }> }
  | { role: 'bu_spoc';     scope: Extract<Scope, { kind: 'business_unit' }> }
  | { role: 'ai_coe';      scope: Extract<Scope, { kind: 'all_cases' }> }
  | { role: 'dpo';         scope: Extract<Scope, { kind: 'all_cases' }> }
  | { role: 'it_security'; scope: Extract<Scope, { kind: 'all_cases' }> }
  | { role: 'admin';       scope: Extract<Scope, { kind: 'all_cases' }> };

export type IdentityMode = 'local-google' | 'network' | 'production' | 'fixture';

/** What the adapter returns. Snapshotted into the session at sign-in (section 6.3). */
export interface Principal {
  subjectId: SubjectId;
  displayName: string;
  email: string;                 // lower-cased; for display and notification addressing only
  roles: readonly RoleScope[];   // non-empty; at most one pair per (role, scope)
  identityMode: IdentityMode;    // recorded on the session and the sign-in audit event
  signedInAt: string;            // ISO-8601, UTC
}
```

```ts
// rai-web/server/src/identity/adapter.ts  (proposed path)

import type { Principal, IdentityMode, RoleScope } from '@rai/shared/identity';

/** Output of a mode's login verifier, before roles are known. */
export interface VerifiedLogin {
  issuer: string;                 // OIDC `iss` as verified by openid-client, or 'fixture'
  subject: string;                // Google `sub`; Entra `oid`; fixture user id
  email: string;                  // lower-cased
  emailVerified: boolean;         // Google `email_verified`; Entra: true when `email` or `preferred_username` is present (both come from the tenant directory, not the user)
  displayName: string;            // `name`, else email local part
  claims: Readonly<Record<string, unknown>>; // raw claims; data, never instructions
}

export interface LoginVerifier {
  /** Builds the provider redirect and the state the callback must match (PKCE + state + nonce). */
  beginSignIn(input: { callbackUrl: URL }): Promise<{ redirectTo: URL; transaction: SignInTransaction }>;
  /** Exchanges the callback for verified claims or throws SignInRefused('unauthenticated', reason). */
  completeSignIn(input: { callbackUrl: URL; transaction: SignInTransaction }): Promise<VerifiedLogin>;
}

export interface RoleResolver {
  /** Maps a verified login to its (role, scope) pairs. Empty array means "no access" (section 6.4). */
  resolve(login: VerifiedLogin): Promise<readonly RoleScope[]>;
}

export interface IdentityAdapter {
  readonly mode: IdentityMode;
  /** Validates configuration and bind target; throws IdentityStartupError so the process never listens (section 5). */
  start(bind: { host: string; port: number; publicBaseUrl: URL }): Promise<void>;
  /** The W0 contract's core function: verified login in, Principal out. */
  resolvePrincipal(login: VerifiedLogin): Promise<Principal>;
  readonly verifier: LoginVerifier;
  /** For the W0-10 readiness probe. */
  health(): { mode: IdentityMode; ready: boolean; reason?: StartupReasonCode };
}

export interface SignInTransaction {
  state: string;          // 128-bit random, base64url
  nonce: string;          // 128-bit random
  codeVerifier: string;   // PKCE S256
  createdAt: string;      // expires after 10 minutes
  returnTo?: string;      // same-origin path only; anything else is dropped
}

export class SignInRefused extends Error {
  constructor(
    readonly errorType: 'unauthenticated' | 'forbidden',
    readonly reason: SignInReasonCode,   // logged and audited; never shown to the user verbatim
  ) { super(reason); }
}
```

`resolvePrincipal` is `verifier → RoleResolver → Principal`; the verifier and resolver are chosen by mode (section 4). If the resolver returns no pairs, `resolvePrincipal` throws `SignInRefused('forbidden', …)` and no session is created.

### 2.1 Scope representation

The W0 contract says the owner's scope is "owned cases". The adapter expresses this as the rule `{ kind: 'owned_cases', ownerSubjectId }` rather than a list of case IDs, because a list taken at sign-in is stale after the first case is created and would make identity depend on the case store. The W0-05 policy resolves the rule against the case store at each check (`case.owner_subject_id = principal.subjectId`). BU SPOC scope is the BU identifier itself; W0-05 compares it with `case.business_unit`. The three reviewer roles and Admin carry `all_cases`; which lane a reviewer may act in follows from the role under the W0-06 lane mapping, not from the scope.

An owner has no BU in the identity model. A case's `business_unit` is a case field set at creation; the SPOC of that BU gains scope over the case through the case, not through the owner.

### 2.2 Subject identity

The stable key is `subjectId = <issuerKey>:<subject>`:

| Mode | `issuerKey` | `subject` | Why |
|---|---|---|---|
| `local-google` | `google` | ID-token `sub` | Google's stable per-account identifier |
| `network` (allow-list, any OIDC issuer) | `oidc:<sha256(iss)[0..12]>` | ID-token `sub` | Distinguishes issuers without embedding a URL in a key |
| `network` (AD) and `production` | `entra:<tenantId>` | ID-token `oid` | Entra's `sub` is pairwise per application; `oid` is stable across applications in the tenant |
| `fixture` | `fixture` | fixture user id | Stable across test runs so evidence records can cite it |

Cases, lane decisions, dispositions and audit events reference `subjectId`, never the email. An email or display-name change at the provider updates the subject's profile row (W0-04 persistence) and changes no ownership or history. The email is never compared for authorization except inside the allow-list resolver, which matches on the provider-verified email and then keys everything on `subjectId`.

### 2.3 Invariants the adapter enforces before returning a Principal

1. `roles` is non-empty, or `SignInRefused('forbidden')`.
2. No duplicate (role, scope) pair; `bu_spoc` may appear several times with different BUs; every other role at most once.
3. `email` is present and lower-cased; for Google `email_verified` must be true, or `SignInRefused('unauthenticated', 'email_not_verified')`.
4. `displayName` is non-empty (falls back to the email local part) and is trimmed to 200 characters.
5. The dual-role case is legitimate: a principal may be both a lane reviewer and a BU SPOC. The adapter never drops a role to "resolve" the conflict; the D05 no-self-approval rule is applied by W0-05 at decision time using both pairs.

## 3. Modes

| Mode | Who may sign in (L11) | Verifier | Role source | Bind | Google |
|---|---|---|---|---|---|
| `local-google` | Any Google account, loopback only | Google OIDC via `openid-client` | Local role map (untracked file); unmapped account gets `owner` (section 4.1) | Loopback only; refuses otherwise | On |
| `network` | Allow-listed accounts or AD members, on a closed network only (W7 entry) | Configured OIDC issuer (`allow-list` source) or Entra (`ad` source) | Allow-list entries, or AD group-to-role mapping (shape in section 9; values W6/W8) | Any; the operator confirms the closed environment at W7-00 | Off when source is `ad`; when source is `allow-list` the issuer is configuration and a Google issuer is permitted only on a non-True URL (source-spec non-goal), which W7-00 checks by hand |
| `production` | True AD (Entra) members with a mapped group only (L4) | Entra OIDC, tenant fixed by configuration | AD group-to-role mapping, an Admin configuration revision (L12, W6) with group values from D10/W8 | Any | Off; any Google variable present is a start-up refusal |
| `fixture` | The seven synthetic users, test environment only | None (no provider; a test-only route names the user) | The fixture table (section 7) | Loopback only and `NODE_ENV=test` only | Off |

The mode is configuration (`RAI_IDENTITY_MODE`). An unknown value, a missing value or a value whose prerequisites are absent refuses to start (section 5). There is no default mode.

Slice 1 implements `local-google` and `fixture` (W1-01). `network` is implemented at W7-00 only if the operator rehearsal is networked; `production` at W8 after D10. The start-up rules for all four modes are implemented and unit-tested in W1-01 so a later ticket cannot loosen them unnoticed.

## 4. Verifiers and role resolvers per mode

### 4.1 `local-google`

- **Verifier.** `openid-client` discovery against `https://accounts.google.com`, authorization-code flow with PKCE (S256), `state`, `nonce`, scopes `openid email profile`, `prompt=select_account`. The redirect URI is `${RAI_PUBLIC_BASE_URL}/auth/callback` and must be a loopback URL (section 5). The developer's own OAuth client ID and secret come from the environment (`RAI_IDENTITY_GOOGLE_CLIENT_ID`, `RAI_IDENTITY_GOOGLE_CLIENT_SECRET`), held locally and never committed (W1-08 wording). The client verifies `iss`, `aud`, `exp`, `nonce` and requires `email_verified: true`.
- **Role resolver.** Reads the optional local role map at `RAI_IDENTITY_LOCAL_ROLE_MAP` (an untracked JSON file in the allow-list format of section 4.2, matched on lower-cased email). An account absent from the map receives exactly `[{ role: 'owner', scope: { kind: 'owned_cases', ownerSubjectId } }]`, the least-privileged role, so that the W1-08 manual sign-in works with no local set-up and the account sees nothing until it creates a case. This default exists only in `local-google`; every other mode refuses an unmapped account. **Reviewer check:** the lead confirms this default at review; it is a W0-03 rule for the loopback developer mode, not a product decision.

### 4.2 `network`, source `allow-list`

- **Verifier.** `openid-client` discovery against `RAI_IDENTITY_OIDC_ISSUER_URL`; same flow as 4.1. Client ID and secret come from the D10 custody mechanism (section 8).
- **Role resolver.** The allow-list, read once at start from the custody mechanism (secret name `RAI_IDENTITY_ALLOW_LIST_JSON`), parsed and validated against this shape; an invalid document refuses to start:

```ts
export interface AllowList {
  version: 1;
  entries: Array<{
    email: string;                  // compared lower-cased, exact match; no wildcards or domains
    roles: RoleScope[];             // non-empty; ownerSubjectId is filled in by the resolver at sign-in
    displayNameOverride?: string;
  }>;
}
```

A verified login whose email is not an entry is refused with `forbidden` and no session. The allow-list contains real staff addresses when used at W7, so it is a secret under D10 custody, never a file in the repository, and the fixture allow-lists used in tests contain only `@fixture.example.test` addresses.

### 4.3 `network`, source `ad`, and `production`

- **Verifier.** `openid-client` discovery against `https://login.microsoftonline.com/${RAI_IDENTITY_ENTRA_TENANT_ID}/v2.0`; the discovered `issuer` must equal that URL or start-up is refused (`issuer_not_entra`). Same authorization-code + PKCE flow; scopes `openid profile email`. Subject is `oid`. Group membership is read from the `groups` claim of the ID token (the app registration must emit it, an operator step recorded at W8). If the token carries the overage indicator (`_claim_names` / `_claim_sources` or `hasgroups`) instead of the list, the sign-in is refused with `forbidden` and reason `groups_overage` in slice-1 shape; whether W8 adds a Microsoft Graph lookup is an open item there, not a silent fallback here.
- **Role resolver.** The AD group-to-role mapping (section 9), read from the configuration revision store (W1-00 substrate; Admin-editable from W6). Each group object ID in the token that matches a rule contributes that rule's (role, scope) pair; no match means `forbidden`. Values are never in this repository.
- **Google is off.** In `production` the presence of any `RAI_IDENTITY_GOOGLE_*` variable is a start-up refusal, not a warning (`google_forbidden_in_mode`). In `network` with source `ad` the same rule applies.

### 4.4 `fixture`

No provider. The verifier is a test-only route that names one of the seven fixture users (section 7); the resolver returns that user's pairs from the fixture table. The composition root mounts the fixture verifier only when `RAI_IDENTITY_MODE=fixture`, and start-up refuses that mode unless `NODE_ENV=test` and the bind is loopback.

## 5. Start-up validation: fail closed

`IdentityAdapter.start()` runs before Fastify listens. Any failure throws `IdentityStartupError` with a reason code; the process logs the code (never a value) and exits with code **78** (`EX_CONFIG`). It never listens in a degraded state, and the W0-10 readiness probe reports `identity.ready = false` with the same reason code for any process that is up but whose adapter reports not-ready.

**Loopback** means the bind host is the literal `127.0.0.1`, `::1` or `localhost`, and `RAI_PUBLIC_BASE_URL` has one of those hosts. `0.0.0.0`, `::`, an interface address, a hostname other than `localhost`, or a base URL with any other host is not loopback. After `listen`, the adapter reads `server.address()` and closes the server with the same exit code if the bound address is not loopback (a second check, in case a reverse proxy or a platform rewrote the bind).

| # | Condition | Result | Reason code | Tested by |
|---|---|---|---|---|
| S1 | `RAI_IDENTITY_MODE` missing or not one of the four values | refuse | `mode_unknown` | W1-01 |
| S2 | `local-google` and bind host not loopback | refuse | `bind_not_loopback` | W1-01, W1-08 (negative) |
| S3 | `local-google` and `RAI_PUBLIC_BASE_URL` host not loopback | refuse | `base_url_not_loopback` | W1-01 |
| S4 | `local-google` and Google client ID or secret absent | refuse | `secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET` (or `_ID`) | W1-01 |
| S5 | `local-google` and `trustProxy` enabled | refuse | `proxy_forbidden_in_mode` | W1-01 |
| S6 | `network` and `RAI_IDENTITY_NETWORK_SOURCE` not `allow-list` or `ad` | refuse | `network_source_unknown` | W1-01 |
| S7 | `network` / `allow-list` and issuer URL, client ID, client secret or allow-list absent from custody | refuse | `secret_missing:<name>` | W1-01 (unit), W7-00 (live, if networked) |
| S8 | `network` / `allow-list` and allow-list fails schema validation | refuse | `allow_list_invalid` | W1-01 |
| S9 | `network` / `ad` or `production` and tenant ID, client ID or client secret absent | refuse | `secret_missing:<name>` | W1-01 (unit), W8 (live) |
| S10 | `production` or `network` / `ad` and any `RAI_IDENTITY_GOOGLE_*` variable set | refuse | `google_forbidden_in_mode` | W1-01 |
| S11 | `production` or `network` / `ad` and discovered issuer differs from the Entra tenant URL | refuse | `issuer_not_entra` | W1-01 (unit with a stub discovery document), W8 (live) |
| S12 | `production` and no published group-to-role mapping revision | refuse | `group_mapping_missing` | W6, W8 |
| S13 | `fixture` and `NODE_ENV` is not `test` | refuse | `fixture_outside_test` | W1-01 |
| S14 | `fixture` and bind host not loopback | refuse | `bind_not_loopback` | W1-01 |
| S15 | Any secret whose value is empty, whitespace or the placeholder literal `set-in-custody` | treated as absent | as S4/S7/S9 | W1-01 |
| S16 | After `listen`, `server.address()` is not loopback in `local-google` or `fixture` | close and exit 78 | `bind_not_loopback` | W1-01 |

```ts
export type StartupReasonCode =
  | 'mode_unknown' | 'bind_not_loopback' | 'base_url_not_loopback' | 'base_url_not_https'
  | 'proxy_forbidden_in_mode' | 'network_source_unknown' | 'allow_list_invalid'
  | 'google_forbidden_in_mode' | 'issuer_not_entra' | 'group_mapping_missing'
  | 'fixture_outside_test' | 'discovery_failed' | `secret_missing:${string}`;

export type SignInReasonCode =
  | 'state_mismatch' | 'nonce_mismatch' | 'transaction_missing' | 'code_exchange_failed'
  | 'issuer_mismatch' | 'email_not_verified' | 'no_role' | 'not_allow_listed'
  | 'no_mapped_group' | 'groups_overage';
```

Configuration parsing is a pure function (`parseIdentityConfig(env, bind) → Ok<IdentityConfig> | Refused<reasonCode>`) so the table above is one table-driven `node:test` file with no network, no Postgres and no process spawn; S16 is the one test that starts a server. The manual W1-08 negative ("`local-google` refuses a non-loopback bind and an unknown mode") runs the real command with `RAI_BIND_HOST=0.0.0.0` and with `RAI_IDENTITY_MODE=nonsense` and records the exit code and reason code.

## 6. Sign-in surface, session and error contract

The adapter's HTTP surface is a Fastify plugin registered under `/auth`. The [W0-02 "W1 interface shapes" section](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan) records the request/response shapes for W1-13 and Lane B; the routes, status codes and error cases below are what those shapes must agree with, and W0-09 reconciles any drift before W1-01 starts.

### 6.1 Routes

| Route | Mode | Behaviour |
|---|---|---|
| `GET /auth/session` | all | Returns the current `Principal` (200) or `unauthenticated` (401). `Cache-Control: no-store`. The SPA calls it on load; it never derives permissions from the response beyond choosing what to render. |
| `GET /auth/sign-in?returnTo=<path>` | `local-google`, `network`, `production` | Stores a `SignInTransaction` in a short-lived, HttpOnly transaction cookie (`__Host-rai_signin`, 10-minute expiry, `SameSite=Lax`) and 302-redirects to the provider. `returnTo` is kept only if it is a same-origin absolute path. |
| `GET /auth/callback` | same | Completes the code exchange, calls `resolvePrincipal`, creates the session (6.3), clears the transaction cookie, 302-redirects to `returnTo` or `/`. Any failure renders the sign-in page with the error's locale key; no partial session exists. |
| `POST /auth/sign-out` | all | Revokes the session row, clears the cookie, 204. Idempotent: without a session it is still 204. Requires `Sec-Fetch-Site: same-origin` or `none`, else 403 `forbidden`. |
| `GET /auth/fixture/users` | `fixture` only | The seven fixture users as `{ id, displayName, roles }` for the test sign-in picker. Not mounted in any other mode (404). |
| `POST /auth/fixture/sign-in` `{ userId }` | `fixture` only | Creates a session for that fixture user (204 + cookie). Unknown `userId` is 422 `invalid_input`. Not mounted in any other mode (404). |

The sign-in page is Lane B's (W1-07) and reads the mode from `GET /auth/session`'s 401 body (`{ code: 'unauthenticated', identityMode }`) to show either the Google button or, in fixture mode, the user picker. The identity mode is not secret; the presence of the fixture routes is what is guarded.

### 6.2 `openid-client` usage (v6 API; W0-02 pins the version)

`discovery(issuerUrl, clientId, clientSecret)` once at start (a discovery failure is a start-up refusal, `discovery_failed`); `buildAuthorizationUrl(config, { redirect_uri, scope, state, nonce, code_challenge, code_challenge_method: 'S256', prompt })` in `beginSignIn`; `authorizationCodeGrant(config, callbackUrl, { expectedState, expectedNonce, pkceCodeVerifier })` in `completeSignIn`, then `tokens.claims()` for `iss`, `sub` / `oid`, `email`, `email_verified`, `name`, `groups`. Access and refresh tokens are discarded after the exchange: the desk holds its own session and never calls the provider on behalf of the user. No token is written to the session row, the log or the audit event.

### 6.3 Session

Server-side sessions in Postgres, one row per session, an opaque cookie:

```ts
// Drizzle schema, proposed; W1-01 adds the migration under the W0-04 rules (forward-only, explicit step)
sessions: {
  id: uuid (pk),
  tokenHash: text (unique),        // sha256 of the 256-bit random cookie value; the value itself is never stored
  subjectId: text,
  principal: jsonb,                // the Principal snapshot returned at sign-in
  identityMode: text,
  createdAt: timestamptz,
  lastSeenAt: timestamptz,
  expiresAt: timestamptz,          // createdAt + RAI_SESSION_ABSOLUTE_HOURS (default 12)
  revokedAt: timestamptz | null,
}
```

- Cookie `__Host-rai_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (on loopback over plain `http` the `__Host-` prefix and `Secure` are dropped and the cookie is named `rai_session`; the adapter picks the name from the public base URL scheme, and `production` refuses a non-`https` base URL, reason `base_url_not_https`). No signing secret is needed because the cookie value is random and looked up by hash.
- A request is authenticated when the hash matches a row with `revokedAt IS NULL`, `expiresAt > now()` and `lastSeenAt > now() - RAI_SESSION_IDLE_MINUTES` (default 120). `lastSeenAt` is updated at most once per minute to avoid a write per request.
- Roles are a snapshot. A change in the allow-list or the group mapping takes effect at the next sign-in; the absolute TTL bounds the staleness. Revoking all sessions of a subject on a mapping change is a W6 operator action, not slice 1.
- Sign-in always creates a new session row (no fixation: an existing cookie is ignored and replaced).
- Expired and revoked rows are deleted by the `reset` and a periodic sweep (W1-01); session rows are operational data, not audit, and are not retained.

### 6.4 Error contract

Codes and statuses are the ADR-0003 table that W0-06 confirms. Every response carries `code`, `messageKey` (D12 locale key, section 12) and the correlation ID (W0-10).

| Situation | HTTP / `code` | `messageKey` | Session | Audit / log |
|---|---|---|---|---|
| No cookie, unknown hash, expired, idle-expired or revoked session | 401 `unauthenticated` | `auth.session_required` | none | log only, reason code |
| Callback with missing or mismatched `state`, `nonce` or transaction cookie; code exchange failed; `iss`/`aud` mismatch; email not verified | 401 `unauthenticated` | `auth.sign_in_failed` | none created | log reason code; audit `identity.sign_in_refused` with subject hash, no email |
| Verified login with no (role, scope) pair: unlisted (allow-list), no mapped group or groups overage (AD), unmapped in production | 403 `forbidden` | `auth.not_permitted` | none created | audit `identity.sign_in_refused` (reason code, issuer key, sha256 of subject; never the email) |
| Sign-out without matching `Sec-Fetch-Site` | 403 `forbidden` | `auth.not_permitted` | unchanged | log only |
| Fixture route in a non-fixture mode | 404 `not_found` | `common.not_found` | — | — |
| `POST /auth/fixture/sign-in` with an unknown `userId` | 422 `invalid_input` | `auth.fixture_user_unknown` | none | — |
| Start-up misconfiguration (section 5) | process exits 78 before listening | — | — | log reason code; readiness `identity.ready=false` |

Refused sign-ins are never 404 and never reveal whether the account exists at the provider; the body is the same for every `forbidden` reason. Nothing about a refused login is rendered beyond the locale message.

## 7. Test substitute: the fixture identity provider

Seven synthetic users: six single-role users, one per source-spec role, plus one dual-role identity. The dual-role identity is a lane reviewer who is also BU SPOC of one fixture BU, so the W0-05 no-self-approval row (D05) can be exercised: it is a fixture user, not a seventh role. Names, addresses and BUs are invented; none is a person named in the source spec or a real True account, and `example.test` is a reserved domain that never resolves.

Fixture business units (W1-09 reuses these identifiers for its cases):

| `BusinessUnitId` | Display name |
|---|---|
| `BU-CM` | Consumer Mobile |
| `BU-RP` | Retail & Partner Channels |

Fixture users (W1-00 owns the table; W1-09 owns the cases that reference them):

| Fixture user id | `subjectId` | Display name | Email | (role, scope) pairs |
|---|---|---|---|---|
| `fx-owner-cm` | `fixture:fx-owner-cm` | ณัฐพร ส. (Nattaporn S.) | `owner.cm@fixture.example.test` | `owner` / owned cases |
| `fx-spoc-cm` | `fixture:fx-spoc-cm` | Suchada P. | `spoc.cm@fixture.example.test` | `bu_spoc` / `BU-CM` |
| `fx-coe` | `fixture:fx-coe` | Kritsada T. | `coe@fixture.example.test` | `ai_coe` / all cases |
| `fx-dpo` | `fixture:fx-dpo` | Pimchanok R. | `dpo@fixture.example.test` | `dpo` / all cases |
| `fx-sec` | `fixture:fx-sec` | Wutthichai K. | `sec@fixture.example.test` | `it_security` / all cases |
| `fx-admin` | `fixture:fx-admin` | Desk Admin (fixture) | `admin@fixture.example.test` | `admin` / all cases |
| `fx-dual-coe-spoc-rp` | `fixture:fx-dual-coe-spoc-rp` | Rattanaporn C. | `dual.coe-spoc.rp@fixture.example.test` | `ai_coe` / all cases **and** `bu_spoc` / `BU-RP` |

The owner's display name carries Thai script on purpose so that the sign-in screen, the queue and the audit trail prove Thai rendering (D12) from the first fixture. The dual-role identity's lane is AI/COE: on a BU-RP case it may read everything, may create, edit and submit as SPOC, and must be refused approve of the AI/COE lane on that case (D05; W2-02 negative), while still being allowed to approve the AI/COE lane on a BU-CM case. Whether send-back is also withheld from a dual-role reviewer is not part of D05 as recorded; see section 14.

Rules:

- The table is a TypeScript constant in `rai-web/fixtures/identity/users.ts` (proposed path), exported read-only, with a unit test asserting exactly seven entries, unique ids, unique emails, and that only `fx-dual-coe-spoc-rp` has more than one pair. Adding, removing or re-roling a fixture user is a change to this spec, in its own PR, never a fixture tweak inside a feature ticket.
- The fixture verifier is mounted only in `fixture` mode (section 4.4, S13, S14). `rai-web/server/src/main.ts` imports `identity/fixture.ts` behind the mode switch, and a test asserts that a `production` or `network` configuration cannot reach the fixture routes (404) and that `fixture` mode outside `NODE_ENV=test` exits 78.
- The fixture sign-in has no password or secret: it is loopback-only and test-only by construction, and its presence in a deployed configuration is a defect, not a hardening question.
- The Playwright journeys (W1-INT, W2-INT, W3-INT) sign in through `POST /auth/fixture/sign-in` against the real server; substitute runs with W1-13 are never acceptance evidence, but the fixture identity provider inside the real server is the intended evidence path for every automated A01 test. The Google path is proved by hand once, at W1-08.
- The demo role switcher (`demo/`) is not this provider and is not ported ([design-to-build map](../delivery/design-to-build-map.md)).

## 8. Secrets and custody

Secrets are: the OIDC client secret (every provider mode), the allow-list document (`network` / `allow-list`), and, outside this spec but through the same mechanism, the mail credentials (W0-07) and the store credentials (W0-04, `DATABASE_URL` when it embeds a password). The rule from the W0 contract: networked or production secrets live in a custody mechanism approved under D10, never in configuration files; the adapter refuses to start in `network` or `production` mode if any is absent.

```ts
// rai-web/server/src/secrets/index.ts  (proposed path; shared with W0-04 and W0-07)
export interface SecretSource {
  /** Undefined when absent. Empty, whitespace-only and the placeholder literal 'set-in-custody' count as absent. */
  get(name: string): Promise<string | undefined>;
  /** For the start-up log: where secrets come from, never what they are. */
  describe(): 'env' | 'file';
}
```

Two implementations, chosen by `RAI_SECRET_SOURCE` (default `env`):

- `env`: `process.env`, populated by the host's secret manager at process start. This is the slice-1 mechanism on a developer machine (shell export or an untracked `.env.local` that `.gitignore` excludes; W1-00 writes the ignore rule and the sample file with placeholders only).
- `file`: one file per secret under `RAI_SECRET_DIR` (default `/run/secrets`), the Docker and Kubernetes secret-mount convention, read once at start and never re-read. D10 decides which mechanism the True host uses and may add a third implementation behind the same interface; nothing else in the server changes.

Rules: no secret is logged, echoed in an error, written to the audit store, returned by any route or included in the readiness body; `describe()` is the only thing the start-up log prints. The sample env file (W1-00) carries `set-in-custody` for every secret and the S15 rule turns a forgotten placeholder into a refusal rather than a silently empty secret. The local Google OAuth client for W1-08 is a developer's own test client, held locally and never committed; W1-08 records "Google sign-in on loopback: pass" without the account address.

## 9. Configuration shape

### 9.1 Environment variables owned by this spec

W0-02's environment list carries these names with the placeholders below; W1-00 creates the sample file. Non-identity variables (`RAI_BIND_HOST`, `RAI_PORT`, `RAI_PUBLIC_BASE_URL`, `NODE_ENV`, `DATABASE_URL`) are named here only so the rules in section 5 are readable; W0-02 owns their final names.

| Variable | Modes | Secret | Sample placeholder | Rule |
|---|---|---|---|---|
| `RAI_IDENTITY_MODE` | all | no | `fixture` | one of `local-google`, `network`, `production`, `fixture`; no default (S1) |
| `RAI_IDENTITY_GOOGLE_CLIENT_ID` | `local-google` | no | `set-locally` | required in `local-google` (S4); forbidden in `production` and `network`/`ad` (S10) |
| `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` | `local-google` | yes (local only) | `set-in-custody` | as above |
| `RAI_IDENTITY_LOCAL_ROLE_MAP` | `local-google` | no (untracked file path) | empty | optional path to an allow-list-format JSON; absent means every account is `owner` (4.1) |
| `RAI_IDENTITY_NETWORK_SOURCE` | `network` | no | `allow-list` | `allow-list` or `ad` (S6) |
| `RAI_IDENTITY_OIDC_ISSUER_URL` | `network`/`allow-list` | no | `https://issuer.example.test` | required (S7); ignored elsewhere |
| `RAI_IDENTITY_OIDC_CLIENT_ID` | `network`, `production` | no | `set-in-custody` | required (S7, S9) |
| `RAI_IDENTITY_OIDC_CLIENT_SECRET` | `network`, `production` | yes | `set-in-custody` | required (S7, S9) |
| `RAI_IDENTITY_ALLOW_LIST_JSON` | `network`/`allow-list` | yes | `set-in-custody` | required (S7); validated (S8) |
| `RAI_IDENTITY_ENTRA_TENANT_ID` | `network`/`ad`, `production` | no | `00000000-0000-0000-0000-000000000000` | required (S9); fixes the issuer (S11) |
| `RAI_SECRET_SOURCE` | all | no | `env` | `env` or `file` |
| `RAI_SECRET_DIR` | `file` source | no | `/run/secrets` | directory of one-file-per-secret |
| `RAI_SESSION_ABSOLUTE_HOURS` | all | no | `12` | 1-24 |
| `RAI_SESSION_IDLE_MINUTES` | all | no | `120` | 5-720 |

### 9.2 AD group-to-role mapping (shape only; values are W6 and W8, A10)

The mapping is an Admin-editable configuration revision under L12, stored in the W1-00 configuration revision store and versioned and audited like every other revision (W0-04). W0 fixes the shape; W6 builds the Admin screen and the activation rule; W8 supplies the tenant's group object IDs under D10. Nothing in this repository ever contains a real group ID.

```ts
export interface GroupRoleMapping {
  kind: 'identity.group_role_mapping';
  version: 1;
  tenantId: string;                     // must equal RAI_IDENTITY_ENTRA_TENANT_ID or start-up refuses (S11 family)
  rules: Array<
    | { groupObjectId: string; role: 'owner' }                                       // scope: owned cases (subject filled at sign-in)
    | { groupObjectId: string; role: 'bu_spoc'; businessUnit: BusinessUnitId }       // one group per BU
    | { groupObjectId: string; role: 'ai_coe' | 'dpo' | 'it_security' | 'admin' }   // scope: all cases
  >;
}
```

Resolution: for each `groups` entry in the token, every matching rule contributes its pair; duplicates collapse; no match means `forbidden`. A user in both a reviewer group and a BU SPOC group is the production form of the dual-role fixture and is handled by D05 at decision time, not by the mapping. `businessUnit` must be in the configured BU value list (D11-style list, W6) or the revision fails validation when published. The mapping is never a per-request lookup against AD: slice-1 shape reads the token's groups only.

## 10. Observability and audit hooks

- **Readiness** (W0-10, W3-07): `identity: { mode, ready, reason? }`. `ready` is true only after `start()` succeeded; the reason codes are the section 5 table.
- **Start-up log line**: mode, bind host and port, public base URL, `secrets.describe()`, session TTLs. Never a client ID, secret, allow-list entry or role map content.
- **Request log**: `subjectRef` = first 12 hex characters of `sha256(subjectId)` and the session id; never the email or display name (personal data) and never a token. The correlation ID is the request's, shared with the audit event.
- **Audit events** (through the W0-04 append-only audit store, in the same transaction as the session write): `identity.signed_in` (subjectId, identityMode, roles summary as `role:scopeKind[:bu]`, sessionId, correlationId), `identity.sign_in_refused` (identityMode, reason code, issuer key, sha256 of the provider subject; never the email), `identity.signed_out` (subjectId, sessionId). W0-04 lists these names in its event catalogue.

## 11. Tests and which ticket runs them

| ID | Test | Layer | Ticket |
|---|---|---|---|
| ID-01 | Every row S1-S15 of section 5 as a table-driven case over `parseIdentityConfig` | unit, `node:test` | W1-01 |
| ID-02 | S16: a server started in `local-google` or `fixture` on `0.0.0.0` closes and exits 78 | integration (real listen) | W1-01; re-run by hand at W1-08 |
| ID-03 | Each of the seven fixture users resolves to exactly the pairs in section 7; the dual-role identity keeps both | unit | W1-01 |
| ID-04 | Fixture table invariants: seven entries, unique ids and emails, only one multi-pair user | unit | W1-00 |
| ID-05 | `resolvePrincipal` refuses an empty pair list with `forbidden` and writes no session | unit | W1-01 |
| ID-06 | Allow-list resolver: listed email resolves, unlisted is `forbidden`, matching is case-insensitive and exact, schema rejection is S8; fixtures use `@fixture.example.test` only | unit | W1-01 |
| ID-07 | Group mapping resolver with synthetic group IDs: mapped groups produce pairs, unmatched produce `forbidden`, overage indicator produces `forbidden`, `tenantId` mismatch refuses | unit | W1-01 (logic), W8 (live) |
| ID-08 | No cookie → 401; wrong role on a route → 403 from the W0-05 middleware, not from the adapter | integration (Fastify inject, Postgres) | W1-01 |
| ID-09 | Session: absolute expiry, idle expiry, sign-out revokes, replaced on re-sign-in, `lastSeenAt` throttled | integration (Postgres) | W1-01 |
| ID-10 | Fixture routes are 404 in every non-fixture mode; `fixture` outside `NODE_ENV=test` exits 78 | integration | W1-01 |
| ID-11 | Callback error branches (state, nonce, transaction cookie missing, email not verified) return 401 with `auth.sign_in_failed` and no session; uses a synthetic claims object, not Google | unit | W1-01 |
| ID-12 | Sign-in through the fixture provider lands each user on that user's scoped list; an out-of-scope case is absent; no client-side check decides access | browser, Playwright | W1-07 (on W1-13), W1-INT (real server) |
| ID-13 | The dual-role identity is refused approve of the AI/COE lane on a BU-RP case and permitted approve on a BU-CM case (D05) | integration | W2-02, W2-08 |
| ID-14 | Manual: Google sign-in on a loopback bind with a locally held OAuth client, recorded as "Google sign-in on loopback: pass" without the account address; unknown-mode and non-loopback refusals recorded with exit code | manual, outside CI | W1-08 |
| ID-15 | No email, token, secret or allow-list content appears in any log line or audit row for a sign-in, a refusal and a start-up refusal | integration | W3-07 |
| ID-16 | `network` mode start-up against a stub OIDC discovery document (allow-list source) and the A01 network clause | integration | W7-00, only if the rehearsal is networked |
| ID-17 | `production` start-up refuses Google variables, a non-Entra issuer and a missing mapping; accepts configured True AD roles | live | W8 |

No test calls Google, Entra or any network host. `openid-client` is exercised against synthetic discovery documents and claims objects in W1-01; the live provider paths are ID-14 (manual), ID-16 and ID-17.

## 12. Locale keys (D12)

Every user-facing string the adapter or the sign-in screen shows carries a key; Thai is the default rendering, English the second. Values below are the initial text for the W1-00 locale files; Lane B may improve wording in its own tickets without changing keys.

| Key | th | en |
|---|---|---|
| `auth.sign_in` | เข้าสู่ระบบ | Sign in |
| `auth.sign_in_with_google` | เข้าสู่ระบบด้วย Google (เฉพาะเครื่องนี้) | Sign in with Google (this machine only) |
| `auth.sign_in_with_true_ad` | เข้าสู่ระบบด้วยบัญชี True | Sign in with your True account |
| `auth.sign_out` | ออกจากระบบ | Sign out |
| `auth.session_required` | กรุณาเข้าสู่ระบบก่อนใช้งาน | Please sign in to continue |
| `auth.session_expired` | เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง | Your session has expired; please sign in again |
| `auth.sign_in_failed` | เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง | Sign-in did not complete; please try again |
| `auth.not_permitted` | บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบตรวจสอบ | This account is not permitted to use the review desk |
| `auth.fixture_user_select` | เลือกผู้ใช้ทดสอบ (สภาพแวดล้อมทดสอบเท่านั้น) | Choose a fixture user (test environment only) |
| `auth.fixture_user_unknown` | ไม่พบผู้ใช้ทดสอบที่ระบุ | Unknown fixture user |
| `auth.signed_in_as` | เข้าสู่ระบบในชื่อ {displayName} | Signed in as {displayName} |
| `role.owner` | เจ้าของยูสเคส | Use-case owner |
| `role.bu_spoc` | ผู้ประสานงาน BU | BU SPOC |
| `role.ai_coe` | AI/COE | AI/COE |
| `role.dpo` | DPO | DPO |
| `role.it_security` | IT/Security | IT/Security |
| `role.admin` | ผู้ดูแลระบบ | Admin |

## 13. Consumers and cross-links

| Consumer | Uses | Where |
|---|---|---|
| W0-02 file-level plan | Section 9 variable names in its env list; section 6 routes in "W1 interface shapes" (sign-in); section 11 rows in the test-layer map; paths in `rai-web/server/src/identity/` and `rai-web/fixtures/identity/` | [W0-02](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan) |
| W0-04 persistence | `sessions` table (6.3), subject profile row (2.2), audit event names (10), `SecretSource` for store credentials (8) | [W0-04](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec) |
| W0-05 authorization matrix | `Principal` and `RoleScope` as the input to every row; `owned_cases` and `business_unit` resolution (2.1); the dual-role fixture for the D05 no-self-approval row | [W0-05](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix) |
| W0-06 workflow and errors | `unauthenticated`, `forbidden`, `invalid_input`, `not_found` codes as used in 6.4 (codes from ADR-0003) | [W0-06](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract) |
| W0-07 mail sink | `SecretSource` for mail credentials; `Principal.email` as the recipient address source under case-view scope | [W0-07](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink) |
| W0-08 fixtures | The fixture BUs and users that W1-09's synthetic cases reference | [W0-08](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures) |
| W0-10 observability | Readiness shape, reason codes, redaction rule (10) | [W0-10](../delivery/w0-technical-contract.md#w0-10--observability-contract-for-the-desk-runtime) |
| W1-00 | Fixture user table, locale keys, `.gitignore` and sample env placeholders | [work breakdown](../delivery/slice-1-work-breakdown.md#w1--scoped-case-and-versioned-pack) |
| W1-01 | Everything in sections 4.1, 4.4, 5, 6 and tests ID-01 to ID-11 | same |
| W1-07, W1-13 | Sign-in screen and the substitute's sign-in shape | same |
| W1-08 | ID-02 and ID-14 by hand | same |
| W2-02 | ID-13 | same |
| W3-07 | ID-15, readiness | same |
| W6 | Group-mapping Admin screen (9.2), session revocation on mapping change | [later packages](../delivery/later-packages-outline.md) |
| W7-00 | `network` mode if the rehearsal is networked; closed-environment confirmation (3) | same |
| W8 / ADR-0004 | `production` mode, tenant, group IDs, custody mechanism (D10) | [ADR index](../../adr/README.md) |

Architecture boundary: "Identity adapter" row of the [boundary table](../architecture/README.md); path column filled by W0-02.

## 14. Open items (not decided here)

- [ ] AD group-to-role mapping values, Entra tenant, app registration and whether an overage fallback via Microsoft Graph is added — W6 (screen) and W8 (values) at D10; ADR-0004.
- [ ] Custody mechanism on the True host (`env` from the host secret manager, `file` mount, or a third `SecretSource`) — D10, ADR-0004/0007.
- [ ] Whether the W7 rehearsal is networked; if so which `network` source and, for `allow-list`, which non-True issuer — W7 entry.
- [ ] The `local-google` default-to-`owner` rule for unmapped accounts (4.1) — lead confirms at this ticket's review.
- [ ] Whether a dual-role reviewer (also owner or BU SPOC on the case) is withheld send-back as well as approve. D05 as recorded withholds approve only; extending it to send-back is a W0-05 refinement under D05's "review leads may refine" clause, recorded there if adopted, not in this spec.
- [ ] Any drift between this spec's route and variable names and the W0-02 sections that mirror them — W0-09 exit review.

## 15. Stop-condition check

- **No unrestricted network login.** `local-google` cannot listen off loopback (S2, S3, S5, S16); `network` admits only allow-listed or AD-mapped accounts and refuses to start without the custody-held secrets (S6-S9); `production` is Entra only with Google variables treated as misconfiguration (S10, S11); `fixture` is loopback and test-only (S13, S14). There is no default mode and no default role outside `local-google`. Passed.
- **No external-register writes.** The adapter has no client for TPM, VRO or the AI Reporting Tool; the only outbound calls are OIDC discovery and the code exchange with the configured issuer. Passed.
- **AI never approves.** The adapter has no model, no QC and no workflow write path; its output is a `Principal` that the W0-05 policy checks. Passed.
