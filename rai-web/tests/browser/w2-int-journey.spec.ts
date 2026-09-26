// W2-INT: the automated W2 journey against the real server (W0-02 section 8.1 browser layer). Proves A04, A07, A09.
//
// Journey (one test, through the UI): owner submits v1 of fx-case-nonvendor → one lane send-back that names a
// document slot → version N stays readable, lists the decision with its feedback, and a successor draft exists that
// shows the same feedback → owner edits that draft and resubmits v2
// (all three lanes open again) → disposition so an undispositioned finding does not block Ready (owner proposes
// fixed, owning lane confirms) → three current-version approvals → Ready is the desk completion state on the
// approve response. No Deploy control. No new ready route. After each decision the workspace reads the stored
// findings with no error notice.
//
// Sign-in through POST /auth/fixture/sign-in (support/sign-in.ts); keyboard on send-back, disposition, approve and
// submit; axe (th) on the states reached; three widths from playwright.config.ts. Fixture set slice1-synthetic@1
// reloaded before each test. Users: fx-user-owner-cm, fx-user-ai-coe, fx-user-dpo, fx-user-it-security.

import { findFixtureUser } from '@rai/fixtures/data/users';
import { test, expect, type Page } from './support/real-test.js';
import type { CaseListResponse, CaseView } from '@rai/shared/schemas/cases';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { LaneDecisionResponse } from '@rai/shared/schemas/review';
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, pressTab, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET, queryRows } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const DPO = 'fx-user-dpo';
const IT_SEC = 'fx-user-it-security';
const NONVENDOR_CASE = 'RAI-2000-0001';

type Row = Record<string, unknown>;

const DEFICIENCY = 'Privacy notice must name the retention period';
const SUMMARY = 'Resubmit once the notice is updated';

/** The DPO send-back of v1 under `heading`: lane, decision, the slot it names, its deficiency and summary. */
async function expectSendBackFeedback(page: Page, heading: string): Promise<void> {
  const region = page.getByRole('region', { name: heading, exact: true });
  await expect(region.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  const decision = region.getByRole('listitem').filter({ hasText: t('th', 'lane.dpo') });
  await expect(decision).toContainText(t('th', 'projection.sent_back'));
  await expect(decision).toContainText(
    t('th', 'version.decisions.decided_by', { subject: findFixtureUser(DPO)!.displayName }), // W3-F1: the DPO's name
  );
  const item = decision.getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(
    t('th', 'review.send_back.slot_option', { number: 2, name: t('th', 'slot.s2.name') }),
  );
  await expect(item).toContainText(DEFICIENCY);
  await expect(decision).toContainText(SUMMARY);
}

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

function changeButton(page: Page, slot: number, slotNameKey: LocaleKey) {
  return page.getByRole('button', {
    name: t('th', 'pack.change_slot', { number: slot, name: t('th', slotNameKey) }),
    exact: true,
  });
}

async function setSlotNotYet(page: Page, slot: number, slotNameKey: LocaleKey): Promise<void> {
  await changeButton(page, slot, slotNameKey).click();
  const dialog = page.getByRole('dialog', {
    name: t('th', 'slot.dialog.title', { number: slot, name: t('th', slotNameKey) }),
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: t('th', 'slot.state.not_yet'), exact: false }).check();
  await dialog.getByRole('button', { name: t('th', 'slot.dialog.apply') }).click();
  await expect(dialog).toBeHidden();
}

/** Submits the open draft with the keyboard and waits for the frozen version screen. */
async function submitByKeyboard(page: Page, caseId: string): Promise<string> {
  await tabUntil(page, (info) => info.tag === 'button' && info.text === t('th', 'pack.action.submit'), 80);
  await expectVisibleFocus(page);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/versions/[0-9a-f-]{36}$`));
  const versionId = /\/versions\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (versionId === undefined) throw new Error(`no version id in ${page.url()}`);
  return versionId;
}

async function openAsReviewer(page: Page, user: string, caseId: string, versionId: string): Promise<void> {
  await signInAsFixture(page, user);
  await page.goto(`/cases/${caseId}/versions/${versionId}`);
  await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
}

/**
 * Runs a lane decision, then proves the refreshed workspace reads the stored findings with no error notice instead of
 * re-running lane QC: after a send-back the version is closed and qc-run answers 409 under a successful decision.
 * Without a run in view, an empty lane must not read as a clean QC result: the decision may have seen QC unavailable.
 */
async function decideThenReadStoredFindings<T>(
  page: Page,
  versionId: string,
  decide: () => Promise<T>,
): Promise<T> {
  const nextLoad = page.waitForResponse(
    (r) => new RegExp(`/versions/${versionId}/(findings|lanes/[a-z_]+/qc-run)$`).test(r.url()),
    { timeout: 15_000 },
  );
  const decided = await decide();
  const load = await nextLoad;
  expect(`${load.request().method()} ${new URL(load.url()).pathname}`).toMatch(/^GET \/.*\/findings$/);
  await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-review-qc="empty"]')).toHaveCount(0);
  return decided;
}

async function keyboardApprove(page: Page, lane: string, versionId: string): Promise<LaneDecisionResponse> {
  const approveLabel = t('th', 'review.action.approve');
  const approvePromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new RegExp(`/lanes/${lane}/approve$`).test(r.url()),
  );
  await tabUntil(page, (info) => info.tag === 'button' && info.text === approveLabel, 80);
  await expectVisibleFocus(page);
  return decideThenReadStoredFindings(page, versionId, async () => {
    await page.keyboard.press('Enter');
    const response = await approvePromise;
    expect(response.status()).toBe(201);
    return (await response.json()) as LaneDecisionResponse;
  });
}

test.describe(`W2-INT journey on the real server: v1 → send-back → v2 → dispositions → three approvals → Ready (${FIXTURE_SET}; fx-case-nonvendor)`, () => {
  test('owner submits; DPO send-back names a slot; owner sees the feedback and resubmits v2; dispose then three approvals reach Ready', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);

    // 1. Owner submits the existing draft (v1).
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, NONVENDOR_CASE);
    await page.goto(`/cases/${caseId}`);
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toBeEnabled();
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-draft-th', lang: 'th' });
    const v1Id = await submitByKeyboard(page, caseId);
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.submitted', { number: 1 }));
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expect(page.locator('[data-status="in_review"]').first()).toContainText(
      t('th', 'status.in_review'),
    );
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-v1-frozen-th', lang: 'th' });

    const v1Before = (await (
      await page.request.get(`/api/cases/${caseId}/versions/${v1Id}`)
    ).json()) as SubmittedVersion;
    expect(v1Before.versionNumber).toBe(1);
    expect(v1Before.isLatest).toBe(true);
    const frozenTextBefore = await page
      .locator('section.card')
      .filter({ hasText: t('th', 'version.frozen_note') })
      .innerText();

    // 2. One lane send-back that names a document slot (slot 2 — DPO only) with a summary.
    await signOut(page);
    await openAsReviewer(page, DPO, caseId, v1Id);
    await expect(page.locator('[data-review-qc="empty"]')).toHaveText(t('th', 'review.findings.empty'));
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-reviewer-v1-th', lang: 'th' });

    const sendBackLabel = t('th', 'review.action.send_back');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === sendBackLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    const sendBackDialog = page.getByRole('dialog', { name: t('th', 'review.send_back.title') });
    await expect(sendBackDialog).toBeVisible();
    await sendBackDialog.locator('select').selectOption('2');
    await pressTab(page);
    await page.keyboard.type(DEFICIENCY);
    await pressTab(page);
    await page.keyboard.type(SUMMARY);
    await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === t('th', 'review.send_back.submit'),
      8,
    );
    await decideThenReadStoredFindings(page, v1Id, async () => {
      await page.keyboard.press('Enter');
      await expect(sendBackDialog).toBeHidden();
    });
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.send_back') }),
    ).toBeVisible();
    await expectSendBackFeedback(page, t('th', 'version.decisions.heading'));

    const nav = page.getByRole('navigation', { name: t('th', 'version.nav_heading') });
    await expect(nav).toContainText(t('th', 'version.nav_draft', { number: 2 }));
    await expect(nav).toContainText(t('th', 'version.nav_submitted', { number: 1 }));

    // Version N stays readable as the current submitted version; a successor draft exists alongside it.
    await page.goto(`/cases/${caseId}/versions/${v1Id}`);
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    const frozenTextAfter = await page
      .locator('section.card')
      .filter({ hasText: t('th', 'version.frozen_note') })
      .innerText();
    expect(frozenTextAfter).toBe(frozenTextBefore);
    await expectSendBackFeedback(page, t('th', 'version.decisions.heading'));
    const v1After = (await (
      await page.request.get(`/api/cases/${caseId}/versions/${v1Id}`)
    ).json()) as SubmittedVersion;
    expect(v1After.versionId).toBe(v1Id);
    expect(v1After.isLatest).toBe(true); // still the only submitted version; the successor is a draft
    const viewAfterSendBack = (await (await page.request.get(`/api/cases/${caseId}`)).json()) as CaseView;
    expect(viewAfterSendBack.currentVersion?.versionId).toBe(v1Id);
    expect(viewAfterSendBack.draft).not.toBeNull();

    const drafts = await queryRows<Row>(
      'SELECT id, version_number, parent_version_id, submitted_at IS NULL AS is_draft FROM pack_version WHERE case_id = $1 AND parent_version_id = $2',
      [caseId, v1Id],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.is_draft).toBe(true);
    expect(drafts[0]?.version_number).toBe(2);

    // 3. Owner sees the feedback on v1 and on the successor draft, edits the draft and resubmits v2; all three lanes
    // open again.
    await signOut(page);
    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${v1Id}`);
    await expectSendBackFeedback(page, t('th', 'version.decisions.heading'));
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-owner-v1-decisions-th', lang: 'th' });
    await page.goto(`/cases/${caseId}`);
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toBeEnabled();
    await expectSendBackFeedback(page, t('th', 'pack.feedback_heading', { number: 1 }));
    await setSlotNotYet(page, 7, 'slot.s7.name');
    await expect(page.getByText(t('th', 'pack.pending_changes', { count: 1 }))).toBeVisible();
    await page.getByRole('button', { name: t('th', 'pack.action.save') }).click();
    // Successor draft revision may already be > 1 after create; match the catalogue stem, not a fixed number.
    const savedStem = t('th', 'pack.saved', { revision: '¶' }).split('¶')[0]!;
    await expect(page.getByRole('status')).toContainText(savedStem);
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-successor-draft-th', lang: 'th' });
    // The notice belongs to the draft: it is gone on v1 and stays gone back on the draft.
    await nav.getByRole('link', { name: t('th', 'version.nav_submitted', { number: 1 }) }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expect(page.getByText(savedStem)).toHaveCount(0);
    await nav.getByRole('link', { name: t('th', 'version.nav_draft', { number: 2 }) }).click();
    await expect(page.getByRole('heading', { level: 2, name: t('th', 'pack.heading') })).toBeVisible();
    await expect(page.getByText(savedStem)).toHaveCount(0);
    const v2Id = await submitByKeyboard(page, caseId);
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.submitted', { number: 2 }));
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 2 }) }),
    ).toBeVisible();
    expect(v2Id).not.toBe(v1Id);

    const viewAfterResubmit = (await (await page.request.get(`/api/cases/${caseId}`)).json()) as CaseView;
    expect(viewAfterResubmit.currentVersion?.versionId).toBe(v2Id);
    expect(viewAfterResubmit.raiStatus).toBe('pending');
    expect(viewAfterResubmit.privacyStatus).toBe('pending');
    expect(viewAfterResubmit.securityStatus).toBe('pending');
    const lanes = page.getByRole('group', { name: t('th', 'case.lane_status.heading') });
    await expect(lanes).toBeVisible();
    await expect(lanes).toContainText(t('th', 'case.lane.rai'));
    await expect(lanes).toContainText(t('th', 'case.lane.privacy'));
    await expect(lanes).toContainText(t('th', 'case.lane.security'));
    await expect(lanes.locator('[data-status="pending"]')).toHaveCount(3);
    await expect(lanes.getByText(t('th', 'projection.pending'), { exact: true })).toHaveCount(3);
    const laneOpens = await queryRows<Row>(
      "SELECT target_ref->>'lane' AS lane FROM audit_event WHERE action = 'lane.opened' AND target_case_id = $1 AND target_version_id = $2 ORDER BY seq",
      [caseId, v2Id],
    );
    expect(laneOpens.map((r) => r.lane).sort()).toEqual(['ai_coe', 'dpo', 'it_security']);

    // 4. Disposition so an undispositioned finding does not block Ready (owner proposes fixed, lane confirms).
    await signOut(page);
    await openAsReviewer(page, AI_COE, caseId, v2Id);
    await expect(page.locator('[data-review-qc="findings"] [data-finding-id]').first()).toBeVisible();
    const findingId = await page
      .locator('[data-review-qc="findings"] [data-finding-id]')
      .first()
      .getAttribute('data-finding-id');
    expect(findingId).toBeTruthy();
    await signOut(page);

    await signInAsFixture(page, OWNER);
    await page.goto(`/cases/${caseId}/versions/${v2Id}`);
    await expect(page.locator('[data-review-qc="findings"]')).toBeVisible({ timeout: 15_000 });
    const proposeLabel = t('th', 'review.disposition.fixed_proposed');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === proposeLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    await expect(
      page.locator(`[data-finding-id="${findingId}"] [data-disposition-kind="fixed_proposed"]`),
    ).toContainText(t('th', 'review.disposition.fixed_proposed'));
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-owner-propose-th', lang: 'th' });

    await signOut(page);
    await openAsReviewer(page, AI_COE, caseId, v2Id);
    const confirmLabel = t('th', 'review.disposition.fixed_confirmed');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === confirmLabel, 80);
    await page.keyboard.press('Enter');
    await expect(
      page.locator(`[data-finding-id="${findingId}"] [data-disposition-kind="fixed_confirmed"]`),
    ).toContainText(t('th', 'review.disposition.fixed_confirmed'));

    // 5. Three current-version approvals → Ready on the last approve response. No Deploy control.
    await signOut(page);
    await openAsReviewer(page, DPO, caseId, v2Id);
    await expect(page.locator('[data-review-qc="empty"]')).toHaveText(t('th', 'review.findings.empty'));
    const dpoBody = await keyboardApprove(page, 'dpo', v2Id);
    expect(dpoBody.ready).toBe(false);
    await expect(
      page.getByRole('status').filter({ hasText: t('th', 'review.decided.approve') }),
    ).toBeVisible();
    await expect(page.locator('[data-review-qc="none_stored"]')).toHaveText(
      t('th', 'review.findings.none_stored'),
    );

    await signOut(page);
    await openAsReviewer(page, AI_COE, caseId, v2Id);
    const aiBody = await keyboardApprove(page, 'ai_coe', v2Id);
    expect(aiBody.ready).toBe(false);

    await signOut(page);
    await openAsReviewer(page, IT_SEC, caseId, v2Id);
    const itBody = await keyboardApprove(page, 'it_security', v2Id);
    expect(itBody.ready).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: t('th', 'review.decided.ready') })).toBeVisible();
    await expect(page.locator('[data-status="ready_for_launch"]').first()).toContainText(
      t('th', 'status.ready_for_launch'),
    );
    await expect(page.getByRole('button', { name: /Deploy|deploy|เปิดใช้|ปล่อย/i })).toHaveCount(0);
    await expect(page.locator('[data-review-controls="ready"]')).toHaveCount(0);
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'w2-int-journey-ready-th', lang: 'th' });

    // No POST /ready route exists on the real server.
    const readyPost = await page.request.post(`/api/cases/${caseId}/ready`);
    expect(readyPost.status()).toBe(404);

    const [caseRow] = await queryRows<Row>(
      'SELECT desk_status, ai_readiness_status, current_version_id FROM "case" WHERE id = $1',
      [caseId],
    );
    expect(caseRow).toEqual({
      desk_status: 'ready',
      ai_readiness_status: 'ready',
      current_version_id: v2Id,
    });
    const [versionRow] = await queryRows<Row>(
      'SELECT ready_at IS NOT NULL AS is_ready FROM pack_version WHERE id = $1',
      [v2Id],
    );
    expect(versionRow?.is_ready).toBe(true);

    // v1 remains readable after Ready.
    const v1Still = await page.request.get(`/api/cases/${caseId}/versions/${v1Id}`);
    expect(v1Still.status()).toBe(200);
    expect(((await v1Still.json()) as SubmittedVersion).versionNumber).toBe(1);
  });
});
