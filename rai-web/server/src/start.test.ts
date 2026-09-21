// ID-02 (W0-03 section 5, S16): the post-listen loopback check. The bind host satisfies S2/S14 (localhost) so the
// process reaches listen; the address resolution the adapter reads after listen is stubbed to a non-loopback
// address; the server closes, the exit code is 78 and the reason code is bind_not_loopback. A real listen on an
// ephemeral loopback port; no Postgres is touched (the fixture adapter and the app make no query before a request).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
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
