// W5-09 (W5 plan section 7, "Queue and case list") on the real server: a tier chip on each queue and case-list card
// whose case has a proposed tier, with the tier's text always visible (never colour alone), no chip for a case without
// one, and the SYNTHETIC PLACEHOLDER banner once when any card shows a tier (D07 open). Thai and English; axe with no
// critical or serious violation at the three widths (projects). No tier filter (W6-16).
// Fixture set slice1-synthetic@1: RAI-2000-0001 (slot 1 attached), fx-user-owner-cm owns every fixture case.

import { test, expect, type Page } from './support/real-test.js';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { signInAsFixture } from './support/sign-in.js';
import { FIXTURE_SET } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const REVIEWER = 'fx-user-ai-coe';
const CASE = 'RAI-2000-0001';
const THREE_HIGH = { RQ1: 'public', RQ2: 'automated', RQ4: 'customers' };

const cards = (page: Page) => page.locator('article[data-registry-id]');
const card = (page: Page, registryId: string) => page.locator(`article[data-registry-id="${registryId}"]`);
const chips = (page: Page) => page.locator('[data-risk-tier]');
const banner = (page: Page) => page.locator('[data-placeholder-rubric]');

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const row = ((await response.json()) as CaseListResponse).items.find((i) => i.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function answerAndSubmit(page: Page, caseId: string): Promise<void> {
  const draft = (await (await page.request.get(`/api/cases/${caseId}/draft`)).json()) as PackDraft;
  const saved = await page.request.put(`/api/cases/${caseId}/draft`, {
    data: {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
      riskAnswers: THREE_HIGH,
    },
  });
  expect(saved.status()).toBe(200);
  const next = (await saved.json()) as PackDraft;
  const submitted = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { expectedVersion: { versionId: next.draftId, revision: next.draftRevision } },
  });
  expect(submitted.status()).toBe(201);
}

async function openList(page: Page, path: '/queue' | '/cases'): Promise<void> {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible({ timeout: 15_000 });
}

test.describe(`W5-09 risk tier on the queue and case list on the real server (${FIXTURE_SET})`, () => {
  test('no chip and no banner before any submit; after a High submit one chip, the banner, th and en; axe', async ({
    page,
  }, testInfo) => {
    await signInAsFixture(page, OWNER);
    for (const path of ['/queue', '/cases'] as const) {
      await openList(page, path);
      await expect(chips(page)).toHaveCount(0);
      await expect(banner(page)).toHaveCount(0);
    }

    await answerAndSubmit(page, await caseIdOf(page, CASE));

    await signInAsFixture(page, REVIEWER);
    for (const path of ['/queue', '/cases'] as const) {
      await openList(page, path);
      const chip = card(page, CASE).locator('[data-risk-tier]');
      await expect(chip).toHaveAttribute('data-risk-tier', 'high');
      await expect(chip).toContainText(t('th', 'risk.list.tier'));
      await expect(chip).toContainText(t('th', 'risk.tier.high'));
      await expect(chips(page), 'only the submitted case has a tier').toHaveCount(1);
      await expect(banner(page)).toHaveCount(1);
      await expect(banner(page)).toHaveAttribute('role', 'note');
      await expect(banner(page)).toHaveText(t('th', 'risk.placeholder.banner'));
      await expectStatusElementsHaveText(page);
      await expectAccessible(page, testInfo, { name: `w5-09${path.replace('/', '-')}-th`, lang: 'th' });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        'no horizontal page scroll',
      ).toBeLessThanOrEqual(0);
    }

    const res = await page.request.post('/api/session/locale', { data: { locale: 'en' } });
    expect(res.status()).toBe(204);
    for (const path of ['/queue', '/cases'] as const) {
      await openList(page, path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      const chip = card(page, CASE).locator('[data-risk-tier]');
      await expect(chip).toContainText(t('en', 'risk.list.tier'));
      await expect(chip).toContainText(t('en', 'risk.tier.high'));
      await expect(banner(page)).toHaveText(t('en', 'risk.placeholder.banner'));
      await expectAccessible(page, testInfo, { name: `w5-09${path.replace('/', '-')}-en`, lang: 'en' });
    }
  });
});
