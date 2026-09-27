// W4-12 (W4a plan section 7) on the real server under the evidence configuration (QC_MODE=substitute, whose scripted
// findings carry evidence locators): the QC log on the version view, every unavailable run on the version (any
// trigger) before the decision controls, a completed run that evaluated 0 rules reading differently from "no
// findings", and a finding row with its rule label, rule ID, evidence location and owning lane. Thai and English, the
// three widths (projects), axe with no critical or serious violation, keyboard-only approve.
// Fixture set slice1-synthetic@1: fx-case-na-reasons (RAI-2000-0004), fx-case-vendor (HR); fx-user-owner-cm,
// fx-user-ai-coe, fx-user-dpo.

import { test, expect, type Page } from './support/real-test.js';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { CaseListResponse } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { VersionQcRunsResponse } from '@rai/shared/schemas/review';
import { t, type Locale } from '@rai/shared/locales/keys';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectVisibleFocus, tabUntil } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET, queryRows } from './support/database.js';

const OWNER = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const DPO = 'fx-user-dpo';
const NA_REASONS_CASE = 'RAI-2000-0004';
const EXCERPT_HASH = '0cb00095daeff1cf47996a236d9551eae358c081aeafc54d36039d7d592920fd'; // fx-case-vendor.json

async function caseIdOf(page: Page, registryId: string): Promise<string> {
  const response = await page.request.get('/api/cases?pageSize=100');
  expect(response.status()).toBe(200);
  const list = (await response.json()) as CaseListResponse;
  const row = list.items.find((item) => item.registryId === registryId);
  if (row === undefined) throw new Error(`${registryId} is not in the signed-in user's list`);
  return row.caseId;
}

async function submitDraft(page: Page, caseId: string, draft: Pick<PackDraft, 'draftId' | 'draftRevision'>) {
  const submit = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
    data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
    headers: { 'idempotency-key': crypto.randomUUID() },
  });
  expect(submit.status()).toBe(201);
  return ((await submit.json()) as { versionId: string }).versionId;
}

/**
 * An upload QC outage on slot 7 recorded on the draft, as W4-04 writes it (run lane NULL, slot set, 0 rules; the
 * QC-UNAVAILABLE finding owned by the slot's lane, IT/Security). Seeded because the evidence configuration's
 * substitute has no upload script (W4-04 removed them), so no upload run there is ever unavailable. Synthetic.
 */
async function seedUploadOutage(draftId: string): Promise<string> {
  const [revision] = await queryRows<{ id: string }>(
    "SELECT id FROM configuration_revision WHERE kind = 'qc_rules' ORDER BY revision_number DESC LIMIT 1",
  );
  const runId = crypto.randomUUID();
  await queryRows(
    `INSERT INTO qc_run (id, version_id, trigger, slot, lane, engine_id, runner_version, rule_revision, status,
                         unavailable_reason, rules_evaluated, requested_at, completed_at, correlation_id)
     VALUES ($1, $2, 'upload', 7, NULL, 'substitute-scripted', '0.0.0', $3, 'unavailable', 'timeout', 0,
             now() - interval '1 minute', now() - interval '1 minute', $4)`,
    [runId, draftId, revision!.id, crypto.randomUUID()],
  );
  await queryRows(
    `INSERT INTO qc_finding (id, run_id, version_id, slot, kind, rule_id, rule_revision, severity, owning_lane,
                             evidence, message_key, message_params, created_at)
     VALUES ($1, $2, $3, NULL, 'unavailable', 'QC-UNAVAILABLE', $4, 'high', 'it_security',
             '[{"artifact_id":null,"content_hash":null,"slot":null,"locator":{"kind":"absent"}}]'::jsonb,
             'qc.finding.unavailable', '{"reason":"timeout","trigger":"upload","rulesEvaluated":0}'::jsonb,
             now() - interval '1 minute')`,
    [crypto.randomUUID(), runId, draftId, revision!.id],
  );
  return runId;
}

async function openAsReviewer(page: Page, fixtureUserId: string, caseId: string, versionId: string) {
  await signInAsFixture(page, fixtureUserId);
  await page.goto(`/cases/${caseId}/versions/${versionId}`);
  await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
  await expect(page.locator('[data-qc-log="ready"]')).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, 'no horizontal page scroll').toBeLessThanOrEqual(overflow.innerWidth);
}

/** Whether `first` precedes `second` in document order. */
async function precedes(page: Page, first: string, second: string): Promise<boolean> {
  return page.evaluate(
    ([a, b]) => {
      const x = document.querySelector(a!);
      const y = document.querySelector(b!);
      if (x === null || y === null) return false;
      return Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
    },
    [first, second],
  );
}

async function switchLocale(page: Page, locale: Locale): Promise<void> {
  const res = await page.request.post('/api/session/locale', { data: { locale } });
  expect(res.status()).toBe(204);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-review-controls="ready"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-qc-log="ready"]')).toBeVisible();
}

test.describe(`W4-12 QC log and unavailable runs on the real server (${FIXTURE_SET})`, () => {
  test('every unavailable run shows before the decision controls; 0 rules evaluated is not "no defects"; the QC log lists every run; th and en; keyboard approve', async ({
    page,
  }, testInfo) => {
    // Slot 1 "not yet" breaks fx-case-na-reasons' AI/COE script, so that lane's run is unavailable (as in W2-INT-07).
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
    const uploadRunId = await seedUploadOutage(draft.draftId);
    const versionId = await submitDraft(page, caseId, (await saved.json()) as PackDraft);
    await signOut(page);

    // The AI/COE reviewer's opening records that lane's unavailable approve-attempt run.
    await openAsReviewer(page, AI_COE, caseId, versionId);
    await expect(page.locator('[data-review-qc="unavailable"] [data-unavailable-run-id]')).toHaveCount(2);
    await signOut(page);

    // The DPO reviewer sees both outages (an upload run and another lane's run) before deciding; its own run is
    // scripted with no rule, so it evaluated 0 rules and never reads as "no defects".
    await openAsReviewer(page, DPO, caseId, versionId);
    const runs = (
      (await (
        await page.request.get(`/api/cases/${caseId}/versions/${versionId}/qc-runs`)
      ).json()) as VersionQcRunsResponse
    ).runs;
    const aiRun = runs.find((r) => r.trigger === 'approve_attempt' && r.lane === 'ai_coe')!;
    const dpoRun = runs.find((r) => r.trigger === 'approve_attempt' && r.lane === 'dpo')!;
    expect(runs.map((r) => r.runId)).toEqual([
      uploadRunId,
      runs.find((r) => r.trigger === 'submit')!.runId,
      aiRun.runId,
      dpoRun.runId,
    ]);

    const block = page.locator('[data-review-qc="unavailable"]');
    await expect(block).toHaveCount(1);
    await expect(block.locator('[data-unavailable-run-id]')).toHaveCount(2);
    await expect(block.locator(`[data-unavailable-run-id="${uploadRunId}"]`)).toContainText(
      t('th', 'qc_log.scope.slot', { trigger: t('th', 'qc_log.trigger.upload'), number: 7 }),
    );
    await expect(block.locator(`[data-unavailable-run-id="${aiRun.runId}"]`)).toContainText(
      t('th', 'qc_log.scope.lane', {
        trigger: t('th', 'qc_log.trigger.approve_attempt'),
        lane: t('th', 'lane.ai_coe'),
      }),
    );
    await expect(page.locator('[data-review-qc="no_rules"]')).toContainText(
      t('th', 'review.findings.no_rules'),
    );
    await expect(page.locator('[data-review-qc="empty"]')).toHaveCount(0);
    expect(
      await precedes(page, '[data-review-qc="unavailable"]', '[data-review-controls="ready"]'),
      'unavailable runs render before the decision controls',
    ).toBe(true);

    const log = page.locator('[data-qc-log="ready"]');
    await expect(log.locator('[data-qc-run-id]')).toHaveCount(4);
    const outcomes = await log
      .locator('[data-qc-run-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-qc-outcome')));
    expect(outcomes).toEqual(['unavailable', 'no_rules', 'unavailable', 'no_rules']);
    await expect(log.locator(`[data-qc-run-id="${dpoRun.runId}"]`)).toContainText(
      t('th', 'qc_log.outcome.no_rules'),
    );
    await expect(log.locator(`[data-qc-run-id="${dpoRun.runId}"]`)).toContainText(
      t('th', 'qc_log.revision', { label: 'w4a.1' }),
    );
    await expect(log.locator(`[data-qc-run-id="${uploadRunId}"]`)).toContainText(
      t('th', 'qc_log.outcome.unavailable', { reason: t('th', 'review.qc.reason.timeout') }),
    );
    await expectStatusElementsHaveText(page);
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'w4-12-unavailable-runs-qc-log-th', lang: 'th' });

    await switchLocale(page, 'en');
    await expect(page.getByRole('heading', { level: 2, name: t('en', 'qc_log.heading') })).toBeVisible();
    await expect(page.locator('[data-review-qc="no_rules"]')).toContainText(
      t('en', 'review.findings.no_rules'),
    );
    await expect(block.locator(`[data-unavailable-run-id="${uploadRunId}"]`)).toContainText(
      t('en', 'review.qc.unavailable_body', { reason: t('en', 'review.qc.reason.timeout') }),
    );
    await expect(log.locator(`[data-qc-run-id="${uploadRunId}"]`)).toContainText(
      t('en', 'qc_log.outcome.unavailable', { reason: t('en', 'review.qc.reason.timeout') }),
    );
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, testInfo, { name: 'w4-12-unavailable-runs-qc-log-en', lang: 'en' });

    // Keyboard only: reach Approve past the outage list and decide; approve names the run the reviewer saw.
    const approveLabel = t('en', 'review.action.approve');
    const approvePromise = page.waitForRequest(
      (req) => req.method() === 'POST' && /\/lanes\/dpo\/approve$/.test(req.url()),
    );
    await tabUntil(page, (info) => info.tag === 'button' && info.text === approveLabel, 80);
    await expectVisibleFocus(page);
    await page.keyboard.press('Enter');
    const body = (await approvePromise).postDataJSON() as { qcRunId?: string };
    expect(body.qcRunId).toBe(dpoRun.runId);
    await expect(
      page.getByRole('status').filter({ hasText: t('en', 'review.decided.approve') }),
    ).toBeFocused();
    // The QC log stays on the decided version.
    await expect(page.locator('[data-qc-log="ready"] [data-qc-run-id]')).toHaveCount(4);
  });

  test('a finding row shows its rule label, rule ID, evidence location and owning lane; no excerpt hash reaches the page', async ({
    page,
  }, testInfo) => {
    await signInAsFixture(page, OWNER);
    const caseId = findFixtureCase('fx-case-vendor')!.caseId;
    const draft = (await (await page.request.get(`/api/cases/${caseId}/draft`)).json()) as PackDraft;
    const versionId = await submitDraft(page, caseId, draft);
    await signOut(page);

    await openAsReviewer(page, AI_COE, caseId, versionId);
    const rows = page.locator('[data-review-qc="findings"] [data-finding-id]');
    await expect(rows).toHaveCount(2);
    const cited = rows.filter({ has: page.locator('[data-finding-rule="ACC-METRIC-CITED"]') });
    const extraction = rows.filter({
      has: page.locator('[data-finding-rule="ACC-EXTRACTION-NOT-HALLUCINATION"]'),
    });
    // W4-16: the line names the ordinal the scripted locator carries (section 4, page 3), never document text.
    const slotOne = (locale: Locale, kind: 'section' | 'page') =>
      t(locale, 'review.evidence.label', {
        locations: t(locale, 'review.evidence.location', {
          place: t(locale, 'review.evidence.slot', { number: 1 }),
          kind:
            kind === 'section'
              ? t(locale, 'review.evidence.ordinal.section', { index: 4 })
              : t(locale, 'review.evidence.ordinal.page', { page: 3 }),
        }),
      });
    for (const locale of ['th', 'en'] as const) {
      if (locale === 'en') await switchLocale(page, 'en');
      await expect(cited.locator('.finding-rule')).toHaveText(
        t(locale, 'review.findings.rule', {
          label: t(locale, 'qc.rule.acc_metric_cited'),
          id: 'ACC-METRIC-CITED',
        }),
      );
      await expect(cited.locator('.finding-evidence')).toHaveText(slotOne(locale, 'section'));
      await expect(cited.locator('[data-finding-owning-lane="ai_coe"]')).toHaveText(
        t(locale, 'review.findings.owning_lane', { lane: t(locale, 'lane.ai_coe') }),
      );
      await expect(extraction.locator('.finding-rule')).toHaveText(
        t(locale, 'review.findings.rule', {
          label: t(locale, 'qc.rule.acc_extraction_not_hallucination'),
          id: 'ACC-EXTRACTION-NOT-HALLUCINATION',
        }),
      );
      await expect(extraction.locator('.finding-evidence')).toHaveText(slotOne(locale, 'page'));
      const log = page.locator('[data-qc-log="ready"]');
      const outcomes = await log
        .locator('[data-qc-run-id]')
        .evaluateAll((items) => items.map((row) => row.getAttribute('data-qc-outcome')));
      expect(outcomes, 'submit evaluated no scripted rule; the AI/COE run recorded findings').toEqual([
        'no_rules',
        'findings',
      ]);
      expect(await page.content()).not.toContain(EXCERPT_HASH);
      await expectStatusElementsHaveText(page);
      await expectNoHorizontalScroll(page);
      await expectAccessible(page, testInfo, { name: `w4-12-finding-row-${locale}`, lang: locale });
    }
  });
});
