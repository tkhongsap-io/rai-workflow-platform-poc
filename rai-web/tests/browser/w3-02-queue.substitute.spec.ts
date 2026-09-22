// W3-02 UI assertions against W3-08 only. W3-INT owns real-server evidence.
import { test, expect, type Page } from '@playwright/test';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import type { QueueResponse } from '@rai/shared/schemas/queue';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { VersionFindingsResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { tabUntil, pressTab, expectVisibleFocus } from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';

const RESET_URL = `http://127.0.0.1:${process.env.SUBSTITUTE_PORT ?? '8789'}/__substitute/reset`;
const cards = (page: Page) => page.locator('article[data-registry-id]');
const ids = async (page: Page) =>
  cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-registry-id')).sort());
const ALL = ['RAI-2000-0001', 'RAI-2000-0002', 'RAI-2000-0003', 'RAI-2000-0004', 'RAI-2000-0005'];
const CM = ['RAI-2000-0001', 'RAI-2000-0003'];
async function open(page: Page, user = 'fx-user-owner-cm', url = '/queue') {
  await signInAsFixture(page, user);
  await page.goto(url);
  await expect(page.getByTestId('queue-count')).toBeVisible();
}
async function queue(page: Page, query = ''): Promise<QueueResponse> {
  const response = await page.request.get(`/api/queue${query}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as QueueResponse;
}
async function submit(page: Page, caseId: string) {
  const draft = (await (await page.request.get(`/api/cases/${caseId}/draft`)).json()) as PackDraft;
  const response = await page.request.post(`/api/cases/${caseId}/draft/submit`, {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as SubmittedVersion;
}
test.beforeEach(async ({ page }) => {
  expect((await page.request.post(RESET_URL)).status()).toBe(204);
});

test('Thai queue cards, primary navigation and English rendering remain accessible', async ({
  page,
}, info) => {
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(th['queue.title']);
  expect(await ids(page)).toEqual(ALL);
  const card = cards(page).filter({ has: page.getByText('RAI-2000-0004') });
  await expect(card.getByTestId('current-version')).toHaveText(th['cases.version_none']);
  await expect(card.getByTestId('latest-version')).toHaveText(
    th['version.nav_draft'].replace('{number}', '1'),
  );
  await expect(card.getByText(th['queue.no_lanes'])).toBeVisible();
  await expect(card.getByText(th['queue.next.prepare_pack'], { exact: false })).toBeVisible();
  await expectStatusElementsHaveText(page);
  await expectAccessible(page, info, { name: 'queue-th', lang: 'th' });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('queue-th.png'), fullPage: true });
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['queue.title']);
  await expectAccessible(page, info, { name: 'queue-en', lang: 'en' });
  // Compatibility list still has its original heading and API, while primary queue nav is additive.
  await page.getByRole('link', { name: en['shell.nav.cases'], exact: true }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en['cases.title']);
  await page.getByRole('link', { name: en['queue.title'], exact: true }).click();
  await expect(page).toHaveURL(/\/queue$/);
});

test('URL filters, page size, back/forward/reload and no-match/empty-page states', async ({ page }, info) => {
  await open(page, 'fx-user-owner-cm', '/queue?pageSize=2');
  await expect(cards(page)).toHaveCount(2);
  await page.getByRole('button', { name: th['cases.next_page'], exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(
    page.getByText(th['cases.page_of'].replace('{page}', '2').replace('{pages}', '3'), { exact: true }),
  ).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  const second = await ids(page);
  await page.reload();
  await expect(page.getByTestId('queue-count')).toBeVisible();
  await expect.poll(() => ids(page)).toEqual(second);
  await page.getByLabel(th['queue.search'], { exact: true }).fill('พนักงาน');
  await page.getByRole('button', { name: th['queue.apply'] }).click();
  await expect(page).toHaveURL(/page=1/);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByLabel(th['queue.search'], { exact: true })).toHaveValue('พนักงาน');
  await page.goBack();
  await expect(cards(page)).toHaveCount(2);
  await expect.poll(() => ids(page)).toEqual(second);
  await expect(page.getByLabel(th['queue.search'], { exact: true })).toHaveValue('');
  await page.goForward();
  await expect(cards(page)).toHaveCount(1);
  await page.getByLabel(th['queue.search'], { exact: true }).fill('%');
  await page.getByRole('button', { name: th['queue.apply'] }).click();
  await expect(page.getByRole('heading', { name: th['queue.no_matches'] })).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expectAccessible(page, info, { name: 'queue-no-match', lang: 'th' });
  await page.getByRole('button', { name: th['queue.reset'], exact: true }).first().click();
  await expect(cards(page)).toHaveCount(5);
  await page.goto('/queue?page=99&pageSize=2');
  await expect(page.getByRole('heading', { name: th['queue.empty_page'] })).toBeVisible();
  await page.getByRole('button', { name: th['queue.first_page'] }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.goto('/queue?status=invalid');
  await expect(page.getByRole('alert')).toHaveText(th['queue.invalid_query']);
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: th['queue.reset'] }).click();
  await expect(cards(page)).toHaveCount(5);
});

test('Reset clears unapplied drafts on the bare queue before Apply', async ({ page }) => {
  await open(page);
  const search = page.getByLabel(th['queue.search'], { exact: true });
  const searchBy = page.getByLabel(th['queue.search_by'], { exact: true });
  const status = page.locator('#queue-status');
  const owner = page.locator('#queue-owner');
  const group = page.locator('#queue-group');
  const pageSize = page.getByLabel(th['queue.page_size'], { exact: true });
  await search.fill('unapplied');
  await searchBy.selectOption('owner');
  await status.selectOption('draft');
  await owner.selectOption({ index: 1 });
  await group.selectOption({ index: 1 });
  await pageSize.selectOption('10');
  await expect(page).toHaveURL(/\/queue$/);
  await page.getByRole('button', { name: th['queue.reset'], exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(searchBy).toHaveValue('all');
  await expect(status).toHaveValue('');
  await expect(owner).toHaveValue('');
  await expect(group).toHaveValue('');
  await expect(pageSize).toHaveValue('25');
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/queue');
  await page.getByRole('button', { name: th['queue.apply'], exact: true }).click();
  const params = new URL((await requested).url()).searchParams;
  expect(Object.fromEntries(params)).toEqual({ searchBy: 'all', page: '1', pageSize: '25' });
  await expect.poll(() => ids(page)).toEqual(ALL);
});

test('independent scope expectations cover all roles, hidden options/counts, searches and pages', async ({
  page,
}, info) => {
  for (const [user, expected] of [
    ['fx-user-owner-cm', ALL],
    ['fx-user-owner-cm-2', []],
    ['fx-user-spoc-cm', CM],
    ['fx-user-ai-coe', ALL],
    ['fx-user-dpo', ALL],
    ['fx-user-it-security', ALL],
    ['fx-user-admin', ALL],
    ['fx-user-dpo-spoc-hr', ALL],
  ] as const) {
    await open(page, user);
    expect(await ids(page), user).toEqual(expected);
    const response = await queue(page);
    expect(response.total).toBe(expected.length);
    expect(response.statusCounts.draft).toBe(expected.length);
    expect(response.statusCounts.in_review).toBe(0);
    if (expected.length === 0) {
      expect(response.filterOptions).toEqual({ owners: [], statuses: [], useCaseGroups: [] });
      for (const query of [
        '?owner=fixture%3Afx-user-owner-cm',
        '?owner=no-such-owner',
        '?searchBy=owner&search=ณัฐพร',
        '?searchBy=status&search=draft',
        '?searchBy=sourceRecordId&search=TPM',
        '?searchBy=useCaseGroup&search=customer',
        '?search=พนักงาน',
      ])
        expect(await queue(page, query)).toEqual(response);
      await expectAccessible(page, info, { name: 'queue-empty-owner', lang: 'th' });
    }
    if (user === 'fx-user-spoc-cm') {
      const seen: string[] = [];
      for (let n = 1; n <= 2; n++) {
        await page.goto(`/queue?pageSize=1&page=${n}`);
        await expect(cards(page)).toHaveCount(1);
        seen.push(...((await ids(page)) as string[]));
      }
      expect(seen.sort()).toEqual(CM);
      await page.goto('/queue?search=พนักงาน');
      await expect(page.getByTestId('queue-count')).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      expect((await queue(page, '?search=พนักงาน')).filterOptions).toEqual(response.filterOptions);
    }
    await signOut(page);
  }
});

test('queue and card deep links require sign-in; copied HR case remains forbidden to CM SPOC', async ({
  page,
}, info) => {
  await page.goto('/queue?search=พนักงาน');
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  expect((await page.request.get('/api/queue')).status()).toBe(401);
  await page.getByLabel(th['auth.fixture_user_select']).selectOption('fx-user-owner-cm');
  await page.getByRole('button', { name: th['auth.sign_in'], exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  const target = await cards(page).getByRole('link').getAttribute('href');
  expect(target).toMatch(/^\/cases\//);
  await signOut(page);
  await page.goto(target!);
  await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  await page.getByLabel(th['auth.fixture_user_select']).selectOption('fx-user-spoc-cm');
  await page.getByRole('button', { name: th['auth.sign_in'], exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(th['error.forbidden']);
  await expect(
    page.getByText('ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)', { exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api${target!}`)).status()).toBe(403);
  await expectAccessible(page, info, { name: 'queue-deep-link-forbidden', lang: 'th' });
});

test('submitted lane dates and successor versions render from the API in Thai and English', async ({
  page,
}, info) => {
  await open(page);
  const all = await queue(page);
  const original = all.items.find((x) => x.registryId === 'RAI-2000-0001')!;
  const version = await submit(page, original.caseId);
  await page.reload();
  await expect(
    cards(page)
      .filter({ has: page.getByText(original.registryId) })
      .locator('[data-lane]'),
  ).toHaveCount(3);
  const submitted = (await queue(page)).items.find((x) => x.caseId === original.caseId)!;
  let card = cards(page).filter({ has: page.getByText(original.registryId) });
  for (const lane of submitted.lanes) {
    const row = card.locator(`[data-lane="${lane.lane}"]`);
    await expect(row.locator('time')).toHaveAttribute('datetime', lane.due.dueOn);
    await expect(row.locator('time')).toHaveText(
      th['queue.due_on'].replace(
        '{date}',
        new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }).format(new Date(lane.due.dueOn)),
      ),
    );
  }
  await signOut(page);
  await signInAsFixture(page, 'fx-user-dpo');
  const response = await page.request.post(
    `/api/cases/${original.caseId}/versions/${version.versionId}/lanes/dpo/send-back`,
    {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 2, deficiency: 'Synthetic correction' }] },
      },
    },
  );
  expect(response.status()).toBe(201);
  await page.goto('/queue?status=sent_back');
  await expect(cards(page)).toHaveCount(1);
  card = cards(page);
  await expect(card.getByTestId('current-version')).toHaveText(
    th['cases.version_number'].replace('{versionNumber}', '1'),
  );
  await expect(card.getByTestId('latest-version')).toHaveText(
    th['version.nav_draft'].replace('{number}', '2'),
  );
  await expect(card.locator('[data-lane="dpo"] [data-status]')).toHaveAttribute('data-status', 'sent_back');
  await expect(card.getByText(th['queue.next.correct_pack'], { exact: false })).toBeVisible();
  expect(
    (await queue(page)).items.find((x) => x.caseId === original.caseId)!.lanes.map((x) => x.due),
  ).toEqual(submitted.lanes.map((x) => x.due));
  await expectAccessible(page, info, { name: 'queue-successor-th', lang: 'th' });
  await page.screenshot({ path: info.outputPath('queue-successor.png'), fullPage: true });
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(card.getByText(en['queue.next.correct_pack'], { exact: false })).toBeVisible();
  await expectAccessible(page, info, { name: 'queue-successor-en', lang: 'en' });
});

test('keyboard-only filter and card navigation with visible focus', async ({ page }, info) => {
  await open(page);
  await tabUntil(page, (x) => x.tag === 'input');
  await expect(page.getByLabel(th['queue.search'], { exact: true })).toBeFocused();
  await page.keyboard.type('พนักงาน');
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(1);
  await tabUntil(page, (x) => x.tag === 'a' && x.text === th['cases.open']);
  await expectVisibleFocus(page);
  await expectAccessible(page, info, { name: 'queue-keyboard', lang: 'th' });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cases\//);
  await pressTab(page);
  await expectVisibleFocus(page);
});

test('loading, network failure, retry and expired sessions never display stale cards', async ({
  page,
}, info) => {
  await signInAsFixture(page, 'fx-user-owner-cm');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/queue*', async (route) => {
    await gate;
    await route.abort('failed');
  });
  await page.goto('/queue');
  await expect(page.getByRole('status')).toContainText(th['common.loading']);
  await expect(cards(page)).toHaveCount(0);
  await expectAccessible(page, info, { name: 'queue-loading', lang: 'th' });
  release();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expectAccessible(page, info, { name: 'queue-error', lang: 'th' });
  await page.unroute('**/api/queue*');
  await page.getByRole('button', { name: th['common.retry'] }).click();
  await expect(cards(page)).toHaveCount(5);
  await signOut(page);
  await page.getByLabel(th['queue.search'], { exact: true }).fill('x');
  await page.getByRole('button', { name: th['queue.apply'] }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(cards(page)).toHaveCount(0);
});

test('an older response cannot replace the newest URL result', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/queue*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === 'old') {
      const answer = await route.fetch();
      await gate;
      await route.fulfill({ response: answer });
    } else await route.continue();
  });
  await page.getByLabel(th['queue.search'], { exact: true }).fill('old');
  await page.getByRole('button', { name: th['queue.apply'] }).click();
  await expect(page.getByRole('status')).toContainText(th['common.loading']);
  await page.getByLabel(th['queue.search'], { exact: true }).fill('พนักงาน');
  await page.getByRole('button', { name: th['queue.apply'] }).click();
  await expect(cards(page)).toHaveCount(1);
  const settled = page.waitForResponse((r) => new URL(r.url()).searchParams.get('search') === 'old');
  release();
  await settled;
  await expect(cards(page)).toHaveCount(1);
  expect(await ids(page)).toEqual(['RAI-2000-0004']);
});

test('awaiting-disposition and review-complete cards follow substitute workflow responses', async ({
  page,
}, info) => {
  await open(page);
  const vendor = (await queue(page)).items.find((x) => x.registryId === 'RAI-2000-0002')!;
  const version = await submit(page, vendor.caseId);
  const expectedVersion = { versionId: version.versionId, revision: 1 };
  const base = `/api/cases/${vendor.caseId}`;
  const reviewers = { ai_coe: 'fx-user-ai-coe', dpo: 'fx-user-dpo', it_security: 'fx-user-it-security' };
  for (const [lane, user] of Object.entries(reviewers)) {
    await signInAsFixture(page, user);
    const runResponse = await page.request.post(
      `${base}/versions/${version.versionId}/lanes/${lane}/qc-run`,
      { data: { expectedVersion } },
    );
    expect(runResponse.status()).toBe(200);
    const run = (await runResponse.json()) as { runId: string };
    const approved = await page.request.post(`${base}/versions/${version.versionId}/lanes/${lane}/approve`, {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: { expectedVersion, qcRunId: run.runId },
    });
    expect(approved.status()).toBe(201);
  }
  await page.goto('/queue?status=awaiting_disposition');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).getByText(th['queue.next.resolve_findings'], { exact: false })).toBeVisible();
  await expect(cards(page).locator('[data-lane] [data-status="approved"]')).toHaveCount(3);
  await expectAccessible(page, info, { name: 'queue-awaiting-disposition', lang: 'th' });
  const findings = (await (
    await page.request.get(`${base}/versions/${version.versionId}/findings`)
  ).json()) as VersionFindingsResponse;
  expect(findings.findings.length).toBeGreaterThan(0);
  for (const finding of findings.findings) {
    await signInAsFixture(page, reviewers[finding.owningLane]);
    const response = await page.request.post(`${base}/findings/${finding.findingId}/dispositions`, {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: { expectedVersion, kind: 'waived', reason: 'Synthetic browser rehearsal only' },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto('/queue?status=ready_for_launch');
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).getByText(th['queue.next.review_complete'], { exact: false })).toBeVisible();
  await expect(cards(page).getByTestId('latest-version')).toHaveText(
    th['version.nav_submitted'].replace('{number}', '1'),
  );
  await expectAccessible(page, info, { name: 'queue-complete', lang: 'th' });
});
