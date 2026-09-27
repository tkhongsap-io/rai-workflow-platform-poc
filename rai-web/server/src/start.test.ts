// ID-02 (W0-03 section 5, S16): the post-listen loopback check. The bind host satisfies S2/S14 (localhost) so the
// process reaches listen; the address resolution the adapter reads after listen is stubbed to a non-loopback
// address; the server closes, the exit code is 78 and the reason code is bind_not_loopback. A real listen on an
// ephemeral loopback port; no Postgres is touched (the fixture adapter and the app make no query before a request).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { migrationFileCount } from './db/migrate.js';
import { startServer } from './start.js';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const fixtureUsers = [
  {
    fixtureUserId: 'fx-user-admin',
    subjectId: 'fixture:fx-user-admin',
    displayName: 'Desk Admin (fixture)',
    email: 'admin@rai-desk.example',
    roles: [{ role: 'admin' as const, scope: { kind: 'all_cases' as const } }],
  },
];

function envFor(port: number, mode: 'fixture' | 'local-google') {
  return {
    NODE_ENV: 'test',
    HOST: 'localhost',
    PORT: String(port),
    PUBLIC_BASE_URL: `http://localhost:${port}`,
    TRUST_PROXY: 'false',
    DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:1/rai', // never connected to
    DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:1/rai',
    BLOB_DIR: './.local/blobs',
    UPLOAD_MAX_FILE_BYTES: '26214400',
    UPLOAD_MAX_PACK_BYTES: '157286400',
    UPLOAD_MAX_IMAGE_PIXELS: '40000000',
    IDEMPOTENCY_TTL_HOURS: '72',
    BLOB_ORPHAN_MIN_AGE_HOURS: '24',
    BLOB_TMP_MAX_AGE_HOURS: '1',
    RAI_IDENTITY_MODE: mode,
    RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
    RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
    MAIL_MODE: 'sink-memory',
    MAIL_SINK_DIR: './.local/mail',
    QC_MODE: 'substitute',
    LOG_LEVEL: 'error',
    LOG_PRETTY: 'false',
    BUILD_COMMIT: 'test',
  };
}

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}
const exit = (code: number): never => {
  throw new Exited(code);
};
const discovery = () =>
  Promise.resolve({
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
  });

for (const mode of ['fixture', 'local-google'] as const) {
  test(`ID-02 S16 ${mode}: a non-loopback bound address after listen closes the server and exits 78 with bind_not_loopback`, async () => {
    const port = await freePort();
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => lines.push(line);
    let bound = false;
    try {
      await assert.rejects(
        startServer(envFor(port, mode), {
          exit,
          discovery,
          fixtureUsers,
          addressOf: (fastify) => {
            bound = fastify.server.listening;
            return { address: '10.0.0.5', family: 'IPv4', port };
          },
        }),
        (err: unknown) => err instanceof Exited && err.code === 78,
      );
    } finally {
      console.error = original;
    }
    assert.equal(bound, true, 'the server did listen before the S16 check');
    assert.deepEqual(
      lines.map((l) => JSON.parse(l) as unknown),
      [{ event: 'process.refused', reason: 'bind_not_loopback' }],
    );
    // the port is free again: the server closed
    const probe = createServer();
    await new Promise<void>((resolve, reject) =>
      probe.once('error', reject).listen(port, '127.0.0.1', () => probe.close(() => resolve())),
    );
  });
}

test('ID-02 control: with the real address resolution on localhost the server starts, serves the sign-in surface and stops', async () => {
  const port = await freePort();
  const server = await startServer(envFor(port, 'fixture'), { exit, discovery, fixtureUsers });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/fixture/users`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { users: { fixtureUserId: string }[] };
    assert.deepEqual(
      body.users.map((u) => u.fixtureUserId),
      ['fx-user-admin'],
    );
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/session`)).status, 401);
    const headers = { cookie: 'rai_session=RAI-DESK-SYNTHETIC-FIXTURE' };
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`, { headers })).status, 200);
    const readiness = await fetch(`http://127.0.0.1:${port}/readyz`, { headers });
    assert.equal(readiness.status, 503);
    const report = (await readiness.json()) as {
      store: { db: string };
      mailSink: { status: string };
      qc: { status: string };
      build: { schemaVersion: string };
    };
    assert.equal(report.store.db, 'unreachable');
    assert.equal(report.mailSink.status, 'ok');
    assert.equal(report.qc.status, 'ok');
    assert.equal(report.build.schemaVersion, String(migrationFileCount()));
  } finally {
    await server.close();
  }
});

// W1-02: the configured BU keys are the slice-1 fixture list in every identity mode (W0-04 `case.business_unit_id`),
// not the grants of the identity table: the injected table above holds an Admin only, and local-google has no table
// at all, yet both directories list `CM` and `HR`, so a local-google account can file a case (W0-03 4.1).
for (const mode of ['fixture', 'local-google'] as const) {
  test(`W1-02 ${mode}: the started app's BU directory lists the slice-1 fixture BU keys CM and HR`, async () => {
    const port = await freePort();
    const server = await startServer(envFor(port, mode), { exit, discovery, fixtureUsers });
    try {
      assert.deepEqual([...server.businessUnits.list()], ['CM', 'HR']);
      assert.equal(server.businessUnits.has('CM'), true);
      assert.equal(server.businessUnits.has('HR'), true);
      assert.equal(server.businessUnits.has('Consumer Mobile'), false);
    } finally {
      await server.close();
    }
  });
}

test('W1-02: an injected BU key list replaces the fixture list and is unioned with the identity table grants', async () => {
  const port = await freePort();
  const server = await startServer(envFor(port, 'fixture'), {
    exit,
    discovery,
    fixtureUsers: [
      ...fixtureUsers,
      {
        fixtureUserId: 'fx-user-spoc-cm',
        subjectId: 'fixture:fx-user-spoc-cm',
        displayName: 'Suchada P.',
        email: 'spoc.cm@rai-desk.example',
        roles: [{ role: 'bu_spoc' as const, scope: { kind: 'business_unit' as const, businessUnit: 'CM' } }],
      },
    ],
    fixtureBusinessUnits: ['XX'],
  });
  try {
    assert.deepEqual([...server.businessUnits.list()], ['XX', 'CM']);
  } finally {
    await server.close();
  }
});

const moduleError = (message: string) => Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });

// A present but broken fixtures build must not start with no BU keys and no QC runner and say nothing.
for (const [name, error] of [
  ['a syntax error', new SyntaxError('Unexpected token')],
  [
    'an unbuilt module inside the package',
    moduleError(
      "Cannot find module '/srv/node_modules/@rai/fixtures/dist/data/users.js' imported from /srv/x.js",
    ),
  ],
] as const) {
  test(`a fixtures import failing with ${name} refuses to start with fixtures_import_failed`, async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => lines.push(line);
    try {
      await assert.rejects(
        startServer(envFor(await freePort(), 'fixture'), {
          exit,
          discovery,
          fixtureUsers,
          importFixture: () => Promise.reject(error),
        }),
        (err: unknown) => err instanceof Exited && err.code === 78,
      );
    } finally {
      console.error = original;
    }
    assert.deepEqual(
      lines.map((l) => JSON.parse(l) as unknown),
      [{ event: 'process.refused', reason: 'fixtures_import_failed' }],
    );
  });
}

test('an absent fixtures package (a production install) starts with no fixture BU keys and no QC runner', async () => {
  const port = await freePort();
  const server = await startServer(envFor(port, 'fixture'), {
    exit,
    discovery,
    fixtureUsers,
    importFixture: () =>
      Promise.reject(moduleError("Cannot find package '@rai/fixtures' imported from /srv/x.js")),
  });
  try {
    assert.deepEqual([...server.businessUnits.list()], []);
    const headers = { cookie: 'rai_session=RAI-DESK-SYNTHETIC-FIXTURE' };
    const report = (await (await fetch(`http://127.0.0.1:${port}/readyz`, { headers })).json()) as {
      qc: { status: string };
    };
    assert.equal(report.qc.status, 'disabled');
  } finally {
    await server.close();
  }
});

test('S2 / S1 through startServer: a 0.0.0.0 bind in local-google and an unknown mode exit 78 before any listen', async () => {
  const port = await freePort();
  for (const [env, reason] of [
    [{ ...envFor(port, 'local-google'), HOST: '0.0.0.0' }, 'bind_not_loopback'],
    [{ ...envFor(port, 'local-google'), RAI_IDENTITY_MODE: 'nonsense' }, 'mode_unknown'],
    [{ ...envFor(port, 'fixture'), NODE_ENV: 'development' }, 'fixture_outside_test'],
  ] as const) {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => lines.push(line);
    try {
      await assert.rejects(
        startServer(env, { exit, discovery, fixtureUsers }),
        (err: unknown) => err instanceof Exited && err.code === 78,
      );
    } finally {
      console.error = original;
    }
    assert.deepEqual(JSON.parse(lines[0]!), { event: 'process.refused', reason });
  }
});

// W4-13 (W4a plan section 2): QC_MODE selects the runner in every environment, with no fallback between runners,
// and readiness `qc.kind` comes from the bound runner (or the configured mode when none is bound), never a constant.
async function readinessQc(port: number) {
  const report = (await (await fetch(`http://127.0.0.1:${port}/readyz`)).json()) as {
    qc: { kind: string; status: string };
  };
  return report.qc;
}

test('W4-13: QC_MODE=deterministic outside NODE_ENV=test binds the deterministic runner and never loads the substitute', async () => {
  const port = await freePort();
  const imported: string[] = [];
  const server = await startServer(
    { ...envFor(port, 'local-google'), NODE_ENV: 'development', QC_MODE: 'deterministic' },
    {
      exit,
      discovery,
      importFixture: (specifier) => {
        imported.push(specifier);
        return Promise.reject(moduleError(`Cannot find package '@rai/fixtures' imported from /srv/x.js`));
      },
    },
  );
  try {
    assert.deepEqual(await readinessQc(port), { kind: 'deterministic', status: 'ok' });
    assert.ok(
      imported.every((s) => !s.includes('substitutes/qc')),
      `the substitute runner is never imported: ${imported.join(', ')}`,
    );
  } finally {
    await server.close();
  }
});

test('W4-13: QC_MODE=substitute with fixtures absent stays unbound (disabled), reports kind substitute, never falls back', async () => {
  const port = await freePort();
  const server = await startServer(envFor(port, 'fixture'), {
    exit,
    discovery,
    fixtureUsers,
    importFixture: () =>
      Promise.reject(moduleError("Cannot find package '@rai/fixtures' imported from /srv/x.js")),
  });
  try {
    assert.deepEqual(await readinessQc(port), { kind: 'substitute', status: 'disabled' });
  } finally {
    await server.close();
  }
});

for (const [name, env] of [
  ['network identity', { RAI_IDENTITY_MODE: 'network', NODE_ENV: 'development' }],
  ['NODE_ENV=production', { RAI_IDENTITY_MODE: 'local-google', NODE_ENV: 'production' }],
] as const) {
  test(`W4-13: QC_MODE=substitute under ${name} exits 78 with invalid:QC_MODE before listening`, async () => {
    const port = await freePort();
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => lines.push(line);
    try {
      await assert.rejects(
        startServer({ ...envFor(port, 'local-google'), ...env }, { exit, discovery, fixtureUsers }),
        (err: unknown) => err instanceof Exited && err.code === 78,
      );
    } finally {
      console.error = original;
    }
    assert.deepEqual(
      lines.map((l) => JSON.parse(l) as unknown),
      [{ event: 'process.refused', reason: 'invalid:QC_MODE' }],
    );
    const probe = await fetch(`http://127.0.0.1:${port}/readyz`).catch(() => undefined);
    assert.equal(probe, undefined, 'nothing listens');
  });
}

// W7-05 (W7 plan section 2, "New test seam"): `exchange` returns the claims a principal is minted from, so the
// override is refused before parseConfig unless NODE_ENV=test and HOST is loopback. `discovery` only supplies a
// document S18 still validates, so it is refused only under NODE_ENV=production, after parseConfig.
async function refusedWith(env: Record<string, string>, overrides: Parameters<typeof startServer>[1]) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => lines.push(line);
  try {
    await assert.rejects(
      startServer(env, overrides),
      (err: unknown) => err instanceof Exited && err.code === 78,
    );
  } finally {
    console.error = original;
  }
  return lines.map((l) => JSON.parse(l) as { event: string; reason: string });
}

const syntheticExchange = () => Promise.resolve(undefined);

const networkAllowListEnv = (port: number) => ({
  ...envFor(port, 'local-google'),
  RAI_IDENTITY_MODE: 'network',
  RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
  RAI_IDENTITY_OIDC_ISSUER_URL: 'https://idp.rai-desk.test',
  RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
  RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
  RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
    version: 1,
    entries: [{ email: 'admin@rai-desk.example', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] }],
  }),
  QC_MODE: 'deterministic',
});

for (const [name, env] of [
  ['NODE_ENV=development (local-google)', { NODE_ENV: 'development' }],
  ['NODE_ENV=production (local-google)', { NODE_ENV: 'production' }],
  [
    'a non-loopback HOST under NODE_ENV=test (local-google, which parse would refuse as bind_not_loopback)',
    { HOST: '0.0.0.0' },
  ],
  ['a non-loopback HOST under NODE_ENV=test (network)', { RAI_IDENTITY_MODE: 'network', HOST: '0.0.0.0' }],
  [
    'an unknown mode under NODE_ENV=production (parse would say mode_unknown)',
    { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'nonsense' },
  ],
  ['a missing HOST under NODE_ENV=test', { HOST: '' }],
] as const) {
  test(`W7-05: an exchange override with ${name} exits 78 test_exchange_override_forbidden before parse, never listening`, async () => {
    const port = await freePort();
    const lines = await refusedWith(
      { ...envFor(port, 'local-google'), QC_MODE: 'deterministic', ...env },
      { exit, discovery, exchange: syntheticExchange },
    );
    assert.deepEqual(lines, [{ event: 'process.refused', reason: 'test_exchange_override_forbidden' }]);
    const probe = await fetch(`http://127.0.0.1:${port}/readyz`).catch(() => undefined);
    assert.equal(probe, undefined, 'nothing listens');
  });
}

test('W7-05: an exchange override under NODE_ENV=test on loopback is accepted and reaches the sign-in callback', async () => {
  const port = await freePort();
  const calls: { expectedState: string }[] = [];
  const server = await startServer(
    { ...envFor(port, 'local-google'), QC_MODE: 'deterministic' },
    {
      exit,
      // A token endpoint on a closed loopback port: if the override were ever ignored, openid-client's real
      // exchange would fail locally instead of reaching a provider.
      discovery: () =>
        Promise.resolve({
          issuer: 'https://accounts.google.com',
          authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          token_endpoint: 'https://127.0.0.1:1/token',
        }),
      exchange: (input) => {
        calls.push({ expectedState: input.expectedState });
        return Promise.resolve({
          iss: 'https://accounts.google.com',
          sub: 'synthetic-subject-1',
          email: 'owner@rai-desk.example',
          email_verified: true,
          nonce: input.expectedNonce,
        });
      },
    },
  );
  try {
    const begin = await server.fastify.inject({ method: 'POST', url: '/auth/sign-in', payload: {} });
    assert.equal(begin.statusCode, 200);
    const state = new URL(begin.json<{ redirectUrl: string }>().redirectUrl).searchParams.get('state');
    const transaction = begin.cookies.find((c) => c.name === 'rai_signin');
    assert.ok(state && transaction, 'a sign-in transaction was issued');
    await server.fastify.inject({
      method: 'GET',
      url: `/auth/callback?code=synthetic-code&state=${state}`,
      headers: { cookie: `rai_signin=${transaction.value}` },
    });
    assert.deepEqual(calls, [{ expectedState: state }], 'the injected exchange, not openid-client, answered');
  } finally {
    await server.close();
  }
});

test('W7-05: a discovery override under NODE_ENV=production exits 78 test_discovery_override_forbidden, never listening', async () => {
  const port = await freePort();
  let discovered = 0;
  const lines = await refusedWith(
    { ...envFor(port, 'local-google'), NODE_ENV: 'production', QC_MODE: 'deterministic' },
    {
      exit,
      discovery: (...args: Parameters<typeof discovery>) => {
        discovered += 1;
        return discovery(...args);
      },
    },
  );
  assert.deepEqual(lines, [{ event: 'process.refused', reason: 'test_discovery_override_forbidden' }]);
  assert.equal(discovered, 0, 'the injected discovery is never called');
  const probe = await fetch(`http://127.0.0.1:${port}/readyz`).catch(() => undefined);
  assert.equal(probe, undefined, 'nothing listens');
});

test('W7-05: the discovery guard runs after parse, so a parse refusal under NODE_ENV=production keeps its reason', async () => {
  const port = await freePort();
  for (const [env, reason] of [
    [{ RAI_IDENTITY_MODE: 'nonsense' }, 'mode_unknown'],
    [{ QC_MODE: 'substitute' }, 'invalid:QC_MODE'],
    [{ LOG_PRETTY: 'true', QC_MODE: 'deterministic' }, 'log_pretty_in_production'],
  ] as const) {
    const lines = await refusedWith(
      { ...envFor(port, 'local-google'), NODE_ENV: 'production', ...env },
      { exit, discovery },
    );
    assert.deepEqual(lines, [{ event: 'process.refused', reason }]);
  }
});

test('W7-05 S17: network with an http PUBLIC_BASE_URL exits 78 base_url_not_https before discovery, never listening', async () => {
  const port = await freePort();
  let discovered = 0;
  const lines = await refusedWith(
    { ...networkAllowListEnv(port), NODE_ENV: 'development', TRUST_PROXY: 'true' },
    {
      exit,
      discovery: (...args: Parameters<typeof discovery>) => {
        discovered += 1;
        return discovery(...args);
      },
    },
  );
  assert.deepEqual(lines, [{ event: 'process.refused', reason: 'base_url_not_https' }]);
  assert.equal(discovered, 0, 'no discovery is attempted');
  const probe = await fetch(`http://127.0.0.1:${port}/readyz`).catch(() => undefined);
  assert.equal(probe, undefined, 'nothing listens');
});
