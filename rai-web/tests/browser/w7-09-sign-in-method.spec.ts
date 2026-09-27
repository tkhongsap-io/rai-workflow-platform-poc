// W7-09 (W7 plan section 7): the sign-in screen labels its provider button from GET /auth/sign-in-method. The real
// built server runs in fixture mode here (playwright.config.ts), so it answers `{ method: 'fixture' }` (asserted
// first, outside the page's routing); the organisation variant is rendered by answering GET /auth/fixture/users
// with the 404 every non-fixture mode gives and GET /auth/sign-in-method with `organization` through page.route.
// The provider button is reached and pressed by keyboard alone; its POST /auth/sign-in (absent in fixture mode) is
// answered by the route too, with a same-origin redirect, so no request leaves loopback. th and en, axe zero
// critical and serious, no horizontal scroll, at every project width (1440, 834, 390).
import { t } from '@rai/shared/locales/keys';
import { test, expect } from './support/real-test.js';
import { expectAccessible } from './support/axe.js';
import { tabTo } from './support/keyboard.js';

test('W7-09: the real server announces its method; the organisation variant renders and is operable by keyboard', async ({
  page,
}, info) => {
  const announced = await page.request.get('/auth/sign-in-method');
  expect(announced.status()).toBe(200);
  expect(announced.headers()['cache-control']).toBe('no-store');
  expect(await announced.json()).toEqual({ method: 'fixture' });

  let methodReads = 0;
  const signInBodies: unknown[] = [];
  await page.route('**/auth/fixture/users', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'not_found', messageKey: 'error.not_found', correlationId: 'w7-09-synthetic' },
      }),
    }),
  );
  await page.route('**/auth/sign-in-method', (route) => {
    methodReads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"method":"organization"}' });
  });
  await page.route('**/auth/sign-in', (route) => {
    signInBodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ redirectUrl: '/sign-in?returnTo=%2Fcases' }),
    });
  });

  await page.goto('/sign-in');
  for (const locale of ['th', 'en'] as const) {
    if (locale === 'en') {
      await tabTo(page, page.getByRole('button', { name: t('th', 'shell.locale.en'), exact: true }));
      await page.keyboard.press('Enter');
    }
    const button = page.getByRole('button', {
      name: t(locale, 'auth.sign_in_with_organization'),
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(page.getByText(t(locale, 'sign_in.organization_note'), { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: t(locale, 'auth.sign_in_with_google') })).toHaveCount(0);
    await expect(page.getByText(t(locale, 'sign_in.google_note'))).toHaveCount(0);
    await expect(page.getByLabel(t(locale, 'auth.fixture_user_select'))).toHaveCount(0);
    await expectAccessible(page, info, { name: `w7-09-organization-${locale}`, lang: locale });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(methodReads).toBe(1);

  // Keyboard only: Tab to the provider button and press Enter; the SPA posts /auth/sign-in and follows the answer.
  await tabTo(
    page,
    page.getByRole('button', { name: t('en', 'auth.sign_in_with_organization'), exact: true }),
  );
  await page.keyboard.press('Enter');
  await expect.poll(() => signInBodies.length).toBe(1);
  expect(signInBodies[0]).toEqual({});
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fcases$/);
  // The followed redirect reloads the screen, which reads the method again (the locale may reset when signed out).
  await expect(
    page
      .getByRole('button', { name: t('th', 'auth.sign_in_with_organization'), exact: true })
      .or(page.getByRole('button', { name: t('en', 'auth.sign_in_with_organization'), exact: true })),
  ).toBeVisible();
  await expect.poll(() => methodReads).toBe(2);
});
