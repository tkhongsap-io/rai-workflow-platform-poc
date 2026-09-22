// W2-INT: the W2-07 reviewer workspace journey promoted to evidence against the REAL server (built SPA served by
// `node server/dist/main.js` on the real Postgres in fixture identity mode; playwright.config.ts). Same keyboard
// and axe coverage as the W2-07 substitute spec; the database is reset to fixture set slice1-synthetic@1 through
// support/database.ts before every test. Proves A09/A07 at the browser layer. Fixture ids: fx-case-nonvendor
// (RAI-2000-0001); users fx-user-owner-cm, fx-user-ai-coe, fx-user-admin.

import { test, expect, type Page } from '@playwright/test';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, pressTab, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET, resetToFixtureSet } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
const NONVENDOR_CASE = 'RAI-2000-0001';

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function submitNonvendor(page: Page): Promise<{ caseId: string; versionId: string }> {
  await signInAsFixture(page, OWNER);
  const caseId = await caseIdOf(page, NONVENDOR_CASE);
  const draftResponse = await page.request.get(`/api/cases/${caseId}/draft`);
  expect(draftResponse.status()).toBe(200);
  const draft = (await draftResponse.json()) as PackDraft;
  const submit = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
    data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  expect(submit.status()).toBe(201);
  const version = (await submit.json()) as { versionId: string; versionNumber: number };
  return { caseId, versionId: version.versionId };
}

async function openAsReviewer(page: Page, caseId: string, versionId: string): Promise<void> {
  await signInAsFixture(page, AI_COE);
  await page.goto(`/cases/${caseId}/versions/${versionId}`);
  await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, 'no horizontal page scroll (section 9, item 7)').toBeLessThanOrEqual(
    overflow.innerWidth,
  );
}

async function expectFocusInsideDialog(page: Page): Promise<void> {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
  });
  expect(inside, 'focus stays inside the open dialog (section 9, item 3)').toBe(true);
}

function frozenPack(page: Page) {
  return page.locator('section.card').filter({ hasText: t('th', 'version.frozen_note') });
}

test.beforeEach(async () => {
  await resetToFixtureSet();
});

test.describe(`W2-INT reviewer workspace on the real server (${FIXTURE_SET}; fx-case-nonvendor)`, () => {
  test('keyboard send-back: findings before controls, dialog focus, frozen N unchanged, axe th+en', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await openAsReviewer(page, caseId, versionId);

    const findingsBeforeControls = await page.evaluate(() => {
      const findings = document.querySelector('[data-review-qc]');
      const controls = document.querySelector('[data-review-controls="ready"]');
      if (findings === null || controls === null) return false;
      return Boolean(findings.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(findingsBeforeControls, 'findings render before decision controls').toBe(true);
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible();
    await expect(page.locator('[data-review-qc="findings"]')).toContainText('v1.0 Sheet3');
    await expect(page.locator('[data-review-qc="findings"]')).not.toContainText('{threshold_source}');

    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-findings-controls-th', lang: 'th' });

    const frozenBefore = await frozenPack(page).innerText();
    expect(frozenBefore.length).toBeGreaterThan(0);

    await signOut(page);
    await signInAsFixture(page, ADMIN);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await signOut(page);
    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);

    await signOut(page);
    await openAsReviewer(page, caseId, versionId);

    const sendBackLabel = t('th', 'review.action.send_back');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === sendBackLabel, 80);
    await expectVisibleFocus(page);
    const sendBackButton = page.getByRole('button', { name: sendBackLabel });
    await expect(sendBackButton).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: t('th', 'review.send_back.title') });
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-send-back-dialog-th', lang: 'th' });

    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.send_back.submit'),
      12,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText(t('th', 'review.send_back.slot_required'));

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(sendBackButton).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    await tabUntil(page, (info) => info.tag === 'textarea', 8);
    await page.keyboard.type('draft deficiency');
    const asked: string[] = [];
    page.once('dialog', (confirm) => {
      asked.push(confirm.message());
      void confirm.dismiss();
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect(asked).toEqual([t('th', 'dialog.discard_confirm')]);
    await expect(
      dialog.getByRole('textbox', { name: t('th', 'review.send_back.deficiency_label'), exact: false }),
    ).toHaveValue('draft deficiency');
    page.once('dialog', (confirm) => {
      asked.push(confirm.message());
      void confirm.accept();
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(asked).toHaveLength(2);
    await expect(sendBackButton).toBeFocused();

    // Name slot 1 (single-lane AI/COE document); not slot-5 / pack-level disposition invention.
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    const slotSelect = dialog.locator('select');
    await expect(slotSelect).toBeFocused();
    const slotOneLabel = t('th', 'review.send_back.slot_option', {
      number: 1,
      name: t('th', 'slot.s1.name'),
    });
    await slotSelect.selectOption('1');
    await expect(slotSelect.locator('option:checked')).toHaveText(slotOneLabel);
    await expect(slotSelect).toHaveValue('1');
    await pressTab(page);
    await expect(dialog.locator('textarea').first()).toBeFocused();
    await page.keyboard.type('Use-case brief needs a cited metric before AI/COE can approve');
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.send_back.submit'),
      8,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.send_back') }),
    ).toBeVisible();

    const nav = page.getByRole('navigation', { name: t('th', 'version.nav_heading') });
    await expect(nav.getByRole('link')).toHaveCount(2);
    await expect(nav).toContainText(t('th', 'version.nav_draft', { number: 2 }));
    await expect(nav).toContainText(t('th', 'version.nav_submitted', { number: 1 }));

    await tabUntil(
      page,
      (info) => info.tag === 'a' && info.text.includes(t('th', 'version.nav_submitted', { number: 1 })),
      40,
    );
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    const frozenAfter = await frozenPack(page).innerText();
    expect(frozenAfter, 'frozen version N text is unchanged after send-back').toBe(frozenBefore);

    const locale = await page.request.post('/api/session/locale', { data: { locale: 'en' } });
    expect(locale.status()).toBe(204);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('heading', { level: 2, name: t('en', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-frozen-v1-en', lang: 'en' });
  });

  test('keyboard approve records the notice and sends qcRunId', async ({ page }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await openAsReviewer(page, caseId, versionId);
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-before-approve-th', lang: 'th' });

    const approveLabel = t('th', 'review.action.approve');
    const approvePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && /\/lanes\/ai_coe\/approve$/.test(req.url()),
    );
    await tabUntil(page, (info) => info.tag === 'button' && info.text === approveLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    const request = await approvePromise;
    const body = request.postDataJSON() as { qcRunId?: string; expectedVersion?: unknown };
    expect(body.qcRunId, 'approve carries the qcRunId the reviewer saw').toBeTruthy();
    expect(typeof body.qcRunId).toBe('string');
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.approve') }),
    ).toBeVisible();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-after-approve-th', lang: 'th' });
  });
});
