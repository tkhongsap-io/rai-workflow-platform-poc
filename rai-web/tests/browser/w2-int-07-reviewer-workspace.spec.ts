// The reviewer workspace on the real server, by keyboard: findings render before the decision controls, the send-back
// dialog keeps focus, a decision moves focus to its outcome (never away from a control reached during the reload),
// and frozen version N is unchanged. Axe in th and en.
// Fixture set slice1-synthetic@1: fx-case-nonvendor (RAI-2000-0001); fx-user-owner-cm, fx-user-ai-coe, fx-user-admin.

import { test, expect, type Page } from './support/real-test.js';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import { t } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, pressTab, tabTo, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
const NONVENDOR_CASE = 'RAI-2000-0001';
const NA_REASONS_CASE = 'RAI-2000-0004';

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
    ).toBeFocused();

    const nav = page.getByRole('navigation', { name: t('th', 'version.nav_heading') });
    await expect(nav.getByRole('link')).toHaveCount(2);
    await expect(nav).toContainText(t('th', 'version.nav_draft', { number: 2 }));
    await expect(nav).toContainText(t('th', 'version.nav_submitted', { number: 1 }));

    // Focus is on the outcome notice; the version navigation comes before it, so the Tab order wraps around.
    await tabTo(page, nav.getByRole('link', { name: t('th', 'version.nav_submitted', { number: 1 }) }));
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
    ).toBeFocused();
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await expectAccessible(page, testInfo, { name: 'w2-int-reviewer-after-approve-th', lang: 'th' });
  });

  test('the decision notice does not take focus from a control the keyboard user reached during the reload', async ({
    page,
  }) => {
    const { caseId, versionId } = await submitNonvendor(page);
    await signOut(page);
    await openAsReviewer(page, caseId, versionId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/cases/${caseId}`, async (route) => {
      await held;
      await route.continue();
    });

    await page.getByRole('button', { name: t('th', 'review.action.approve') }).click();
    await expect(page.locator('.case-screen[aria-busy="true"]')).toBeVisible();
    const shellSignOut = page.getByRole('banner').getByRole('button', { name: t('th', 'auth.sign_out') });
    await tabTo(page, shellSignOut);
    release();
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.approve') }),
    ).toBeVisible();
    await expect(shellSignOut).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog').getByRole('button', { name: t('th', 'auth.sign_out') }),
    ).toBeVisible();
  });

  test('one opening runs lane QC once; approve names the unavailable run shown', async ({ page }) => {
    // Slot 1 set to "not yet" no longer matches fx-case-na-reasons' QC script, so the substitute's run is unavailable.
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, NA_REASONS_CASE);
    const draft = (await (await page.request.get(`/api/cases/${caseId}/draft`)).json()) as PackDraft;
    const saved = await page.request.put(`/api/cases/${caseId}/draft`, {
      data: {
        expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
        slots: { 1: { state: 'not_yet' } },
      },
    });
    expect(saved.status()).toBe(200);
    const { draftRevision } = (await saved.json()) as PackDraft;
    const submit = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
      data: { expectedVersion: { versionId: draft.draftId, revision: draftRevision } },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(submit.status()).toBe(201);
    const { versionId } = (await submit.json()) as { versionId: string };
    await signOut(page);

    const qcRuns: Promise<LaneQcRunResponse>[] = [];
    page.on('response', (response) => {
      if (/\/lanes\/ai_coe\/qc-run$/.test(response.url()))
        qcRuns.push(response.json() as Promise<LaneQcRunResponse>);
    });
    await openAsReviewer(page, caseId, versionId);
    await expect(page.locator('[data-review-qc="unavailable"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(qcRuns, 'one opening issues one lane-QC request').toHaveLength(1);
    const shown = await qcRuns[0]!;
    expect(shown.status).toBe('unavailable');

    const approvePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && /\/lanes\/ai_coe\/approve$/.test(req.url()),
    );
    await page.getByRole('button', { name: t('th', 'review.action.approve') }).click();
    const body = (await approvePromise).postDataJSON() as { qcRunId?: string };
    expect(body.qcRunId).toBe(shown.runId);
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.approve') }),
    ).toBeFocused();
  });

  test('an unavailable run shows its QC-UNAVAILABLE finding under the notice; the owning lane can waive it there', async ({
    page,
  }, testInfo) => {
    // W0-06 7.3 part 4 (recorded 2026-09-25): the outage finding belongs to the lane whose run saw it (W0-07 3.6).
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, NA_REASONS_CASE);
    const draft = (await (await page.request.get(`/api/cases/${caseId}/draft`)).json()) as PackDraft;
    const saved = await page.request.put(`/api/cases/${caseId}/draft`, {
      data: {
        expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
        slots: { 1: { state: 'not_yet' } },
      },
    });
    expect(saved.status()).toBe(200);
    const { draftRevision } = (await saved.json()) as PackDraft;
    const submit = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
      data: { expectedVersion: { versionId: draft.draftId, revision: draftRevision } },
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    expect(submit.status()).toBe(201);
    const { versionId } = (await submit.json()) as { versionId: string };
    await signOut(page);

    await openAsReviewer(page, caseId, versionId);
    await expect(page.locator('[data-review-qc="unavailable"]')).toBeVisible();
    const rows = page.locator('[data-review-qc="findings"] [data-finding-id]');
    await expect(rows).toHaveCount(1);
    const row = rows.first();
    await expect(row).toContainText(t('th', 'review.findings.slot_none'));
    await expect(row.locator('[data-disposition-kind-action="waived"]')).toBeVisible();
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-07-outage-finding-th', lang: 'th' });

    await row.locator('[data-disposition-kind-action="waived"]').click();
    const dialog = page.getByRole('dialog', { name: t('th', 'review.disposition.reason.title') });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('synthetic waiver: QC outage seen before deciding');
    await dialog.getByRole('button', { name: t('th', 'review.disposition.reason.submit') }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('[data-disposition-kind="waived"]')).toContainText(
      t('th', 'review.disposition.waived'),
    );
  });
});
