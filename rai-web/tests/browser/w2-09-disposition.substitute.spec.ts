// W2-09: findings and disposition UI on the W2-10 substitute (playwright.substitute.config.ts). Owning-lane
// reviewer reaches fixed / waived / N/A by keyboard; waived/N/A require a reason; a finding never disappears
// after disposition; axe zero critical and zero serious. Owner cannot load qc-run (lane.approve), so no
// disposition controls in the UI; propose-fixed is covered by the view-model unit test plus one substitute
// API path. fixed_confirmed kinds are unit-tested (overlay from this visit's POST). Drive the substitute,
// not the real server. Not W2-INT. Issue #35 stays open.

import { test, expect, type Page } from '@playwright/test';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { DispositionResponse } from '@rai/shared/schemas/review';
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

async function openAsReviewer(page: Page, caseId: string, versionId: string): Promise<void> {
  await signInAsFixture(page, AI_COE);
  await page.goto(`/cases/${caseId}/versions/${versionId}`);
  await expect(page.locator('[data-review-qc="findings"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
}

async function expectFocusInsideDialog(page: Page): Promise<void> {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
  });
  expect(inside, 'focus stays inside the open dialog (section 9, item 3)').toBe(true);
}

test.describe('W2-09 disposition UI on the W2-10 substitute (fx-case-nonvendor)', () => {
  test.beforeEach(async ({ page }) => {
    await resetSubstitute(page);
  });

  test('keyboard waive: finding stays, empty reason stays, axe, owner has no controls', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await openAsReviewer(page, caseId, versionId);

    const findings = page.locator('[data-review-qc="findings"]');
    await expect(findings).toBeVisible();
    const firstRow = findings.locator('[data-finding-id]').first();
    await expect(firstRow).toBeVisible();
    const findingId = await firstRow.getAttribute('data-finding-id');
    expect(findingId).toBeTruthy();

    await expect(firstRow.locator('[data-disposition-kind-action="fixed"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="waived"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="not_applicable"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="fixed_confirmed"]')).toHaveCount(0);
    await expect(firstRow.locator('[data-disposition-kind-action="fixed_proposed"]')).toHaveCount(0);

    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'disposition-findings-controls-th', lang: 'th' });

    const waiveLabel = t('th', 'review.disposition.waived');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === waiveLabel, 80);
    await expectVisibleFocus(page);
    const waiveButton = firstRow.getByRole('button', { name: waiveLabel });
    await expect(waiveButton).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: t('th', 'review.disposition.reason.title') });
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    await expectAccessible(page, testInfo, { name: 'disposition-reason-dialog-th', lang: 'th' });

    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.disposition.reason.submit'),
      12,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText(t('th', 'review.disposition.reason.required'));

    await tabUntil(page, (info) => info.tag === 'textarea', 8);
    await page.keyboard.type('accepted residual risk for this fixture finding');
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.disposition.reason.submit'),
      8,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();

    await expect(firstRow).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind="waived"]')).toContainText(
      t('th', 'review.disposition.waived'),
    );
    await expect(findings.locator(`[data-finding-id="${findingId}"]`)).toHaveCount(1);

    await signOut(page);
    await signInAsFixture(page, ADMIN);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-disposition-controls]')).toHaveCount(0);
    await expect(page.locator('[data-review-qc="findings"]')).toHaveCount(0);

    await signOut(page);
    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-disposition-controls]')).toHaveCount(0);
    await expect(page.locator('[data-disposition-kind-action]')).toHaveCount(0);
    await expect(page.locator('[data-review-qc="findings"]')).toHaveCount(0);

    const propose = await page.request.post(`/api/cases/${caseId}/findings/${findingId}/dispositions`, {
      data: {
        expectedVersion: { versionId, revision: 1 },
        kind: 'fixed_proposed',
      },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(propose.status()).toBe(201);
    const body = (await propose.json()) as DispositionResponse;
    expect(body.kind).toBe('fixed_proposed');
    expect(body.findingId).toBe(findingId);
  });

  test('keyboard fixed and not_applicable keep the finding row', async ({ page }) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await openAsReviewer(page, caseId, versionId);

    const firstRow = page.locator('[data-review-qc="findings"] [data-finding-id]').first();
    const findingId = await firstRow.getAttribute('data-finding-id');
    expect(findingId).toBeTruthy();

    const fixedLabel = t('th', 'review.disposition.fixed');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === fixedLabel, 80);
    await page.keyboard.press('Enter');
    await expect(firstRow.locator('[data-disposition-kind="fixed"]')).toContainText(
      t('th', 'review.disposition.fixed'),
    );
    await expect(page.locator(`[data-finding-id="${findingId}"]`)).toBeVisible();

    // Second finding for N/A (first may still show fixed controls; use another row when present).
    const rows = page.locator('[data-review-qc="findings"] [data-finding-id]');
    const count = await rows.count();
    const naRow = count > 1 ? rows.nth(1) : firstRow;
    const naLabel = t('th', 'review.disposition.not_applicable');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === naLabel, 80);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t('th', 'review.disposition.reason.title') });
    await expect(dialog).toBeVisible();
    await tabUntil(page, (info) => info.tag === 'textarea', 8);
    await page.keyboard.type('out of scope for this lane finding');
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.disposition.reason.submit'),
      8,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(naRow.locator('[data-disposition-kind="not_applicable"]')).toContainText(
      t('th', 'review.disposition.not_applicable'),
    );
  });
});
