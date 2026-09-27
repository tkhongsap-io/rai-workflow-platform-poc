// W5-07 (W5 plan section 7, "Pack editor") on the real server: the risk questionnaire in the pack editor. The owner
// answers, clears and saves through the existing save-draft request; the live preview runs the shared engine and is
// labelled as a preview (nothing is recorded before submit); the SYNTHETIC PLACEHOLDER banner shows with the
// questions (R-2); Thai and English; axe with no critical or serious violation at the three widths (projects);
// keyboard-only answering with native radios. A 404 on the rubric read (R-16) shows one "not configured" line and
// leaves save and submit working. The seeded rubric is the W5-02 placeholder, not D07 (AI/COE).
// Fixture set slice1-synthetic@1: RAI-2000-0001 (slot 1 attached), fx-user-owner-cm.

import { test, expect, type Page } from './support/real-test.js';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { t, type Locale } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabUntil } from './support/keyboard.js';
import { signInAsFixture } from './support/sign-in.js';
import { FIXTURE_SET } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const CASE = 'RAI-2000-0001';
const RUBRIC_ROUTE = '**/api/configuration/risk-rubric/current';

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function readDraft(page: Page, caseId: string): Promise<PackDraft> {
  const response = await page.request.get(`/api/cases/${caseId}/draft`);
  expect(response.status()).toBe(200);
  return (await response.json()) as PackDraft;
}

async function openEditor(page: Page, caseId: string): Promise<void> {
  await page.goto(`/cases/${caseId}`);
  await expect(page.locator('[data-risk-questionnaire="ready"]')).toBeVisible({ timeout: 15_000 });
}

async function switchLocale(page: Page, locale: Locale): Promise<void> {
  const res = await page.request.post('/api/session/locale', { data: { locale } });
  expect(res.status()).toBe(204);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-risk-questionnaire="ready"]')).toBeVisible({ timeout: 15_000 });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, 'no horizontal page scroll').toBeLessThanOrEqual(overflow.innerWidth);
}

const question = (page: Page, id: string) => page.locator(`[data-risk-question="${id}"]`);
const preview = (page: Page) => page.locator('[data-risk-preview]');

test.describe(`W5-07 risk questionnaire in the pack editor on the real server (${FIXTURE_SET})`, () => {
  test('answer, preview, save with attribution, clear; placeholder banner; th and en; axe', async ({
    page,
  }, testInfo) => {
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, CASE);
    await openEditor(page, caseId);

    // The placeholder banner and seven questions, each with its options plus Unknown and the evidence hint.
    const section = page.locator('[data-risk-questionnaire="ready"]');
    await expect(section.getByRole('note')).toHaveText(t('th', 'risk.placeholder.banner'));
    await expect(section.locator('fieldset[data-risk-question]')).toHaveCount(7);
    await expect(question(page, 'RQ1').locator('input[type="radio"]')).toHaveCount(4);
    await expect(question(page, 'RQ1').getByLabel(t('th', 'risk.answer.unknown'))).toBeVisible();
    await expect(question(page, 'RQ1').locator('[data-risk-evidence="attached"]')).toHaveText(
      t('th', 'risk.evidence.hint', {
        slot: 1,
        name: t('th', 'slot.s1.name'),
        state: t('th', 'slot.state.attached'),
      }),
    );
    await expect(section).toContainText('synthetic-placeholder.1');

    // No answers: the preview is Unknown over the whole range, labelled as a preview.
    await expect(preview(page)).toHaveAttribute('data-risk-preview', 'unknown');
    await expect(preview(page)).toContainText(t('th', 'risk.preview.label'));
    await expect(preview(page)).toContainText(
      t('th', 'risk.unknown.range', { count: 7, lowest: 'ต่ำ', highest: 'สูง' }),
    );

    // Three high answers settle High with four questions still open; the Council line says so.
    await question(page, 'RQ1').locator('input[value="public"]').check();
    await question(page, 'RQ2').locator('input[value="automated"]').check();
    await expect(preview(page)).toHaveAttribute('data-risk-preview', 'unknown');
    await question(page, 'RQ4').locator('input[value="customers"]').check();
    await question(page, 'RQ3').locator('input[value="unknown"]').check();
    await expect(preview(page)).toHaveAttribute('data-risk-preview', 'high');
    await expect(preview(page).locator('[data-risk-council="required"]')).toHaveText(
      t('th', 'risk.council.required'),
    );
    await expect(question(page, 'RQ1').locator('[data-risk-attribution="pending"]')).toHaveText(
      t('th', 'risk.answer.unsaved'),
    );
    await expect(page.getByText(t('th', 'pack.pending_changes', { count: 4 }))).toBeVisible();
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toBeDisabled();

    // Nothing is recorded before the save: the draft still has no answers.
    expect((await readDraft(page, caseId)).riskAnswers).toEqual({});

    // Save through the one draft request; the answers come back attributed to the owner.
    const savePromise = page.waitForRequest((req) => req.method() === 'PUT' && /\/draft$/.test(req.url()));
    await page.getByRole('button', { name: t('th', 'pack.action.save') }).click();
    const sent = (await savePromise).postDataJSON() as { riskAnswers?: Record<string, string | null> };
    expect(sent.riskAnswers).toEqual({ RQ1: 'public', RQ2: 'automated', RQ3: 'unknown', RQ4: 'customers' });
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
    const saved = await readDraft(page, caseId);
    expect(Object.keys(saved.riskAnswers).sort()).toEqual(['RQ1', 'RQ2', 'RQ3', 'RQ4']);
    expect(saved.riskAnswers.RQ1).toMatchObject({ value: 'public', answeredRole: 'owner' });
    await expect(question(page, 'RQ1').locator('[data-risk-attribution="saved"]')).toContainText(
      t('th', 'role.owner'),
    );
    await expect(question(page, 'RQ1').locator('input[value="public"]')).toBeChecked();
    await expect(preview(page)).toHaveAttribute('data-risk-preview', 'high');
    await expect(page.getByRole('button', { name: t('th', 'pack.action.submit') })).toBeEnabled();
    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'w5-07-risk-questionnaire-th', lang: 'th' });

    // English: the rubric's own English text, the English banner and tier labels.
    await switchLocale(page, 'en');
    await expect(page.getByRole('heading', { name: t('en', 'risk.questionnaire.heading') })).toBeVisible();
    await expect(section.getByRole('note')).toHaveText(t('en', 'risk.placeholder.banner'));
    await expect(question(page, 'RQ1').locator('legend')).toHaveText(
      '[SYNTHETIC PLACEHOLDER] How many people does the system affect?',
    );
    await expect(preview(page)).toContainText(t('en', 'risk.preview.label'));
    await expect(preview(page)).toContainText('High');
    await expect(preview(page).locator('[data-risk-council="required"]')).toHaveText(
      t('en', 'risk.council.required'),
    );
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'w5-07-risk-questionnaire-en', lang: 'en' });

    // Clear one answer: the tier may still be High but is no longer settled, so the preview says "may require".
    await page.getByRole('button', { name: t('en', 'risk.answer.clear_label', { number: 1 }) }).click();
    await expect(question(page, 'RQ1').locator('input:checked')).toHaveCount(0);
    await expect(preview(page)).toHaveAttribute('data-risk-preview', 'unknown');
    await expect(preview(page).locator('[data-risk-council="possible"]')).toHaveText(
      t('en', 'risk.council.possible'),
    );
    await page.getByRole('button', { name: t('en', 'pack.action.save') }).click();
    await expect(page.getByRole('status')).toContainText(t('en', 'pack.saved', { revision: 3 }));
    const cleared = await readDraft(page, caseId);
    expect(Object.keys(cleared.riskAnswers).sort()).toEqual(['RQ2', 'RQ3', 'RQ4']);
    await expect(
      page.getByRole('button', { name: t('en', 'risk.answer.clear_label', { number: 1 }) }),
    ).toBeDisabled();
  });

  test('keyboard only: native radios answer a question and the save reaches the draft', async ({ page }) => {
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, CASE);
    await openEditor(page, caseId);

    // Tab into the first question's radio group; arrow keys move within the group and select.
    await tabUntil(page, (info) => info.tag === 'input', 80);
    const inFirst = await page.evaluate(
      () =>
        document.activeElement?.closest('[data-risk-question]')?.getAttribute('data-risk-question') ?? null,
    );
    expect(inFirst).toBe('RQ1');
    await page.keyboard.press('Space');
    await expect(question(page, 'RQ1').locator('input[value="few"]')).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(question(page, 'RQ1').locator('input[value="many"]')).toBeChecked();
    await expectVisibleFocus(page);
    // Tab leaves the group (one stop per radio group) and reaches the clear button of question 1.
    const clearLabel = t('th', 'risk.answer.clear');
    await tabUntil(page, (info) => info.tag === 'button' && info.text === clearLabel, 5);
    await tabUntil(page, (info) => info.tag === 'button' && info.text === t('th', 'pack.action.save'), 60);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
    expect((await readDraft(page, caseId)).riskAnswers.RQ1?.value).toBe('many');
  });

  test('a 404 on the rubric read shows "not configured" and leaves save and submit working (R-16)', async ({
    page,
  }) => {
    await signInAsFixture(page, OWNER);
    const caseId = await caseIdOf(page, CASE);
    await page.route(RUBRIC_ROUTE, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'not_found', messageKey: 'error.not_found', correlationId: crypto.randomUUID() },
        }),
      }),
    );
    await page.goto(`/cases/${caseId}`);
    const section = page.locator('[data-risk-questionnaire="not_configured"]');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section).toContainText(t('th', 'risk.questionnaire.not_configured'));
    await expect(section.locator('fieldset')).toHaveCount(0);
    await expect(page.locator('.notice-error')).toHaveCount(0);
    await expect(page.locator('[data-placeholder-rubric]')).toHaveCount(0);

    // Save stays reachable (a settings change) and submit still works.
    await page.locator('#pack-stage').selectOption({ index: 1 });
    await page.getByRole('button', { name: t('th', 'pack.action.save') }).click();
    await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
    await page.getByRole('button', { name: t('th', 'pack.action.submit') }).click();
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/versions/`), { timeout: 15_000 });
  });
});
