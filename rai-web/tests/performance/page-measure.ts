import assert from 'node:assert/strict';
import { checkControls, type Controls } from './server-contract.js';
import { chromium, expect } from '@playwright/test';
import { baseline, guardPlan, routePath, type Plan } from './profiles.js';

const SCREENS = {
  queue: { path: '/queue', ready: '[data-testid="queue-count"]' },
  overview: { path: '/cases/:caseId', ready: '.case-head' },
  editor: { path: '/cases/:caseId', ready: '[aria-labelledby="pack-heading"]' },
  reviewer: { path: '/cases/:caseId/versions/:versionId', ready: '[data-review-controls="ready"]' },
  history: { path: '/cases/:caseId/versions/:versionId', ready: '.versions-nav' },
} as const;
export interface PagePlan extends Plan {
  pages: {
    kind: keyof typeof SCREENS;
    actor: string;
    ids: Record<string, string>;
    /** Additional final-INT loaded-data assertions, e.g. selected version heading and artifact metadata. */
    visible: string[];
    absent: string[];
  }[];
}
export async function measurePages(plan: PagePlan, controls: { queue: Controls; mutation: Controls }) {
  guardPlan(plan);
  checkControls(plan.queue, controls.queue);
  checkControls(plan.mutation, controls.mutation);
  assert.deepEqual(plan.pages.map((p) => p.kind).sort(), Object.keys(SCREENS).sort());
  const browser = await chromium.launch();
  try {
    for (const selection of plan.pages) {
      const screen = SCREENS[selection.kind];
      assert(screen && selection.visible.length && selection.absent.length);
      const path = routePath(screen.path, selection.ids);
      const target = selection.kind === 'queue' ? 'queue' : 'mutation';
      const origin = plan[target].baseUrl;
      await controls[target].settled();
      const context = await browser.newContext({
        baseURL: origin,
        viewport: { width: 1440, height: 900 },
        locale: 'th-TH',
      });
      try {
        const signIn = await context.request.post('/auth/fixture/sign-in', {
          data: { fixtureUserId: selection.actor },
          headers: { 'sec-fetch-site': 'same-origin' },
        });
        assert.equal(signIn.status(), 200);
        const locale = await context.request.post('/api/session/locale', {
          data: { locale: 'th' },
          headers: { 'sec-fetch-site': 'same-origin' },
        });
        assert.equal(locale.status(), 204);
        const page = await context.newPage();
        await baseline(
          plan,
          `page-${selection.kind}`,
          false,
          target,
          undefined,
          200,
          1000,
          () => async () => {
            const started = performance.now();
            const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            assert.equal(response?.status(), 200);
            await expect(page).toHaveURL(new URL(path, origin).href);
            await expect(page.locator('html')).toHaveAttribute('lang', 'th');
            for (const selector of [screen.ready, ...selection.visible])
              await expect(page.locator(selector)).toBeVisible();
            for (const selector of ['[data-review-qc="loading"]', ...selection.absent])
              await expect(page.locator(selector)).toHaveCount(0);
            await page.evaluate(
              () =>
                new Promise<void>((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                ),
            );
            return { wallMs: performance.now() - started };
          },
          () => controls[target].settled(),
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
