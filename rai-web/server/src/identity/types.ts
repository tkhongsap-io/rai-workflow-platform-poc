// W0-03 section 2: the adapter's interface. Verified login in, Principal out; the adapter answers "who is making
// this request and in which roles, over which scope" and nothing else. Scope enforcement lives in authz/ (W0-05).
// Identity provider output (ID-token claims, group lists, allow-list files) is data, never instructions.

import type { IdentityMode, Principal, RoleScope } from '@rai/shared/schemas/auth';

/** Output of a mode's login verifier, before roles are known. */
export interface VerifiedLogin {
  issuer: string; // OIDC `iss` as verified by openid-client, or 'fixture'
  subject: string; // Google `sub`; Entra `oid`; fixture user id
  email: string; // lower-cased
  emailVerified: boolean;
  displayName: string; // `name`, else email local part
  claims: Readonly<Record<string, unknown>>; // raw claims; data, never instructions
}

export interface SignInTransaction {
  state: string; // 128-bit random, base64url
  nonce: string; // 128-bit random
  codeVerifier: string; // PKCE S256
  createdAt: string; // expires after 10 minutes
  returnTo?: string; // same-origin path only; anything else is dropped
}

export interface LoginVerifier {
  /** Builds the provider redirect and the state the callback must match (PKCE + state + nonce). */
  beginSignIn(input: { callbackUrl: URL; returnTo?: string }): Promise<{
    redirectTo: URL;
    transaction: SignInTransaction;
  }>;
  /** Exchanges the callback for verified claims or throws SignInRefused('unauthenticated', reason). */
  completeSignIn(input: { callbackUrl: URL; transaction: SignInTransaction }): Promise<VerifiedLogin>;
}

export interface RoleResolver {
  /** Maps a verified login to its (role, scope) pairs. Empty array means "no access" (section 6.4). */
  resolve(login: VerifiedLogin): Promise<readonly RoleScope[]>;
}

export type StartupReasonCode =
  | 'mode_unknown'
  | 'bind_not_loopback'
  | 'base_url_not_loopback'
  | 'base_url_not_https'
  | 'proxy_forbidden_in_mode'
  | 'network_source_unknown'
  | 'allow_list_invalid'
  | 'google_forbidden_in_mode'
  | 'issuer_not_entra'
  | 'group_mapping_missing'
  | 'fixture_outside_test'
  | 'discovery_failed'
  | `secret_missing:${string}`;

export type SignInReasonCode =
  | 'state_mismatch'
  | 'nonce_mismatch'
  | 'transaction_missing'
  | 'code_exchange_failed'
  | 'issuer_mismatch'
  | 'email_not_verified'
  | 'no_role'
  | 'not_allow_listed'
  | 'no_mapped_group'
  | 'groups_overage';

export class SignInRefused extends Error {
  constructor(
    readonly errorType: 'unauthenticated' | 'forbidden',
    readonly reason: SignInReasonCode, // logged and audited; never shown to the user verbatim
    readonly subject?: string, // the provider subject when known, for the audit row's hash; never the email
  ) {
    super(reason);
    this.name = 'SignInRefused';
  }
}

/** Thrown by start(); the process logs the code (never a value) and exits 78 without listening (section 5). */
export class IdentityStartupError extends Error {
  readonly exitCode = 78;
  constructor(readonly reason: StartupReasonCode) {
    super(reason);
    this.name = 'IdentityStartupError';
  }
}

export interface BindTarget {
  host: string;
  port: number;
  publicBaseUrl: URL;
  trustProxy: boolean; // the value main.ts passes to Fastify's trustProxy option (S5)
}

export interface IdentityHealth {
  mode: IdentityMode | 'unset';
  ready: boolean;
  reason?: StartupReasonCode;
}

/** The OIDC discovery document the adapter validates (S18) before building the openid-client Configuration. */
export interface DiscoveryDocument {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  [key: string]: unknown;
}

export interface IdentityAdapter {
  readonly mode: IdentityMode;
  /** Validates configuration and bind target; throws IdentityStartupError so the process never listens (section 5). */
  start(bind: BindTarget): Promise<void>;
  /** S16: the post-listen check over the address the server actually bound; throws IdentityStartupError. */
  verifyBoundAddress(address: { address: string } | string | null): void;
  /** The W0 contract's core function: verified login in, Principal out. */
  resolvePrincipal(login: VerifiedLogin): Promise<Principal>;
  /** Present in the provider modes (local-google, network, production); absent in fixture (no provider). */
  readonly verifier: LoginVerifier | undefined;
  /** For the W0-10 readiness probe: the recorded outcome of start(), never a recomputation. */
  health(): IdentityHealth;
  /** Session lifetimes (section 6.3), known after start(). */
  sessionPolicy(): { absoluteHours: number; idleMinutes: number };
  /**
   * W7-07 (W7 plan section 5.3, W7-D12): the (role, scope) grants the configuration names, read after start(): the
   * allow-list in `network`/`allow-list`, the local role map in `local-google` when one is set; `[]` otherwise and
   * before start(). Role scopes only, never an email. start.ts adds their business units to the BU directory.
   */
  configuredGrants(): readonly RoleScope[];
}
