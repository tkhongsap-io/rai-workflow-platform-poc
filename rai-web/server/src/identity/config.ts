// W0-03 section 5: the pure part of the start-up validation. `parseIdentityConfig(env, bind)` decides every row a
// read of the environment and the bind target can decide (S1-S10, S13-S15, S17) and returns either the typed
// identity configuration or the first refusal reason. No I/O, no clock, no network: ID-01 drives this table with
// no Postgres and no process spawn. S11, S12, S16 and S18 need the discovered issuer, the revision store and the
// bound address; they run inside `start()` (adapter.ts) against injected seams.
//
// `env` is the RAI_IDENTITY_* / RAI_SECRET_* / RAI_SESSION_* slice config.ts hands over (W0-02 section 1.1: only
// config.ts reads process.env), with secrets from the `file` source already overlaid by start().

import { IDENTITY_MODES, type IdentityMode } from '@rai/shared/schemas/auth';
import { normaliseSecret } from '../secrets/index.js';
import { parseAllowList, type AllowList } from './allow-list.js';
import type { BindTarget, StartupReasonCode } from './types.js';

export type IdentityEnv = Readonly<Record<string, string | undefined>>;

export interface SessionPolicy {
  absoluteHours: number; // 1-24, default 12
  idleMinutes: number; // 5-720, default 120
}

export type IdentityConfig =
  | { mode: 'fixture'; session: SessionPolicy }
  | {
      mode: 'local-google';
      session: SessionPolicy;
      google: { clientId: string; clientSecret: string };
      localRoleMapPath: string | undefined; // RAI_IDENTITY_LOCAL_ROLE_MAP; absent means every account is owner (4.1)
    }
  | {
      mode: 'network';
      session: SessionPolicy;
      source: 'allow-list';
      issuerUrl: URL;
      oidc: { clientId: string; clientSecret: string };
      allowList: AllowList;
    }
  | {
      mode: 'network';
      session: SessionPolicy;
      source: 'ad';
      tenantId: string;
      oidc: { clientId: string; clientSecret: string };
    }
  | {
      mode: 'production';
      session: SessionPolicy;
      tenantId: string;
      oidc: { clientId: string; clientSecret: string };
    };

export type ParseResult = { ok: true; config: IdentityConfig } | { ok: false; reason: StartupReasonCode };

export const ENTRA_ISSUER_PREFIX = 'https://login.microsoftonline.com/';

/** The Entra issuer for a tenant (S11): the discovered `issuer` must equal this value exactly. */
export function entraIssuerUrl(tenantId: string): string {
  return `${ENTRA_ISSUER_PREFIX}${tenantId}/v2.0`;
}

/** Loopback per section 5: 127.0.0.1, ::1 or localhost, and nothing else. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

function refused(reason: StartupReasonCode): ParseResult {
  return { ok: false, reason };
}

/** Reads a secret-or-not variable with the S15 rule: empty, whitespace and placeholder literals are absent. */
function secret(env: IdentityEnv, name: string): string | undefined {
  return normaliseSecret(env[name]);
}

function intInRange(
  env: IdentityEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | undefined {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value < min || value > max ? undefined : value;
}

function sessionPolicy(env: IdentityEnv): SessionPolicy | undefined {
  const absoluteHours = intInRange(env, 'RAI_SESSION_ABSOLUTE_HOURS', 12, 1, 24);
  const idleMinutes = intInRange(env, 'RAI_SESSION_IDLE_MINUTES', 120, 5, 720);
  if (absoluteHours === undefined || idleMinutes === undefined) return undefined;
  return { absoluteHours, idleMinutes };
}

/** True when any RAI_IDENTITY_GOOGLE_* variable carries a value (S10); placeholders count as unset (S15). */
function anyGoogleVariableSet(env: IdentityEnv): boolean {
  return Object.keys(env).some(
    (name) => name.startsWith('RAI_IDENTITY_GOOGLE_') && secret(env, name) !== undefined,
  );
}

/** Pure: `Ok<IdentityConfig> | Refused<reasonCode>` over the environment slice and the bind target. */
export function parseIdentityConfig(
  env: IdentityEnv,
  bind: BindTarget,
  nodeEnv: string | undefined = env.NODE_ENV,
): ParseResult {
  const modeRaw = env.RAI_IDENTITY_MODE?.trim();
  if (modeRaw === undefined || modeRaw === '' || !(IDENTITY_MODES as readonly string[]).includes(modeRaw)) {
    return refused('mode_unknown'); // S1: missing and unknown are not distinguished
  }
  const mode = modeRaw as IdentityMode;
  const session = sessionPolicy(env);
  if (session === undefined) return refused('secret_missing:RAI_SESSION_ABSOLUTE_HOURS'); // out-of-range lifetime
  const bindLoopback = isLoopbackHost(bind.host);
  const baseLoopback = isLoopbackHost(bind.publicBaseUrl.hostname);

  switch (mode) {
    case 'fixture': {
      if (nodeEnv !== 'test') return refused('fixture_outside_test'); // S13
      if (!bindLoopback || !baseLoopback) return refused('bind_not_loopback'); // S14
      return { ok: true, config: { mode, session } };
    }
    case 'local-google': {
      if (!bindLoopback) return refused('bind_not_loopback'); // S2
      if (!baseLoopback) return refused('base_url_not_loopback'); // S3
      const clientId = secret(env, 'RAI_IDENTITY_GOOGLE_CLIENT_ID');
      if (clientId === undefined) return refused('secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID'); // S4, S15
      const clientSecret = secret(env, 'RAI_IDENTITY_GOOGLE_CLIENT_SECRET');
      if (clientSecret === undefined) return refused('secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET'); // S4, S15
      if (bind.trustProxy) return refused('proxy_forbidden_in_mode'); // S5
      const localRoleMapPath = env.RAI_IDENTITY_LOCAL_ROLE_MAP?.trim();
      return {
        ok: true,
        config: {
          mode,
          session,
          google: { clientId, clientSecret },
          localRoleMapPath:
            localRoleMapPath === undefined || localRoleMapPath === '' ? undefined : localRoleMapPath,
        },
      };
    }
    case 'network': {
      const source = env.RAI_IDENTITY_NETWORK_SOURCE?.trim();
      if (source !== 'allow-list' && source !== 'ad') return refused('network_source_unknown'); // S6
      const clientId = secret(env, 'RAI_IDENTITY_OIDC_CLIENT_ID');
      const clientSecret = secret(env, 'RAI_IDENTITY_OIDC_CLIENT_SECRET');
      if (source === 'allow-list') {
        const issuerRaw = secret(env, 'RAI_IDENTITY_OIDC_ISSUER_URL');
        if (issuerRaw === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_ISSUER_URL'); // S7
        if (clientId === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID'); // S7
        if (clientSecret === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET'); // S7
        const allowListJson = secret(env, 'RAI_IDENTITY_ALLOW_LIST_JSON');
        if (allowListJson === undefined) return refused('secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON'); // S7
        let issuerUrl: URL;
        try {
          issuerUrl = new URL(issuerRaw);
        } catch {
          return refused('discovery_failed'); // an unparseable issuer cannot be discovered
        }
        let allowList: AllowList;
        try {
          allowList = parseAllowList(allowListJson);
        } catch {
          return refused('allow_list_invalid'); // S8
        }
        return {
          ok: true,
          config: { mode, session, source, issuerUrl, oidc: { clientId, clientSecret }, allowList },
        };
      }
      // source === 'ad': Entra, Google off (S9, S10)
      const tenantId = secret(env, 'RAI_IDENTITY_ENTRA_TENANT_ID');
      if (tenantId === undefined) return refused('secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID'); // S9
      if (clientId === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID'); // S9
      if (clientSecret === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET'); // S9
      if (anyGoogleVariableSet(env)) return refused('google_forbidden_in_mode'); // S10
      return { ok: true, config: { mode, session, source, tenantId, oidc: { clientId, clientSecret } } };
    }
    case 'production': {
      if (bind.publicBaseUrl.protocol !== 'https:') return refused('base_url_not_https'); // S17
      if (anyGoogleVariableSet(env)) return refused('google_forbidden_in_mode'); // S10
      const tenantId = secret(env, 'RAI_IDENTITY_ENTRA_TENANT_ID');
      if (tenantId === undefined) return refused('secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID'); // S9
      const clientId = secret(env, 'RAI_IDENTITY_OIDC_CLIENT_ID');
      if (clientId === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID'); // S9
      const clientSecret = secret(env, 'RAI_IDENTITY_OIDC_CLIENT_SECRET');
      if (clientSecret === undefined) return refused('secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET'); // S9
      return { ok: true, config: { mode, session, tenantId, oidc: { clientId, clientSecret } } };
    }
  }
}
