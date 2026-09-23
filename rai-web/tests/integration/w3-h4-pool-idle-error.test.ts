// Postgres terminating the desk's idle pooled connections (a restart, a failover, an idle timeout) must not take the
// process down: the pool reports the error through the redacted error capture, drops the dead clients and the next
// request connects afresh. Fixture ids: fx-user-owner-cm.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { parseDatabaseConfig, readEnv } from '@rai/server/config';
import { startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';

async function signIn(server: TestServerProcess): Promise<string> {
  const res = await fetch(`${server.baseUrl}${FIXTURE_SIGN_IN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fixtureUserId: 'fx-user-owner-cm' }),
  });
  assert.equal(res.status, 200);
  const cookie = firstCookie(res.headers.get('set-cookie') ?? undefined);
  assert.ok(cookie !== undefined, 'no session cookie');
  return cookie;
}

async function listCases(server: TestServerProcess, cookie: string): Promise<number> {
  const res = await fetch(`${server.baseUrl}/api/cases`, {
    headers: { cookie, 'sec-fetch-site': 'same-origin' },
  });
  await res.arrayBuffer();
  return res.status;
}

/** Terminates every backend the desk's pool holds, from a plain client under the same role (no application_name). */
async function terminateDeskBackends(): Promise<number> {
  const client = new pg.Client({ connectionString: parseDatabaseConfig(readEnv()).url });
  await client.connect();
  try {
    const result = await client.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity
       WHERE application_name = 'rai-desk' AND usename = current_user AND pid <> pg_backend_pid()`,
    );
    return result.rows.filter((row) => row.terminated).length;
  } finally {
    await client.end();
  }
}

describe('the pool survives Postgres terminating its idle clients', () => {
  it('logs error.captured, stays up, and the next signed-in GET /api/cases answers 200', async () => {
    const server = await startTestServer();
    try {
      const cookie = await signIn(server);
      assert.equal(await listCases(server, cookie), 200);

      assert.ok((await terminateDeskBackends()) > 0, 'the idle pool held no rai-desk backend');
      const captured = await server.waitForEvent('error.captured');
      assert.equal((captured.fields as { category?: unknown }).category, 'internal_error');

      assert.equal(await listCases(server, cookie), 200);
      assert.equal(server.linesFor('process.stopping').length, 0);
    } finally {
      assert.deepEqual(await server.stop(), { code: 0, signal: null });
    }
  });
});
