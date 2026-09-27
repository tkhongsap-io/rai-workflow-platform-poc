// ID-10 and the W1-01 Done-when refusals through the real command: `node server/src/main.ts` with a fixture
// configuration outside NODE_ENV=test, a local-google configuration on a non-loopback bind, and an unknown mode,
// each exits 78 (EX_CONFIG) with the reason code and never listens. In fixture mode under NODE_ENV=test the real
// process serves the fixture routes (loaded from @rai/fixtures at run time) against this ticket's Postgres.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '@rai/server/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = path.join(root, 'server/src/main.ts');

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function baseEnv(port: number): Record<string, string> {
  const env = readEnv();
  return {
    PATH: env.PATH ?? '',
    HOME: env.HOME ?? '',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    TRUST_PROXY: 'false',
    DATABASE_URL: env.DATABASE_URL ?? '',
    DATABASE_MIGRATE_URL: env.DATABASE_MIGRATE_URL ?? '',
    BLOB_DIR: './.local/blobs',
    UPLOAD_MAX_FILE_BYTES: '26214400',
    UPLOAD_MAX_PACK_BYTES: '157286400',
    UPLOAD_MAX_IMAGE_PIXELS: '40000000',
    IDEMPOTENCY_TTL_HOURS: '72',
    BLOB_ORPHAN_MIN_AGE_HOURS: '24',
    BLOB_TMP_MAX_AGE_HOURS: '1',
    RAI_IDENTITY_MODE: 'fixture',
    MAIL_MODE: 'sink-memory',
    MAIL_SINK_DIR: './.local/mail',
    QC_MODE: 'substitute',
    LOG_LEVEL: 'error',
    LOG_PRETTY: 'false',
    BUILD_COMMIT: 'test',
  };
}

function run(env: Record<string, string>): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=rai-source', main], {
      cwd: root,
      env,
    });
    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('exit', (code) => resolve({ code, stderr, stdout }));
  });
}

test('ID-10 fixture mode outside NODE_ENV=test exits 78 with fixture_outside_test', async () => {
  const port = await freePort();
  const r = await run({ ...baseEnv(port), NODE_ENV: 'development' });
  assert.equal(r.code, 78);
  assert.deepEqual(JSON.parse(r.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'fixture_outside_test',
  });
});

test('local-google refuses to start on a non-loopback bind (S2) and on an unknown mode (S1), exit 78, never listening', async () => {
  const port = await freePort();
  const google = {
    ...baseEnv(port),
    NODE_ENV: 'development',
    RAI_IDENTITY_MODE: 'local-google',
    RAI_IDENTITY_GOOGLE_CLIENT_ID: 'synthetic.apps.googleusercontent.com',
    RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
  };
  const nonLoopback = await run({ ...google, HOST: '0.0.0.0' });
  assert.equal(nonLoopback.code, 78);
  assert.deepEqual(JSON.parse(nonLoopback.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'bind_not_loopback',
  });
  const unknown = await run({ ...google, RAI_IDENTITY_MODE: 'nonsense' });
  assert.equal(unknown.code, 78);
  assert.deepEqual(JSON.parse(unknown.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'mode_unknown',
  });
  const missing = await run({ ...google, RAI_IDENTITY_MODE: '' });
  assert.equal(missing.code, 78);
  assert.deepEqual(JSON.parse(missing.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'mode_unknown',
  });
  const proxied = await run({ ...google, TRUST_PROXY: 'true' });
  assert.equal(proxied.code, 78);
  assert.deepEqual(JSON.parse(proxied.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'proxy_forbidden_in_mode',
  });
  for (const r of [nonLoopback, unknown, missing, proxied]) {
    const probe = await fetch(`http://127.0.0.1:${port}/api/session`).catch(() => undefined);
    assert.equal(probe, undefined, 'nothing listens');
    assert.ok(!r.stdout.includes('process.started'));
  }
});

test('W4-13: the real process refuses QC_MODE=substitute with a non-local identity mode, exit 78 invalid:QC_MODE, never listening', async () => {
  const port = await freePort();
  // W4a plan section 2: `substitute` is a local value (fixture, local-google) outside NODE_ENV=production.
  const r = await run({ ...baseEnv(port), NODE_ENV: 'development', RAI_IDENTITY_MODE: 'network' });
  assert.equal(r.code, 78);
  assert.deepEqual(JSON.parse(r.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'invalid:QC_MODE',
  });
  const probe = await fetch(`http://127.0.0.1:${port}/api/session`).catch(() => undefined);
  assert.equal(probe, undefined, 'nothing listens');
  assert.ok(!r.stdout.includes('process.started'));
});
// W7-05 (W7 plan section 5.1): S17 extended to network. A synthetic allow-list configuration with an http base URL
// is refused inside the adapter's pure parse, before discovery, so the synthetic issuer is never contacted.
test('W7-05 S17: the real process in network mode with an http PUBLIC_BASE_URL exits 78 base_url_not_https, never listening', async () => {
  const port = await freePort();
  const r = await run({
    ...baseEnv(port),
    NODE_ENV: 'development',
    HOST: '0.0.0.0',
    TRUST_PROXY: 'true',
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    RAI_IDENTITY_MODE: 'network',
    RAI_IDENTITY_NETWORK_SOURCE: 'allow-list',
    RAI_IDENTITY_OIDC_ISSUER_URL: 'https://idp.rai-desk.test',
    RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-oidc-client',
    RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-oidc-secret',
    RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
      version: 1,
      entries: [
        { email: 'admin@rai-desk.example', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] },
      ],
    }),
    QC_MODE: 'deterministic',
  });
  assert.equal(r.code, 78);
  assert.deepEqual(JSON.parse(r.stderr.trim().split('\n').at(-1)!), {
    event: 'process.refused',
    reason: 'base_url_not_https',
  });
  const probe = await fetch(`http://127.0.0.1:${port}/api/session`).catch(() => undefined);
  assert.equal(probe, undefined, 'nothing listens');
  assert.ok(!r.stdout.includes('process.started'));
});

test('the real process in fixture mode under NODE_ENV=test serves the fixture picker from @rai/fixtures and answers 401 without a session', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=rai-source', main], {
    cwd: root,
    env: { ...baseEnv(port), LOG_LEVEL: 'info' },
  });
  let output = '';
  child.stdout.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr.on('data', (d: Buffer) => (output += d.toString()));
  try {
    const deadline = Date.now() + 30_000;
    let users: { fixtureUserId: string }[] | undefined;
    while (Date.now() < deadline && users === undefined) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/auth/fixture/users`);
        if (res.status === 200) users = ((await res.json()) as { users: { fixtureUserId: string }[] }).users;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(users, `the fixture picker answered within 30 s; output: ${output}`);
    assert.equal(users.length, 8);
    assert.ok(users.some((u) => u.fixtureUserId === 'fx-user-dpo-spoc-hr'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/session`)).status, 401);
    assert.ok(output.includes('process.started'), 'process.started is logged after listen');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
