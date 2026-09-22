// W1-INT Done-when "the evidence configuration cannot load the substitute" (W0-02 section 8.1: substitute runs are
// never evidence). The BUILT deployable (`node server/dist/main.js`, what playwright.config.ts starts and what
// `npm start` runs) is spawned here with every substitute-shaped variable set in its environment; it starts
// unchanged and nothing of the W1-13 substitute appears: no substitute banner in the served SPA (the product bundle
// has no API-substitute configuration whatever the process environment says), no `x-rai-substitute` header on
// any answer, no `/__substitute/reset` hook (the W0-06 JSON 404), and no substitute marker in the served bundle.
// The static half (no evidence test imports the substitute; the configuration file names no substitute) is
// tests/integration/w1-int-substitute-absent.test.ts. Fixture ids: fx-user-owner-cm.

import { test, expect } from './support/real-test.js';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import { FIXTURE_SIGN_IN_PATH } from './support/sign-in.js';
import { startTestServer } from '../support/process.js';

test.use({ serverMode: 'reset-only' });

// Split so this file never contains the marker itself (as scripts/check-substitute-absent.mjs does).
const MARKER = ['RAI_DESK', 'SUBSTITUTE', 'MARKER'].join('_');

const SUBSTITUTE_FLAGS = {
  VITE_API_SUBSTITUTE: 'true',
  RAI_API_SUBSTITUTE: 'true',
  API_SUBSTITUTE: 'true',
  API_PROXY_TARGET: 'http://127.0.0.1:8789',
  SUBSTITUTE_PORT: '8789',
  SUBSTITUTE_WEB_PORT: '5175',
};

test.describe('W1-INT evidence configuration: the built server ignores every substitute flag', () => {
  test('with VITE_API_SUBSTITUTE=true and the other substitute variables in its environment the built server serves the product bundle and the real API only', async ({
    page,
  }) => {
    const server = await startTestServer({ built: true, env: SUBSTITUTE_FLAGS });
    try {
      const origin = server.baseUrl;
      expect(server.linesFor('process.started')).toHaveLength(1);

      // The served page: no banner, the content-security policy of static.ts, no substitute marker in the bundle.
      await page.goto(`${origin}/sign-in`);
      await expect(page.getByRole('heading', { level: 1, name: th['sign_in.title'] })).toBeVisible();
      await expect(page.getByText(th['shell.substitute_banner'])).toHaveCount(0);
      await expect(page.getByTestId('substitute-banner')).toHaveCount(0);
      const html = await page.request.get(`${origin}/`);
      expect(html.status()).toBe(200);
      expect(html.headers()['content-security-policy']).toContain("script-src 'self'");
      expect(html.headers()['x-rai-substitute']).toBeUndefined();
      const scripts = [...(await html.text()).matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map(
        (m) => m[1] ?? '',
      );
      expect(scripts.length).toBeGreaterThan(0);
      for (const src of scripts) {
        const bundle = await page.request.get(`${origin}${src}`);
        expect(bundle.status()).toBe(200);
        expect((await bundle.text()).includes(MARKER), `${src} carries the substitute marker`).toBe(false);
      }

      // The API: the real fixture route, no marker header, no reset hook, no substitute-only path.
      const signIn = await page.request.post(`${origin}${FIXTURE_SIGN_IN_PATH}`, {
        data: { fixtureUserId: 'fx-user-owner-cm' },
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(signIn.status()).toBe(200);
      expect(((await signIn.json()) as { identityMode: string }).identityMode).toBe('fixture');
      expect(signIn.headers()['x-rai-substitute']).toBeUndefined();
      for (const path of ['/auth/fixture/users', '/api/session', '/api/cases']) {
        const response = await page.request.get(`${origin}${path}`);
        expect(response.status(), path).toBe(200);
        expect(response.headers()['x-rai-substitute'], path).toBeUndefined();
      }
      const reset = await page.request.post(`${origin}/__substitute/reset`);
      expect(reset.status()).toBe(404);
      expect(((await reset.json()) as { error: { code: string } }).error.code).toBe('not_found');
      expect(reset.headers()['x-rai-substitute']).toBeUndefined();
    } finally {
      await server.stop();
    }
  });
});
