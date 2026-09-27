// W7-03 (W7 plan sections 3.3 and 7): the real built server, on an isolated synthetic database whose journal holds
// one migration this build does not know, recorded additive in schema_migration_class, reports readiness `ahead`
// (ready, served), and the Admin desk-health screen shows it as a warning with the additive note, th and en,
// keyboard-only locale switch, axe clean, at every project width.
import { expect, test } from '@playwright/test';
import pg from 'pg';
import { t } from '@rai/shared/locales/keys';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { tabTo } from './support/keyboard.js';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startTestServer } from '../support/process.js';

const SYNTHETIC_HASH = 'w703-synthetic-additive-migration-from-a-newer-build';

test('W7-03: readiness ahead by an additive migration is ready and shown as a warning on desk health', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await withIsolatedFixtureDatabase(async (env) => {
    // A newer build's `npm run migrate` ran one additive migration after this build's last one.
    const owner = new pg.Client({ connectionString: env.DATABASE_MIGRATE_URL });
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await owner.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, max(created_at) + 1 FROM drizzle.__drizzle_migrations`,
        [SYNTHETIC_HASH],
      );
      await owner.query(
        `INSERT INTO schema_migration_class (hash, tag, rollback_class) VALUES ($1, '9999_w7_03_synthetic_newer', 'additive')`,
        [SYNTHETIC_HASH],
      );
      await owner.query('COMMIT');
    } finally {
      await owner.end();
    }
    const server = await startTestServer({ built: true, env: { ...env, MAIL_MODE: 'sink-file' } });
    try {
      const ready = await page.request.get(`${server.baseUrl}/readyz`);
      expect(ready.status()).toBe(200);
      const report = (await ready.json()) as ReadinessReport;
      expect(report.status).toBe('ready');
      expect(report.store.migrations).toBe('ahead');

      const signedIn = await page.request.post(`${server.baseUrl}/auth/fixture/sign-in`, {
        data: { fixtureUserId: 'fx-user-admin' },
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(signedIn.status()).toBe(200);
      // A business route is served while ahead (the gate closes only on pending).
      expect((await page.request.get(`${server.baseUrl}/api/cases`)).status()).toBe(200);
      await page.goto(`${server.baseUrl}/operator/desk-health`);
      for (const locale of ['th', 'en'] as const) {
        if (locale === 'en') {
          await tabTo(page, page.getByRole('button', { name: t('th', 'shell.locale.en'), exact: true }));
          await page.keyboard.press('Enter');
        }
        await expect(
          page.getByRole('heading', { name: t(locale, 'operator.title'), exact: true }),
        ).toBeVisible();
        const row = page
          .locator('dl > div')
          .filter({ has: page.locator('dt', { hasText: t(locale, 'operator.field.migrations') }) });
        await expect(row).toHaveCount(1);
        const badge = row.locator('[data-status="ahead"]');
        await expect(badge).toHaveAttribute('data-tone', 'warn');
        await expect(badge).toContainText(t(locale, 'operator.value.ahead'));
        await expect(row).toContainText(t(locale, 'operator.field.migrations_ahead_note'));
        await expectStatusElementsHaveText(page);
        await expectAccessible(page, info, { name: `w7-03-ahead-${locale}`, lang: locale });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
          true,
        );
      }
    } finally {
      await server.stop();
    }
  });
});
