// Real HTTP transitions and persisted SQL evidence; scripted QC is not model acceptance.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { t } from '@rai/shared/locales/keys';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { VersionFindingsResponse } from '@rai/shared/schemas/review';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startJourneyServer } from './support/journey-server.js';
import { expectAccessible } from './support/axe.js';
import { tabTo } from './support/keyboard.js';

async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}
const actors = { ai_coe: 'fx-user-ai-coe', dpo: 'fx-user-dpo', it_security: 'fx-user-it-security' } as const;
for (const completion of ['approval', 'disposition'] as const) {
  test(`Ready after final ${completion}: persisted read-only reviewer and owner reload`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    await withIsolatedFixtureDatabase(async (env) => {
      const server = await startJourneyServer(env);
      const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
      await db.connect();
      const origin = server.baseUrl;
      const signIn = async (fixtureUserId: string) => {
        expect(
          (await page.request.post(`${origin}/auth/fixture/sign-in`, { data: { fixtureUserId } })).status(),
        ).toBe(200);
      };
      const post = async (url: string, data: unknown, status: number) => {
        const response = await page.request.post(origin + url, {
          data,
          headers: { 'idempotency-key': randomUUID() },
        });
        expect(response.status()).toBe(status);
        return response;
      };
      try {
        await signIn('fx-user-owner-cm');
        const list = (await (
          await page.request.get(`${origin}/api/cases?pageSize=100`)
        ).json()) as CaseListResponse;
        const caseId = list.items.find((c) => c.registryId === 'RAI-2000-0001')!.caseId;
        await server.bindCase(caseId);
        const draft = (await (
          await page.request.get(`${origin}/api/cases/${caseId}/draft`)
        ).json()) as PackDraft;
        const submitted = await post(
          `/api/cases/${caseId}/draft/submit`,
          { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
          201,
        );
        const { versionId } = (await submitted.json()) as { versionId: string };
        const expectedVersion = { versionId, revision: 1 };
        const apiPath = `/api/cases/${caseId}/versions/${versionId}`;
        const route = `${origin}/cases/${caseId}/versions/${versionId}`;
        await expect
          .poll(
            async () =>
              (
                await db.query<{ status: string }>(
                  "SELECT status FROM qc_run WHERE version_id=$1 AND trigger='submit'",
                  [versionId],
                )
              ).rows,
          )
          .toEqual([{ status: 'completed' }]);
        const runs = new Map<string, string>();
        for (const [lane, user] of Object.entries(actors)) {
          await signIn(user);
          const qc = await post(`${apiPath}/lanes/${lane}/qc-run`, { expectedVersion }, 200);
          const result = (await qc.json()) as { runId: string; status: string };
          expect(result.status).toBe('completed');
          runs.set(lane, result.runId);
        }
        const listed = (await (
          await page.request.get(origin + apiPath + '/findings')
        ).json()) as VersionFindingsResponse;
        expect(listed.findings.length).toBeGreaterThan(0);
        const last = listed.findings.find((f) => f.owningLane === 'ai_coe')!;
        expect(last).toBeTruthy();
        for (const finding of listed.findings) {
          if (completion === 'disposition' && finding.findingId === last.findingId) continue;
          await signIn(actors[finding.owningLane]);
          const fixed = await post(
            `/api/cases/${caseId}/findings/${finding.findingId}/dispositions`,
            { expectedVersion, kind: 'fixed' },
            201,
          );
          expect(((await fixed.json()) as { ready: boolean }).ready).toBe(false);
        }
        for (const [lane, user] of Object.entries(actors)) {
          if (completion === 'approval' && lane === 'it_security') continue;
          await signIn(user);
          const decision = await post(
            `${apiPath}/lanes/${lane}/approve`,
            { expectedVersion, qcRunId: runs.get(lane) },
            201,
          );
          expect(((await decision.json()) as { ready: boolean }).ready).toBe(false);
        }
        await signIn(completion === 'approval' ? actors.it_security : actors.ai_coe);
        await page.goto(route);
        await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
        const target =
          completion === 'approval'
            ? page.getByRole('button', { name: t('th', 'review.action.approve'), exact: true })
            : page.locator(`[data-finding-id="${last.findingId}"] [data-disposition-kind-action="fixed"]`);
        const suffix =
          completion === 'approval'
            ? '/lanes/it_security/approve'
            : `/findings/${last.findingId}/dispositions`;
        const mutations: string[] = [];
        let completed = false;
        let readyGets = 0;
        page.on('request', (request) => {
          if (completed && request.method() === 'POST' && request.url().includes('/api/cases/'))
            mutations.push(request.url());
        });
        page.on('response', (response) => {
          if (
            completed &&
            response.request().method() === 'GET' &&
            response.url() === origin + apiPath + '/findings' &&
            response.status() === 200
          )
            readyGets++;
          if (response.request().method() === 'POST' && response.url().endsWith(suffix)) completed = true;
        });
        const decision = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith(suffix),
        );
        await activate(page, target);
        const final = await decision;
        expect(final.status()).toBe(201);
        expect(((await final.json()) as { ready: boolean }).ready).toBe(true);
        await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
        await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(
          page.locator('[data-disposition-kind-action], [data-review-controls="ready"]'),
        ).toHaveCount(0);
        expect(mutations).toEqual([]);
        await expect.poll(() => readyGets).toBeGreaterThan(0);
        const snapshot = async () => {
          const rows: Record<string, unknown>[][] = [];
          for (const query of [
            'SELECT * FROM qc_run WHERE version_id=$1 ORDER BY id',
            'SELECT * FROM qc_finding WHERE version_id=$1 ORDER BY id',
            'SELECT d.* FROM disposition_event d JOIN qc_finding f ON f.id=d.finding_id WHERE f.version_id=$1 ORDER BY d.id',
            'SELECT * FROM audit_event WHERE target_version_id=$1 ORDER BY id',
          ])
            rows.push((await db.query<Record<string, unknown>>(query, [versionId])).rows);
          return rows;
        };
        const before = await snapshot();
        for (const user of [actors.it_security, actors.ai_coe, 'fx-user-owner-cm']) {
          await signIn(user);
          for (const reload of [false, true]) {
            const get = page.waitForResponse(
              (r) => r.request().method() === 'GET' && r.url() === origin + apiPath + '/findings',
            );
            if (reload) await page.reload();
            else await page.goto(route);
            expect((await get).status()).toBe(200);
            await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
            if (user === actors.it_security) {
              await expect(page.locator('[data-review-qc="empty"]')).toContainText(
                t('th', 'review.findings.empty'),
              );
              await expect(page.locator('[data-finding-id]')).toHaveCount(0);
            } else {
              await expect(
                page.locator(`[data-finding-id="${last.findingId}"] [data-disposition-kind="fixed"]`),
              ).toBeVisible();
            }
            await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
            await expect(page.getByRole('alert')).toHaveCount(0);
            await expect(
              page.locator('[data-disposition-kind-action], [data-review-controls="ready"]'),
            ).toHaveCount(0);
            expect(mutations).toEqual([]);
          }
          await expectAccessible(page, info, { name: `ready-${completion}-${user}`, lang: 'th' });
          await info.attach(`ready-${completion}-${user}`, {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          });
        }
        expect(await snapshot()).toEqual(before);
        // Real server denials stay intact; these explicit API probes are not page mutations.
        await signIn(actors.ai_coe);
        await post(`${apiPath}/lanes/ai_coe/qc-run`, { expectedVersion }, 409);
        await post(
          `/api/cases/${caseId}/findings/${last.findingId}/dispositions`,
          { expectedVersion, kind: 'fixed' },
          409,
        );
        await signIn('fx-user-owner-cm-2');
        await page.goto(route);
        await expect(page.getByRole('alert').first()).toContainText(t('th', 'error.forbidden'));
      } finally {
        try {
          await server.stop();
        } finally {
          await db.end();
        }
      }
    });
  });
}
