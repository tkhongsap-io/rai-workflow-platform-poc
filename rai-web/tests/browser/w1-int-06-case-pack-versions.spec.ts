// W1-INT: the W1-06 journey (case overview, nine-slot pack editor and version navigation as one flow, inside the
// W1-07 shell) promoted to evidence against the REAL server: the built SPA served by `node server/dist/main.js`
// (server/src/static.ts) on the real Postgres in fixture identity mode (playwright.config.ts). It is the W1-06
// `*.substitute.spec.ts` with only what the real server legitimately differs on changed: the database is reset to
// fixture set slice1-synthetic@1 through support/database.ts before every test instead of the substitute's reset
// hook, and no answer carries `x-rai-substitute` (asserted absent). Proves A02 (browser layer, W0-02 8.2).
// Interacts only through the UI (roles, labels, keyboard); the API is called directly only to sign in
// (support/sign-in.ts), to read what the server serves for comparison, and to produce a concurrent edit for the
// stale-version case. Fixture ids: fx-case-missing-slot (RAI-2000-0003), fx-case-nonvendor (RAI-2000-0001),
// fx-case-na-reasons (RAI-2000-0004); users fx-user-owner-cm, fx-user-owner-cm-2.

import { test, expect, type Locator, type Page } from './support/real-test.js';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { VersionListResponse } from '@rai/shared/schemas/versions';
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, focusedElement, pressTab, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const OTHER_OWNER = 'fx-user-owner-cm-2';
const MISSING_SLOT_CASE = 'RAI-2000-0003';
const NONVENDOR_CASE = 'RAI-2000-0001';
const THAI_NAME_CASE = 'RAI-2000-0004';

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function openCase(page: Page, registryId: string, user = OWNER): Promise<string> {
  await signInAsFixture(page, user);
  const caseId = await caseIdOf(page, registryId);
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return caseId;
}

async function readDraft(page: Page, caseId: string): Promise<PackDraft> {
  const response = await page.request.get(`/api/cases/${caseId}/draft`);
  expect(response.status()).toBe(200);
  return (await response.json()) as PackDraft;
}

function slotRow(page: Page, slot: number) {
  return page.locator(`.slot-row[data-slot="${slot}"]`);
}

function changeButton(page: Page, slot: number, slotNameKey: LocaleKey) {
  return page.getByRole('button', {
    name: t('th', 'pack.change_slot', { number: slot, name: t('th', slotNameKey) }),
    exact: true,
  });
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

/**
 * Enter on a focused Change button opens the slot dialog. The dialog's showModal() and its focus move run in a
 * React effect after the click commits, so wait for the dialog and for the current-state radio to hold focus
 * before the first arrow key; an arrow pressed earlier lands on the still-focused button and changes nothing.
 */
async function openSlotDialog(page: Page, dialog: Locator): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { checked: true })).toBeFocused();
}

async function expectFocusInsideDialog(page: Page): Promise<void> {
  const inside = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    return dialog !== null && document.activeElement !== null && dialog.contains(document.activeElement);
  });
  expect(inside, 'focus stays inside the open dialog (section 9, item 3)').toBe(true);
}

test.describe(`W1-INT (W1-06) case flow on the real server (fx-case-missing-slot, fx-case-nonvendor, fx-case-na-reasons of ${FIXTURE_SET})`, () => {
  test('the overview shows identity, submission, status as text, the next action and the nine slot rows', async ({
    page,
  }, testInfo) => {
    const caseId = await openCase(page, MISSING_SLOT_CASE);
    // The real server: no answer is marked as a substitute's, and the substitute's reset hook does not exist.
    const probe = await page.request.get(`/api/cases/${caseId}`);
    expect(probe.status()).toBe(200);
    expect(probe.headers()['x-rai-substitute']).toBeUndefined();
    expect((await page.request.post('/__substitute/reset')).status()).toBe(404);

    await expect(page.getByText(MISSING_SLOT_CASE, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Field Technician Dispatch Optimiser');
    await expect(page.getByText(t('th', 'case.submission.none'), { exact: true })).toBeVisible();
    await expect(page.locator('[data-status="draft"]').first()).toContainText(t('th', 'status.draft'));
    await expect(page.getByText(t('th', 'next_action.draft'))).toBeVisible();
    await expect(page.getByText('AIR-FX-2304', { exact: true })).toBeVisible(); // the known source id, unchanged
    await expect(page.locator('.slot-row')).toHaveCount(9);
    // The fixture's slot facts render as received: 7 missing, 8 not yet, 3 and 4 N/A by the non-vendor default.
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.missing'));
    await expect(slotRow(page, 8).locator('[data-status]')).toContainText(t('th', 'slot.state.not_yet'));
    await expect(slotRow(page, 3)).toContainText(t('th', 'slot.na.reason.non_vendor_default'));
    await expect(slotRow(page, 1).getByRole('link')).toHaveText('RiskScreening_DispatchOptimiser.pdf');
    await expect(page.getByRole('navigation', { name: t('th', 'version.nav_heading') })).toContainText(
      t('th', 'version.nav_none'),
    );
    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'overview-draft-th', lang: 'th' });
  });

  test('every slot state and reason is reachable by keyboard, the N/A reason cannot be skipped, and a save persists', async ({
    page,
  }, testInfo) => {
    const caseId = await openCase(page, MISSING_SLOT_CASE);
    const apply = t('th', 'slot.dialog.apply');
    const change = t('th', 'pack.action.change');

    // Keyboard only: Tab to the seventh slot action, open the dialog, land on the checked radio.
    let seen = 0;
    await tabUntil(
      page,
      (info) => {
        if (info.tag === 'button' && info.text === change) seen += 1;
        return seen === 7;
      },
      80,
    );
    const button7 = changeButton(page, 7, 'slot.s7.name');
    await expect(button7).toBeFocused();
    await expectVisibleFocus(page);
    const dialog = page.getByRole('dialog', {
      name: t('th', 'slot.dialog.title', { number: 7, name: t('th', 'slot.s7.name') }),
    });
    await openSlotDialog(page, dialog);
    await expectFocusInsideDialog(page);
    await expect(
      dialog.getByRole('radio', { name: t('th', 'slot.state.missing'), exact: false }),
    ).toBeChecked();

    // Not applicable without a reason: Apply keeps the dialog open and names the rule.
    await page.keyboard.press('ArrowDown'); // missing → not_applicable
    await expect(
      dialog.getByRole('radio', { name: t('th', 'slot.state.not_applicable'), exact: false }),
    ).toBeChecked();
    await expect(dialog.getByRole('textbox', { name: t('th', 'slot.dialog.reason_label') })).toBeVisible();
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveText(t('th', 'validation.reason_required'));
    expect((await focusedElement(page))?.tag, 'focus moves to the reason field').toBe('textarea');
    // Whitespace alone is not a reason either.
    await page.keyboard.type('   ');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveText(t('th', 'validation.reason_required'));
    // A typed reason applies and closes; focus returns to the invoking control.
    await page.keyboard.type('ระบบทดสอบภายใน ไม่มีการประเมินความปลอดภัยแยกต่างหาก');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(
      t('th', 'slot.state.not_applicable'),
    );
    await expect(slotRow(page, 7)).toContainText('ระบบทดสอบภายใน');
    expect((await focusedElement(page))?.text).toBe(t('th', 'pack.action.change'));
    await expect(button7).toBeFocused();

    // Not yet.
    await openSlotDialog(page, dialog);
    await page.keyboard.press('ArrowUp'); // not_applicable → missing
    await page.keyboard.press('ArrowUp'); // missing → not_yet
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.not_yet'));

    // Missing (back to the saved state: the row is no longer marked pending).
    await expect(button7).toBeFocused();
    await openSlotDialog(page, dialog);
    await page.keyboard.press('ArrowDown'); // not_yet → missing
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.missing'));
    await expect(slotRow(page, 7)).not.toHaveClass(/slot-row-pending/);

    // Attached: an upload through 7.4, then the slot points at the artifact.
    await expect(button7).toBeFocused();
    await openSlotDialog(page, dialog);
    await page.keyboard.press('ArrowUp'); // missing → not_yet
    await page.keyboard.press('ArrowUp'); // not_yet → attached
    const fileInput = dialog.locator('input[type="file"]');
    await expect(fileInput).toBeVisible();
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('alert')).toHaveText(t('th', 'slot.dialog.file_required'));
    await fileInput.setInputFiles({
      name: 'SecurityAssessment_synthetic.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n'),
    });
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.attached'));
    await expect(slotRow(page, 7).getByRole('link')).toHaveText('SecurityAssessment_synthetic.pdf');
    await expect(slotRow(page, 7)).toHaveClass(/slot-row-pending/);

    // Slot 8 to N/A with a reason, then save both with the keyboard.
    const button8 = changeButton(page, 8, 'slot.s8.name');
    await button8.focus();
    await expect(button8).toBeFocused();
    const dialog8 = page.getByRole('dialog', {
      name: t('th', 'slot.dialog.title', { number: 8, name: t('th', 'slot.s8.name') }),
    });
    await openSlotDialog(page, dialog8);
    await page.keyboard.press('ArrowDown'); // not_yet → missing
    await page.keyboard.press('ArrowDown'); // missing → not_applicable
    await tabUntil(page, (info) => info.tag === 'textarea', 5);
    await page.keyboard.type('Idea stage: no deployment yet');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === apply, 10);
    await page.keyboard.press('Enter');
    await expect(page.getByText(t('th', 'pack.pending_changes', { count: 2 }))).toBeVisible();
    const submit = page.getByRole('button', { name: t('th', 'pack.action.submit') });
    await expect(submit).toBeDisabled(); // save first
    await expectAccessible(page, testInfo, { name: 'editor-pending-th', lang: 'th' });

    await tabUntil(page, (info) => info.tag === 'button' && info.text === t('th', 'pack.action.save'), 60);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
    await expect(submit).toBeEnabled();

    // What the server holds after the save is what the screen shows after a reload.
    const draft = await readDraft(page, caseId);
    expect(draft.draftRevision).toBe(2);
    expect(draft.slots[7].state).toBe('attached');
    expect(draft.slots[8]).toEqual({
      state: 'not_applicable',
      reason: { kind: 'text', text: 'Idea stage: no deployment yet' },
    });
    await page.reload();
    await expect(slotRow(page, 7).getByRole('link')).toHaveText('SecurityAssessment_synthetic.pdf');
    await expect(slotRow(page, 8)).toContainText('Idea stage: no deployment yet');
    await expect(page.getByText(t('th', 'pack.no_pending_changes'))).toBeVisible();
    await expectStatusElementsHaveText(page);
  });

  test('the slot dialog contains focus, closes on Escape, and asks before discarding an unsaved reason', async ({
    page,
  }, testInfo) => {
    await openCase(page, MISSING_SLOT_CASE);
    const button = changeButton(page, 7, 'slot.s7.name');
    await button.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expectFocusInsideDialog(page);
    for (let i = 0; i < 12; i += 1) {
      await pressTab(page);
      await expectVisibleFocus(page);
      await expectFocusInsideDialog(page);
    }
    // Backwards too: the dialog opened on the checked radio (third in DOM order), so the first Shift+Tab
    // must wrap to the last control instead of leaving the dialog.
    for (let i = 0; i < 8; i += 1) {
      await pressTab(page, 1, true);
      await expectVisibleFocus(page);
      await expectFocusInsideDialog(page);
    }
    await expectAccessible(page, testInfo, { name: 'slot-dialog-th', lang: 'th' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();

    // Unsaved reason: Escape asks through the shared dialog's confirm (dialog.discard_confirm); declining keeps
    // the dialog and the typed text, accepting closes and discards. Both answers are keyboard operations of the
    // native confirm; here the test answers them.
    await openSlotDialog(page, dialog);
    await page.keyboard.press('ArrowDown');
    await tabUntil(page, (info) => info.tag === 'textarea', 5);
    await page.keyboard.type('draft reason');
    const asked: string[] = [];
    page.once('dialog', (confirm) => {
      asked.push(confirm.message());
      void confirm.dismiss();
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    expect(asked).toEqual([t('th', 'dialog.discard_confirm')]);
    await expect(dialog.getByRole('textbox', { name: t('th', 'slot.dialog.reason_label') })).toHaveValue(
      'draft reason',
    );
    await expectFocusInsideDialog(page);
    page.once('dialog', (confirm) => {
      asked.push(confirm.message());
      void confirm.accept();
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(asked).toHaveLength(2);
    await expect(button).toBeFocused();
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.missing'));
  });

  test('a save after another session saved shows the 409 guidance and reload recovers', async ({ page }) => {
    const caseId = await openCase(page, MISSING_SLOT_CASE);
    // Another session saves first (through the contract, with the current expected version).
    const before = await readDraft(page, caseId);
    const other = await page.request.put(`/api/cases/${caseId}/draft`, {
      data: {
        expectedVersion: { versionId: before.draftId, revision: before.draftRevision },
        slots: { 8: { state: 'missing' } },
      },
    });
    expect(other.status()).toBe(200);
    // This screen still holds revision 1 and tries to save a change.
    await changeButton(page, 7, 'slot.s7.name').click();
    await page.getByRole('radio', { name: t('th', 'slot.state.not_yet'), exact: false }).check();
    await page.getByRole('button', { name: t('th', 'slot.dialog.apply') }).click();
    await page.getByRole('button', { name: t('th', 'pack.action.save') }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(t('th', 'error.stale_version'));
    await expect(alert).toContainText(t('th', 'error.stale_version.guidance.revision_changed'));
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.not_yet')); // nothing lost yet
    await alert.getByRole('button', { name: t('th', 'action.reload') }).click();
    await expect(slotRow(page, 8).locator('[data-status]')).toContainText(t('th', 'slot.state.missing')); // the other save
    await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.missing')); // pending dropped
    await expect(page.getByText(t('th', 'pack.draft_revision', { number: 1, revision: 2 }))).toBeVisible();
  });

  test('submit freezes the pack; version navigation shows the versions the server serves, read-only', async ({
    page,
  }, testInfo) => {
    const caseId = await openCase(page, NONVENDOR_CASE);
    await tabUntil(page, (info) => info.tag === 'button' && info.text === t('th', 'pack.action.submit'), 80);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/versions/[0-9a-f-]{36}$`));
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.submitted', { number: 1 }));
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    await expect(page.locator('[data-status="in_review"]')).toContainText(t('th', 'status.in_review'));
    await expect(
      page.getByText(t('th', 'case.submission.version', { number: 1 }), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(t('th', 'next_action.in_review'))).toBeVisible();
    await expect(page.locator('.slot-row')).toHaveCount(9);
    await expect(page.getByRole('button', { name: t('th', 'pack.action.change') })).toHaveCount(0); // read-only
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toHaveCount(0);
    await expect(page.getByText('fixture:fx-user-owner-cm').last()).toBeVisible(); // submittedBy as recorded
    await expect(page.getByText('lane-mapping/v1')).toBeVisible();
    await expect(slotRow(page, 3)).toContainText(t('th', 'slot.na.reason.non_vendor_default'));
    await expect(slotRow(page, 1).getByRole('link')).toHaveText('RiskScreening_ChurnScoring.pdf');

    // The navigation lists exactly what GET /api/cases/{id}/versions serves.
    const served = (await (
      await page.request.get(`/api/cases/${caseId}/versions`)
    ).json()) as VersionListResponse;
    expect(served.items.map((v) => v.versionNumber)).toEqual([1]);
    const nav = page.getByRole('navigation', { name: t('th', 'version.nav_heading') });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(served.items.length);
    for (const [index, item] of served.items.entries()) {
      await expect(links.nth(index)).toContainText(
        t('th', 'version.nav_submitted', { number: item.versionNumber }),
      );
      await expect(links.nth(index)).toHaveAttribute('href', `/cases/${caseId}/versions/${item.versionId}`);
    }
    await expect(nav.locator('[data-status="latest"]')).toContainText(t('th', 'version.latest'));
    await expect(nav.getByText(t('th', 'version.nav_draft', { number: 1 }))).toHaveCount(0); // no open draft after submit
    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'version-frozen-th', lang: 'th' });

    // Deep link to the case resolves to the latest version when no draft is open; the version link works by keyboard.
    await page.goto(`/cases/${caseId}`);
    await expect(page).toHaveURL(
      new RegExp(`/cases/${caseId}/versions/${served.items[0]?.versionId ?? ''}$`),
    );
    await tabUntil(
      page,
      (info) => info.tag === 'a' && info.text.includes(t('th', 'version.nav_submitted', { number: 1 })),
      40,
    );
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
    ).toBeVisible();
    // A version id of another case is 404 from the API and rendered as received.
    await page.goto(`/cases/${caseId}/versions/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole('alert')).toContainText(t('th', 'error.not_found'));
  });

  test('forbidden and unauthenticated answers are rendered as received; no client-side rule decides access', async ({
    page,
  }, testInfo) => {
    // The owner reads the case id; the other owner (no fixture case) is refused by the server.
    const caseId = await openCase(page, MISSING_SLOT_CASE);
    await signOut(page);
    await signInAsFixture(page, OTHER_OWNER);
    await page.goto(`/cases/${caseId}`);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(t('th', 'error.forbidden'));
    await expect(page.getByRole('button', { name: t('th', 'pack.action.change') })).toHaveCount(0);
    await expect(page.getByText('Field Technician Dispatch Optimiser')).toHaveCount(0); // nothing about the case leaks
    await expectAccessible(page, testInfo, { name: 'forbidden-th', lang: 'th' });

    await signOut(page);
    await page.goto(`/cases/${caseId}`);
    await expect(page).toHaveURL(`/sign-in?returnTo=${encodeURIComponent(`/cases/${caseId}`)}`);
  });

  test('the Thai fixture name renders and the audit passes in English too', async ({ page }, testInfo) => {
    const caseId = await openCase(page, THAI_NAME_CASE);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ผู้ช่วยตอบคำถามพนักงาน');
    await expect(slotRow(page, 4)).toContainText('MSA-FX-0042'); // the typed N/A reason, verbatim
    await expectNoHorizontalScroll(page);
    const locale = await page.request.post('/api/session/locale', { data: { locale: 'en' } });
    expect(locale.status()).toBe(204);
    await page.goto(`/cases/${caseId}`);
    await expect(page.getByRole('heading', { level: 2, name: t('en', 'pack.heading') })).toBeVisible();
    await expect(page.locator('[data-status="draft"]').first()).toContainText(t('en', 'status.draft'));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'overview-draft-en', lang: 'en' });
  });
});
