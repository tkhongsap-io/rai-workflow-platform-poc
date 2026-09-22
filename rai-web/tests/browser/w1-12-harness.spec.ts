// W1-12: the browser runner proves itself locally without external services. The web server Playwright starts is
// the one deployable in test mode (fixture identity, in-memory mail sink, QC substitute) on loopback; Chromium is
// the only browser (W0-02 section 2). The pages audited here are synthetic documents set on the page, not product
// screens: the product screens arrive with W1-07 and W1-06 and use these same helpers. Fixture ids: none.

import { test, expect } from './support/real-test.js';
import {
  auditAccessibility,
  blockingViolations,
  expectAccessible,
  expectStatusElementsHaveText,
} from './support/axe.js';
import { expectVisibleFocus, focusedElement, pressTab, tabUntil } from './support/keyboard.js';
import { BrowserFixtureSignInError, signInAsFixture } from './support/sign-in.js';

test.describe('W1-12 browser harness', () => {
  test('the test-mode API answers on the loopback base URL with the W0-06 envelope', async ({
    page,
    baseURL,
  }) => {
    expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await page.request.get('/api/w1-12-harness-probe');
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await response.json()) as {
      error: { code: string; messageKey: string; correlationId: string };
    };
    expect(body.error.code).toBe('not_found');
    expect(body.error.messageKey).toBe('error.not_found');
    expect(body.error.correlationId).toBe(response.headers()['x-correlation-id']);
  });

  test('the accessibility audit reports critical violations on a page that has them', async ({
    page,
  }, testInfo) => {
    await page.setContent(
      '<!doctype html><html lang="th"><head><title>ทดสอบ</title></head><body><main><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10"><button></button></main></body></html>',
    );
    const results = await auditAccessibility(page, testInfo, { name: 'deliberately-broken', lang: 'th' });
    const blocking = blockingViolations(results).map((v) => v.id);
    expect(blocking).toContain('image-alt');
    expect(blocking).toContain('button-name');
    expect(testInfo.attachments.some((a) => a.name === 'axe-deliberately-broken.json')).toBe(true);
  });

  test('the accessibility audit passes a minimal accessible page in Thai and in English', async ({
    page,
  }, testInfo) => {
    await page.setContent(
      '<!doctype html><html lang="th"><head><title>โต๊ะตรวจ</title></head><body><main><h1>โต๊ะตรวจ</h1><p>ทดสอบเครื่องมือ</p><button type="button">ดำเนินการ</button></main></body></html>',
    );
    const th = await expectAccessible(page, testInfo, { name: 'minimal-th', lang: 'th' });
    expect(th.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Review desk</title></head><body><main><h1>Review desk</h1><p>Harness check</p><button type="button">Continue</button></main></body></html>',
    );
    await expectAccessible(page, testInfo, { name: 'minimal-en', lang: 'en' });
  });

  test('the audit refuses a page whose lang attribute is not the one the spec expects', async ({
    page,
  }, testInfo) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>x</h1></main></body></html>',
    );
    await expect(auditAccessibility(page, testInfo, { name: 'wrong-lang', lang: 'th' })).rejects.toThrow(
      /lang/,
    );
  });

  test('the keyboard helper sees a visible focus ring after Tab and walks the Tab order', async ({
    page,
  }) => {
    await page.setContent(
      '<!doctype html><html lang="th"><head><title>คีย์บอร์ด</title><style>button:focus-visible{outline:2px solid #00639F;outline-offset:2px}</style></head><body><main><h1>คีย์บอร์ด</h1><button type="button">หนึ่ง</button><button type="button">สอง</button><a href="#three">สาม</a></main></body></html>',
    );
    expect(await focusedElement(page)).toBeNull();
    await pressTab(page);
    const first = await expectVisibleFocus(page);
    expect(first.tag).toBe('button');
    expect(first.text).toBe('หนึ่ง');
    const link = await tabUntil(page, (info) => info.tag === 'a');
    expect(link.text).toBe('สาม');
    await pressTab(page, 1, true);
    expect((await focusedElement(page))?.text).toBe('สอง');
  });

  test('status elements must carry visible text, never colour alone', async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="th"><head><title>สถานะ</title></head><body><main><span data-status="ready">พร้อม</span></main></body></html>',
    );
    await expectStatusElementsHaveText(page);
    await page.setContent(
      '<!doctype html><html lang="th"><head><title>สถานะ</title></head><body><main><span data-status="ready" style="background:#0a0;width:1em;height:1em;display:inline-block"></span></main></body></html>',
    );
    await expect(expectStatusElementsHaveText(page)).rejects.toThrow(/data-status="ready"/);
  });

  test('the fixture sign-in helper signs a known user in and fails loudly for an unknown one', async ({
    page,
  }) => {
    // W1-01 serves POST /auth/fixture/sign-in in fixture mode (W0-02 section 7.2): 200 SessionInfo for a
    // known fixture user, 404 not_found for an unknown id. The helper must surface the 404, never swallow it.
    const session = await signInAsFixture(page, 'fx-user-owner-cm');
    expect(session.identityMode).toBe('fixture');
    expect(session.principal.subjectId).toBe('fixture:fx-user-owner-cm');
    await expect(signInAsFixture(page, 'fx-user-does-not-exist')).rejects.toThrow(BrowserFixtureSignInError);
    await expect(signInAsFixture(page, 'fx-user-does-not-exist')).rejects.toThrow(/answered 404/);
  });
});
