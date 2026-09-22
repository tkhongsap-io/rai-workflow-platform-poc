// W2-07: reviewer workspace on the W1-13/W2-10 substitute (playwright.substitute.config.ts). Findings render
// before decision controls; send-back cannot submit without a named artifact slot; history keeps version N
// unchanged after send-back. Keyboard-only path; axe zero critical and zero serious (section 9). Drive the
// substitute, not the real server. Not W2-INT.

import { test, expect, type Page } from '@playwright/test';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { VersionListResponse } from '@rai/shared/schemas/versions';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';

const RESET_URL = `http://127.0.0.1:${process.env.SUBSTITUTE_PORT ?? '8789'}/__substitute/reset`;
const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
const NONVENDOR_CASE = 'RAI-2000-0001';

async function resetSubstitute(page: Page): Promise<void> {
  const response = await page.request.post(RESET_URL);
  expect(response.status(), 'the substitute reset hook answers 204').toBe(204);
}

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

test.describe('W2-07 reviewer workspace on the W2-10 substitute (fx-case-nonvendor)', () => {
  test.beforeEach(async ({ page }) => {
    await resetSubstitute(page);
  });

  test('keyboard send-back: findings before controls, empty submit stays, history keeps v1, axe clean', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await signInAsFixture(page, AI_COE);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);

    // Findings (or empty/unavailable) must appear before the decision controls are drawn.
    await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
    const findingsBeforeControls = await page.evaluate(() => {
      const findings = document.querySelector('[data-review-qc]');
      const controls = document.querySelector('[data-review-controls="ready"]');
      if (findings === null || controls === null) return false;
      return Boolean(findings.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(findingsBeforeControls, 'findings render before decision controls').toBe(true);
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: t('th', 'review.findings.heading', { lane: t('th', 'lane.ai_coe') }),
      }),
    ).toBeVisible();
    // fx-case-nonvendor ai_coe scripts a classic-ML metric finding on slot 1.
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible();
    await expect(page.locator('[data-status="medium"]').first()).toContainText(
      t('th', 'finding.severity.medium'),
    );

    // Admin never sees decision controls on the same version.
    await signOut(page);
    await signInAsFixture(page, ADMIN);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('th', 'review.action.send_back') })).toHaveCount(0);

    // Owner neither.
    await signOut(page);
    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);

    // Back to AI/COE for the keyboard send-back path.
    await signOut(page);
    await signInAsFixture(page, AI_COE);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-controls="ready"]')).toBeVisible();

    const sendBackLabel = t('th', 'review.action.send_back');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === sendBackLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t('th', 'review.send_back.title') });
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);

    // Empty submit stays on the dialog (A09 / W2-07).
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.send_back.submit'),
      12,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText(t('th', 'review.send_back.slot_required'));

    // Name BRD (slot 5) and send back.
    await dialog.getByLabel(t('th', 'review.send_back.slot_label'), { exact: false }).selectOption('5');
    await dialog
      .getByLabel(t('th', 'review.send_back.deficiency_label'), { exact: false })
      .fill('BRD needs a cited metric before AI/COE can approve');
    await dialog.getByRole('button', { name: t('th', 'review.send_back.submit') }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.send_back') }),
    ).toBeVisible();

    // History: successor draft + frozen v1; opening v1 still shows the frozen pack and no decision controls.
    const nav = page.getByRole('navigation', { name: t('th', 'version.nav_heading') });
    await expect(nav.getByRole('link')).toHaveCount(2);
    await expect(nav).toContainText(t('th', 'version.nav_draft', { number: 2 }));
    await expect(nav).toContainText(t('th', 'version.nav_submitted', { number: 1 }));

    const before = (await (await page.request.get(`/api/cases/${caseId}/versions/${versionId}`)).json()) as {
      versionNumber: number;
      slots: unknown;
    };
    await nav.getByRole('link', { name: t('th', 'version.nav_submitted', { number: 1 }) }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    const after = (await (await page.request.get(`/api/cases/${caseId}/versions/${versionId}`)).json()) as {
      versionNumber: number;
      slots: unknown;
    };
    expect(after.slots).toEqual(before.slots);
    expect(after.versionNumber).toBe(1);

    const versions = (await (
      await page.request.get(`/api/cases/${caseId}/versions`)
    ).json()) as VersionListResponse;
    expect(versions.items.map((v) => v.versionNumber)).toEqual([1]);

    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    const axe = await expectAccessible(page, testInfo, { name: 'reviewer-send-back-th', lang: 'th' });
    expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
