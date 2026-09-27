// ID-01 (W0-03 section 11): rows S1-S10, S13-S15 and S17 of the start-up refusal table as a table-driven case over
// the pure parseIdentityConfig(env, bind). No network, no Postgres, no process spawn. S11, S12 (ID-18, ID-19) and
// S16 (ID-02) are in adapter.test.ts and start.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentityConfig, type IdentityEnv } from './config.js';
import type { BindTarget } from './types.js';

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
  trustProxy: true,
};

const google: IdentityEnv = {
  RAI_IDENTITY_MODE: 'local-google',
  RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic-client-id.apps.googleusercontent.com',
  RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
};
const allowListJson = JSON.stringify({
  version: 1,
  entries: [
    { email: 'dpo@rai-desk.example', roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }] },
  ],
});
const networkAllowList: IdentityEnv = {
  RAI_IDENTITY_MODE: 'network',
  RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
  RAI_IDENTITY_OIDC_ISSUER_URL: 'https://issuer.example.test',
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
  RAI_IDENTITY_ALLOW_LIST_JSON: allowListJson,
};
const networkAd: IdentityEnv = {
  RAI_IDENTITY_MODE: 'network',
  RAI_IDENTITY_NETWORK_SOURCE: 'ad',
  RAI_IDENTITY_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
};
const production: IdentityEnv = {
  RAI_IDENTITY_MODE: 'production',
  RAI_IDENTITY_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
};
const fixture: IdentityEnv = { RAI_IDENTITY_MODE: 'fixture' };

function reasonOf(env: IdentityEnv, bind: BindTarget, nodeEnv = 'test'): string {
  const result = parseIdentityConfig(env, bind, nodeEnv);
  return result.ok ? 'ok' : result.reason;
}

const rows: Array<{ row: string; env: IdentityEnv; bind: BindTarget; nodeEnv?: string; expect: string }> = [
  { row: 'S1 missing mode', env: {}, bind: loopback, expect: 'mode_unknown' },
  { row: 'S1 unknown mode', env: { RAI_IDENTITY_MODE: 'nonsense' }, bind: loopback, expect: 'mode_unknown' },
  { row: 'S1 empty mode', env: { RAI_IDENTITY_MODE: '  ' }, bind: loopback, expect: 'mode_unknown' },
  {
    row: 'S2 local-google bind 0.0.0.0',
    env: google,
    bind: { ...loopback, host: '0.0.0.0' },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S2 local-google bind ::',
    env: google,
    bind: { ...loopback, host: '::' },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S2 local-google bind interface address',
    env: google,
    bind: { ...loopback, host: '192.168.1.20' },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S2 local-google bind hostname',
    env: google,
    bind: { ...loopback, host: 'desk.internal' },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S3 local-google base URL host not loopback',
    env: google,
    bind: { ...loopback, publicBaseUrl: new URL('http://desk.internal:8787') },
    expect: 'base_url_not_loopback',
  },
  {
    row: 'S4 local-google client id absent',
    env: { ...google, RAI_IDENTITY_GOOGLE_CLIENT_ID: undefined },
    bind: loopback,
    expect: 'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID',
  },
  {
    row: 'S4 local-google client secret absent',
    env: { ...google, RAI_IDENTITY_GOOGLE_CLIENT_SECRET: undefined },
    bind: loopback,
    expect: 'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
  },
  {
    row: 'S5 local-google trustProxy',
    env: google,
    bind: { ...loopback, trustProxy: true },
    expect: 'proxy_forbidden_in_mode',
  },
  {
    row: 'S6 network source missing',
    env: { ...networkAllowList, RAI_IDENTITY_NETWORK_SOURCE: undefined },
    bind: networked,
    expect: 'network_source_unknown',
  },
  {
    row: 'S6 network source unknown',
    env: { ...networkAllowList, RAI_IDENTITY_NETWORK_SOURCE: 'ldap' },
    bind: networked,
    expect: 'network_source_unknown',
  },
  {
    row: 'S7 allow-list issuer absent',
    env: { ...networkAllowList, RAI_IDENTITY_OIDC_ISSUER_URL: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_ISSUER_URL',
  },
  {
    row: 'S7 allow-list client id absent',
    env: { ...networkAllowList, RAI_IDENTITY_OIDC_CLIENT_ID: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID',
  },
  {
    row: 'S7 allow-list client secret absent',
    env: { ...networkAllowList, RAI_IDENTITY_OIDC_CLIENT_SECRET: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET',
  },
  {
    row: 'S7 allow-list document absent',
    env: { ...networkAllowList, RAI_IDENTITY_ALLOW_LIST_JSON: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON',
  },
  {
    row: 'S8 allow-list not JSON',
    env: { ...networkAllowList, RAI_IDENTITY_ALLOW_LIST_JSON: '{not json' },
    bind: networked,
    expect: 'allow_list_invalid',
  },
  {
    row: 'S8 allow-list wrong version',
    env: { ...networkAllowList, RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({ version: 2, entries: [] }) },
    bind: networked,
    expect: 'allow_list_invalid',
  },
  {
    row: 'S8 allow-list entry without roles',
    env: {
      ...networkAllowList,
      RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
        version: 1,
        entries: [{ email: 'a@rai-desk.example', roles: [] }],
      }),
    },
    bind: networked,
    expect: 'allow_list_invalid',
  },
  {
    row: 'S8 allow-list wildcard entry',
    env: {
      ...networkAllowList,
      RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
        version: 1,
        entries: [{ email: '*@rai-desk.example', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] }],
      }),
    },
    bind: networked,
    expect: 'ok',
  },
  {
    row: 'S9 ad tenant absent',
    env: { ...networkAd, RAI_IDENTITY_ENTRA_TENANT_ID: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID',
  },
  {
    row: 'S9 ad client id absent',
    env: { ...networkAd, RAI_IDENTITY_OIDC_CLIENT_ID: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID',
  },
  {
    row: 'S9 production client secret absent',
    env: { ...production, RAI_IDENTITY_OIDC_CLIENT_SECRET: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET',
  },
  {
    row: 'S9 production tenant absent',
    env: { ...production, RAI_IDENTITY_ENTRA_TENANT_ID: undefined },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID',
  },
  {
    row: 'S10 production with a Google client id',
    env: { ...production, RAI_IDENTITY_GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com' },
    bind: networked,
    expect: 'google_forbidden_in_mode',
  },
  {
    row: 'S10 production with a Google client secret',
    env: { ...production, RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'x' },
    bind: networked,
    expect: 'google_forbidden_in_mode',
  },
  {
    row: 'S10 network/ad with a Google variable',
    env: { ...networkAd, RAI_IDENTITY_GOOGLE_CLIENT_ID: 'x' },
    bind: networked,
    expect: 'google_forbidden_in_mode',
  },
  {
    row: 'S10 network/allow-list tolerates a Google variable (source is not ad)',
    env: { ...networkAllowList, RAI_IDENTITY_GOOGLE_CLIENT_ID: 'x' },
    bind: networked,
    expect: 'ok',
  },
  {
    row: 'S13 fixture outside NODE_ENV=test',
    env: fixture,
    bind: loopback,
    nodeEnv: 'development',
    expect: 'fixture_outside_test',
  },
  {
    row: 'S13 fixture in production NODE_ENV',
    env: fixture,
    bind: loopback,
    nodeEnv: 'production',
    expect: 'fixture_outside_test',
  },
  {
    row: 'S14 fixture bind not loopback',
    env: fixture,
    bind: { ...loopback, host: '0.0.0.0' },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S14 fixture base URL not loopback',
    env: fixture,
    bind: { ...loopback, publicBaseUrl: new URL('http://desk.internal') },
    expect: 'bind_not_loopback',
  },
  {
    row: 'S15 placeholder secret counts as absent',
    env: { ...google, RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'set-in-custody' },
    bind: loopback,
    expect: 'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
  },
  {
    row: 'S15 sample client id placeholder counts as absent',
    env: { ...google, RAI_IDENTITY_GOOGLE_CLIENT_ID: 'set-locally' },
    bind: loopback,
    expect: 'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID',
  },
  {
    row: 'S15 whitespace secret counts as absent',
    env: { ...production, RAI_IDENTITY_OIDC_CLIENT_SECRET: '   ' },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET',
  },
  {
    row: 'S15 empty allow-list secret counts as absent',
    env: { ...networkAllowList, RAI_IDENTITY_ALLOW_LIST_JSON: '' },
    bind: networked,
    expect: 'secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON',
  },
  {
    row: 'S15 placeholder Google variable does not trigger S10',
    env: {
      ...production,
      RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'set-in-custody',
      RAI_IDENTITY_GOOGLE_CLIENT_ID: 'set-locally',
    },
    bind: networked,
    expect: 'ok',
  },
  {
    row: 'S17 production base URL not https',
    env: production,
    bind: { ...networked, publicBaseUrl: new URL('http://desk.example.test') },
    expect: 'base_url_not_https',
  },
  // W7-05 (W7 plan section 5.1): S17 extended to network, both sources, before any other network row.
  {
    row: 'S17 network/allow-list base URL not https',
    env: networkAllowList,
    bind: { ...networked, publicBaseUrl: new URL('http://desk.example.test') },
    expect: 'base_url_not_https',
  },
  {
    row: 'S17 network/allow-list http base URL on loopback is still refused',
    env: networkAllowList,
    bind: { ...loopback, publicBaseUrl: new URL('http://127.0.0.1:8787') },
    expect: 'base_url_not_https',
  },
  {
    row: 'S17 network/ad base URL not https',
    env: networkAd,
    bind: { ...networked, publicBaseUrl: new URL('http://desk.example.test') },
    expect: 'base_url_not_https',
  },
  {
    row: 'S17 network http refuses before the source row (S6)',
    env: { ...networkAllowList, RAI_IDENTITY_NETWORK_SOURCE: undefined },
    bind: { ...networked, publicBaseUrl: new URL('http://desk.example.test') },
    expect: 'base_url_not_https',
  },
  {
    row: 'S17 network/allow-list https with HOST=0.0.0.0 and TRUST_PROXY=true parses',
    env: { ...networkAllowList, RAI_IDENTITY_OIDC_ISSUER_URL: 'https://idp.rai-desk.test' },
    bind: {
      host: '0.0.0.0',
      port: 8787,
      publicBaseUrl: new URL('https://desk.rai-desk.test'),
      trustProxy: true,
    },
    expect: 'ok',
  },
  {
    row: 'session lifetime out of range refuses',
    env: { ...fixture, RAI_SESSION_ABSOLUTE_HOURS: '48' },
    bind: loopback,
    expect: 'secret_missing:RAI_SESSION_ABSOLUTE_HOURS',
  },
  { row: 'local-google complete on loopback parses', env: google, bind: loopback, expect: 'ok' },
  {
    row: 'local-google on localhost and ::1 parses',
    env: google,
    bind: { ...loopback, host: 'localhost', publicBaseUrl: new URL('http://[::1]:8787') },
    expect: 'ok',
  },
  {
    row: 'network/allow-list complete parses on any bind',
    env: networkAllowList,
    bind: networked,
    expect: 'ok',
  },
  { row: 'network/ad complete parses', env: networkAd, bind: networked, expect: 'ok' },
  { row: 'production complete parses', env: production, bind: networked, expect: 'ok' },
  { row: 'fixture under test on loopback parses', env: fixture, bind: loopback, expect: 'ok' },
];

for (const { row, env, bind, nodeEnv, expect } of rows) {
  test(`ID-01 ${row} → ${expect}`, () => {
    assert.equal(reasonOf(env, bind, nodeEnv), expect);
  });
}

test('the S8 wildcard row is a plain address to the parser: matching is exact, so the entry never matches anyone', () => {
  // Documented here so the table row above is not misread: no wildcard semantics exist (section 4.2).
  const result = parseIdentityConfig(
    {
      ...networkAllowList,
      RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
        version: 1,
        entries: [{ email: '*@rai-desk.example', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] }],
      }),
    },
    networked,
    'test',
  );
  assert.ok(result.ok && result.config.mode === 'network' && result.config.source === 'allow-list');
});

test('the parsed configuration carries the session policy (defaults 12 h absolute, 120 min idle) and never a raw variable', () => {
  const result = parseIdentityConfig(google, loopback, 'development');
  assert.ok(result.ok);
  assert.deepEqual(result.config.session, { absoluteHours: 12, idleMinutes: 120 });
  const custom = parseIdentityConfig(
    { ...google, RAI_SESSION_ABSOLUTE_HOURS: '1', RAI_SESSION_IDLE_MINUTES: '5' },
    loopback,
    'development',
  );
  assert.ok(custom.ok);
  assert.deepEqual(custom.config.session, { absoluteHours: 1, idleMinutes: 5 });
});
