// W6-06 (W6 plan sections 1.2 Q1/Q4/Q5/Q16/Q18, 2.1-2.4, 4.2, 9 and 13): the Admin edits the simple configuration
// kinds on the real server with synthetic fixtures. A draft saves half-finished work and lists what publishing would
// refuse; publishing needs a change note and makes the draft the next revision; a page that is out of date gets the
// 409 guidance and reloads; a draft started from an earlier revision is started again from the revision in force.
// th/en, keyboard, axe at the three project widths.
import { test, expect, type Page } from './support/real-test.js';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import type {
  ConfigurationDraftDetail,
  ConfigurationDraftResponse,
  ConfigurationIndexResponse,
  ConfigurationRevisionDetail,
  ConfigurationRevisionListResponse,
  ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { expectAccessible } from './support/axe.js';
import { expectVisibleFocus, tabTo } from './support/keyboard.js';
import { signInAsFixture } from './support/sign-in.js';

const BASE = '/api/admin/configuration';
const NOTE = 'W6-06 synthetic: DPO four working days';

async function history(page: Page, kind: string): Promise<ConfigurationRevisionSummary[]> {
  const response = await page.request.get(`${BASE}/${kind}/revisions`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as ConfigurationRevisionListResponse).items;
}
async function current(page: Page, kind: string): Promise<ConfigurationRevisionDetail> {
  const [newest] = await history(page, kind);
  const response = await page.request.get(`${BASE}/${kind}/revisions/${newest!.revisionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ConfigurationRevisionDetail;
}
async function draftOf(page: Page, kind: string): Promise<ConfigurationDraftDetail | null> {
  const response = await page.request.get(`${BASE}/${kind}/draft`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as ConfigurationDraftResponse).draft;
}
async function noSidewaysScroll(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
}
const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

test('Admin edits the SLA, sees the problem publishing would refuse, and publishes with a change note', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto('/admin/configuration/sla');
  const editor = page.getByTestId('admin-config-editor');
  const dpo = editor.getByLabel(th['lane.dpo'], { exact: true });
  await expect(dpo).toHaveValue('3');
  await expect(editor.getByLabel(th['lane.ai_coe'], { exact: true })).toHaveValue('5');
  const save = editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true });
  const publish = editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true });
  await expect(publish).toBeDisabled(); // no draft
  await expect(editor).toContainText(th['admin.config.editor.publish_needs_save']);

  // A value publishing would refuse still saves as a draft (Q18); the problem is listed beside the field.
  await dpo.fill('0');
  await save.click();
  await expect(page.getByTestId('admin-config-editor-status')).toHaveText(th['admin.config.editor.saved']);
  const problems = page.getByTestId('admin-config-problems');
  const dpoProblem = problems.locator('li[data-path="/dpo"]');
  await expect(dpoProblem).toContainText(th['lane.dpo']);
  await expect(dpoProblem).toContainText(th['validation.configuration.schema']);
  await expect(dpo).toHaveAttribute('aria-invalid', 'true');
  await expect(publish).toBeDisabled();
  await expect(editor).toContainText(th['admin.config.editor.publish_has_problems']);
  expect((await draftOf(page, 'sla'))?.problemCount).toBe(1);
  await expect(page.getByTestId('admin-config-draft')).toContainText(
    fill(th['admin.config.draft.problems'], { count: 1 }),
  );
  await expectAccessible(page, info, { name: 'admin-edit-sla-problem-th', lang: 'th' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-edit-sla-problem-th.png'), fullPage: true });

  await dpo.fill('4');
  await save.click();
  await expect(problems).toHaveCount(0);
  await expect(editor).toContainText(th['admin.config.editor.no_problems']);
  await expect(dpo).not.toHaveAttribute('aria-invalid', 'true');
  expect((await draftOf(page, 'sla'))?.body).toEqual({ dpo: 4, ai_coe: 5, it_security: 5 });

  // English; publish: an empty note is refused in the dialog, then the note publishes revision 2.
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await editor.getByRole('button', { name: en['admin.config.editor.publish'], exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText(
    fill(en['admin.config.publish_dialog.title'], { kind: en['admin.config.kind.sla'] }),
  );
  await expect(dialog).toContainText(en['admin.config.applies_note']);
  const confirm = dialog.getByRole('button', {
    name: en['admin.config.publish_dialog.confirm'],
    exact: true,
  });
  await confirm.click();
  await expect(dialog.getByText(en['admin.config.publish_dialog.note_required'])).toBeVisible();
  expect((await history(page, 'sla')).length).toBe(1);
  await expectAccessible(page, info, { name: 'admin-edit-publish-dialog-en', lang: 'en' });
  await dialog.getByLabel(en['admin.config.publish_dialog.note_label']).fill(NOTE);
  await confirm.click();
  await expect(dialog).toBeHidden();
  const published = page.getByTestId('admin-config-published');
  await expect(published).toHaveText(fill(en['admin.config.editor.published'], { number: 2 }));
  await expect(published).toBeFocused();
  const row2 = page.locator('[data-testid="admin-config-history"] tr[data-revision="2"]');
  await expect(row2.locator('[data-col="note"]')).toHaveText(NOTE);
  await expect(row2.locator('[data-col="in_force"]')).toHaveText(en['admin.config.history.in_force']);
  await expect(page.getByTestId('admin-config-current')).toContainText('"dpo": 4');
  await expect(page.getByTestId('admin-config-draft')).toHaveCount(0);
  await expect(editor.getByLabel(en['lane.dpo'], { exact: true })).toHaveValue('4');
  expect(await current(page, 'sla')).toMatchObject({
    revisionNumber: 2,
    changeNote: NOTE,
    body: { dpo: 4, ai_coe: 5, it_security: 5 },
  });
  expect(await draftOf(page, 'sla')).toBeNull();
  await expectAccessible(page, info, { name: 'admin-edit-sla-published-en', lang: 'en' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-edit-sla-published-en.png'), fullPage: true });
});

test('templates, recipients, calendar and use-case groups: problems shown, drafts discarded and published', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');

  // A template version with no QC catalogue entry is refused (publish qc_rules first, plan 2.4); the draft is discarded.
  await page.goto('/admin/configuration/checklist_templates');
  let editor = page.getByTestId('admin-config-editor');
  await expect(editor).toContainText(th['admin.config.editor.templates_hint']);
  await editor
    .getByRole('button', { name: th['admin.config.editor.add.checklist_templates'], exact: true })
    .click();
  const added = editor.getByLabel(fill(th['admin.config.editor.item.checklist_templates'], { number: 3 }), {
    exact: true,
  });
  await expect(added).toBeFocused();
  await added.fill('v3.0');
  await editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }).click();
  const templateProblem = page.getByTestId('admin-config-problems').locator('li[data-path="/versions/2"]');
  await expect(templateProblem).toContainText(
    fill(th['admin.config.editor.item.checklist_templates'], { number: 3 }),
  );
  await expect(templateProblem).toContainText(th['validation.configuration.template_not_in_catalogue']);
  await expect(added).toHaveAttribute('aria-invalid', 'true');
  await expectAccessible(page, info, { name: 'admin-edit-templates-problem-th', lang: 'th' });
  await noSidewaysScroll(page);
  await editor.getByRole('button', { name: th['admin.config.editor.discard'], exact: true }).click();
  const discard = page.getByRole('dialog');
  await discard.getByRole('button', { name: th['admin.config.discard_dialog.confirm'], exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(page.getByText(th['admin.config.draft.none'])).toBeVisible();
  expect(await draftOf(page, 'checklist_templates')).toBeNull();
  await expect(editor.getByRole('textbox')).toHaveCount(2);

  // A recipient on a real domain is refused while mail stays in the sink.
  await page.goto('/admin/configuration/operator_recipients');
  editor = page.getByTestId('admin-config-editor');
  await expect(editor).toContainText(th['admin.config.editor.recipients_hint']);
  await editor
    .getByRole('button', { name: th['admin.config.editor.add.operator_recipients'], exact: true })
    .click();
  await editor
    .getByLabel(fill(th['admin.config.editor.item.operator_recipients'], { number: 2 }), { exact: true })
    .fill('digest@corp-mail.com');
  await editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }).click();
  await expect(
    page.getByTestId('admin-config-problems').locator('li[data-path="/addresses/1"]'),
  ).toContainText(th['validation.configuration.recipient_not_synthetic']);
  await expect(
    editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }),
  ).toBeDisabled();

  // Calendar: a holiday added and published.
  await page.goto('/admin/configuration/calendar');
  editor = page.getByTestId('admin-config-editor');
  await expect(editor).toContainText('Asia/Bangkok');
  const holidays = (await current(page, 'calendar')).body.holidays as string[];
  await editor.getByRole('button', { name: th['admin.config.editor.add.calendar'], exact: true }).click();
  await editor
    .getByLabel(fill(th['admin.config.editor.item.calendar'], { number: holidays.length + 1 }), {
      exact: true,
    })
    .fill('2026-12-31');
  await editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }).click();
  await expect(editor).toContainText(th['admin.config.editor.no_problems']);
  await editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel(th['admin.config.publish_dialog.note_label'])
    .fill('W6-06 synthetic: year-end holiday');
  await dialog.getByRole('button', { name: th['admin.config.publish_dialog.confirm'], exact: true }).click();
  await expect(page.getByTestId('admin-config-published')).toHaveText(
    fill(th['admin.config.editor.published'], { number: 2 }),
  );
  expect((await current(page, 'calendar')).body).toEqual({
    timezone: 'Asia/Bangkok',
    holidays: [...holidays, '2026-12-31'],
  });
  await expectAccessible(page, info, { name: 'admin-edit-calendar-th', lang: 'th' });
  await noSidewaysScroll(page);

  // Use-case groups: the last group removed, a new one added, published (cases keep their stored value, plan 2.1).
  await page.goto('/admin/configuration/use_case_groups');
  editor = page.getByTestId('admin-config-editor');
  const groups = (await current(page, 'use_case_groups')).body.groups as string[];
  await editor
    .getByRole('button', {
      name: fill(th['admin.config.editor.remove'], {
        item: fill(th['admin.config.editor.item.use_case_groups'], { number: groups.length }),
      }),
      exact: true,
    })
    .click();
  await editor
    .getByRole('button', { name: th['admin.config.editor.add.use_case_groups'], exact: true })
    .click();
  await editor
    .getByLabel(fill(th['admin.config.editor.item.use_case_groups'], { number: groups.length }), {
      exact: true,
    })
    .fill('fraud-analytics');
  await editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }).click();
  await expect(editor).toContainText(th['admin.config.editor.no_problems']);
  await editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(th['admin.config.publish_dialog.note_label']).fill('W6-06 synthetic: new group');
  await dialog.getByRole('button', { name: th['admin.config.publish_dialog.confirm'], exact: true }).click();
  await expect(page.getByTestId('admin-config-published')).toBeVisible();
  expect((await current(page, 'use_case_groups')).body.groups).toEqual([
    ...groups.slice(0, -1),
    'fraud-analytics',
  ]);
  await expectAccessible(page, info, { name: 'admin-edit-groups-th', lang: 'th' });
});

test('a moved draft gives the 409 guidance and Reload shows it; a stale draft starts again from the revision in force', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto('/admin/configuration/sla');
  const editor = page.getByTestId('admin-config-editor');
  await editor.getByLabel(th['lane.dpo'], { exact: true }).fill('4');
  await editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }).click();
  await expect(page.getByTestId('admin-config-editor-status')).toHaveText(th['admin.config.editor.saved']);

  // Another Admin session moves the draft.
  const draft = (await draftOf(page, 'sla'))!;
  const moved = await page.request.put(`${BASE}/sla/draft`, {
    data: {
      baseRevisionId: draft.baseRevisionId,
      expectedDraftVersion: draft.draftVersion,
      body: { dpo: 6, ai_coe: 5, it_security: 5 },
    },
  });
  expect(moved.status()).toBe(200);

  await editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(th['admin.config.publish_dialog.note_label']).fill(NOTE);
  await dialog.getByRole('button', { name: th['admin.config.publish_dialog.confirm'], exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    th['error.stale_version.guidance.configuration_changed'],
  );
  expect((await history(page, 'sla')).length).toBe(1);
  await expectAccessible(page, info, { name: 'admin-edit-409-th', lang: 'th' });
  await dialog.getByRole('button', { name: th['action.reload'], exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(editor.getByLabel(th['lane.dpo'], { exact: true })).toHaveValue('6');

  // Publish revision 2 from the draft, save a new draft on it, then restore revision 1: the draft is now stale.
  const index = (await (await page.request.get(BASE)).json()) as ConfigurationIndexResponse;
  const rev1 = index.kinds.find((x) => x.kind === 'sla')!.current!.revisionId;
  const second = await page.request.post(`${BASE}/sla/draft/publish`, {
    data: { expectedDraftVersion: draft.draftVersion + 1, expectedCurrentRevisionId: rev1, changeNote: NOTE },
  });
  expect(second.status()).toBe(201);
  const rev2 = ((await second.json()) as ConfigurationRevisionSummary).revisionId;
  const onRev2 = await page.request.put(`${BASE}/sla/draft`, {
    data: { baseRevisionId: rev2, expectedDraftVersion: null, body: { dpo: 7, ai_coe: 5, it_security: 5 } },
  });
  expect(onRev2.status()).toBe(200);
  const restored = await page.request.post(`${BASE}/sla/revisions/${rev1}/restore`, {
    data: { expectedCurrentRevisionId: rev2, changeNote: 'W6-06 synthetic: back to the seed' },
  });
  expect(restored.status()).toBe(201);

  await page.reload();
  await expect(page.getByTestId('admin-config-draft')).toContainText(th['admin.config.draft.based_on_stale']);
  await expect(editor.getByLabel(th['lane.dpo'], { exact: true })).toHaveValue('7');
  await expect(editor.getByLabel(th['lane.dpo'], { exact: true })).toBeDisabled();
  await expect(
    editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }),
  ).toBeDisabled();
  await expectAccessible(page, info, { name: 'admin-edit-stale-th', lang: 'th' });
  await editor.getByRole('button', { name: th['admin.config.editor.start_again'], exact: true }).click();
  await expect(editor.getByLabel(th['lane.dpo'], { exact: true })).toHaveValue('3');
  await expect(editor.getByLabel(th['lane.dpo'], { exact: true })).toBeEnabled();
  await expect(page.getByTestId('admin-config-draft')).toContainText(
    fill(th['admin.config.draft.based_on'], { number: 3 }),
  );
  const rebased = (await draftOf(page, 'sla'))!;
  expect(rebased.baseRevisionId).toBe((await current(page, 'sla')).revisionId);
  expect(rebased.body).toEqual({ dpo: 3, ai_coe: 5, it_security: 5 });
  await noSidewaysScroll(page);
});

test('keyboard only: edit the SLA, save the draft, publish from the dialog, focus lands on the result', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto('/admin/configuration/sla');
  const editor = page.getByTestId('admin-config-editor');
  const dpo = editor.getByLabel(th['lane.dpo'], { exact: true });
  await expect(dpo).toHaveValue('3');
  await tabTo(page, dpo);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('4');
  await tabTo(page, editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }));
  await expectVisibleFocus(page);
  await page.keyboard.press('Enter');
  await expect(editor).toContainText(th['admin.config.editor.no_problems']);
  await tabTo(page, editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(th['admin.config.publish_dialog.note_label'])).toBeFocused();
  await page.keyboard.type(NOTE);
  await tabTo(
    page,
    dialog.getByRole('button', { name: th['admin.config.publish_dialog.confirm'], exact: true }),
  );
  await expectVisibleFocus(page);
  await expectAccessible(page, info, { name: 'admin-edit-keyboard-dialog', lang: 'th' });
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('admin-config-published')).toBeFocused();
  await expectVisibleFocus(page);
  expect(await current(page, 'sla')).toMatchObject({ revisionNumber: 2, changeNote: NOTE });
});
