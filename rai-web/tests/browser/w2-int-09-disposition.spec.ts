// The disposition UI against the real server: the owner proposes fixed, the owning lane confirms, waive and N/A
// need a reason, and a stored submit-QC finding reaches its lane's reviewer so Ready is reachable from the UI.
// Keyboard only; axe zero critical/serious. Fixture set slice1-synthetic@1.

import { test, expect, type Page } from './support/real-test.js';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabTo, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const DPO = 'fx-user-dpo';
const IT_SEC = 'fx-user-it-security';
const ADMIN = 'fx-user-admin';
const NONVENDOR_CASE = 'RAI-2000-0001';
const MISSING_SLOT_CASE = 'RAI-2000-0003';

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function submitCase(page: Page, registryId: string): Promise<{ caseId: string; versionId: string }> {
  await signInAsFixture(page, OWNER);
  const caseId = await caseIdOf(page, registryId);
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

/** Runs the lane's QC and approves with that run, as a reviewer who saw it would. */
async function approveByApi(page: Page, user: string, caseId: string, versionId: string, lane: string) {
  await signInAsFixture(page, user);
  const lanePath = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
  const expectedVersion = { versionId, revision: 1 };
  const qc = await page.request.post(`${lanePath}/qc-run`, { data: { expectedVersion } });
  expect(qc.status()).toBe(200);
  const { runId } = (await qc.json()) as { runId: string };
  const approve = await page.request.post(`${lanePath}/approve`, {
    data: { expectedVersion, qcRunId: runId },
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  expect(approve.status()).toBe(201);
  await signOut(page);
}

async function expectFocusInsideDialog(page: Page): Promise<void> {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
  });
  expect(inside, 'focus stays inside the open dialog (section 9, item 3)').toBe(true);
}

test.describe(`W2-INT disposition UI on the real server (${FIXTURE_SET})`, () => {
  test('keyboard: owner propose-fixed then AI/COE confirm; axe on owner findings', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitCase(page, NONVENDOR_CASE);
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
    const { caseId, versionId } = await submitCase(page, NONVENDOR_CASE);
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

  test('keyboard: the owning lane sees a stored submit-QC finding, approves, dispositions it, and Ready applies', async ({
    page,
  }, testInfo) => {
    const { caseId, versionId } = await submitCase(page, MISSING_SLOT_CASE);
    const findingsPath = `/api/cases/${caseId}/versions/${versionId}/findings`;
    // Submit QC runs after the submit response; wait until its it_security finding is stored.
    await expect
      .poll(
        async () => {
          const listed = (await (await page.request.get(findingsPath)).json()) as {
            findings: { ruleId: string; owningLane: string }[];
          };
          return listed.findings.map((f) => `${f.ruleId}/${f.owningLane}`);
        },
        { timeout: 15_000 },
      )
      .toEqual(['PACK-SLOT-MISSING/it_security']);
    await signOut(page);
    await approveByApi(page, AI_COE, caseId, versionId, 'ai_coe');
    await approveByApi(page, DPO, caseId, versionId, 'dpo');

    await signInAsFixture(page, IT_SEC);
    await page.goto(`/cases/${caseId}/versions/${versionId}`);
    await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
    const row = page.locator('[data-review-qc="findings"] [data-finding-id]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(t('th', 'qc.finding.pack_slot_missing', { slot: 7 }));
    await expect(page.locator('[data-review-qc="empty"]')).toHaveCount(0);
    await expectAccessible(page, testInfo, { name: 'w2-int-disposition-submit-qc-finding-th', lang: 'th' });

    await tabTo(page, page.getByRole('button', { name: t('th', 'review.action.approve'), exact: true }));
    await page.keyboard.press('Enter');
    const approved = page.getByRole('status').filter({ hasText: t('th', 'review.decided.approve') });
    await expect(approved).toBeFocused();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await expect(page.locator('[data-status="ready_for_launch"]')).toHaveCount(0);

    // The screen reloaded; tabTo waits for the lane's findings to render again before it tabs.
    await tabTo(page, row.getByRole('button', { name: t('th', 'review.disposition.fixed'), exact: true }));
    await page.keyboard.press('Enter');
    const ready = page.getByRole('status').filter({ hasText: t('th', 'review.decided.ready') });
    await expect(ready).toBeFocused();
    await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
    await expect(row.locator('[data-disposition-kind="fixed"]')).toBeVisible();
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-disposition-ready-th', lang: 'th' });
  });
});
