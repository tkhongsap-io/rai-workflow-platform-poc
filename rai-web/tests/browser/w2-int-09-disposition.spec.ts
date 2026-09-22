// W2-INT: the W2-09 disposition UI journey promoted to evidence against the REAL server. Owner proposes fixed via
// GET …/findings; owning-lane reviewer confirms; waive / N/A require a reason. Keyboard-only; axe zero
// critical/serious. Single-lane findings only (no slot-5 / pack / unavailable owning-lane dispositions). Issue
// #35 stays open. Fixture set slice1-synthetic@1; fx-case-nonvendor / RAI-2000-0001.

import { test, expect, type Page } from '@playwright/test';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabUntil } from './support/keyboard.js';
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

/** Seed lane QC findings so GET …/findings has rows for the owner. */
async function seedAiCoeFindings(page: Page, caseId: string, versionId: string): Promise<void> {
  await signInAsFixture(page, AI_COE);
  const qc = await page.request.post(`/api/cases/${caseId}/versions/${versionId}/lanes/ai_coe/qc-run`, {
    data: { expectedVersion: { versionId, revision: 1 } },
  });
  expect(qc.status()).toBe(200);
  const body = (await qc.json()) as { findings: unknown[] };
  expect(body.findings.length).toBeGreaterThan(0);
}

async function expectFocusInsideDialog(page: Page): Promise<void> {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
  });
  expect(inside, 'focus stays inside the open dialog (section 9, item 3)').toBe(true);
}

test.beforeEach(async () => {
  await resetToFixtureSet();
});

test.describe(`W2-INT disposition UI on the real server (${FIXTURE_SET}; fx-case-nonvendor)`, () => {
  test('keyboard: owner propose-fixed then AI/COE confirm; axe on owner findings', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await seedAiCoeFindings(page, caseId, versionId);
    await signOut(page);

    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible({ timeout: 15_000 });
    const firstRow = page.locator('[data-review-qc="findings"] [data-finding-id]').first();
    const findingId = await firstRow.getAttribute('data-finding-id');
    expect(findingId).toBeTruthy();

    await expect(
      page.getByRole('heading', { name: t('th', 'review.disposition.owner_heading') }),
    ).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="fixed_proposed"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="waived"]')).toHaveCount(0);
    await expect(firstRow.locator('[data-disposition-kind-action="fixed"]')).toHaveCount(0);
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);

    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-disposition-owner-findings-th', lang: 'th' });

    const proposeLabel = t('th', 'review.disposition.fixed_proposed');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === proposeLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(firstRow.locator('[data-disposition-kind="fixed_proposed"]')).toContainText(
      t('th', 'review.disposition.fixed_proposed'),
    );
    await expect(page.locator(`[data-finding-id="${findingId}"]`)).toBeVisible();

    await signOut(page);
    await signInAsFixture(page, AI_COE);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible({ timeout: 15_000 });
    const row = page.locator(`[data-finding-id="${findingId}"]`);
    await expect(row.locator('[data-disposition-kind-action="fixed_confirmed"]')).toBeVisible();

    const confirmLabel = t('th', 'review.disposition.fixed_confirmed');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === confirmLabel, 80);
    await page.keyboard.press('Enter');
    await expect(row.locator('[data-disposition-kind="fixed_confirmed"]')).toContainText(
      t('th', 'review.disposition.fixed_confirmed'),
    );
    await expect(row).toBeVisible();
  });

  test('keyboard N/A and waive kinds; empty reason stays; admin has no controls', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await signInAsFixture(page, AI_COE);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible({ timeout: 15_000 });

    const firstRow = page.locator('[data-review-qc="findings"] [data-finding-id]').first();
    const findingId = await firstRow.getAttribute('data-finding-id');
    expect(findingId).toBeTruthy();

    await expect(firstRow.locator('[data-disposition-kind-action="fixed"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="waived"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="not_applicable"]')).toBeVisible();
    await expect(firstRow.locator('[data-disposition-kind-action="fixed_confirmed"]')).toHaveCount(0);
    await expect(firstRow.locator('[data-disposition-kind-action="fixed_proposed"]')).toHaveCount(0);

    const naLabel = t('th', 'review.disposition.not_applicable');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === naLabel, 80);
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: t('th', 'review.disposition.reason.title') });
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-disposition-reason-dialog-th', lang: 'th' });

    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.disposition.reason.submit'),
      12,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText(t('th', 'review.disposition.reason.required'));

    await tabUntil(page, (info) => info.tag === 'textarea', 8);
    await page.keyboard.type('out of scope for this lane finding');
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.disposition.reason.submit'),
      8,
    );
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(firstRow.locator('[data-disposition-kind="not_applicable"]')).toContainText(
      t('th', 'review.disposition.not_applicable'),
    );
    await expect(page.locator(`[data-finding-id="${findingId}"]`)).toHaveCount(1);

    await signOut(page);
    await signInAsFixture(page, ADMIN);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-disposition-controls]')).toHaveCount(0);
    await expect(page.locator('[data-review-qc="findings"]')).toHaveCount(0);
  });
});
