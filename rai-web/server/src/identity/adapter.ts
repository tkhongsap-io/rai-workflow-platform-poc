// W0-03 sections 2-5: the identity adapter factory. Mode chosen by configuration (no default); every mode's
// start-up rules live here so a later ticket cannot loosen them unnoticed (S1-S18). The two seams (`discovery`,
// `groupMappingSource`) exist so S11, S12 and S18 are unit-tested with no network and no Postgres (ID-18, ID-19);
// main.ts passes openid-client's discovery and the W1-00 configuration-revision reader.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IdentityMode, Principal, RoleScope } from '@rai/shared/schemas/auth';
import { createSecretSource, type SecretSource } from '../secrets/index.js';
import { createAllowListResolver, parseAllowList, type AllowListResolver } from './allow-list.js';
import {
  entraIssuerUrl,
  isLoopbackHost,
  parseIdentityConfig,
  type IdentityConfig,
  type IdentityEnv,
} from './config.js';
import {
  createFixtureIdentityProvider,
  type FixtureIdentity,
  type FixtureIdentityProvider,
} from './fixture.js';
import { createGroupMappingResolver, isGroupRoleMapping, type GroupRoleMapping } from './group-mapping.js';
import { GOOGLE_ISSUER, createOidcVerifier, isValidDiscoveryDocument, type Exchange } from './oidc.js';
import {
  IdentityStartupError,
  SignInRefused,
  type BindTarget,
  type DiscoveryDocument,
  type IdentityAdapter,
  type IdentityHealth,
  type LoginVerifier,
  type RoleResolver,
  type SignInReasonCode,
  type StartupReasonCode,
  type VerifiedLogin,
} from './types.js';

export type Discovery = (
  issuerUrl: URL,
  clientId: string,
  clientSecret: string,
) => Promise<DiscoveryDocument>;
/** null = no published `identity.group_role_mapping` revision (S12). The body is validated here, never trusted. */
export type GroupMappingSource = () => Promise<unknown>; // resolves to null when no revision is published

export interface CreateIdentityAdapterInput {
  env: IdentityEnv; // the RAI_IDENTITY_* / RAI_SECRET_* / RAI_SESSION_* slice from config.ts
  nodeEnv: string;
  discovery: Discovery;
  groupMappingSource: GroupMappingSource;
  /** The eight fixture users, injected by the composition root only in fixture mode (server never imports fixtures statically). */
  fixtureUsers?: readonly FixtureIdentity[];
  secretSource?: SecretSource; // defaults to the one RAI_SECRET_SOURCE names
  readLocalRoleMap?: (path: string) => Promise<string>; // local-google 4.1; defaults to fs
  exchange?: Exchange; // ID-11 seam; defaults to openid-client's code grant
  now?: () => Date;
}

/** Secrets the custody mechanism may hold (section 8); the `file` source overlays these names before the parse. */
const CUSTODY_NAMES = [
  'RAI_IDENTITY_GOOGLE_CLIENT_ID',
  'RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
  'RAI_IDENTITY_OIDC_ISSUER_URL',
  'RAI_IDENTITY_OIDC_CLIENT_ID',
  'RAI_IDENTITY_OIDC_CLIENT_SECRET',
  'RAI_IDENTITY_ALLOW_LIST_JSON',
  'RAI_IDENTITY_ENTRA_TENANT_ID',
] as const;

export function subjectIdFor(config: IdentityConfig, login: VerifiedLogin): string {
  switch (config.mode) {
    case 'local-google':
      return `google:${login.subject}`;
    case 'fixture':
      return `fixture:${login.subject}`;
    case 'production':
      return `entra:${config.tenantId}:${login.subject}`;
    case 'network':
      return config.source === 'ad'
        ? `entra:${config.tenantId}:${login.subject}`
        : `oidc:${createHash('sha256').update(login.issuer).digest('hex').slice(0, 12)}:${login.subject}`;
  }
}

/** Section 2.3 invariants 1, 2 and 4 over the resolver's pairs; the dual-role case keeps both pairs (invariant 5). */
export function principalFrom(
  subjectId: string,
  login: VerifiedLogin,
  pairs: readonly RoleScope[],
  noRoleReason: SignInReasonCode,
  displayNameOverride?: string,
): Principal {
  if (pairs.length === 0) throw new SignInRefused('forbidden', noRoleReason);
  const unique = new Map<string, RoleScope>();
  const singleRoles = new Set<string>();
  for (const pair of pairs) {
    unique.set(JSON.stringify(pair), structuredClone(pair));
  }
  for (const pair of unique.values()) {
    if (pair.role === 'bu_spoc') continue; // several BUs are legitimate
    if (singleRoles.has(pair.role)) throw new SignInRefused('forbidden', noRoleReason);
    singleRoles.add(pair.role);
  }
  const email = login.email.trim().toLowerCase();
  const raw = (displayNameOverride ?? login.displayName).trim();
  const displayName = (raw === '' ? (email.split('@')[0] ?? email) : raw).slice(0, 200);
  return { subjectId, displayName, email, roles: [...unique.values()] };
}

async function overlayCustody(env: IdentityEnv, source: SecretSource): Promise<IdentityEnv> {
  if (source.describe() === 'env') return env;
  const overlay: Record<string, string | undefined> = { ...env };
  for (const name of CUSTODY_NAMES) {
    const value = await source.get(name);
    if (value !== undefined) overlay[name] = value;
  }
  return overlay;
}

export function createIdentityAdapter(input: CreateIdentityAdapterInput): IdentityAdapter {
  const now = input.now ?? (() => new Date());
  const modeRaw = input.env.RAI_IDENTITY_MODE?.trim();
  const reportedMode: IdentityMode | 'unset' =
    modeRaw === 'fixture' || modeRaw === 'local-google' || modeRaw === 'network' || modeRaw === 'production'
      ? modeRaw
      : 'unset';
  let health: IdentityHealth = { mode: reportedMode, ready: false };
  let config: IdentityConfig | undefined;
  let verifier: LoginVerifier | undefined;
  let resolver: RoleResolver | undefined;
  let allowList: AllowListResolver | undefined;
  let fixtureProvider: FixtureIdentityProvider | undefined;
  let noRoleReason: SignInReasonCode = 'no_role';

  const refuse = (reason: StartupReasonCode): never => {
    health = { mode: reportedMode, ready: false, reason };
    throw new IdentityStartupError(reason);
  };

  async function discover(issuerUrl: URL, clientId: string, clientSecret: string) {
    let document: DiscoveryDocument;
    try {
      document = await input.discovery(issuerUrl, clientId, clientSecret);
    } catch {
      return refuse('discovery_failed'); // S18; the provider's error text is never logged
    }
    if (!isValidDiscoveryDocument(document)) return refuse('discovery_failed'); // S18
    return document;
  }

  async function startProviderMode(cfg: Exclude<IdentityConfig, { mode: 'fixture' }>): Promise<void> {
    const exchange = input.exchange;
    const verifierOptions = (
      provider: 'google' | 'generic' | 'entra',
      document: Awaited<ReturnType<typeof discover>>,
      clientId: string,
      clientSecret: string,
      scopes: string,
      prompt?: string,
    ): Parameters<typeof createOidcVerifier>[0] => ({
      provider,
      document,
      clientId,
      clientSecret,
      scopes,
      now,
      ...(prompt === undefined ? {} : { prompt }),
      ...(exchange === undefined ? {} : { exchange }),
    });

    if (cfg.mode === 'local-google') {
      const document = await discover(new URL(GOOGLE_ISSUER), cfg.google.clientId, cfg.google.clientSecret);
      verifier = createOidcVerifier(
        verifierOptions(
          'google',
          document,
          cfg.google.clientId,
          cfg.google.clientSecret,
          'openid email profile',
          'select_account',
        ),
      );
      if (cfg.localRoleMapPath !== undefined) {
        try {
          const text = await (input.readLocalRoleMap ?? ((p) => readFile(p, 'utf8')))(cfg.localRoleMapPath);
          allowList = createAllowListResolver(parseAllowList(text));
        } catch {
          return refuse('allow_list_invalid'); // an unreadable or invalid role map is a refusal, never "everyone is owner"
        }
      }
      const map = allowList;
      resolver = {
        resolve: async (login) => {
          if (map !== undefined && map.has(login.email)) return map.resolve(login);
          return [{ role: 'owner', scope: { kind: 'own_cases' } }]; // section 4.1: the least-privileged default, local-google only
        },
      };
      return;
    }
    if (cfg.mode === 'network' && cfg.source === 'allow-list') {
      const document = await discover(cfg.issuerUrl, cfg.oidc.clientId, cfg.oidc.clientSecret);
      verifier = createOidcVerifier(
        verifierOptions(
          'generic',
          document,
          cfg.oidc.clientId,
          cfg.oidc.clientSecret,
          'openid email profile',
        ),
      );
      allowList = createAllowListResolver(cfg.allowList);
      resolver = allowList;
      noRoleReason = 'not_allow_listed';
      return;
    }
    // network / ad and production: Entra only, Google off (S10 already refused in the parse)
    const expectedIssuer = entraIssuerUrl(cfg.tenantId);
    const document = await discover(new URL(expectedIssuer), cfg.oidc.clientId, cfg.oidc.clientSecret);
    if (document.issuer !== expectedIssuer) return refuse('issuer_not_entra'); // S11
    let mapping: GroupRoleMapping = {
      kind: 'identity.group_role_mapping',
      version: 1,
      tenantId: cfg.tenantId,
      rules: [],
    };
    const published = await input.groupMappingSource();
    if (published === null || published === undefined) {
      if (cfg.mode === 'production') return refuse('group_mapping_missing'); // S12
    } else if (!isGroupRoleMapping(published) || published.tenantId !== cfg.tenantId) {
      return refuse('group_mapping_missing'); // S12: a mapping for another tenant, or an invalid body, is no mapping
    } else {
      mapping = published;
    }
    verifier = createOidcVerifier(
      verifierOptions('entra', document, cfg.oidc.clientId, cfg.oidc.clientSecret, 'openid profile email'),
    );
    resolver = createGroupMappingResolver(mapping);
    noRoleReason = 'no_mapped_group';
  }

  return {
    get mode() {
      if (config === undefined) throw new IdentityStartupError('mode_unknown');
      return config.mode;
    },
    get verifier() {
      return verifier;
    },

    async start(bind: BindTarget) {
      let source: SecretSource;
      try {
        source = input.secretSource ?? createSecretSource(input.env);
      } catch {
        return refuse('mode_unknown'); // an unknown RAI_SECRET_SOURCE cannot yield any secret
      }
      const env = await overlayCustody(input.env, source);
      const parsed = parseIdentityConfig(env, bind, input.nodeEnv);
      if (!parsed.ok) return refuse(parsed.reason);
      config = parsed.config;
      if (config.mode === 'fixture') {
        if (input.fixtureUsers === undefined) return refuse('fixture_outside_test'); // no table, no fixture mode
        fixtureProvider = createFixtureIdentityProvider(input.fixtureUsers);
      } else {
        await startProviderMode(config);
      }
      health = { mode: config.mode, ready: true };
    },

    verifyBoundAddress(address) {
      if (config === undefined) return refuse('mode_unknown');
      if (config.mode !== 'local-google' && config.mode !== 'fixture') return;
      const host = address === null ? '' : typeof address === 'string' ? address : address.address;
      if (!isLoopbackHost(host)) return refuse('bind_not_loopback'); // S16
    },

    async resolvePrincipal(login: VerifiedLogin): Promise<Principal> {
      if (config === undefined) throw new IdentityStartupError('mode_unknown');
      if (config.mode === 'fixture') {
        const principal = fixtureProvider?.resolve(login.subject);
        if (principal === undefined) throw new SignInRefused('forbidden', 'no_role');
        return principal;
      }
      if (resolver === undefined) throw new IdentityStartupError('mode_unknown');
      const pairs = await resolver.resolve(login);
      return principalFrom(
        subjectIdFor(config, login),
        login,
        pairs,
        noRoleReason,
        allowList?.displayNameFor(login.email),
      );
    },

    health: () => ({ ...health }),

    sessionPolicy() {
      if (config === undefined) throw new IdentityStartupError('mode_unknown');
      return { ...config.session };
    },

    // W7-07: set only where an allow-list document was parsed (network/allow-list, local-google with a role map).
    configuredGrants: () => allowList?.grants() ?? [],
  };
}
