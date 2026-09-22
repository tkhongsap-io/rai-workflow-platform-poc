// Controlled-clock worker proof, not a wall-time performance benchmark or operator UI acceptance.
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startJourneyServer } from './support/journey-server.js';

test('real submit timeout and four committed worker failures preserve business state and correlate once', async ({
  page,
}) => {
  test.setTimeout(60000);
  await withIsolatedFixtureDatabase(async (env) => {
    const server = await startJourneyServer(env);
    const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
    await db.connect();
    const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
    const url = (p: string) => `${server.baseUrl}${p}`;
    const login = async (fixtureUserId: string) => {
      expect(
        (await page.request.post(url('/auth/fixture/sign-in'), { data: { fixtureUserId } })).status(),
      ).toBe(200);
    };
    try {
      await server.bindCase(caseId);
      await expect(server.bindCase(findFixtureCase('fx-case-vendor')!.caseId)).rejects.toThrow(
        'control refused',
      );
      await server.setMailFailure(true);
      await server.setSubmitTimeout(true);
      await login('fx-user-owner-cm');
      const draft = (await (await page.request.get(url(`/api/cases/${caseId}/draft`))).json()) as PackDraft;
      const response = await page.request.post(url(`/api/cases/${caseId}/draft/submit`), {
        headers: { 'idempotency-key': 'int-fault-submit' },
        data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      });
      expect(response.status()).toBe(201);
      const correlation = response.headers()['x-correlation-id'];
      const state = async () =>
        (
          await db.query<{ snapshot: unknown }>(
            "SELECT jsonb_build_object('case',to_jsonb(c),'version',to_jsonb(v)) AS snapshot FROM \"case\" c JOIN pack_version v ON v.id=c.current_version_id WHERE c.id=$1",
            [caseId],
          )
        ).rows[0]?.snapshot;
      const before = await state();
      const queue = async () =>
        (await (await page.request.get(url(`/api/queue`))).json()) as {
          items: { caseId: string; lanes: unknown[] }[];
        };
      const frozenDates = (await queue()).items.find((item) => item.caseId === caseId)!.lanes;
      type Notification = { id: string; attempts: number; status: string; correlation_id: string };
      const notifications = async () =>
        (
          await db.query<Notification>(
            'SELECT id,attempts,status,correlation_id FROM notification WHERE case_id=$1 ORDER BY id',
            [caseId],
          )
        ).rows;
      await expect.poll(async () => (await notifications()).filter((n) => n.attempts === 1).length).toBe(4);
      const target = (await notifications())[0]!;
      await expect(server.advanceRetry(target.id, 2)).rejects.toThrow('control refused');
      for (const attempts of [1, 2, 3] as const) {
        await expect
          .poll(async () => (await notifications()).find((n) => n.id === target.id)?.attempts)
          .toBe(attempts);
        await server.advanceRetry(target.id, attempts);
        await expect(server.advanceRetry(target.id, attempts)).rejects.toThrow('control refused');
        await expect
          .poll(async () => (await notifications()).filter((n) => n.attempts === attempts + 1).length)
          .toBe(4);
      }
      expect((await notifications()).every((n) => n.status === 'failed' && n.attempts === 4)).toBe(true);
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT id FROM qc_run WHERE version_id=$1 AND trigger='submit' AND unavailable_reason='timeout'",
                [draft.draftId],
              )
            ).rowCount,
          { timeout: 15000 },
        )
        .toBe(1);
      expect(await state()).toEqual(before);
      expect((await queue()).items.find((item) => item.caseId === caseId)!.lanes).toEqual(frozenDates);
      await server.setMailFailure(false);
      await server.setSubmitTimeout(false);
      await login('fx-user-admin');
      const report = (await (
        await page.request.get(url('/api/operator/desk-health'))
      ).json()) as DeskHealthReport;
      const qc = report.unavailableQc.filter((r) => r.versionId === draft.draftId);
      expect(qc).toHaveLength(1);
      expect(qc[0]?.reason).toBe('timeout');
      expect(qc[0]?.correlationId).toBe(correlation);
      const lines = server.capturedLines();
      const forId = (event: string, key: string, id: string) =>
        lines.filter(
          (line) =>
            line.event === event && (line.fields as Record<string, unknown> | undefined)?.[key] === id,
        );
      expect(forId('qc.run.unavailable', 'qcRunId', qc[0]!.qcRunId)).toHaveLength(1);
      expect(forId('error.captured', 'qcRunId', qc[0]!.qcRunId)).toHaveLength(1);
      for (const n of await notifications()) {
        expect(
          report.failedMail.filter(
            (m) => m.notificationId === n.id && m.attempts === 4 && m.correlationId === n.correlation_id,
          ),
        ).toHaveLength(1);
        expect(forId('mail.failed', 'notificationId', n.id)).toHaveLength(1);
        expect(forId('error.captured', 'notificationId', n.id)).toHaveLength(1);
        expect(forId('mail.failed', 'notificationId', n.id)[0]?.correlationId).toBe(n.correlation_id);
      }
    } finally {
      await server.stop();
      await db.end();
    }
  });
});
