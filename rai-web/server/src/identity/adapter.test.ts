// ID-18 (S18, S11), ID-19 (S12), ID-05, ID-06, ID-07 and the local-google default-to-owner rule (W0-03 sections 4.1,
// 5 and 11): the adapter's start() and resolvePrincipal() with an injected discovery and mapping reader, no
// network, no Postgres. Every refusal asserts the reason code and health().ready = false.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityAdapter, principalFrom, subjectIdFor, type Discovery } from './adapter.js';
import { entraIssuerUrl } from './config.js';
import { GOOGLE_ISSUER } from './oidc.js';
import { IdentityStartupError, SignInRefused, type BindTarget, type VerifiedLogin } from './types.js';

const loopback: BindTarget = {
  host: '127.0.0.1',
  port: 8787,
  publicBaseUrl: new URL('http://127.0.0.1:8787'),
  trustProxy: false,
};
const networked: BindTarget = {
  host: '0.0.0.0',
  port: 8787,
  publicBaseUrl: new URL('https://desk.example.test'),
  trustProxy: false,
};
const tenant = '00000000-0000-0000-0000-000000000001';
const production = {
  RAI_IDENTITY_MODE: 'production',
  RAI_IDENTITY_ENTRA_TENANT_ID: tenant,
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
};
const networkAd = { ...production, RAI_IDENTITY_MODE: 'network', RAI_IDENTITY_NETWORK_SOURCE: 'ad' };
const google = {
  RAI_IDENTITY_MODE: 'local-google',
  RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
  RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
};
const allowListJson = JSON.stringify({
  version: 1,
  entries: [
    {
      email: 'DPO@rai-desk.example',
      roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }],
      displayNameOverride: 'Listed DPO',
    },
  ],
});
const networkAllowList = {
  RAI_IDENTITY_MODE: 'network',
  RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
  RAI_IDENTITY_OIDC_ISSUER_URL: 'https://issuer.example.test',
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
  RAI_IDENTITY_ALLOW_LIST_JSON: allowListJson,
};

const validDocument = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
});
const discoverOk: Discovery = (url) => Promise.resolve(validDocument(url.toString().replace(/\/$/, '')));
const noMapping = () => Promise.resolve(null);
const mapping = (tenantId: string) =>
  Promise.resolve({
    kind: 'identity.group_role_mapping',
    version: 1,
    tenantId,
    rules: [
      { groupObjectId: 'grp-synthetic-dpo', role: 'dpo' },
      { groupObjectId: 'grp-synthetic-spoc-cm', role: 'bu_spoc', businessUnit: 'CM' },
      { groupObjectId: 'grp-synthetic-owner', role: 'owner' },
    ],
  });

async function refusal(
  input: Parameters<typeof createIdentityAdapter>[0],
  bind: BindTarget,
): Promise<{ reason: string; health: ReturnType<ReturnType<typeof createIdentityAdapter>['health']> }> {
  const adapter = createIdentityAdapter(input);
  try {
    await adapter.start(bind);
  } catch (err) {
    assert.ok(err instanceof IdentityStartupError, 'start() throws IdentityStartupError');
    assert.equal(err.exitCode, 78);
    return { reason: err.reason, health: adapter.health() };
  }
  throw new Error('expected start() to refuse');
}

const login = (over: Partial<VerifiedLogin> = {}): VerifiedLogin => ({
  issuer: GOOGLE_ISSUER,
  subject: '1234567890',
  email: 'someone@example.test',
  emailVerified: true,
  displayName: 'Someone',
  claims: {},
  ...over,
});

for (const mode of [
  { name: 'local-google', env: google, bind: loopback },
  { name: 'network/allow-list', env: networkAllowList, bind: networked },
  { name: 'network/ad', env: networkAd, bind: networked },
  { name: 'production', env: production, bind: networked },
]) {
  test(`ID-18 S18 ${mode.name}: discovery that throws refuses with discovery_failed and never listens`, async () => {
    const { reason, health } = await refusal(
      {
        env: mode.env,
        nodeEnv: 'production',
        discovery: () => Promise.reject(new Error('ENOTFOUND')),
        groupMappingSource: () => mapping(tenant),
      },
      mode.bind,
    );
    assert.equal(reason, 'discovery_failed');
    assert.deepEqual(health, { mode: mode.name.split('/')[0], ready: false, reason: 'discovery_failed' });
  });

  test(`ID-18 S18 ${mode.name}: a document without issuer or authorization_endpoint refuses with discovery_failed`, async () => {
    for (const doc of [
      { authorization_endpoint: 'https://x/authorize' },
      { issuer: 'https://x' },
      {},
      null,
    ]) {
      const { reason } = await refusal(
        {
          env: mode.env,
          nodeEnv: 'production',
          discovery: () => Promise.resolve(doc as never),
          groupMappingSource: () => mapping(tenant),
        },
        mode.bind,
      );
      assert.equal(reason, 'discovery_failed');
    }
  });
}

for (const mode of [
  { name: 'production', env: production },
  { name: 'network/ad', env: networkAd },
]) {
  test(`ID-18 S11 ${mode.name}: a valid document whose issuer is not the tenant URL refuses with issuer_not_entra`, async () => {
    const { reason, health } = await refusal(
      {
        env: mode.env,
        nodeEnv: 'production',
        discovery: () =>
          Promise.resolve(validDocument('https://login.microsoftonline.com/other-tenant/v2.0')),
        groupMappingSource: () => mapping(tenant),
      },
      networked,
    );
    assert.equal(reason, 'issuer_not_entra');
    assert.equal(health.ready, false);
  });
}

test('ID-19 S12 production: no published group-to-role mapping refuses with group_mapping_missing', async () => {
  const { reason, health } = await refusal(
    { env: production, nodeEnv: 'production', discovery: discoverOk, groupMappingSource: noMapping },
    networked,
  );
  assert.equal(reason, 'group_mapping_missing');
  assert.deepEqual(health, { mode: 'production', ready: false, reason: 'group_mapping_missing' });
});

test('ID-19 S12 production: a mapping for another tenant, or an invalid body, is no mapping', async () => {
  for (const source of [() => mapping('other-tenant'), () => Promise.resolve({ kind: 'something_else' })]) {
    const { reason } = await refusal(
      { env: production, nodeEnv: 'production', discovery: discoverOk, groupMappingSource: source },
      networked,
    );
    assert.equal(reason, 'group_mapping_missing');
  }
});

test('ID-19 production with a valid mapping and the tenant issuer starts; health is ready with no reason', async () => {
  const adapter = createIdentityAdapter({
    env: production,
    nodeEnv: 'production',
    discovery: discoverOk,
    groupMappingSource: () => mapping(tenant),
  });
  await adapter.start(networked);
  assert.deepEqual(adapter.health(), { mode: 'production', ready: true });
  assert.equal(adapter.mode, 'production');
  assert.ok(adapter.verifier !== undefined, 'a provider mode has a verifier');
});

test('ID-07 group mapping resolver: mapped groups produce pairs, unmatched is forbidden, overage is forbidden', async () => {
  const adapter = createIdentityAdapter({
    env: production,
    nodeEnv: 'production',
    discovery: discoverOk,
    groupMappingSource: () => mapping(tenant),
  });
  await adapter.start(networked);
  const entra = (claims: Record<string, unknown>) =>
    login({
      issuer: entraIssuerUrl(tenant),
      subject: 'oid-synthetic-1',
      email: 'staff@example.test',
      claims,
    });

  const dual = await adapter.resolvePrincipal(
    entra({ groups: ['grp-synthetic-dpo', 'grp-synthetic-spoc-cm', 'grp-unknown'] }),
  );
  assert.equal(dual.subjectId, `entra:${tenant}:oid-synthetic-1`);
  assert.deepEqual(dual.roles, [
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
  ]);

  await assert.rejects(
    adapter.resolvePrincipal(entra({ groups: ['grp-unknown'] })),
    (err: unknown) =>
      err instanceof SignInRefused && err.errorType === 'forbidden' && err.reason === 'no_mapped_group',
  );
  await assert.rejects(
    adapter.resolvePrincipal(entra({ groups: [] })),
    (err: unknown) => err instanceof SignInRefused && err.reason === 'no_mapped_group',
  );
  await assert.rejects(
    adapter.resolvePrincipal(entra({ hasgroups: true })),
    (err: unknown) =>
      err instanceof SignInRefused && err.errorType === 'forbidden' && err.reason === 'groups_overage',
  );
  await assert.rejects(
    adapter.resolvePrincipal(entra({ _claim_names: { groups: 'src1' }, _claim_sources: {} })),
    (err: unknown) => err instanceof SignInRefused && err.reason === 'groups_overage',
  );
});

test('network/ad without a published mapping starts (S12 is a production row) and refuses every login', async () => {
  const adapter = createIdentityAdapter({
    env: networkAd,
    nodeEnv: 'test',
    discovery: discoverOk,
    groupMappingSource: noMapping,
  });
  await adapter.start(networked);
  assert.equal(adapter.health().ready, true);
  await assert.rejects(
    adapter.resolvePrincipal(
      login({ issuer: entraIssuerUrl(tenant), subject: 'oid-1', claims: { groups: ['any'] } }),
    ),
    (err: unknown) => err instanceof SignInRefused && err.errorType === 'forbidden',
  );
});

test('ID-06 allow-list resolver: listed email resolves (case-insensitive, exact), unlisted is forbidden with not_allow_listed', async () => {
  const adapter = createIdentityAdapter({
    env: networkAllowList,
    nodeEnv: 'test',
    discovery: discoverOk,
    groupMappingSource: noMapping,
  });
  await adapter.start(networked);
  const listed = await adapter.resolvePrincipal(
    login({ issuer: 'https://issuer.example.test', subject: 'sub-1', email: 'dpo@rai-desk.example' }),
  );
  assert.deepEqual(listed.roles, [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }]);
  assert.equal(listed.displayName, 'Listed DPO', 'displayNameOverride applies');
  assert.match(listed.subjectId, /^oidc:[0-9a-f]{12}:sub-1$/);
  for (const email of [
    'dpo2@rai-desk.example',
    'xdpo@rai-desk.example',
    'dpo@rai-desk.example.evil',
    'admin@rai-desk.example',
  ]) {
    await assert.rejects(
      adapter.resolvePrincipal(login({ issuer: 'https://issuer.example.test', subject: 'sub-2', email })),
      (err: unknown) =>
        err instanceof SignInRefused && err.errorType === 'forbidden' && err.reason === 'not_allow_listed',
      email,
    );
  }
});

test('local-google: an account absent from the role map receives exactly owner / own_cases; a mapped account its pairs', async () => {
  const roleMap = JSON.stringify({
    version: 1,
    entries: [{ email: 'admin.dev@example.test', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] }],
  });
  const adapter = createIdentityAdapter({
    env: { ...google, RAI_IDENTITY_LOCAL_ROLE_MAP: '/untracked/role-map.json' },
    nodeEnv: 'development',
    discovery: discoverOk,
    groupMappingSource: noMapping,
    readLocalRoleMap: (path) =>
      path === '/untracked/role-map.json' ? Promise.resolve(roleMap) : Promise.reject(new Error('ENOENT')),
  });
  await adapter.start(loopback);
  assert.equal(adapter.mode, 'local-google');
  const unmapped = await adapter.resolvePrincipal(
    login({ subject: '1234567890', email: 'Anyone@Example.Test' }),
  );
  assert.deepEqual(unmapped, {
    subjectId: 'google:1234567890',
    displayName: 'Someone',
    email: 'anyone@example.test',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
  });
  const mapped = await adapter.resolvePrincipal(login({ subject: '42', email: 'admin.dev@example.test' }));
  assert.deepEqual(mapped.roles, [{ role: 'admin', scope: { kind: 'all_cases' } }]);
});

test('local-google: an unreadable or invalid role map refuses to start (allow_list_invalid), never "everyone is owner"', async () => {
  for (const read of [() => Promise.reject(new Error('ENOENT')), () => Promise.resolve('{"version":3}')]) {
    const { reason } = await refusal(
      {
        env: { ...google, RAI_IDENTITY_LOCAL_ROLE_MAP: '/x.json' },
        nodeEnv: 'development',
        discovery: discoverOk,
        groupMappingSource: noMapping,
        readLocalRoleMap: read,
      },
      loopback,
    );
    assert.equal(reason, 'allow_list_invalid');
  }
});

test('local-google: no role map means every account is owner (section 4.1) and discovery targets accounts.google.com', async () => {
  const seen: string[] = [];
  const adapter = createIdentityAdapter({
    env: google,
    nodeEnv: 'development',
    discovery: (url, clientId) => {
      seen.push(url.toString(), clientId);
      return discoverOk(url, clientId, '');
    },
    groupMappingSource: noMapping,
  });
  await adapter.start(loopback);
  assert.deepEqual(seen, [`${GOOGLE_ISSUER}/`, google.RAI_IDENTITY_GOOGLE_CLIENT_ID]);
  const p = await adapter.resolvePrincipal(login({ email: 'dev@example.test' }));
  assert.deepEqual(p.roles, [{ role: 'owner', scope: { kind: 'own_cases' } }]);
});

test('ID-05 resolvePrincipal refuses an empty pair list with forbidden (no session is created because no Principal exists)', () => {
  assert.throws(
    () => principalFrom('google:1', login(), [], 'no_role'),
    (err: unknown) =>
      err instanceof SignInRefused && err.errorType === 'forbidden' && err.reason === 'no_role',
  );
});

test('section 2.3 invariants: duplicates collapse, several BU grants are kept, names are trimmed to 200', () => {
  const p = principalFrom(
    'google:1',
    login({ displayName: '  ' + 'x'.repeat(300) + '  ', email: 'A@B.example' }),
    [
      { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
      { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
      { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
      { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    ],
    'no_role',
  );
  assert.equal(p.roles.length, 3);
  assert.equal(p.displayName.length, 200);
  assert.equal(p.email, 'a@b.example');
  const collapsed = principalFrom(
    'google:1',
    login(),
    [
      { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
      { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
    ],
    'no_role',
  );
  assert.equal(collapsed.roles.length, 1, 'an exact duplicate collapses rather than refuses');
});

test('display name falls back to the email local part when the provider gives none', () => {
  const p = principalFrom(
    'google:1',
    login({ displayName: '', email: 'first.last@example.test' }),
    [{ role: 'owner', scope: { kind: 'own_cases' } }],
    'no_role',
  );
  assert.equal(p.displayName, 'first.last');
});

test('subject ids are issuer-qualified per mode and never the email (section 2.2)', () => {
  const session = { absoluteHours: 12, idleMinutes: 120 };
  assert.equal(
    subjectIdFor(
      {
        mode: 'local-google',
        session,
        google: { clientId: 'a', clientSecret: 'b' },
        localRoleMapPath: undefined,
      },
      login({ subject: 's' }),
    ),
    'google:s',
  );
  assert.equal(
    subjectIdFor({ mode: 'fixture', session }, login({ subject: 'fx-user-dpo' })),
    'fixture:fx-user-dpo',
  );
  assert.equal(
    subjectIdFor(
      { mode: 'production', session, tenantId: 't', oidc: { clientId: 'a', clientSecret: 'b' } },
      login({ subject: 'oid' }),
    ),
    'entra:t:oid',
  );
  const oidc = subjectIdFor(
    {
      mode: 'network',
      session,
      source: 'allow-list',
      issuerUrl: new URL('https://issuer.example.test'),
      oidc: { clientId: 'a', clientSecret: 'b' },
      allowList: { version: 1, entries: [] },
    },
    login({ issuer: 'https://issuer.example.test', subject: 'sub', email: 'someone@example.test' }),
  );
  assert.match(oidc, /^oidc:[0-9a-f]{12}:sub$/);
  assert.ok(!oidc.includes('@'));
});

test('fixture mode: resolvePrincipal maps a fixture user id to its pairs and refuses an unknown id; there is no verifier', async () => {
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: noMapping,
    fixtureUsers: [
      {
        fixtureUserId: 'fx-user-owner-cm',
        subjectId: 'fixture:fx-user-owner-cm',
        displayName: 'ณัฐพร ส. (Nattaporn S.)',
        email: 'owner.cm@rai-desk.example',
        roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
      },
    ],
  });
  await adapter.start(loopback);
  assert.equal(adapter.verifier, undefined);
  const p = await adapter.resolvePrincipal(login({ issuer: 'fixture', subject: 'fx-user-owner-cm' }));
  assert.equal(p.subjectId, 'fixture:fx-user-owner-cm');
  await assert.rejects(
    adapter.resolvePrincipal(login({ issuer: 'fixture', subject: 'fx-user-nobody' })),
    SignInRefused,
  );
});

test('fixture mode without a fixture table refuses (fixture_outside_test): the identities are injected, never bundled', async () => {
  const { reason } = await refusal(
    {
      env: { RAI_IDENTITY_MODE: 'fixture' },
      nodeEnv: 'test',
      discovery: discoverOk,
      groupMappingSource: noMapping,
    },
    loopback,
  );
  assert.equal(reason, 'fixture_outside_test');
});

test('S16 verifyBoundAddress: a non-loopback bound address refuses with bind_not_loopback in local-google and fixture only', async () => {
  const adapter = createIdentityAdapter({
    env: google,
    nodeEnv: 'development',
    discovery: discoverOk,
    groupMappingSource: noMapping,
  });
  await adapter.start(loopback);
  adapter.verifyBoundAddress({ address: '127.0.0.1' });
  adapter.verifyBoundAddress({ address: '::1' });
  assert.throws(
    () => adapter.verifyBoundAddress({ address: '10.0.0.5' }),
    (e: unknown) => e instanceof IdentityStartupError && e.reason === 'bind_not_loopback',
  );
  assert.throws(() => adapter.verifyBoundAddress('0.0.0.0'), /bind_not_loopback/);
  assert.throws(() => adapter.verifyBoundAddress(null), /bind_not_loopback/);
  assert.deepEqual(adapter.health(), { mode: 'local-google', ready: false, reason: 'bind_not_loopback' });

  const prod = createIdentityAdapter({
    env: production,
    nodeEnv: 'production',
    discovery: discoverOk,
    groupMappingSource: () => mapping(tenant),
  });
  await prod.start(networked);
  prod.verifyBoundAddress({ address: '10.0.0.5' }); // production may bind anywhere
  assert.equal(prod.health().ready, true);
});

test('the file secret source overlays custody-held secrets before the parse and never appears in the config object', async () => {
  const values: Record<string, string> = { RAI_IDENTITY_OIDC_CLIENT_SECRET: 'from-file' };
  const adapter = createIdentityAdapter({
    env: { ...production, RAI_IDENTITY_OIDC_CLIENT_SECRET: 'set-in-custody', RAI_SECRET_SOURCE: 'file' },
    nodeEnv: 'production',
    discovery: (_url, _id, secret) => {
      assert.equal(secret, 'from-file');
      return discoverOk(_url, _id, secret);
    },
    groupMappingSource: () => mapping(tenant),
    secretSource: { get: (name) => Promise.resolve(values[name]), describe: () => 'file' },
  });
  await adapter.start(networked);
  assert.equal(adapter.health().ready, true);
});

// W7-07 (W7 plan section 5.3, W7-D12 option A): the configured (role, scope) grants, never an email, so start.ts can
// add the allow-list's or role map's business units to the BU directory.
test('W7-07 configuredGrants: network/allow-list returns the allow-list grants in order, deduplicated, no email', async () => {
  const list = JSON.stringify({
    version: 1,
    entries: [
      {
        email: 'spoc.a@rai-desk.example',
        roles: [
          { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'RET' } },
          { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
        ],
      },
      {
        email: 'spoc.b@rai-desk.example',
        roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'RET' } }],
      },
      { email: 'dpo@rai-desk.example', roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }] },
    ],
  });
  const adapter = createIdentityAdapter({
    env: { ...networkAllowList, RAI_IDENTITY_ALLOW_LIST_JSON: list },
    nodeEnv: 'test',
    discovery: discoverOk,
    groupMappingSource: noMapping,
  });
  assert.deepEqual(adapter.configuredGrants(), [], 'nothing before start()');
  await adapter.start(networked);
  const grants = adapter.configuredGrants();
  assert.deepEqual(grants, [
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'RET' } },
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } },
    { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
  ]);
  assert.ok(!JSON.stringify(grants).includes('@'), 'never an email');
  (grants[0]!.scope as { businessUnit: string }).businessUnit = 'MUTATED';
  assert.equal(
    (adapter.configuredGrants()[0]!.scope as { businessUnit: string }).businessUnit,
    'RET',
    'a copy, not the resolver state',
  );
});

test('W7-07 configuredGrants: local-google returns the role map grants, or none without a map; fixture and network/ad none', async () => {
  const roleMap = JSON.stringify({
    version: 1,
    entries: [
      {
        email: 'spoc.dev@example.test',
        roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'ENT' } }],
      },
    ],
  });
  const mapped = createIdentityAdapter({
    env: { ...google, RAI_IDENTITY_LOCAL_ROLE_MAP: '/untracked/role-map.json' },
    nodeEnv: 'development',
    discovery: discoverOk,
    groupMappingSource: noMapping,
    readLocalRoleMap: () => Promise.resolve(roleMap),
  });
  await mapped.start(loopback);
  assert.deepEqual(mapped.configuredGrants(), [
    { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'ENT' } },
  ]);

  const unmapped = createIdentityAdapter({
    env: google,
    nodeEnv: 'development',
    discovery: discoverOk,
    groupMappingSource: noMapping,
  });
  await unmapped.start(loopback);
  assert.deepEqual(unmapped.configuredGrants(), [], 'the default owner role is not a configured grant');

  const fixture = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: noMapping,
    fixtureUsers: [
      {
        fixtureUserId: 'fx-user-spoc-cm',
        subjectId: 'fixture:fx-user-spoc-cm',
        displayName: 'SPOC (synthetic)',
        email: 'spoc.cm@rai-desk.example',
        roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
      },
    ],
  });
  await fixture.start(loopback);
  assert.deepEqual(
    fixture.configuredGrants(),
    [],
    'fixture grants reach the BU directory through the identity table',
  );

  const ad = createIdentityAdapter({
    env: networkAd,
    nodeEnv: 'test',
    discovery: discoverOk,
    groupMappingSource: () => mapping(tenant),
  });
  await ad.start(networked);
  assert.deepEqual(ad.configuredGrants(), []);
});
