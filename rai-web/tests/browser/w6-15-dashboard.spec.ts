// W6-15 (W6 plan sections 8, 9 and 13): the dashboard screen on the real server with synthetic fixtures. Every number
// on screen is the one `GET /api/dashboard` serves to the same session (the SPA never counts); each role sees its own
// scope; a countable number opens the W6-14 queue drill-down; th/en, keyboard, axe at the three project widths.
import { test, expect, type Page } from './support/real-test.js';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import { CASE_STATUSES } from '@rai/shared/schemas/cases';
import type { DashboardResponse } from '@rai/shared/schemas/dashboard';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { expectMainFocused, expectVisibleFocus, tabTo } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';

const LANES = ['ai_coe', 'dpo', 'it_security'] as const;
const LANE_COLUMNS = ['pending', 'approved', 'sentBack', 'dueSoon', 'breached'] as const;
const SEVERITIES = ['high', 'medium', 'low'] as const;

async function dashboard(page: Page): Promise<DashboardResponse> {
  const response = await page.request.get('/api/dashboard');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-rai-substitute']).toBeUndefined();
  return (await response.json()) as DashboardResponse;
}
async function queue(page: Page, query = ''): Promise<QueueResponse> {
  const response = await page.request.get(`/api/queue${query}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as QueueResponse;
}
async function submit(page: Page, registryId: string): Promise<void> {
  const item = (await queue(page)).items.find((x) => x.registryId === registryId)!;
  const draft = (await (await page.request.get(`/api/cases/${item.caseId}/draft`)).json()) as PackDraft;
  const response = await page.request.post(`/api/cases/${item.caseId}/draft/submit`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
  });
  expect(response.status()).toBe(201);
}
async function openDashboard(page: Page, user: string): Promise<DashboardResponse> {
  await signInAsFixture(page, user);
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-as-of')).toBeVisible();
  return dashboard(page);
}
const cell = (page: Page, tile: string, row: string, col: string) =>
  page.locator(`[data-tile="${tile}"] tr[data-row="${row}"] [data-col="${col}"]`);

/** Every countable number on screen equals the served one, as text (numbers are text, plan section 9). */
async function expectTilesMatch(page: Page, data: DashboardResponse): Promise<void> {
  await expect(cell(page, 'status', 'total', 'count')).toHaveText(String(data.cases.total));
  for (const status of CASE_STATUSES)
    await expect(cell(page, 'status', status, 'count')).toHaveText(String(data.cases.byStatus[status]));
  for (const lane of data.lanes)
    for (const col of LANE_COLUMNS)
      await expect(cell(page, 'lanes', lane.lane, col)).toHaveText(String(lane[col]));
  for (const lane of LANES) {
    for (const severity of SEVERITIES) {
      const served = data.findings.open.find((x) => x.lane === lane && x.severity === severity)?.count ?? 0;
      await expect(cell(page, 'findings', lane, severity)).toHaveText(String(served));
    }
    const { outage, paused } = data.findings.unavailableOpen[lane];
    await expect(cell(page, 'findings', lane, 'unavailable')).toHaveText(String(outage + paused));
    await expect(cell(page, 'findings', lane, 'paused')).toHaveText(String(paused));
  }
  for (const col of ['runs30d', 'unavailableRuns30d', 'pausedRuns30d', 'rechecks30d'] as const)
    await expect(cell(page, 'qc', col, 'count')).toHaveText(String(data.qc[col]));
  await expect(page.locator('[data-tile="activity"] tbody tr')).toHaveCount(data.activity.length);
  for (const week of data.activity)
    for (const col of ['submitted', 'resubmitted', 'sentBack', 'ready'] as const)
      await expect(cell(page, 'activity', week.weekStart, col)).toHaveText(String(week[col]));
}

test('owner dashboard equals the API, is accessible in Thai and English, and drills down to the queue', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-owner-cm');
  await submit(page, 'RAI-2000-0001');
  await submit(page, 'RAI-2000-0003'); // a slot without a document: an open QC defect on the current version
  await page.goto('/queue');
  // "Dashboard" is the first link of the primary navigation.
  const nav = page.getByRole('navigation', { name: th['shell.nav_label'] });
  await expect(nav.getByRole('link').first()).toHaveText(th['dashboard.title']);
  await nav.getByRole('link', { name: th['dashboard.title'], exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(th['dashboard.title']);
  await expect(page.getByTestId('dashboard-as-of')).toBeVisible();
  const data = await dashboard(page);
  expect(data.cases.total).toBe(5);
  expect(data.cases.byStatus.in_review + data.cases.byStatus.awaiting_disposition).toBe(2);
  await expectTilesMatch(page, data);
  // Each tile is a captioned table; bars are decoration only; the risk tile says tiers are not available yet.
  for (const tile of ['status', 'lanes', 'findings', 'qc', 'activity'])
    await expect(page.locator(`[data-tile="${tile}"] table caption`)).toHaveCount(1);
  await expect(page.locator('.dashboard-bar').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-tile="risk"]')).toContainText(th['dashboard.risk.unavailable']);
  // A 0 is plain text, a count is a link.
  await expect(cell(page, 'lanes', 'dpo', 'approved').getByRole('link')).toHaveCount(0);
  await expect(cell(page, 'lanes', 'dpo', 'pending').getByRole('link')).toHaveText('2');
  await expectStatusElementsHaveText(page);
  await expectAccessible(page, info, { name: 'dashboard-th', lang: 'th' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('dashboard-th.png'), fullPage: true });

  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['dashboard.title']);
  await expect(page.locator('[data-tile="lanes"] caption')).toHaveText(en['dashboard.lanes.caption']);
  await expectTilesMatch(page, data);
  await expectAccessible(page, info, { name: 'dashboard-en', lang: 'en' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  // Drill-down: the DPO pending count opens the queue filtered to exactly those cases.
  await cell(page, 'lanes', 'dpo', 'pending').getByRole('link').click();
  await expect(page).toHaveURL(/\/queue\?lane=dpo&laneStatus=pending$/);
  await expect(page.getByTestId('queue-drilldown')).toBeVisible();
  await expect(page.locator('article[data-registry-id]')).toHaveCount(2);
  await expect(page.locator('article[data-registry-id="RAI-2000-0001"]')).toBeVisible();
  // Back returns to the dashboard; the status link opens the queue's status filter.
  await page.goBack();
  await expect(page.getByTestId('dashboard-as-of')).toBeVisible();
  await cell(page, 'status', 'draft', 'count').getByRole('link').click();
  await expect(page).toHaveURL(/\/queue\?status=draft$/);
  await expect(page.locator('article[data-registry-id]')).toHaveCount(data.cases.byStatus.draft);
  await page.goBack();
  // A finding count opens the defect drill-down of its lane and severity (never the QC-unavailable findings).
  const open = data.findings.open[0];
  expect(open, 'the missing-slot submit leaves an open defect').toBeDefined();
  const filter = `findingLane=${open!.lane}&findingSeverity=${open!.severity}&findingKind=defect`;
  await cell(page, 'findings', open!.lane, open!.severity).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/queue\\?${filter}$`));
  await expect(page.getByTestId('queue-drilldown')).toBeVisible();
  await expect(page.locator('article[data-registry-id="RAI-2000-0003"]')).toBeVisible();
  await expect(page.locator('article[data-registry-id]')).toHaveCount(
    (await queue(page, `?${filter}`)).total,
  );
});

test('each role sees its own scope: BU SPOC, DPO reviewer and Admin', async ({ page }, info) => {
  await signInAsFixture(page, 'fx-user-owner-cm');
  await submit(page, 'RAI-2000-0001');
  await signOut(page);
  for (const [user, total] of [
    ['fx-user-spoc-cm', 2],
    ['fx-user-dpo', 5],
    ['fx-user-admin', 5],
  ] as const) {
    const data = await openDashboard(page, user);
    expect(data.cases.total, user).toBe(total);
    await expectTilesMatch(page, data);
    // The status counts are the queue's (W6-13 invariant), so the total link lists the same number of cases.
    expect((await queue(page)).total).toBe(total);
    await expectAccessible(page, info, { name: `dashboard-${user}`, lang: 'th' });
    await signOut(page);
  }
});

test('an owner with no case in scope sees the empty state', async ({ page }, info) => {
  const data = await openDashboard(page, 'fx-user-owner-cm-2');
  expect(data.cases.total).toBe(0);
  await expect(page.getByRole('heading', { level: 2, name: th['dashboard.empty'] })).toBeVisible();
  await expect(page.locator('[data-tile]')).toHaveCount(0);
  await expectAccessible(page, info, { name: 'dashboard-empty-th', lang: 'th' });
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: en['dashboard.empty'] })).toBeVisible();
  await expectAccessible(page, info, { name: 'dashboard-empty-en', lang: 'en' });
});

test('keyboard only: reach the dashboard from the navigation and open a drill-down', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-owner-cm');
  await submit(page, 'RAI-2000-0001');
  await page.goto('/queue');
  await expect(page.getByTestId('queue-count')).toBeVisible();
  await tabTo(page, page.getByRole('navigation', { name: th['shell.nav_label'] }).getByRole('link').first());
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('dashboard-as-of')).toBeVisible();
  await expectMainFocused(page);
  const link = cell(page, 'lanes', 'it_security', 'pending').getByRole('link');
  await tabTo(page, link);
  await expectVisibleFocus(page);
  await expectAccessible(page, info, { name: 'dashboard-keyboard', lang: 'th' });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/queue\?lane=it_security&laneStatus=pending$/);
  await expect(page.getByTestId('queue-drilldown')).toBeVisible();
  await expectMainFocused(page);
});
