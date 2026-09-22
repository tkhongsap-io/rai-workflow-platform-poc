// W3-03a/A05: follow the actual file-sink link from the built server. Real DB and fixture identity only.
import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { t } from '@rai/shared/locales/keys';
import type { DeliveryRequest } from '@rai/shared/mail/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { FIXTURE_SET } from './support/database.js';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startTestServer } from '../support/process.js';

test(`file-sink link requires sign-in and scope; Thai text intact — ${FIXTURE_SET}`, async ({
  page,
  context,
}) => {
  await withIsolatedFixtureDatabase(async (env) => {
    const dir = env.MAIL_SINK_DIR!;
    const server = await startTestServer({ built: true, env: { ...env, MAIL_MODE: 'sink-file' } });
    try {
      const signIn = async (fixtureUserId: string) => {
        const res = await page.request.post(`${server.baseUrl}/auth/fixture/sign-in`, {
          data: { fixtureUserId },
          headers: { 'sec-fetch-site': 'same-origin' },
        });
        expect(res.status()).toBe(200);
      };
      await signIn('fx-user-owner-cm');
      const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
      const draft = (await (
        await page.request.get(`${server.baseUrl}/api/cases/${caseId}/draft`)
      ).json()) as PackDraft;
      const response = await page.request.post(`${server.baseUrl}/api/cases/${caseId}/draft/submit`, {
        data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
        headers: { 'idempotency-key': `browser-${draft.draftId}`, 'sec-fetch-site': 'same-origin' },
      });
      expect(response.status()).toBe(201);
      await expect.poll(async () => (await readdir(dir)).filter((n) => n.endsWith('.json')).length).toBe(4);
      const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
      const mail = JSON.parse(await readFile(path.join(dir, names[0]!), 'utf8')) as {
        request: DeliveryRequest;
      };
      expect(mail.request.mail.subject).toBe(t('th', 'mail.lane_opened'));
      const text = await readFile(path.join(dir, names[0]!.replace('.json', '.txt')), 'utf8');
      expect(text).toContain(mail.request.mail.subject);
      const link = mail.request.deepLinks[0]!.url;
      expect(new URL(link).origin).toBe(server.baseUrl);
      await context.clearCookies();
      await page.goto(link);
      await expect(page).toHaveURL(
        `${server.baseUrl}/sign-in?returnTo=${encodeURIComponent(new URL(link).pathname)}`,
      );
      await expect(page.getByLabel(t('th', 'auth.fixture_user_select'))).toBeVisible();
      await signIn('fx-user-owner-cm-2');
      await page.goto(link);
      await expect(page.getByRole('alert')).toContainText(t('th', 'error.forbidden'));
      await signIn('fx-user-dpo');
      await page.goto(link);
      await expect(
        page.getByRole('heading', { level: 1, name: String(mail.request.mail.templateParams.caseName) }),
      ).toBeVisible();
    } finally {
      await server.stop();
    }
  });
});
