// Fixture sign-in for browser specs (W0-02 section 7.2; Lane C, W1-12). Signs in through the same API the SPA
// uses (`POST /auth/fixture/sign-in`, served by W1-01a in `fixture` mode only); the session cookie lands in the
// browser context's cookie jar because `page.request` shares it. A journey that must prove the sign-in screen
// itself (W1-07) drives the picker through the UI instead. Fails loudly on any status but 200.

import type { Page } from '@playwright/test';
import type { SessionInfo } from '@rai/shared/schemas/auth';

export const FIXTURE_SIGN_IN_PATH = '/auth/fixture/sign-in';
export const SIGN_OUT_PATH = '/auth/sign-out';

export class BrowserFixtureSignInError extends Error {
  constructor(
    readonly fixtureUserId: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`fixture sign-in for ${fixtureUserId} answered ${status} at ${FIXTURE_SIGN_IN_PATH}: ${body}`);
    this.name = 'BrowserFixtureSignInError';
  }
}

export async function signInAsFixture(page: Page, fixtureUserId: string): Promise<SessionInfo> {
  const response = await page.request.post(FIXTURE_SIGN_IN_PATH, {
    data: { fixtureUserId },
    headers: { 'sec-fetch-site': 'same-origin' },
  });
  if (response.status() !== 200)
    throw new BrowserFixtureSignInError(fixtureUserId, response.status(), await response.text());
  return (await response.json()) as SessionInfo;
}

/** Revokes the session the way the SPA does; 204 is the only success (W0-02 section 7.2). */
export async function signOut(page: Page): Promise<void> {
  const response = await page.request.post(SIGN_OUT_PATH, { headers: { 'sec-fetch-site': 'same-origin' } });
  if (response.status() !== 204)
    throw new Error(`sign-out answered ${response.status()}: ${await response.text()}`);
}
