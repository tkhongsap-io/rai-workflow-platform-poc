// Real HTTP transaction boundary: no direct QC invocation and no fabricated business rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { startServer } from '@rai/server/start';
import type { QcRunRequest } from '@rai/shared/qc/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { withIsolatedFixtureDatabase } from '../../browser/support/isolated-database.js';
import { freeLoopbackPort, testServerEnv } from '../process.js';

// Test-only canary for the parent capture control.
if (process.env.OBS_SUBMIT_CHILD_CANARY === '1') process.stdout.write('RAI-DESK-SYNTHETIC-FIXTURE\n');

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await delay(25);
  }
  assert.fail('persisted state was not reached');
}
test('committed submit boundary inside captured child', async () => {
  await withIsolatedFixtureDatabase(async (env) => {
    const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
    await db.connect();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: QcRunRequest[] = [];
    let committed = false;
    const port = await freeLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const server = await startServer(testServerEnv(port, env), {
      qcRunner: {
        identity: { runner: 'synthetic-binding', runnerVersion: '1' },
        probe: () => Promise.resolve('ok'),
        async run(request) {
          calls.push(request);
          const row = await db.query<{ submitted_at: Date | null }>(
            'SELECT submitted_at FROM pack_version WHERE id=$1',
            [request.version.versionId],
          );
          committed = row.rows[0]?.submitted_at instanceof Date;
          await gate;
          throw new Error('Synthetic runner failure after commit');
        },
      },
    });
    let closed = false;
    try {
      const login = await fetch(`${origin}/auth/fixture/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixtureUserId: 'fx-user-owner-cm' }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
      const draft = (await (
        await fetch(`${origin}/api/cases/${caseId}/draft`, { headers: { cookie } })
      ).json()) as PackDraft;
      const body = { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } };
      const post = (key: string, payload: unknown, auth = cookie) =>
        fetch(`${origin}/api/cases/${caseId}/draft/submit`, {
          method: 'POST',
          headers: { cookie: auth, 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(payload),
        });
      assert.equal((await post('unauth', body, '')).status, 401);
      assert.equal(
        (
          await post('stale', {
            expectedVersion: { ...body.expectedVersion, revision: draft.draftRevision + 1 },
          })
        ).status,
        409,
      );
      assert.equal(calls.length, 0);
      const fresh = await post('fresh-submit', body);
      assert.equal(fresh.status, 201); // gate still closed: response never waits for runner
      const correlation = fresh.headers.get('x-correlation-id');
      const response = await fresh.text();
      await until(async () => {
        await Promise.resolve();
        return calls.length === 1 && committed;
      });
      assert.equal(calls[0]?.trigger, 'submit');
      assert.equal(calls[0]?.lane, null);
      assert.equal(calls[0]?.correlationId, correlation);
      const replay = await post('fresh-submit', body);
      assert.equal(replay.status, 201);
      assert.equal(await replay.text(), response);
      assert.equal((await post('another-key', body)).status, 409);
      assert.equal(calls.length, 1);
      const closing = server.close().then(() => {
        closed = true;
      });
      await delay(25);
      assert.equal(closed, false); // shutdown tracks the still-pending submit runner
      release();
      await closing;
      const qc = await db.query<{
        status: string;
        unavailable_reason: string;
        correlation_id: string;
        lane: null;
      }>(
        "SELECT status,unavailable_reason,correlation_id,lane FROM qc_run WHERE version_id=$1 AND trigger='submit'",
        [draft.draftId],
      );
      assert.deepEqual(qc.rows, [
        {
          status: 'unavailable',
          unavailable_reason: 'runner_error',
          correlation_id: correlation,
          lane: null,
        },
      ]);
      const version = await db.query<{ submitted_at: Date | null }>(
        'SELECT submitted_at FROM pack_version WHERE id=$1',
        [draft.draftId],
      );
      assert.ok(version.rows[0]?.submitted_at);
      assert.equal(calls.length, 1);
    } finally {
      release();
      if (!closed) await server.close();
      await db.end();
    }
  });
});
