// Synthetic real-HTTP race: no SQL writes to business/QC/diagnostic rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import type { startServer as StartServer } from '@rai/server/start';
import { BUNDLED_QC_SCRIPTS, ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { QcRunRequest, QcRunResult } from '@rai/shared/qc/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { withIsolatedFixtureDatabase } from '../../browser/support/isolated-database.js';
import { freeLoopbackPort, testServerEnv } from '../process.js';

type Start = typeof StartServer;
export async function lateSubmitScenario(startServer: Start): Promise<void> {
  await withIsolatedFixtureDatabase(async (env) => {
    const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
    await db.connect();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let submitCalls = 0;
    const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
    class HeldSubmitRunner extends ScriptedQcRunner {
      override async run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult> {
        if (request.trigger === 'submit') {
          submitCalls++;
          entered();
          await gate;
        }
        return super.run(request, signal);
      }
    }
    const runner = new HeldSubmitRunner({
      fixtureCaseIdOf: (version) => (version.caseId === caseId ? 'fx-case-nonvendor' : undefined),
    });
    const findings = BUNDLED_QC_SCRIPTS.find(
      (script) => script.fixtureCaseId === 'fx-case-nonvendor',
    )!.entries.find((entry) => entry.trigger === 'approve_attempt' && entry.lane === 'ai_coe')!.findings;
    runner.script({ fixtureCaseId: 'fx-case-nonvendor', trigger: 'submit' }, structuredClone(findings));
    for (const lane of ['dpo', 'ai_coe', 'it_security'] as const)
      runner.script({ fixtureCaseId: 'fx-case-nonvendor', trigger: 'approve_attempt', lane }, []);
    const port = await freeLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const serverEnv = testServerEnv(port, env);
    let server = await startServer(serverEnv, { qcRunner: runner });
    async function signIn(fixtureUserId: string) {
      const response = await fetch(`${origin}/auth/fixture/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixtureUserId }),
      });
      assert.equal(response.status, 200);
      return response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
    }
    async function post(url: string, cookie: string, body: unknown) {
      return fetch(origin + url, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify(body),
      });
    }
    async function snapshot(versionId: string) {
      const queries = [
        ['case', 'SELECT * FROM "case" WHERE id=$1', caseId],
        ['version', 'SELECT * FROM pack_version WHERE id=$1', versionId],
        ['runs', 'SELECT * FROM qc_run WHERE version_id=$1 ORDER BY id', versionId],
        ['findings', 'SELECT * FROM qc_finding WHERE version_id=$1 ORDER BY id', versionId],
        ['decisions', 'SELECT * FROM lane_decision WHERE version_id=$1 ORDER BY id', versionId],
        ['audit', 'SELECT * FROM audit_event WHERE target_case_id=$1 ORDER BY seq', caseId],
      ] as const;
      return Object.fromEntries<Record<string, unknown>[]>(
        await Promise.all(
          queries.map(
            async ([key, sql, id]) =>
              [key, (await db.query<Record<string, unknown>>(sql, [id])).rows] as const,
          ),
        ),
      );
    }
    try {
      const owner = await signIn('fx-user-owner-cm');
      const draft = (await (
        await fetch(`${origin}/api/cases/${caseId}/draft`, { headers: { cookie: owner } })
      ).json()) as PackDraft;
      const expectedVersion = { versionId: draft.draftId, revision: draft.draftRevision };
      const submit = await post(`/api/cases/${caseId}/draft/submit`, owner, { expectedVersion });
      assert.equal(submit.status, 201);
      const correlationId = submit.headers.get('x-correlation-id');
      await started;
      for (const [lane, user] of [
        ['dpo', 'fx-user-dpo'],
        ['ai_coe', 'fx-user-ai-coe'],
        ['it_security', 'fx-user-it-security'],
      ] as const) {
        const cookie = await signIn(user);
        const base = `/api/cases/${caseId}/versions/${draft.draftId}/lanes/${lane}`;
        const qc = await post(`${base}/qc-run`, cookie, { expectedVersion });
        assert.equal(qc.status, 200);
        const result = (await qc.json()) as { runId: string };
        const approval = await post(`${base}/approve`, cookie, { expectedVersion, qcRunId: result.runId });
        assert.equal(approval.status, 201);
        const decision = (await approval.json()) as { ready: boolean };
        assert.equal(decision.ready, lane === 'it_security');
      }
      const before = await snapshot(draft.draftId);
      assert.equal(submitCalls, 1);
      assert.equal(
        (
          await db.query<{ ready_at: Date | null }>('SELECT ready_at FROM pack_version WHERE id=$1', [
            draft.draftId,
          ])
        ).rows[0]?.ready_at instanceof Date,
        true,
      );
      release();
      let late: Record<string, unknown>[] = [];
      for (let i = 0; i < 200; i++) {
        late = (
          await db.query('SELECT * FROM qc_late_result WHERE version_id=$1 ORDER BY id', [draft.draftId])
        ).rows as Record<string, unknown>[];
        if (late.length) break;
        await delay(25);
      }
      assert.equal(late.length, 1);
      assert.equal(late[0]?.trigger, 'submit');
      assert.equal(late[0]?.correlation_id, correlationId);
      assert.equal(late[0]?.status, 'completed');
      assert.ok(Number(late[0]?.refused_finding_count) > 0);
      assert.deepEqual(await snapshot(draft.draftId), before);
      const admin = await signIn('fx-user-admin');
      async function report() {
        const response = await fetch(`${origin}/api/operator/desk-health`, { headers: { cookie: admin } });
        assert.equal(response.status, 200);
        return (await response.json()) as DeskHealthReport;
      }
      const first = (await report()).lateQc.filter((row) => row.versionId === draft.draftId);
      assert.equal(first.length, 1);
      assert.equal(first[0]?.correlationId, correlationId);
      const oldApp = server.fastify;
      await server.close();
      server = await startServer(serverEnv, { qcRunner: runner });
      assert.notEqual(server.fastify, oldApp);
      assert.deepEqual(
        (await report()).lateQc.filter((row) => row.versionId === draft.draftId),
        first,
      );
      assert.deepEqual(await snapshot(draft.draftId), before);
      assert.equal(
        (await db.query('SELECT id FROM qc_late_result WHERE version_id=$1', [draft.draftId])).rowCount,
        1,
      );
      assert.equal(submitCalls, 1);
    } finally {
      release();
      await server.close();
      await db.end();
    }
  });
}
