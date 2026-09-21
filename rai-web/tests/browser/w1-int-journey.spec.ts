// W1-INT: the automated W1 journey against the real server (W0-02 section 7.6 "Restart proof: the W1-INT journey
// stops and restarts the API process against the same database and re-reads the version"; section 8.1 browser
// layer). Proves A01, A02, A07 at the browser layer.
//
// Journey (one test, through the UI): the owner signs in → creates a case → uploads an artifact and attaches it in
// a slot → sets the other slots → submits → the API PROCESS IS STOPPED (SIGTERM, exit 0) and a NEW PROCESS is
// started on the same port, database and blob directory → the case and its version are reopened in the same
// browser session (sessions live in Postgres) and everything is unchanged: the screen, the 7.3/7.6 bodies byte
// for byte, the stored rows, and the artifact download bytes, which hash to the stored sha256. The Playwright web
// server cannot be restarted from a spec, so this test spawns the BUILT deployable (`node server/dist/main.js`,
// tests/support/process.ts with `built: true`) itself on its own loopback port and drives the browser there.
//
// Positive (second test): the BU SPOC of the owner's BU (`fx-user-spoc-cm`, CM) submits a second fixture case
// owned by that owner (`fx-case-nonvendor`, RAI-2000-0001, owner `fx-user-owner-cm`); the `version.submitted`
// audit event records the SPOC as actor and the case owner is unchanged (W0-05 `case.submit`).
//
// Keyboard-only stops with a visible focus ring on the sign-in and submit steps (the promoted W1-06 and W1-07
// specs drive every other control by keyboard); axe (th) on every screen state reached; three widths. Fixture
// set slice1-synthetic@1 (support/database.ts) reloaded before each test; fixture ids in the describe titles.

import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import type { CaseListResponse, CaseView } from '@rai/shared/schemas/cases';
import type { SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { buildPdf } from '@rai/fixtures/generate/pdf';
import { FIXTURE_THAI_LINE } from '@rai/fixtures/data/documents/index';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabUntil } from './support/keyboard.js';
import { FIXTURE_SET, queryRows, resetToFixtureSet } from './support/database.js';
import { freeLoopbackPort, startTestServer, type TestServerProcess } from '../support/process.js';

const OWNER = 'fx-user-owner-cm';
const OWNER_SUBJECT = 'fixture:fx-user-owner-cm';
const SPOC = 'fx-user-spoc-cm';
const SPOC_SUBJECT = 'fixture:fx-user-spoc-cm';
const NONVENDOR_CASE = 'RAI-2000-0001'; // fx-case-nonvendor, owned by fx-user-owner-cm, BU CM

const UPLOAD_NAME = 'BRD_W1_journey_synthetic.pdf';
const UPLOAD_BYTES = buildPdf({
  asciiLines: ['RAI-DESK-SYNTHETIC-FIXTURE W1-INT journey', 'Business requirements (synthetic)'],
  thaiLine: FIXTURE_THAI_LINE,
  title: 'W1-INT journey',
});
const UPLOAD_SHA256 = createHash('sha256').update(UPLOAD_BYTES).digest('hex');
const NA_REASON = 'ไม่มีการนำโมเดลไปใช้จริง จึงไม่มีบันทึกการทดสอบ (synthetic)';

type Row = Record<string, unknown>;

/** Signs in through the sign-in screen at `origin` with the keyboard: Tab to the picker, choose, Enter on the button. */
async function signInThroughPicker(page: Page, origin: string, fixtureUserId: string): Promise<void> {
  await page.goto(`${origin}/sign-in`);
  const picker = page.getByLabel(th['auth.fixture_user_select']);
  await expect(picker).toBeVisible();
  await picker.selectOption(fixtureUserId);
  await picker.focus();
  const button = await tabUntil(page, (info) => info.tag === 'button' && info.text === th['auth.sign_in']);
  expect(button.text).toBe(th['auth.sign_in']);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: th['cases.title'] })).toBeVisible();
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

/** Opens slot `slot`'s dialog, picks `state`, fills what the state needs, applies. */
async function setSlot(
  page: Page,
  slot: number,
  slotNameKey: LocaleKey,
  state: 'attached' | 'not_yet' | 'missing' | 'not_applicable',
  extra: { reason?: string; file?: { name: string; bytes: Buffer } } = {},
): Promise<void> {
  await changeButton(page, slot, slotNameKey).click();
  const dialog = page.getByRole('dialog', {
    name: t('th', 'slot.dialog.title', { number: slot, name: t('th', slotNameKey) }),
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('radio', { name: t('th', `slot.state.${state}` as LocaleKey), exact: false })
    .check();
  if (extra.reason !== undefined)
    await dialog.getByRole('textbox', { name: t('th', 'slot.dialog.reason_label') }).fill(extra.reason);
  if (extra.file !== undefined)
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: extra.file.name, mimeType: 'application/pdf', buffer: extra.file.bytes });
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

async function readText(page: Page, url: string): Promise<{ status: number; text: string }> {
  const response = await page.request.get(url);
  return { status: response.status(), text: await response.text() };
}

async function storedRows(caseId: string, versionId: string) {
  const [c] = await queryRows<Row>('SELECT * FROM "case" WHERE id = $1', [caseId]);
  const [v] = await queryRows<Row>('SELECT * FROM pack_version WHERE id = $1', [versionId]);
  const slots = await queryRows<Row>('SELECT * FROM artifact_slot WHERE version_id = $1 ORDER BY slot', [
    versionId,
  ]);
  const artifacts = await queryRows<Row>('SELECT * FROM artifact WHERE case_id = $1 ORDER BY id', [caseId]);
  const audit = await queryRows<Row>(
    'SELECT seq, actor_subject_id, actor_role, action, target_case_id, target_version_id, correlation_id FROM audit_event WHERE target_case_id = $1 ORDER BY seq',
    [caseId],
  );
  expect(c).toBeDefined();
  expect(v).toBeDefined();
  expect(slots).toHaveLength(9);
  return { c: c as Row, v: v as Row, slots, artifacts, audit };
}

test.beforeEach(async () => {
  await resetToFixtureSet();
});

test.describe(`W1-INT journey on the real server: create → attach → submit → restart → reopen (${FIXTURE_SET}; fx-user-owner-cm)`, () => {
  test('the owner creates, attaches and submits through the UI; the API process is stopped and restarted; the case, the version and the artifact bytes reopen unchanged', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const port = await freeLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    let server: TestServerProcess | undefined = await startTestServer({ built: true, port });
    const firstPid = server.pid;
    let recorded:
      | {
          caseId: string;
          versionId: string;
          registryId: string;
          artifactId: string;
          view: string;
          version: string;
          list: string;
          latest: string;
          meta: string;
          rows: Awaited<ReturnType<typeof storedRows>>;
        }
      | undefined;
    try {
      // Sign in (keyboard) and create the case through the new-case form.
      await signInThroughPicker(page, origin, OWNER);
      await page.getByRole('link', { name: th['shell.nav.new_case'] }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: th['new_case.title'] })).toBeVisible();
      const useCaseName = `ระบบคัดกรองความเสี่ยงเอกสาร (W1-INT journey ${randomUUID().slice(0, 8)})`;
      await page.getByLabel(th['field.use_case_name']).fill(useCaseName);
      await page.getByLabel(th['field.business_unit_id']).fill('CM');
      await page.getByLabel(th['field.business_unit']).fill('Consumer Mobile');
      await expect(page.getByLabel(th['field.business_owner'])).toHaveValue(OWNER_SUBJECT);
      await page.getByLabel(th['field.technical_owner']).fill('Tanawat P. (synthetic)');
      await page.getByLabel(th['field.source_known']).check();
      await page.getByLabel(th['field.source_value']).fill('TPM-JOURNEY-0001');
      await page.getByLabel(th['field.use_case_group']).selectOption('customer-service');
      await page.getByLabel(th['common.no'], { exact: true }).check(); // vendorInvolved: no → slots 3/4 N/A by default (A02)
      await page.getByLabel(th['model_type.classic_ml'], { exact: true }).check();
      const created = page.waitForResponse(
        (r) => r.url() === `${origin}/api/cases` && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: th['new_case.submit'] }).click();
      expect((await created).status()).toBe(201);
      await expect(page).toHaveURL(new RegExp(`^${origin}/cases$`));
      const card = page
        .locator('article[data-registry-id]')
        .filter({ has: page.getByRole('heading', { level: 2, name: useCaseName }) });
      await expect(card).toHaveCount(1);
      const registryId = (await card.getAttribute('data-registry-id')) ?? '';
      expect(registryId).toMatch(/^RAI-\d{4}-\d{4}$/);
      expect(registryId).not.toMatch(/^RAI-2000-/); // never the reserved fixture year (section 8.3)
      await expectAccessible(page, testInfo, { name: 'journey-list-created-th', lang: 'th' });

      // Open the case: the nine slot rows, slots 3 and 4 N/A by the non-vendor default, the known source id.
      await card
        .getByRole('link', { name: th['cases.open_named'].replace('{registryId}', registryId) })
        .click();
      await expect(page).toHaveURL(new RegExp(`^${origin}/cases/[0-9a-f-]{36}$`));
      const caseId = /\/cases\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? '';
      expect(caseId).toMatch(/^[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(useCaseName);
      await expect(page.getByText('TPM-JOURNEY-0001', { exact: true })).toBeVisible();
      await expect(page.locator('.slot-row')).toHaveCount(9);
      await expect(slotRow(page, 3)).toContainText(t('th', 'slot.na.reason.non_vendor_default'));
      await expect(slotRow(page, 4)).toContainText(t('th', 'slot.na.reason.non_vendor_default'));

      // Upload and attach in slot 1; set the other slots; save.
      await setSlot(page, 1, 'slot.s1.name', 'attached', {
        file: { name: UPLOAD_NAME, bytes: UPLOAD_BYTES },
      });
      await expect(slotRow(page, 1).getByRole('link')).toHaveText(UPLOAD_NAME);
      await setSlot(page, 2, 'slot.s2.name', 'not_yet');
      await setSlot(page, 5, 'slot.s5.name', 'not_applicable', { reason: NA_REASON });
      await setSlot(page, 7, 'slot.s7.name', 'not_yet');
      await expect(page.getByText(t('th', 'pack.pending_changes', { count: 4 }))).toBeVisible();
      await expectAccessible(page, testInfo, { name: 'journey-editor-pending-th', lang: 'th' });
      await page.getByRole('button', { name: t('th', 'pack.action.save') }).click();
      await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
      await expect(slotRow(page, 5)).toContainText(NA_REASON);

      // Submit with the keyboard: the frozen version screen.
      const versionId = await submitByKeyboard(page, caseId);
      await expect(page.getByRole('status')).toContainText(t('th', 'pack.submitted', { number: 1 }));
      await expect(
        page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
      ).toBeVisible();
      await expect(page.locator('[data-status="in_review"]').first()).toContainText(
        t('th', 'status.in_review'),
      );
      await expect(slotRow(page, 1).getByRole('link')).toHaveText(UPLOAD_NAME);
      await expect(page.getByText(OWNER_SUBJECT).last()).toBeVisible();
      await expectStatusElementsHaveText(page);
      await expectAccessible(page, testInfo, { name: 'journey-version-frozen-th', lang: 'th' });

      // Record what the first process serves and stores.
      const view = await readText(page, `${origin}/api/cases/${caseId}`);
      const version = await readText(page, `${origin}/api/cases/${caseId}/versions/${versionId}`);
      const list = await readText(page, `${origin}/api/cases/${caseId}/versions`);
      const latest = await readText(page, `${origin}/api/cases/${caseId}/versions/latest`);
      for (const r of [view, version, list, latest]) expect(r.status).toBe(200);
      const parsedVersion = JSON.parse(version.text) as SubmittedVersion;
      expect(parsedVersion.submittedBy).toBe(OWNER_SUBJECT);
      expect(parsedVersion.versionNumber).toBe(1);
      expect(parsedVersion.isLatest).toBe(true);
      expect(parsedVersion.slots[2]).toEqual({ state: 'not_yet' });
      expect(parsedVersion.slots[3]).toMatchObject({ state: 'not_applicable' });
      expect(parsedVersion.slots[5]).toEqual({
        state: 'not_applicable',
        reason: { kind: 'text', text: NA_REASON },
      });
      expect(parsedVersion.slots[6]).toEqual({ state: 'missing' });
      const slot1 = parsedVersion.slots[1];
      expect(slot1.state).toBe('attached');
      const artifact = (slot1 as { artifact: ArtifactRef }).artifact;
      expect(artifact.sha256).toBe(UPLOAD_SHA256);
      expect(artifact.filename).toBe(UPLOAD_NAME);
      expect((JSON.parse(view.text) as CaseView).currentVersion?.versionId).toBe(versionId);
      expect((JSON.parse(list.text) as VersionListResponse).items.map((v) => v.versionNumber)).toEqual([1]);
      const meta = await readText(page, `${origin}/api/artifacts/${artifact.artifactId}/meta`);
      expect(meta.status).toBe(200);
      const rows = await storedRows(caseId, versionId);
      expect(rows.c.current_version_id).toBe(versionId);
      expect(rows.c.draft_version_id).toBeNull();
      expect(rows.audit.map((e) => e.action)).toContain('version.submitted');
      recorded = {
        caseId,
        versionId,
        registryId,
        artifactId: artifact.artifactId,
        view: view.text,
        version: version.text,
        list: list.text,
        latest: latest.text,
        meta: meta.text,
        rows,
      };
    } finally {
      // STOP the API process: SIGTERM → process.stopping → exit 0 (W0-04 graceful shutdown).
      const exit = await server.stop();
      expect(exit).toEqual({ code: 0, signal: null });
      server = undefined;
    }
    expect(recorded).toBeDefined();
    if (recorded === undefined) return;
    await expect(fetch(`${origin}/api/session`)).rejects.toThrow(); // nothing listens between the two processes

    // RESTART: a new process on the same port, database and blob directory.
    server = await startTestServer({ built: true, port });
    try {
      expect(server.pid).not.toBe(firstPid);
      // Reopen in the same browser session: the session row is in Postgres, so no sign-in is needed. A deep link
      // to the case resolves to its latest version because no draft is open.
      await page.goto(`${origin}/cases/${recorded.caseId}`);
      await expect(page).toHaveURL(`${origin}/cases/${recorded.caseId}/versions/${recorded.versionId}`);
      await expect(
        page.getByRole('heading', { level: 2, name: t('th', 'version.heading', { number: 1 }) }),
      ).toBeVisible();
      await expect(page.getByText(recorded.registryId, { exact: true })).toBeVisible();
      await expect(page.locator('[data-status="in_review"]').first()).toContainText(
        t('th', 'status.in_review'),
      );
      await expect(page.locator('.slot-row')).toHaveCount(9);
      await expect(slotRow(page, 1).locator('[data-status]')).toContainText(t('th', 'slot.state.attached'));
      await expect(slotRow(page, 1).getByRole('link')).toHaveText(UPLOAD_NAME);
      await expect(slotRow(page, 2).locator('[data-status]')).toContainText(t('th', 'slot.state.not_yet'));
      await expect(slotRow(page, 5)).toContainText(NA_REASON);
      await expect(slotRow(page, 7).locator('[data-status]')).toContainText(t('th', 'slot.state.not_yet'));
      await expect(page.getByText(OWNER_SUBJECT).last()).toBeVisible();
      await expect(page.getByRole('button', { name: t('th', 'pack.action.change') })).toHaveCount(0); // frozen
      await expectStatusElementsHaveText(page);
      await expectAccessible(page, testInfo, { name: 'journey-version-after-restart-th', lang: 'th' });

      // The 7.3 and 7.6 bodies are byte-identical to the first process's, and so are the stored rows.
      expect(await readText(page, `${origin}/api/cases/${recorded.caseId}`)).toEqual({
        status: 200,
        text: recorded.view,
      });
      expect(
        await readText(page, `${origin}/api/cases/${recorded.caseId}/versions/${recorded.versionId}`),
      ).toEqual({ status: 200, text: recorded.version });
      expect(await readText(page, `${origin}/api/cases/${recorded.caseId}/versions`)).toEqual({
        status: 200,
        text: recorded.list,
      });
      expect(await readText(page, `${origin}/api/cases/${recorded.caseId}/versions/latest`)).toEqual({
        status: 200,
        text: recorded.latest,
      });
      expect(await readText(page, `${origin}/api/artifacts/${recorded.artifactId}/meta`)).toEqual({
        status: 200,
        text: recorded.meta,
      });
      expect(await storedRows(recorded.caseId, recorded.versionId)).toEqual(recorded.rows);

      // The artifact download bytes are what was uploaded, byte for byte.
      const download = await page.request.get(`${origin}/api/artifacts/${recorded.artifactId}`);
      expect(download.status()).toBe(200);
      expect(download.headers()['content-type']).toBe('application/pdf');
      const bytes = await download.body();
      expect(bytes.equals(UPLOAD_BYTES)).toBe(true);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(UPLOAD_SHA256);

      // The list still shows the case with its version and status after the restart.
      await page.goto(`${origin}/cases`);
      const card = page.locator(`article[data-registry-id="${recorded.registryId}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.locator('[data-status="in_review"]')).toContainText(t('th', 'status.in_review'));
      await expect(card.getByText(t('th', 'case.submission.version', { number: 1 }))).toBeVisible();
    } finally {
      await server.stop();
    }
  });
});

test.describe(`W1-INT BU SPOC on behalf on the real server (${FIXTURE_SET}; fx-user-spoc-cm submits fx-case-nonvendor owned by fx-user-owner-cm)`, () => {
  test("the SPOC of the owner's BU submits the owner's fixture case: the submit audit event names the SPOC as actor and the case owner is unchanged", async ({
    page,
    baseURL,
  }, testInfo) => {
    const origin = baseURL ?? '';
    await signInThroughPicker(page, origin, SPOC);
    const listed = (await (
      await page.request.get(`${origin}/api/cases?pageSize=100`)
    ).json()) as CaseListResponse;
    const row = listed.items.find((item) => item.registryId === NONVENDOR_CASE);
    expect(row, `${NONVENDOR_CASE} is in the CM SPOC's list`).toBeDefined();
    const caseId = row?.caseId ?? '';
    const [before] = await queryRows<Row>(
      'SELECT owner_subject_id, business_unit_id FROM "case" WHERE id = $1',
      [caseId],
    );
    expect(before).toEqual({ owner_subject_id: OWNER_SUBJECT, business_unit_id: 'CM' });
    expect(
      await queryRows<Row>(
        "SELECT 1 FROM audit_event WHERE action = 'version.submitted' AND target_case_id = $1",
        [caseId],
      ),
    ).toEqual([]);

    await page.goto(`${origin}/cases/${caseId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toBeEnabled();
    const versionId = await submitByKeyboard(page, caseId);
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.submitted', { number: 1 }));
    await expect(page.getByText(SPOC_SUBJECT).last()).toBeVisible(); // submittedBy: the actor, not the owner
    await expectStatusElementsHaveText(page);
    await expectAccessible(page, testInfo, { name: 'spoc-version-frozen-th', lang: 'th' });

    const version = (await (
      await page.request.get(`${origin}/api/cases/${caseId}/versions/${versionId}`)
    ).json()) as SubmittedVersion;
    expect(version.submittedBy).toBe(SPOC_SUBJECT);
    expect(version.versionNumber).toBe(1);

    const events = await queryRows<Row>(
      "SELECT actor_subject_id, actor_role, target_version_id FROM audit_event WHERE action = 'version.submitted' AND target_case_id = $1 ORDER BY seq",
      [caseId],
    );
    expect(events).toEqual([
      { actor_subject_id: SPOC_SUBJECT, actor_role: 'bu_spoc', target_version_id: versionId },
    ]);
    const [after] = await queryRows<Row>(
      'SELECT owner_subject_id, business_unit_id, current_version_id, desk_status FROM "case" WHERE id = $1',
      [caseId],
    );
    expect(after).toEqual({
      owner_subject_id: OWNER_SUBJECT,
      business_unit_id: 'CM',
      current_version_id: versionId,
      desk_status: 'in_review',
    });
    const [versionRow] = await queryRows<Row>(
      'SELECT submitted_by, submitted_role FROM pack_version WHERE id = $1',
      [versionId],
    );
    expect(versionRow).toEqual({ submitted_by: SPOC_SUBJECT, submitted_role: 'bu_spoc' });

    // The owner still owns the case: signed in as the owner, the case is listed in review with version 1.
    await page.getByRole('button', { name: th['auth.sign_out'] }).click();
    await page.getByRole('dialog').getByRole('button', { name: th['auth.sign_out'] }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signInThroughPicker(page, origin, OWNER);
    const card = page.locator(`article[data-registry-id="${NONVENDOR_CASE}"]`);
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-status="in_review"]')).toContainText(t('th', 'status.in_review'));
    await expect(card.getByText(t('th', 'case.submission.version', { number: 1 }))).toBeVisible();
    await page.goto(`${origin}/cases/${caseId}/versions/${versionId}`);
    await expect(page.getByText(SPOC_SUBJECT).last()).toBeVisible();
  });
});
