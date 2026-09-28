// W6-05 (W6 plan sections 1.2 Q3/Q16, 2.3, 4.2, 9 and 13): the Admin configuration screens on the real server with
// synthetic fixtures. The index lists every kind with its values owner; a kind's history shows change notes and the
// number of versions that froze each revision, as the W6-04 API serves them; two revisions diff by JSON path; a
// restore with a change note publishes a copy as the next revision. Access is the server's: a non-Admin gets the 403
// notice. th/en, keyboard, axe at the three project widths.
import { test, expect, type Page } from './support/real-test.js';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import { CONFIGURATION_KINDS } from '@rai/shared/schemas/cases';
import type {
  ConfigurationDraftDetail,
  ConfigurationIndexResponse,
  ConfigurationRevisionDetail,
  ConfigurationRevisionListResponse,
  ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import { expectAccessible } from './support/axe.js';
import { expectMainFocused, expectVisibleFocus, tabTo } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';

const BASE = '/api/admin/configuration';
const NOTE_2 = 'W6-05 synthetic: DPO four working days';
const NOTE_3 = 'W6-05 synthetic: back to the D01 seed';

async function index(page: Page): Promise<ConfigurationIndexResponse> {
  const response = await page.request.get(BASE);
  expect(response.status()).toBe(200);
  return (await response.json()) as ConfigurationIndexResponse;
}
async function history(page: Page, kind: string): Promise<ConfigurationRevisionSummary[]> {
  const response = await page.request.get(`${BASE}/${kind}/revisions`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as ConfigurationRevisionListResponse).items;
}
async function revisionBody(page: Page, kind: string, id: string): Promise<Record<string, unknown>> {
  const response = await page.request.get(`${BASE}/${kind}/revisions/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as ConfigurationRevisionDetail).body;
}
/** Owner submits a fixture case, which freezes the SLA revision in force (so its version count is 1). */
async function submitAsOwner(page: Page, registryId: string): Promise<void> {
  await signInAsFixture(page, 'fx-user-owner-cm');
  const queue = (await (await page.request.get('/api/queue')).json()) as QueueResponse;
  const item = queue.items.find((x) => x.registryId === registryId)!;
  const draft = (await (await page.request.get(`/api/cases/${item.caseId}/draft`)).json()) as PackDraft;
  const response = await page.request.post(`/api/cases/${item.caseId}/draft/submit`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
  });
  expect(response.status()).toBe(201);
  await signOut(page);
}
/** Admin publishes a second SLA revision through the W6-04 API (the editors are W6-06). */
async function publishSla(page: Page, dpo: number, note: string): Promise<void> {
  const current = (await index(page)).kinds.find((x) => x.kind === 'sla')!.current!;
  const saved = await page.request.put(`${BASE}/sla/draft`, {
    data: {
      baseRevisionId: current.revisionId,
      expectedDraftVersion: null,
      body: { dpo, ai_coe: 5, it_security: 5 },
      changeNote: note,
    },
  });
  expect(saved.status()).toBe(200);
  const draft = (await saved.json()) as ConfigurationDraftDetail;
  const published = await page.request.post(`${BASE}/sla/draft/publish`, {
    data: { expectedDraftVersion: draft.draftVersion, expectedCurrentRevisionId: current.revisionId },
  });
  expect(published.status()).toBe(201);
}
const row = (page: Page, revisionNumber: number) =>
  page.locator(`[data-testid="admin-config-history"] tr[data-revision="${revisionNumber}"]`);
async function noSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}

test('Admin sees every kind, the SLA history with notes and version counts, a diff, and restores with a note', async ({
  page,
}, info) => {
  await submitAsOwner(page, 'RAI-2000-0001'); // freezes SLA revision 1
  await signInAsFixture(page, 'fx-user-admin');
  await publishSla(page, 4, NOTE_2);

  // Index: "Configuration" beside "Desk health" in the navigation; one row per kind with its owner badge.
  await page.goto('/queue');
  const nav = page.getByRole('navigation', { name: th['shell.nav_label'] });
  await nav.getByRole('link', { name: th['admin.config.title'], exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/configuration$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(th['admin.config.title']);
  const served = await index(page);
  const table = page.getByTestId('admin-config-index');
  await expect(table.locator('caption')).toHaveText(th['admin.config.index.caption']);
  await expect(table.locator('tbody tr')).toHaveCount(CONFIGURATION_KINDS.length);
  for (const entry of served.kinds) {
    const tr = table.locator(`tr[data-kind="${entry.kind}"]`);
    await expect(tr.locator('[data-col="kind"]')).toHaveText(th[`admin.config.kind.${entry.kind}`]);
    await expect(tr.locator('[data-col="owner"]')).toHaveText(
      th[`admin.config.values_owner.${entry.valuesOwner.toLowerCase()}` as keyof typeof th],
    );
    await expect(tr.locator('[data-col="current"]')).toContainText(
      entry.current === null
        ? th['admin.config.not_published']
        : th['admin.config.revision_number'].replace('{number}', String(entry.current.revisionNumber)),
    );
  }
  await expect(table.locator('tr[data-kind="risk_rubric"] [data-col="owner"]')).toHaveText(
    th['admin.config.values_owner.d07'],
  );
  await expect(table.locator('tr[data-kind="group_role_mapping"] [data-col="owner"]')).toHaveText(
    th['admin.config.values_owner.d10'],
  );
  await expectAccessible(page, info, { name: 'admin-config-index-th', lang: 'th' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-config-index-th.png'), fullPage: true });

  // Kind page: history newest first, change notes and version counts equal to the API.
  await table.locator('tr[data-kind="sla"] [data-col="kind"]').getByRole('link').click();
  await expect(page).toHaveURL(/\/admin\/configuration\/sla$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(th['admin.config.kind.sla']);
  const items = await history(page, 'sla');
  expect(items.map((x) => x.revisionNumber)).toEqual([2, 1]);
  expect(items[1]!.frozenOnVersionCount).toBe(1);
  await expect(page.locator('[data-testid="admin-config-history"] tbody tr')).toHaveCount(2);
  await expect(page.locator('[data-testid="admin-config-history"] tbody tr').first()).toHaveAttribute(
    'data-revision',
    '2',
  );
  for (const item of items) {
    await expect(row(page, item.revisionNumber).locator('[data-col="note"]')).toHaveText(
      item.changeNote ?? th['admin.config.no_note'],
    );
    await expect(row(page, item.revisionNumber).locator('[data-col="versions"]')).toHaveText(
      String(item.frozenOnVersionCount),
    );
  }
  await expect(row(page, 2).locator('[data-col="in_force"]')).toHaveText(th['admin.config.history.in_force']);
  await expect(row(page, 2).getByRole('button')).toHaveCount(0); // the revision in force is never restored
  await expect(page.getByTestId('admin-config-current')).toContainText('"dpo": 4');
  await expectAccessible(page, info, { name: 'admin-config-kind-th', lang: 'th' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-config-kind-th.png'), fullPage: true });

  // Two-revision diff: from 1 to 2 changes only /dpo.
  await page.getByLabel(th['admin.config.compare.from']).selectOption(items[1]!.revisionId);
  await page.getByLabel(th['admin.config.compare.to']).selectOption(items[0]!.revisionId);
  await page.getByRole('button', { name: th['admin.config.compare.submit'], exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/admin/configuration/sla/revisions/${items[0]!.revisionId}\\?against=${items[1]!.revisionId}$`,
    ),
  );
  const diff = page.getByTestId('admin-config-diff');
  await expect(diff.locator('tbody tr')).toHaveCount(1);
  const dpo = diff.locator('tr[data-path="/dpo"]');
  await expect(dpo.locator('[data-col="change"]')).toHaveText(th['admin.config.diff.change.changed']);
  await expect(dpo.locator('[data-col="before"]')).toHaveText('3');
  await expect(dpo.locator('[data-col="after"]')).toHaveText('4');
  await expectAccessible(page, info, { name: 'admin-config-diff-th', lang: 'th' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-config-diff-th.png'), fullPage: true });

  // English.
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(diff.locator('caption')).toHaveText(
    en['admin.config.diff.caption'].replace('{from}', '1').replace('{to}', '2'),
  );
  await expect(dpo.locator('[data-col="change"]')).toHaveText(en['admin.config.diff.change.changed']);
  await expectAccessible(page, info, { name: 'admin-config-diff-en', lang: 'en' });

  // Restore revision 1 from its history row: an empty note is refused in the dialog, then a note restores it.
  await page.getByRole('link', { name: en['admin.config.kind.sla'], exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/configuration\/sla$/);
  await row(page, 1).getByRole('button', { name: en['admin.config.restore'] }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText(
    en['admin.config.restore_dialog.title'].replace('{number}', '1'),
  );
  await expect(dialog).toContainText(en['admin.config.applies_note']);
  await dialog.getByRole('button', { name: en['admin.config.restore_dialog.confirm'], exact: true }).click();
  await expect(dialog.getByText(en['admin.config.restore_dialog.note_required'])).toBeVisible();
  expect((await history(page, 'sla')).length).toBe(2);
  await expectAccessible(page, info, { name: 'admin-config-restore-dialog-en', lang: 'en' });
  await dialog.getByLabel(en['admin.config.restore_dialog.note_label']).fill(NOTE_3);
  await dialog.getByRole('button', { name: en['admin.config.restore_dialog.confirm'], exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('admin-config-restored')).toHaveText(
    en['admin.config.restored'].replace('{from}', '1').replace('{to}', '3'),
  );
  await expect(row(page, 3).locator('[data-col="note"]')).toHaveText(NOTE_3);
  await expect(row(page, 3).locator('[data-col="restores"]')).toHaveText(
    en['admin.config.revision_number'].replace('{number}', '1'),
  );
  await expect(row(page, 3).locator('[data-col="in_force"]')).toHaveText(en['admin.config.history.in_force']);
  const after = await history(page, 'sla');
  expect(after[0]).toMatchObject({
    revisionNumber: 3,
    restoresRevisionNumber: 1,
    changeNote: NOTE_3,
    inForce: true,
  });
  expect(await revisionBody(page, 'sla', after[0]!.revisionId)).toEqual({
    dpo: 3,
    ai_coe: 5,
    it_security: 5,
  });
  await expectAccessible(page, info, { name: 'admin-config-restored-en', lang: 'en' });
  await noSidewaysScroll(page);
});

test('a non-Admin has no Configuration link and gets the 403 notice on every Admin page', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');
  const slaId = (await index(page)).kinds.find((x) => x.kind === 'sla')!.current!.revisionId;
  await signOut(page);
  for (const user of ['fx-user-dpo', 'fx-user-owner-cm']) {
    await signInAsFixture(page, user);
    await page.goto('/queue');
    const nav = page.getByRole('navigation', { name: th['shell.nav_label'] });
    await expect(nav.getByRole('link', { name: th['dashboard.title'], exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: th['admin.config.title'], exact: true })).toHaveCount(0);
    for (const path of [
      '/admin/configuration',
      '/admin/configuration/sla',
      `/admin/configuration/sla/revisions/${slaId}`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('alert')).toContainText(th['error.forbidden']);
      await expect(page.locator('table')).toHaveCount(0);
    }
    await expectAccessible(page, info, { name: `admin-config-403-${user}`, lang: 'th' });
    await signOut(page);
  }
  // An unknown kind is the server's 404, rendered as the not-found notice.
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto('/admin/configuration/lane_mapping');
  await expect(page.getByRole('alert')).toContainText(th['error.not_found']);
});

test('keyboard only: open the history, restore with a note from the dialog, focus returns', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');
  await publishSla(page, 4, NOTE_2);
  await page.goto('/admin/configuration');
  await expect(page.getByTestId('admin-config-index')).toBeVisible();
  await tabTo(page, page.locator('tr[data-kind="sla"] [data-col="kind"]').getByRole('link'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/configuration\/sla$/);
  await expectMainFocused(page);
  const restore = row(page, 1).getByRole('button', { name: th['admin.config.restore'] });
  await tabTo(page, restore);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const note = dialog.getByLabel(th['admin.config.restore_dialog.note_label']);
  await expect(note).toBeFocused();
  await page.keyboard.type(NOTE_3);
  await tabTo(
    page,
    dialog.getByRole('button', { name: th['admin.config.restore_dialog.confirm'], exact: true }),
  );
  await expectVisibleFocus(page);
  await expectAccessible(page, info, { name: 'admin-config-keyboard-dialog', lang: 'th' });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('admin-config-restored')).toBeVisible();
  await expect(restore).toBeFocused();
  await expectVisibleFocus(page);
  expect((await history(page, 'sla'))[0]).toMatchObject({ revisionNumber: 3, restoresRevisionNumber: 1 });
});
