// REHEARSAL ONLY: exact-path response interception, not OBS17 or API authorization evidence.
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import th from '../../shared/src/locales/th.json' with { type: 'json' };
import en from '../../shared/src/locales/en.json' with { type: 'json' };
import { signInAsFixture } from './support/sign-in.js';
import { expectAccessible, expectStatusElementsHaveText } from './support/axe.js';
import { tabUntil, expectVisibleFocus } from './support/keyboard.js';
import { operatorPath, report, recipient, recordId, secondId } from './support/operator-rehearsal.js';

const path = '/operator/desk-health';
test.beforeEach(async ({ page }) => {
  await page.request.post('/__substitute/reset');
});
test('rehearsal: populated report, bilingual semantics, keyboard and accessible layout', async ({
  page,
}, info) => {
  let calls = 0;
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  await page.route(`**${operatorPath}`, (route) => {
    calls++;
    return route.fulfill({ json: report() });
  });
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto(path);
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await expect(page.getByText(th['operator.not_scheduled'], { exact: true })).toBeVisible();
  await expect(page.getByText(th['operator.value.ready_for_launch'], { exact: true })).toBeVisible();
  await expect(page.getByText(th['operator.late_qc_note'])).toBeVisible();
  const digest = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: th['operator.sla_digest'], exact: true }) })
    .first();
  await expect(digest.getByText(th['operator.value.running'], { exact: true })).toBeVisible();
  await expect(
    digest.locator('dt').filter({ hasText: th['operator.field.breach_count'] }).locator('..'),
  ).toContainText(th['operator.not_recorded']);
  await expect(page.locator('time').first()).toContainText('2026');
  await expect(page.locator('time').first()).toContainText('07:00');
  await expectStatusElementsHaveText(page);
  await expectAccessible(page, info, { name: 'operator-populated-th', lang: 'th' });
  const initialCalls = calls; // Strict Mode may replay the mount effect in development.
  await tabUntil(page, (element) => element.text === th['operator.refresh']);
  await page.keyboard.press('Enter');
  await expect.poll(() => calls).toBe(initialCalls + 1);
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await tabUntil(page, (element) => element.tag === 'input');
  await expectVisibleFocus(page);
  expect(
    await page
      .locator('input:focus')
      .evaluate((input: HTMLInputElement) =>
        input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
      ),
  ).toBe(recordId);
  await page.getByRole('button', { name: th['shell.locale.en'], exact: true }).click();
  await expect(page.getByRole('heading', { name: en['operator.title'], exact: true })).toBeVisible();
  await expectAccessible(page, info, { name: 'operator-populated-en', lang: 'en' });
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
    scrollX: window.scrollX,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.scrollX).toBe(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    recipient,
  );
  expect(page.url()).not.toContain(recipient);
  expect(logs.join('\n')).not.toContain(recipient);
  expect(calls).toBe(initialCalls + 1); // Locale change does not poll/refetch.
  await tabUntil(page, (element) => element.text === en['operator.open_version']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/cases/${recordId}/versions/${secondId}$`));
});

test('rehearsal: empty lists, no digest run, zero count and scheduled queued mail', async ({
  page,
}, info) => {
  let value = report(false);
  await page.route(`**${operatorPath}`, (route) => route.fulfill({ json: value }));
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto(path);
  for (const key of [
    'operator.empty_mail',
    'operator.empty_qc',
    'operator.empty_late_qc',
    'operator.no_run',
    'operator.empty_digest_failures',
    'operator.empty_counters',
  ] as const)
    await expect(page.getByText(th[key], { exact: true })).toBeVisible();
  await expectAccessible(page, info, { name: 'operator-empty' });
  value = report();
  value.failedMail = [
    { ...value.failedMail[0]!, status: 'queued', attempts: 2, nextAttemptAt: '2026-09-23T00:00:00.000Z' },
  ];
  value.slaDigest.lastRun = { ...value.slaDigest.lastRun!, status: 'completed', breachCount: 0 };
  await page.getByRole('button', { name: th['operator.refresh'] }).click();
  await expect(page.getByText(th['operator.not_scheduled'], { exact: true })).toHaveCount(0);
  const count = page.locator('dt').filter({ hasText: th['operator.field.breach_count'] }).locator('..');
  await expect(count.locator('dd')).toHaveText('0');
});

for (const fixture of ['owner-cm', 'owner-cm-2', 'spoc-cm', 'ai-coe', 'dpo', 'it-security', 'dpo-spoc-hr']) {
  test(`rehearsal: ${fixture} has no operator nav, fetch or report`, async ({ page }, info) => {
    let calls = 0;
    await page.route(`**${operatorPath}`, (route) => {
      calls++;
      return route.fulfill({ json: report() });
    });
    await signInAsFixture(page, `fx-user-${fixture}`);
    await page.goto(path);
    await expect(page.getByRole('alert')).toHaveText(th['error.forbidden']);
    await expect(page.getByRole('navigation').getByRole('link', { name: th['operator.title'] })).toHaveCount(
      0,
    );
    await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
    expect(calls).toBe(0);
    await expectAccessible(page, info, { name: `operator-denied-${fixture}` });
  });
}

for (const failure of ['403', '500', 'network', 'invalid', 'invalid-json'] as const) {
  test(`rehearsal: refresh drops data on ${failure}, keyboard retry recovers`, async ({ page }, info) => {
    let fail = false;
    await page.route(`**${operatorPath}`, async (route) => {
      if (!fail) return route.fulfill({ json: report() });
      if (failure === 'network') return route.abort();
      if (failure === 'invalid')
        return route.fulfill({ json: { ...report(), privateUnexpected: recipient } });
      if (failure === 'invalid-json') return route.fulfill({ contentType: 'application/json', body: '{bad' });
      return route.fulfill({
        status: Number(failure),
        json: {
          error: {
            code: failure === '403' ? 'forbidden' : 'internal_error',
            messageKey: failure === '403' ? 'error.forbidden' : 'error.internal_error',
            correlationId: recordId,
          },
        },
      });
    });
    await signInAsFixture(page, 'fx-user-admin');
    await page.goto(path);
    await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
    fail = true;
    await page.getByRole('button', { name: th['operator.refresh'] }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
    if (failure === 'invalid')
      await expect(page.getByRole('alert')).toHaveText(th['operator.invalid_response']);
    await expectAccessible(page, info, { name: `operator-error-${failure}` });
    fail = false;
    await page.keyboard.press('Shift+Tab');
    await tabUntil(page, (element) => element.text === th['common.retry']);
    await page.keyboard.press('Enter');
    await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  });
}

test('rehearsal: 401 clears report and returns to sign-in', async ({ page }) => {
  let expired = false;
  await page.route(`**${operatorPath}`, (route) =>
    expired
      ? route.fulfill({
          status: 401,
          json: {
            error: { code: 'unauthenticated', messageKey: 'error.unauthenticated', correlationId: recordId },
          },
        })
      : route.fulfill({ json: report() }),
  );
  await signInAsFixture(page, 'fx-user-admin');
  await page.goto(path);
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  expired = true;
  await page.getByRole('button', { name: th['operator.refresh'] }).click();
  await expect(page).toHaveURL(/sign-in\?returnTo=/);
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
});

test('rehearsal: same-subject session replacement clears before effects and ignores obsolete delivery', async ({
  page,
}) => {
  const admin = await signInAsFixture(page, 'fx-user-admin');
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route(`**${operatorPath}`, async (route) => {
    calls++;
    if (calls === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return route.fulfill({ json: report() });
  });
  // Test-only Vite harness mounts the real page/provider. No production session hooks or routes.
  // A layout effect records the first committed DOM, before passive fetch/cleanup effects can hide leaks.
  await page.route('**/operator-session-rehearsal', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
    <html lang="th"><body><div id="root"></div>
    <script id="session-data" type="application/json">${JSON.stringify({ admin, recipient })}</script>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import(${JSON.stringify(`/@fs${fileURLToPath(new URL('./support/operator-session-harness.js', import.meta.url))}`)});
    </script></body></html>`,
    }),
  );
  await page.goto('/operator-session-rehearsal');
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Replace admin', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText(th['common.loading']);
  await page.getByRole('button', { name: 'Become owner', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(th['error.forbidden']);
  const settled = page.waitForResponse((response) => response.url().endsWith(operatorPath));
  release!();
  await (await settled).finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  // A new Admin response renders; the previous delayed response must not become visible to owner.
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Replace admin', exact: true }).click();
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Become owner', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(th['error.forbidden']);
  await expect(page.locator('body')).not.toHaveAttribute('data-leaked', 'true');
  await page.getByRole('button', { name: 'Replace admin', exact: true }).click();
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Drop session', exact: true }).click();
  await expect(page.getByText(recipient, { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-leaked', 'true');
});
