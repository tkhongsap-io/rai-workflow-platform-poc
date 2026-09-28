// W6-11 (W6 plan sections 1.2 Q16 and 6): the Admin edits the identity group mapping (`group_role_mapping`) as
// schema-validated JSON on the real server. The page warns that the mapping is read only at start by organisation
// sign-in and ignored by the fixture sign-in this suite uses; text that is not a JSON object is refused in the page and
// never sent; a body the schema refuses saves as a draft and lists its problems; a synthetic mapping publishes as
// revision 1. Synthetic values only: the all-zero tenant and `fx-group-*` IDs. th/en, keyboard, axe at the three
// project widths.
import { test, expect, type Page } from './support/real-test.js';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import type {
  ConfigurationDraftDetail,
  ConfigurationDraftResponse,
  ConfigurationRevisionDetail,
  ConfigurationRevisionListResponse,
  ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { expectAccessible } from './support/axe.js';
import { expectVisibleFocus, tabTo } from './support/keyboard.js';
import { signInAsFixture } from './support/sign-in.js';

const BASE = '/api/admin/configuration';
const KIND = 'group_role_mapping';
const NOTE = 'W6-11 synthetic: fixture groups for the all-zero tenant';
const SYNTHETIC = {
  kind: 'identity.group_role_mapping',
  version: 1,
  tenantId: '00000000-0000-0000-0000-000000000000',
  rules: [
    { groupObjectId: 'fx-group-dpo', role: 'dpo' },
    { groupObjectId: 'fx-group-spoc-cm', role: 'bu_spoc', businessUnit: 'CM' },
    { groupObjectId: 'fx-group-admin', role: 'admin' },
  ],
};

async function history(page: Page): Promise<ConfigurationRevisionSummary[]> {
  const response = await page.request.get(`${BASE}/${KIND}/revisions`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as ConfigurationRevisionListResponse).items;
}
async function current(page: Page): Promise<ConfigurationRevisionDetail> {
  const [newest] = await history(page);
  const response = await page.request.get(`${BASE}/${KIND}/revisions/${newest!.revisionId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ConfigurationRevisionDetail;
}
async function draftOf(page: Page): Promise<ConfigurationDraftDetail | null> {
  const response = await page.request.get(`${BASE}/${KIND}/draft`);
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

test('Admin edits the identity mapping as JSON: warning, invalid text refused, schema problems listed, a synthetic mapping published', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-admin');

  // The index no longer calls the kind not editable (a schema is registered).
  await page.goto('/admin/configuration');
  const row = page.locator(`tr[data-kind="${KIND}"]`);
  await expect(row.locator('[data-col="owner"]')).toHaveText(th['admin.config.values_owner.d10']);
  await expect(row).not.toContainText(th['admin.config.not_editable']);

  await page.goto(`/admin/configuration/${KIND}`);
  const editor = page.getByTestId('admin-config-editor');
  await expect(editor.getByTestId('admin-config-json-warning')).toHaveText(
    th['admin.config.editor.identity_mapping_warning'],
  );
  await expect(editor).toContainText(th['admin.config.editor.json_hint']);
  const text = editor.getByLabel(th['admin.config.editor.json_label'], { exact: true });
  await expect(text).toHaveValue('{}'); // nothing published and no draft: the seed contains no mapping
  const save = editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true });
  const publish = editor.getByRole('button', { name: th['admin.config.editor.publish'], exact: true });
  await expect(publish).toBeDisabled();
  await expectAccessible(page, info, { name: 'admin-identity-mapping-th', lang: 'th' });
  await noSidewaysScroll(page);

  // Text that is not a JSON object is refused in the page; nothing is sent.
  for (const invalid of ['{"kind":', '[1, 2]']) {
    await text.fill(invalid);
    await save.click();
    await expect(editor.getByTestId('admin-config-json-invalid')).toHaveText(
      th['admin.config.editor.json_invalid'],
    );
    await expect(text).toHaveAttribute('aria-invalid', 'true');
    expect(await draftOf(page)).toBeNull();
  }
  await expectAccessible(page, info, { name: 'admin-identity-mapping-invalid-th', lang: 'th' });

  // A body the schema refuses (an unknown role) saves as a draft and lists the problem at its pointer (Q18).
  await text.fill(
    JSON.stringify({ ...SYNTHETIC, rules: [{ groupObjectId: 'fx-group-x', role: 'superuser' }] }, null, 2),
  );
  await save.click();
  await expect(page.getByTestId('admin-config-editor-status')).toHaveText(th['admin.config.editor.saved']);
  await expect(editor.getByTestId('admin-config-json-invalid')).toHaveCount(0);
  const problem = page.getByTestId('admin-config-problems').locator('li[data-path="/rules"]').first();
  await expect(problem).toContainText('/rules');
  await expect(problem).toContainText(th['validation.configuration.schema']);
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  await expect(publish).toBeDisabled();
  expect((await draftOf(page))?.problemCount).toBeGreaterThan(0);
  expect(await history(page)).toEqual([]);

  // A synthetic mapping has no problems and publishes, in English, as revision 1.
  await text.fill(JSON.stringify(SYNTHETIC, null, 2));
  await save.click();
  await expect(editor).toContainText(th['admin.config.editor.no_problems']);
  await expect(text).not.toHaveAttribute('aria-invalid', 'true');
  expect((await draftOf(page))?.body).toEqual(SYNTHETIC);
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(editor.getByTestId('admin-config-json-warning')).toHaveText(
    en['admin.config.editor.identity_mapping_warning'],
  );
  await editor.getByRole('button', { name: en['admin.config.editor.publish'], exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText(
    fill(en['admin.config.publish_dialog.title'], { kind: en['admin.config.kind.group_role_mapping'] }),
  );
  await dialog.getByLabel(en['admin.config.publish_dialog.note_label']).fill(NOTE);
  await dialog.getByRole('button', { name: en['admin.config.publish_dialog.confirm'], exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('admin-config-published')).toHaveText(
    fill(en['admin.config.editor.published'], { number: 1 }),
  );
  await expect(page.getByTestId('admin-config-current')).toContainText('"fx-group-dpo"');
  // The field restarts from the revision in force (stored as jsonb, so its key order may differ from the text sent).
  const published = editor.getByLabel(en['admin.config.editor.json_label'], { exact: true });
  await expect.poll(async () => JSON.parse(await published.inputValue()) as unknown).toEqual(SYNTHETIC);
  expect(await current(page)).toMatchObject({ revisionNumber: 1, changeNote: NOTE, body: SYNTHETIC });
  expect(await draftOf(page)).toBeNull();
  await expectAccessible(page, info, { name: 'admin-identity-mapping-published-en', lang: 'en' });
  await noSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath('admin-identity-mapping-published-en.png'), fullPage: true });
});

test('keyboard only: the JSON field is reachable and a save is made without a pointer', async ({ page }) => {
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto(`/admin/configuration/${KIND}`);
  const editor = page.getByTestId('admin-config-editor');
  const text = editor.getByLabel(th['admin.config.editor.json_label'], { exact: true });
  await expect(text).toHaveValue('{}');
  await tabTo(page, text);
  await expectVisibleFocus(page);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(JSON.stringify(SYNTHETIC));
  await tabTo(page, editor.getByRole('button', { name: th['admin.config.editor.save'], exact: true }));
  await expectVisibleFocus(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('admin-config-editor-status')).toHaveText(th['admin.config.editor.saved']);
  expect((await draftOf(page))?.body).toEqual(SYNTHETIC);
});
