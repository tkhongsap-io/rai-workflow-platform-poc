// W1-INT: the W1-07 journey (shell, sign-in screen, scoped case list, new-case form) promoted to evidence against
// the REAL server: the built SPA served by `node server/dist/main.js` (server/src/static.ts) on the real Postgres
// in fixture identity mode (playwright.config.ts). It is the W1-07 `*.substitute.spec.ts` with only what the real
// server legitimately differs on changed: no substitute banner and no `x-rai-substitute` header (both asserted
// absent), and the database reset to fixture set slice1-synthetic@1 through support/database.ts instead of the
// substitute's reset hook. Every W1-07 Done-when clause keeps its test: sign-in for each fixture user lands on
// that user's scoped list; an out-of-scope case is absent; no client-side check decides access (the list renders
// what the server returned; a reviewer reaches the form and the server's 403 is what stops the create);
// keyboard-only operation; the axe audit with zero critical and zero serious violations on every screen state; no
// hard-coded string. Proves A01 (browser layer, W0-02 8.2). Fixture ids: the eight W0-03 users and the five W0-08
// cases of fixture set slice1-synthetic@1.

import { test, expect, type Page } from '@playwright/test';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import {
  expectVisibleFocus,
  focusedElement,
  pressTab,
  tabUntil,
  expectMainFocused,
} from './support/keyboard.js';
import { signInAsFixture, signOut } from './support/sign-in.js';
import { FIXTURE_SET, resetToFixtureSet } from './support/database.js';

const ALL_CASES = ['RAI-2000-0001', 'RAI-2000-0002', 'RAI-2000-0003', 'RAI-2000-0004', 'RAI-2000-0005'];
const CM_CASES = ['RAI-2000-0001', 'RAI-2000-0003'];
const HR_CASES = ['RAI-2000-0002', 'RAI-2000-0004', 'RAI-2000-0005'];

/** Each fixture user, what the server must list for it and what must be absent (W0-05 scope rows). */
const SCOPES: {
  fixtureUserId: string;
  displayName: string;
  present: string[];
  absent: string[];
  scopeLine: string;
}[] = [
  {
    fixtureUserId: 'fx-user-owner-cm',
    displayName: 'ณัฐพร ส. (Nattaporn S.)',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.own_cases'],
  },
  {
    fixtureUserId: 'fx-user-owner-cm-2',
    displayName: 'Prasit W.',
    present: [],
    absent: ALL_CASES,
    scopeLine: th['scope.own_cases'],
  },
  {
    fixtureUserId: 'fx-user-spoc-cm',
    displayName: 'Suchada P.',
    present: CM_CASES,
    absent: HR_CASES,
    scopeLine: th['scope.business_unit'].replace('{businessUnit}', 'CM'),
  },
  {
    fixtureUserId: 'fx-user-ai-coe',
    displayName: 'Kritsada T.',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.all_cases'],
  },
  {
    fixtureUserId: 'fx-user-dpo',
    displayName: 'Pimchanok R.',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.all_cases'],
  },
  {
    fixtureUserId: 'fx-user-it-security',
    displayName: 'Wutthichai K.',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.all_cases'],
  },
  {
    fixtureUserId: 'fx-user-admin',
    displayName: 'Desk Admin (fixture)',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.all_cases'],
  },
  {
    fixtureUserId: 'fx-user-dpo-spoc-hr',
    displayName: 'Rattanaporn C.',
    present: ALL_CASES,
    absent: [],
    scopeLine: th['scope.all_cases'],
  },
];

const cards = (page: Page) => page.locator('article[data-registry-id]');
const registryIds = async (page: Page): Promise<string[]> =>
  (await cards(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-registry-id')))).filter(
    (v): v is string => v !== null,
  );

/** Drives the sign-in screen through the UI: the picker, then the button. */
async function signInThroughPicker(page: Page, fixtureUserId: string): Promise<void> {
  await page.goto('/sign-in');
  const picker = page.getByLabel(th['auth.fixture_user_select']);
  await picker.selectOption(fixtureUserId);
  await page.getByRole('button', { name: th['auth.sign_in'], exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: th['cases.title'] })).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in CSS px').toBeLessThanOrEqual(0);
}

// Every test starts from the fixture set: the real database keeps what a test created.
test.beforeEach(async () => {
  await resetToFixtureSet();
});

test.describe(`W1-INT (W1-07) sign-in and scoped list on the real server (fx-user-*, fx-case-* of ${FIXTURE_SET})`, () => {
  test('a signed-out visitor sees the sign-in screen with the fixture picker and the audit passes', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { level: 1, name: th['sign_in.title'] })).toBeVisible();
    // The real server, not the substitute: the product bundle carries no substitute banner
    // (VITE_API_SUBSTITUTE is forced off by `npm run build`) and no answer is marked as a substitute's.
    await expect(page.getByText(th['shell.substitute_banner'])).toHaveCount(0);
    await expect(page.getByTestId('substitute-banner')).toHaveCount(0);
    const probe = await page.request.get('/auth/fixture/users');
    expect(probe.status()).toBe(200);
    expect(probe.headers()['x-rai-substitute']).toBeUndefined();
    await expect(page.getByLabel(th['auth.fixture_user_select'])).toBeVisible();
    // The Google button is the 404 branch of GET /auth/fixture/users and must not show in fixture mode.
    await expect(page.getByRole('button', { name: th['auth.sign_in_with_google'] })).toHaveCount(0);
    await expect(page).toHaveTitle(th['app.title']);
    await expectAccessible(page, testInfo, { name: 'sign-in-th', lang: 'th' });
  });

  for (const scope of SCOPES) {
    test(`${scope.fixtureUserId} lands on its scoped list: ${scope.present.length} fixture cases present, ${scope.absent.length} absent`, async ({
      page,
    }, testInfo) => {
      await signInThroughPicker(page, scope.fixtureUserId);
      await expect(page).toHaveURL(/\/cases$/);
      await expect(
        page.getByText(th['auth.signed_in_as'].replace('{displayName}', scope.displayName)),
      ).toBeVisible();
      await expect(page.getByTestId('scope-line')).toHaveText(scope.scopeLine);
      await expect(page.getByTestId('case-count')).toBeVisible();
      const listed = await registryIds(page);
      for (const id of scope.present)
        expect(listed, `${id} must be listed for ${scope.fixtureUserId}`).toContain(id);
      for (const id of scope.absent)
        expect(listed, `${id} must be absent for ${scope.fixtureUserId}`).not.toContain(id);
      if (scope.present.length === 0) {
        await expect(page.getByRole('heading', { level: 2, name: th['cases.empty_title'] })).toBeVisible();
      }
      await expectStatusElementsHaveText(page);
      if (scope.fixtureUserId === 'fx-user-owner-cm' || scope.fixtureUserId === 'fx-user-owner-cm-2') {
        await expectAccessible(page, testInfo, { name: `list-${scope.fixtureUserId}`, lang: 'th' });
      }
      await signOut(page);
    });
  }

  test('the list shows case identity, submission version, status as text and the next action (owner-cm)', async ({
    page,
  }) => {
    await signInThroughPicker(page, 'fx-user-owner-cm');
    const card = cards(page)
      .filter({ has: page.getByText('RAI-2000-0004') })
      .first();
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(
      'ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)',
    );
    await expect(card.locator('[data-status="draft"]')).toHaveText(new RegExp(th['status.draft']));
    await expect(card.getByText(th['cases.version_none'])).toBeVisible();
    await expect(
      card.getByText(th['cases.next_action'].replace('{action}', th['next_action.draft'])),
    ).toBeVisible();
    await expect(
      card.getByRole('link', { name: th['cases.open_named'].replace('{registryId}', 'RAI-2000-0004') }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await signOut(page);
  });

  test('a deep link without a session goes to sign-in with returnTo and comes back after sign-in', async ({
    page,
  }) => {
    // The case id comes from the API, not from a guess: sign in through the API, read the list, sign out.
    await signInAsFixture(page, 'fx-user-owner-cm');
    const list = (await (await page.request.get('/api/cases')).json()) as {
      items: { caseId: string; registryId: string }[];
    };
    const hrCase = list.items.find((c) => c.registryId === 'RAI-2000-0002');
    expect(hrCase).toBeDefined();
    await signOut(page);

    const target = `/cases/${hrCase?.caseId ?? ''}`;
    await page.goto(target);
    await expect(page).toHaveURL(
      new RegExp(`/sign-in\\?returnTo=${encodeURIComponent(target).replace(/%2F/g, '(?:%2F|/)')}`),
    );
    await expect(page.getByText(th['sign_in.return_notice'])).toBeVisible();
    await page.getByLabel(th['auth.fixture_user_select']).selectOption('fx-user-spoc-cm');
    await page.getByRole('button', { name: th['auth.sign_in'], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    // The route resolves inside the SPA and required a session; scope is the API's answer on the W1-06 screen:
    // the CM SPOC is out of scope for an HR case, so the server's 403 is what the screen shows, and nothing of
    // the case (its name) is rendered.
    await expect(page.getByRole('alert')).toContainText(th['error.forbidden']);
    await expect(page.getByRole('button', { name: th['pack.action.change'] })).toHaveCount(0);
    await signOut(page);
  });

  test('an absolute returnTo is ignored: sign-in lands on the list', async ({ page }) => {
    await page.goto('/sign-in?returnTo=https%3A%2F%2Fevil.example%2F');
    await expect(page.getByText(th['sign_in.return_notice'])).toHaveCount(0);
    await page.getByLabel(th['auth.fixture_user_select']).selectOption('fx-user-owner-cm-2');
    await page.getByRole('button', { name: th['auth.sign_in'], exact: true }).click();
    await expect(page).toHaveURL(/\/cases$/);
    await signOut(page);
  });
});

test.describe('W1-INT (W1-07) new case on the real server (fx-user-owner-cm, fx-user-dpo)', () => {
  test('the server validates: an empty form returns 422 and the field errors land on the inputs', async ({
    page,
  }, testInfo) => {
    await signInThroughPicker(page, 'fx-user-owner-cm');
    await page.getByRole('link', { name: th['shell.nav.new_case'] }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: th['new_case.title'] })).toBeVisible();
    await expect(page.getByLabel(th['field.business_owner'])).toHaveValue('fixture:fx-user-owner-cm');
    await expectAccessible(page, testInfo, { name: 'new-case-th', lang: 'th' });
    await page.getByRole('button', { name: th['new_case.submit'] }).click();
    await expect(page.getByRole('alert')).toContainText(th['error.invalid_input']);
    const name = page.getByLabel(th['field.use_case_name']);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    // The server's messageKey for the empty field (the substitute and the server may word the reason
    // differently); what matters is that a locale-keyed error is attached to the input.
    const describedBy = (await name.getAttribute('aria-describedby')) ?? '';
    expect(describedBy).toMatch(/-error/);
    await expect(
      page.locator(`[id="${describedBy.split(' ').find((id) => id.endsWith('-error')) ?? ''}"]`),
    ).toBeVisible();
    await expectAccessible(page, testInfo, { name: 'new-case-errors-th', lang: 'th' });
    await signOut(page);
  });

  test("an unknown business unit key is the server's 422; a valid form creates a draft and lands on the list", async ({
    page,
  }) => {
    await signInThroughPicker(page, 'fx-user-owner-cm');
    await page.goto('/cases/new');
    const unique = `W1-07 สร้างจากเบราว์เซอร์ ${Date.now()}`;
    await page.getByLabel(th['field.use_case_name']).fill(unique);
    await page.getByLabel(th['field.business_unit_id']).fill('ZZ');
    await page.getByLabel(th['field.business_unit']).fill('Nowhere');
    await page.getByLabel(th['field.technical_owner']).fill('Tech Owner (fixture)');
    await page.getByLabel(th['field.source_known']).check();
    await page.getByLabel(th['field.source_value']).fill('TPM-FX-0009');
    await page.getByLabel(th['field.use_case_group']).selectOption('customer-service');
    await page.getByLabel(th['common.yes'], { exact: true }).check();
    await page.getByRole('button', { name: th['new_case.submit'] }).click();
    await expect(page.getByLabel(th['field.business_unit_id'])).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(th['validation.not_in_configured_list'])).toBeVisible();

    await page.getByLabel(th['field.business_unit_id']).fill('CM');
    await page.getByRole('button', { name: th['new_case.submit'] }).click();
    await expect(page).toHaveURL(/\/cases$/);
    const notice = page
      .getByRole('status')
      .filter({ hasText: th['cases.created_notice'].split(' {')[0] ?? '' });
    await expect(notice).toBeVisible();
    const created = cards(page).filter({ has: page.getByRole('heading', { level: 2, name: unique }) });
    await expect(created).toHaveCount(1);
    await expect(created.locator('[data-status="draft"]')).toBeVisible();
    await signOut(page);
  });

  test("no client-side check decides access: a reviewer reaches the form and the server's 403 is rendered", async ({
    page,
  }) => {
    await signInThroughPicker(page, 'fx-user-dpo');
    await page.getByRole('link', { name: th['shell.nav.new_case'] }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: th['new_case.title'] })).toBeVisible();
    await page.getByLabel(th['field.use_case_name']).fill('Reviewer attempt');
    await page.getByLabel(th['field.business_unit_id']).fill('CM');
    await page.getByLabel(th['field.business_unit']).fill('Consumer Mobile');
    await page.getByLabel(th['field.technical_owner']).fill('x');
    await page.getByLabel(th['field.use_case_group']).selectOption('customer-analytics');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/cases') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: th['new_case.submit'] }).click();
    expect((await response).status()).toBe(403);
    await expect(page.getByRole('alert')).toContainText(th['error.forbidden']);
    await expect(
      page.getByText(new RegExp(th['common.correlation_id'].replace('{correlationId}', '[0-9a-f-]{36}'))),
    ).toBeVisible();
    await signOut(page);
  });
});

test.describe('W1-INT (W1-07) keyboard-only, dialog, locale and reflow on the real server (fx-user-spoc-cm)', () => {
  test('the whole journey runs on the keyboard alone with a visible focus ring at every stop', async ({
    page,
  }, testInfo) => {
    await page.goto('/sign-in');
    await expect(page.getByLabel(th['auth.fixture_user_select'])).toBeVisible();
    // First stop on a fresh load: the skip link; then the locale switch; then the picker, chosen with type-ahead.
    // The picker is awaited above, so the first Tab is pressed on a settled screen (see the list step below for
    // why that matters). The order of stops below is what is asserted.
    await pressTab(page);
    const skip = await expectVisibleFocus(page);
    expect(skip.text).toBe(th['shell.skip_to_content']);
    const picker = await tabUntil(page, (info) => info.tag === 'select');
    expect(picker.tag).toBe('select');
    await page.keyboard.type('Suchada'); // type-ahead on the closed select picks fx-user-spoc-cm
    await expect(page.getByLabel(th['auth.fixture_user_select'])).toHaveValue('fx-user-spoc-cm');
    const button = await tabUntil(page, (info) => info.tag === 'button' && info.text === th['auth.sign_in']);
    expect(button.text).toBe(th['auth.sign_in']);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: th['cases.title'] })).toBeVisible();

    // List: focus moved to the main landmark on navigation, so Tab walks the new screen's controls in visual
    // order (the New case button, then each card's Open case link); open the first case by keyboard. The list
    // must have finished loading first: a Tab pressed while the screen still shows its loading state lands on a
    // control that the loaded re-render replaces, and focus falls back to the body (seen as a flaky
    // "no element is focused" on every width before this wait).
    await expect(page.getByTestId('case-count')).toBeVisible();
    await expectMainFocused(page);
    const openCase = await tabUntil(page, (info) => info.tag === 'a' && info.text === th['cases.open']);
    expect(openCase.text).toBe(th['cases.open']);
    await page.keyboard.press('Enter');
    // The W1-06 case screen: its level-1 heading is the use-case name, under the case's registry id.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: th['version.nav_heading'] })).toBeVisible();

    // New case by keyboard: Shift+Tab from the main landmark reaches the last primary-navigation link, then every
    // field with Tab, then Enter on the submit button.
    await expectMainFocused(page);
    await page.keyboard.press('Shift+Tab');
    const newCase = await expectVisibleFocus(page);
    expect(newCase.text).toBe(th['shell.nav.new_case']);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: th['new_case.title'] })).toBeVisible();
    await tabUntil(page, (info) => info.tag === 'input');
    const unique = `W1-07 keyboard ${Date.now()}`;
    await page.keyboard.type(unique);
    await pressTab(page); // businessUnitId (pre-filled CM from the SPOC grant)
    await expectVisibleFocus(page);
    await expect(page.getByLabel(th['field.business_unit_id'])).toHaveValue('CM');
    await pressTab(page); // businessUnit
    await page.keyboard.type('Consumer Mobile');
    await pressTab(page); // businessOwner: a SPOC names an owner in its BU
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('fixture:fx-user-owner-cm');
    await pressTab(page); // technicalOwner
    await page.keyboard.type('Tech Owner (fixture)');
    await pressTab(page); // source record radio group (Unknown stays)
    await expectVisibleFocus(page);
    const group = await tabUntil(page, (info) => info.tag === 'select');
    expect(group.tag).toBe('select');
    await page.keyboard.type('customer-a');
    await expect(page.getByLabel(th['field.use_case_group'])).toHaveValue('customer-analytics');
    const submit = await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === th['new_case.submit'],
    );
    expect(submit.text).toBe(th['new_case.submit']);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/cases$/);
    await expect(
      cards(page).filter({ has: page.getByRole('heading', { level: 2, name: unique }) }),
    ).toHaveCount(1);

    // Sign-out dialog (section 9 item 3): opens on Enter, focus moves in and stays in, Escape closes and returns
    // focus to the invoking control, Enter on the confirmation signs out.
    // The header sits before the main landmark, so it is reached backwards with Shift+Tab.
    await expectMainFocused(page);
    let signOutButton = await focusedElement(page);
    for (let step = 0; step < 6 && signOutButton?.text !== th['auth.sign_out']; step += 1) {
      await pressTab(page, 1, true);
      signOutButton = await expectVisibleFocus(page);
    }
    expect(signOutButton?.text).toBe(th['auth.sign_out']);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: th['shell.sign_out.confirm_title'] });
    await expect(dialog).toBeVisible();
    const inDialog = async (): Promise<boolean> =>
      page.evaluate(() => document.activeElement?.closest('dialog[open]') !== null);
    expect(await inDialog()).toBe(true);
    const first = await expectVisibleFocus(page);
    expect(first.text).toBe(th['common.cancel']);
    for (let i = 0; i < 4; i += 1) {
      await pressTab(page);
      await expectVisibleFocus(page);
      expect(await inDialog(), `Tab ${i + 1} left the dialog`).toBe(true);
    }
    await expectAccessible(page, testInfo, { name: 'sign-out-dialog-th', lang: 'th' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await focusedElement(page))?.text).toBe(th['auth.sign_out']);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    const confirm = await tabUntil(
      page,
      (info) => info.tag === 'button' && info.text === th['auth.sign_out'],
    );
    expect(confirm.text).toBe(th['auth.sign_out']);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(th['sign_in.signed_out'])).toBeVisible();
    // The session is revoked on the server: the list route bounces back to sign-in.
    await page.goto('/cases');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
  });

  test('the locale switch renders English, persists on the session across a reload, and audits clean in en', async ({
    page,
  }, testInfo) => {
    await signInThroughPicker(page, 'fx-user-spoc-cm');
    await page.getByRole('button', { name: th['shell.locale.en'] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: en['cases.title'] })).toBeVisible();
    await expect(page.getByTestId('scope-line')).toHaveText(
      en['scope.business_unit'].replace('{businessUnit}', 'CM'),
    );
    await expect(page).toHaveTitle(en['app.title']);
    await expectAccessible(page, testInfo, { name: 'list-en', lang: 'en' });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1, name: en['cases.title'] })).toBeVisible();
    const session = (await (await page.request.get('/api/session')).json()) as { locale: string };
    expect(session.locale).toBe('en');
    await page.getByRole('button', { name: th['shell.locale.th'] }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByRole('heading', { level: 1, name: th['cases.title'] })).toBeVisible();
    await signOut(page);
  });

  test('no horizontal scroll on the sign-in, list and form at this width; a Thai fixture name renders', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await expectNoHorizontalScroll(page);
    await signInThroughPicker(page, 'fx-user-dpo');
    await expectNoHorizontalScroll(page);
    await expect(page.getByText('ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)')).toBeVisible();
    await page.goto('/cases/new');
    await expect(page.getByRole('heading', { level: 1, name: th['new_case.title'] })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await signOut(page);
  });

  test('a path no route matches shows the not-found screen inside the shell', async ({ page }) => {
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: th['not_found.title'] })).toBeVisible();
  });
});
