// OBS-03 / bounded OBS-15 process evidence. Full-suite log coverage remains parent INT's gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { Value } from 'typebox/value';
import { ReadinessReportSchema, type ReadinessReport } from '@rai/shared/schemas/observability';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { observabilityDatabaseConfig, withObservabilityDatabase } from '../support/observability-database.js';
import { assertNoLeak, FIXTURE_FORBIDDEN } from '../support/log-capture.js';
import { freeLoopbackPort, startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';

const THAI_FILENAME = 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf';
const BODY_CANARY = 'RAI-DESK-SYNTHETIC-FIXTURE';
const OWNER = FIXTURE_USERS.find((user) => user.fixtureUserId === 'fx-user-owner-cm')!;
const CASE = findFixtureCase('fx-case-nonvendor')!;

// No connection occurs in these regressions; bad role/admin URLs must fail the common preflight.
test('observability database preflight rejects every remote role, routing override and wrong mode', () => {
  const env = {
    NODE_ENV: 'test',
    RAI_IDENTITY_MODE: 'fixture',
    DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:54371/rai',
    DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:54371/rai',
    DATABASE_OPERATOR_URL: 'postgres://rai_operator:rai_operator@127.0.0.1:54371/rai',
    OBS_MIGRATION_ADMIN_URL: 'postgres://postgres:postgres-local@127.0.0.1:54371/rai',
  };
  assert.doesNotThrow(() => observabilityDatabaseConfig(env));
  for (const key of [
    'DATABASE_URL',
    'DATABASE_MIGRATE_URL',
    'DATABASE_OPERATOR_URL',
    'OBS_MIGRATION_ADMIN_URL',
  ] as const) {
    for (const value of [
      env[key].replace('127.0.0.1', 'db.example'),
      `${env[key]}?host=db.example`,
      `${env[key]}#override`,
      env[key].replace(':54371', ':54372'),
      env[key].replace(/\/rai$/, '/other'),
    ])
      assert.throws(() => observabilityDatabaseConfig({ ...env, [key]: value }));
  }
  const remote = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, value.replace('127.0.0.1', 'db.example')]),
  );
  assert.throws(() => observabilityDatabaseConfig(remote), 'matching remote URLs are still forbidden');
  assert.throws(() => observabilityDatabaseConfig({ ...env, NODE_ENV: 'production' }));
  assert.throws(() => observabilityDatabaseConfig({ ...env, RAI_IDENTITY_MODE: 'local-google' }));
  assert.throws(() => observabilityDatabaseConfig({ ...env, DATABASE_OPERATOR_URL: '' }));
});

async function readiness(
  server: TestServerProcess,
  status: number,
  cookie?: string,
): Promise<ReadinessReport> {
  const response = await fetch(`${server.baseUrl}/readyz`, {
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, status);
  const body: unknown = await response.json();
  assert.ok(Value.Check(ReadinessReportSchema, body), 'readiness uses the closed public schema');
  assertNoLeak({ text: () => JSON.stringify(body) });
  return body;
}

function assertRequest(
  server: TestServerProcess,
  correlationId: string | null,
  route: string,
  status: number,
) {
  assert.ok(correlationId, 'response correlation required');
  const lines = server.linesFor('request.completed').filter((line) => line.correlationId === correlationId);
  assert.equal(lines.length, 1, 'exactly one correlated request completion');
  const fields = lines[0]!.fields as Record<string, unknown>;
  assert.equal(fields.route, route);
  assert.equal(fields.status, status);
}

async function stopClean(server: TestServerProcess) {
  const exit = await server.stop();
  assert.equal(exit.code, 0, 'real process drains cleanly');
  assert.equal(exit.signal, null);
}

test(
  'OBS-03: reachable unmigrated database returns HTTP 503 migrations.pending',
  { timeout: 60_000 },
  async () => {
    await withObservabilityDatabase(false, async (env) => {
      const client = new pg.Client({ connectionString: env.DATABASE_URL });
      try {
        await client.connect();
        assert.equal(
          (await client.query<{ reachable: number }>('SELECT 1 AS reachable')).rows[0]?.reachable,
          1,
        );
        assert.equal(
          (
            await client.query<{ journal: string | null }>(
              "SELECT to_regclass('drizzle.__drizzle_migrations') AS journal",
            )
          ).rows[0]?.journal,
          null,
        );
      } finally {
        await client.end();
      }
      const server = await startTestServer({ env });
      try {
        const body = await readiness(server, 503);
        assert.equal(body.status, 'not_ready');
        assert.deepEqual(body.store, { db: 'ok', migrations: 'pending', blob: 'ok' });
        assert.equal(body.identity.status, 'ok');
        assert.equal(body.mailSink.status, 'ok');
        const health = await fetch(`${server.baseUrl}/healthz`);
        assert.equal(health.status, 200);
        await health.arrayBuffer();
      } finally {
        await stopClean(server);
      }
    });
  },
);

test(
  'OBS-15 canaries through real HTTP; OBS-03 cookie health remains live during DB outage',
  { timeout: 90_000 },
  async () => {
    await withObservabilityDatabase(true, async (env) => {
      const server = await startTestServer({ env });
      let cookie = '';
      const query = new URLSearchParams({ searchBy: 'owner', search: OWNER.displayName });
      const requests: [string | null, string, number][] = [];
      let signinId: string | null = null;
      let uploadId: string | null = null;
      try {
        const healthy = await readiness(server, 200);
        assert.equal(healthy.status, 'ready');
        assert.deepEqual(healthy.store, { db: 'ok', migrations: 'current', blob: 'ok' });
        const signin = await fetch(`${server.baseUrl}${FIXTURE_SIGN_IN_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
          body: JSON.stringify({ fixtureUserId: OWNER.fixtureUserId }),
        });
        assert.equal(signin.status, 200);
        cookie = firstCookie(signin.headers.get('set-cookie') ?? undefined) ?? '';
        assert.ok(cookie, 'real sign-in issues a session cookie');
        const identity = await signin.text();
        assert.ok(identity.includes(OWNER.displayName), 'sign-in actually handles the personal-data canary');
        signinId = signin.headers.get('x-correlation-id');
        requests.push([signinId, FIXTURE_SIGN_IN_PATH, 200]);
        const search = await fetch(`${server.baseUrl}/api/queue?${query}`, { headers: { cookie } });
        assert.equal(search.status, 200);
        const result = (await search.json()) as { items: { caseId: string }[]; total: number };
        assert.ok(
          result.total > 0 && result.items.some((item) => item.caseId === CASE.caseId),
          'person search finds the owned fixture',
        );
        requests.push([search.headers.get('x-correlation-id'), '/api/queue', 200]);
        const form = new FormData();
        form.append(
          'file',
          new Blob([`%PDF-1.4\n% ${BODY_CANARY}\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n`], {
            type: 'application/pdf',
          }),
          THAI_FILENAME,
        );
        const upload = await fetch(`${server.baseUrl}/api/cases/${CASE.caseId}/artifacts`, {
          method: 'POST',
          headers: { cookie, 'sec-fetch-site': 'same-origin' },
          body: form,
        });
        assert.equal(upload.status, 201);
        await upload.arrayBuffer();
        uploadId = upload.headers.get('x-correlation-id');
        requests.push([uploadId, '/api/cases/:caseId/artifacts', 201]);
      } finally {
        await stopClean(server);
      }
      for (const [id, route, status] of requests) assertRequest(server, id, route, status);
      for (const [event, id] of [
        ['auth.signin.succeeded', signinId],
        ['upload.stored', uploadId],
      ] as const)
        assert.equal(server.linesFor(event).filter((line) => line.correlationId === id).length, 1);
      const canaries = [
        ...FIXTURE_FORBIDDEN,
        cookie,
        cookie.slice(cookie.indexOf('=') + 1),
        query.toString(),
        encodeURIComponent(OWNER.displayName),
        encodeURIComponent(THAI_FILENAME),
      ];
      assertNoLeak({ text: () => JSON.stringify(server.lines) }, canaries);

      // W0-10 explicitly requires a closed-port DB. No DB service or other worktree is stopped.
      const closedPort = await freeLoopbackPort();
      const outageEnv = { ...env };
      for (const key of ['DATABASE_URL', 'DATABASE_MIGRATE_URL', 'DATABASE_OPERATOR_URL']) {
        const url = new URL(env[key]!);
        url.port = String(closedPort);
        outageEnv[key] = url.href;
      }
      observabilityDatabaseConfig({ ...outageEnv, NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture' });
      const outage = await startTestServer({ env: outageEnv });
      try {
        for (const headers of [{}, { cookie }]) {
          const health = await fetch(`${outage.baseUrl}/healthz`, {
            headers,
            signal: AbortSignal.timeout(10_000),
          });
          assert.equal(health.status, 200, 'liveness never reads a session from the unavailable DB');
          await health.arrayBuffer();
          const report = await readiness(outage, 503, headers.cookie);
          assert.equal(report.status, 'not_ready');
          assert.equal(report.store.db, 'unreachable');
          assert.equal(report.store.migrations, 'unknown');
        }
      } finally {
        await stopClean(outage);
      }
      assertNoLeak({ text: () => JSON.stringify(outage.lines) }, canaries);
    });
  },
);
