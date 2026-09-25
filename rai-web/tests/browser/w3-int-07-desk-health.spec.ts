// OBS09/10/17: worker-produced records through real HTTP, SQL, file sink and Admin UI.
// Workflow setup uses HTTP; operator refresh, correlation selection and locale use the keyboard.
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import pg from 'pg';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { t } from '@rai/shared/locales/keys';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { tabTo } from './support/keyboard.js';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startJourneyServer } from './support/journey-server.js';

test('OBS17: failed send-back and submit timeout correlate once; Admin keyboard and owner denial', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await withIsolatedFixtureDatabase(async (env) => {
    const server = await startJourneyServer(env);
    const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
    const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
    const url = (path: string) => `${server.baseUrl}${path}`;
    const login = async (fixtureUserId: string) => {
      expect(
        (await page.request.post(url('/auth/fixture/sign-in'), { data: { fixtureUserId } })).status(),
      ).toBe(200);
    };
    const records = (event: string, key: string, id: string) =>
      server
        .capturedLines()
        .filter(
          (line) =>
            line.event === event && (line.fields as Record<string, unknown> | undefined)?.[key] === id,
        );
    try {
      await db.connect();
      await server.bindCase(caseId);
      await server.setSubmitTimeout(true);
      await login('fx-user-owner-cm');
      const draftResponse = await page.request.get(url(`/api/cases/${caseId}/draft`));
      expect(draftResponse.status()).toBe(200);
      const draft = (await draftResponse.json()) as PackDraft;
      const submitted = await page.request.post(url(`/api/cases/${caseId}/draft/submit`), {
        headers: { 'idempotency-key': randomUUID() },
        data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      });
      expect(submitted.status()).toBe(201);
      const submitCorrelation = submitted.headers()['x-correlation-id'];
      expect(submitCorrelation).toBeTruthy();
      const qcRows = async () =>
        (
          await db.query<{ id: string; correlation_id: string }>(
            "SELECT id,correlation_id FROM qc_run WHERE version_id=$1 AND trigger='submit' AND status='unavailable' AND unavailable_reason='timeout'",
            [draft.draftId],
          )
        ).rows;
      await expect.poll(async () => (await qcRows()).length, { timeout: 20000 }).toBe(1);
      const qc = (await qcRows())[0]!;
      expect(qc.correlation_id).toBe(submitCorrelation);
      await server.setSubmitTimeout(false);
      // Let ordinary lane notices finish before breaking the sink for the send-back alone.
      await expect
        .poll(
          async () =>
            (
              await db.query(
                "SELECT id FROM notification WHERE case_id=$1 AND event='lane_open' AND status='sent'",
                [caseId],
              )
            ).rowCount,
          { timeout: 15000 },
        )
        .toBe(4);
      await server.setMailFailure(true);
      await login('fx-user-dpo');
      const caseResponse = await page.request.get(url(`/api/cases/${caseId}`));
      expect(caseResponse.status()).toBe(200);
      const current = (await caseResponse.json()) as CaseView;
      const sentBack = await page.request.post(
        url(`/api/cases/${caseId}/versions/${draft.draftId}/lanes/dpo/send-back`),
        {
          headers: { 'idempotency-key': randomUUID() },
          data: {
            expectedVersion: { versionId: draft.draftId, revision: current.caseRevision },
            feedback: { items: [{ slot: 1, deficiency: 'Synthetic OBS17 clarification required' }] },
          },
        },
      );
      expect(sentBack.status()).toBe(201);
      const mailCorrelation = sentBack.headers()['x-correlation-id'];
      expect(mailCorrelation).toBeTruthy();
      const mailRows = async () =>
        (
          await db.query<{
            id: string;
            attempts: number;
            status: string;
            correlation_id: string;
          }>(
            "SELECT id,attempts,status,correlation_id FROM notification WHERE case_id=$1 AND event='send_back'",
            [caseId],
          )
        ).rows;
      await expect
        .poll(async () => (await mailRows()).map((row) => ({ status: row.status, attempts: row.attempts })), {
          timeout: 65000,
        })
        .toEqual([{ status: 'failed', attempts: 4 }]);
      const mail = (await mailRows())[0]!;
      expect(mail.correlation_id).toBe(mailCorrelation);
      await server.setMailFailure(false);
      for (const [event, key, id, correlation] of [
        ['mail.failed', 'notificationId', mail.id, mailCorrelation],
        ['qc.run.unavailable', 'qcRunId', qc.id, submitCorrelation],
        ['error.captured', 'notificationId', mail.id, mailCorrelation],
        ['error.captured', 'qcRunId', qc.id, submitCorrelation],
      ] as const) {
        await expect.poll(() => records(event, key, id).length).toBe(1);
        expect(records(event, key, id)[0]?.correlationId).toBe(correlation);
      }
      expect(records('mail.failed', 'notificationId', mail.id)[0]?.fields).toMatchObject({ attempts: 4 });
      const attempts = records('mail.attempt_failed', 'notificationId', mail.id);
      expect(attempts.map((line) => (line.fields as { attempt: number }).attempt)).toEqual([1, 2, 3]);
      expect(attempts.every((line) => line.correlationId === mailCorrelation)).toBe(true);
      await login('fx-user-admin');
      const reportResponse = await page.request.get(url('/api/operator/desk-health'));
      expect(reportResponse.status()).toBe(200);
      const report = (await reportResponse.json()) as DeskHealthReport;
      const targetMail = report.failedMail.filter((row) => row.notificationId === mail.id);
      expect(targetMail).toHaveLength(1);
      expect(targetMail[0]).toMatchObject({ status: 'failed', attempts: 4, correlationId: mailCorrelation });
      expect(report.unavailableQc.filter((row) => row.qcRunId === qc.id)).toEqual([
        // W0-06 7.2: a submit outage belongs to the pack owner, AI/COE.
        expect.objectContaining({
          reason: 'timeout',
          trigger: 'submit',
          owningLane: 'ai_coe',
          correlationId: submitCorrelation,
        }),
      ]);
      await page.goto(url('/operator/desk-health'));
      for (const locale of ['th', 'en'] as const) {
        if (locale === 'en') {
          await tabTo(page, page.getByRole('button', { name: t('th', 'shell.locale.en'), exact: true }));
          await page.keyboard.press('Enter');
        }
        await expect(
          page.getByRole('heading', { name: t(locale, 'operator.title'), exact: true }),
        ).toBeVisible();
        for (const [heading, id, correlation] of [
          ['operator.failed_mail', mail.id, mailCorrelation],
          ['operator.unavailable_qc', qc.id, submitCorrelation],
        ] as const) {
          const section = page
            .locator('section')
            .filter({ has: page.getByRole('heading', { name: t(locale, heading), exact: true }) });
          const row = section.getByRole('listitem').filter({ has: page.getByText(id, { exact: true }) });
          await expect(row).toHaveCount(1);
          const input = row.getByRole('textbox', {
            name: t(locale, 'operator.correlation_copy', { recordId: id }),
            exact: true,
          });
          await expect(input).toHaveValue(correlation!);
          await expect(input).toHaveAttribute('readonly', '');
          await tabTo(page, input);
          expect(
            await input.evaluate((element: HTMLInputElement) =>
              element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0),
            ),
          ).toBe(correlation);
        }
        const refresh = page.getByRole('button', { name: t(locale, 'operator.refresh'), exact: true });
        await tabTo(page, refresh);
        const refreshed = page.waitForResponse(
          (response) =>
            response.url() === url('/api/operator/desk-health') && response.request().method() === 'GET',
        );
        await page.keyboard.press('Enter');
        expect((await refreshed).status()).toBe(200);
        await expect(page.getByText(mail.id, { exact: true })).toHaveCount(1);
        await expect(page.getByText(qc.id, { exact: true })).toHaveCount(1);
        await expect(refresh).toBeFocused();
        await expectStatusElementsHaveText(page);
        await expectAccessible(page, info, { name: `obs17-admin-${locale}`, lang: locale });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
          true,
        );
      }
      await page.context().clearCookies();
      expect((await page.request.get(url('/api/operator/desk-health'))).status()).toBe(401);
      for (const fixture of [
        'owner-cm-2',
        'spoc-cm',
        'ai-coe',
        'dpo',
        'it-security',
        'dpo-spoc-hr',
        'owner-cm',
      ]) {
        await login(`fx-user-${fixture}`);
        expect((await page.request.get(url('/api/operator/desk-health'))).status()).toBe(403);
      }
      await page.goto(url('/operator/desk-health'));
      await expect(page.getByRole('alert')).toHaveText(t('th', 'error.forbidden'));
      for (const value of [mail.id, qc.id, targetMail[0]!.recipient])
        await expect(page.getByText(value, { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('navigation').getByRole('link', { name: t('th', 'operator.title'), exact: true }),
      ).toHaveCount(0);
      await expectAccessible(page, info, { name: 'obs17-owner-forbidden', lang: 'th' });
      await info.attach('obs17-runtime-correlations', {
        body: JSON.stringify({
          caseId,
          notificationId: mail.id,
          qcRunId: qc.id,
          mailCorrelation,
          submitCorrelation,
          attempts: 4,
        }),
        contentType: 'application/json',
      });
    } finally {
      try {
        await server.stop();
      } finally {
        await db.end();
      }
    }
  });
});
