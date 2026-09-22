// Playwright configuration (W0-02 sections 3.5 and 9): the EVIDENCE configuration. W1-00 created the file; W1-12
// wires the runner and the CI check and adds the harness spec and support helpers (axe audit, keyboard, fixture
// sign-in); W1-INT promotes the W1-07 and W1-06 journeys here and adds the W1 journey and the evidence-configuration
// check; W2-INT promotes the W2-07 and W2-09 journeys and adds the W2 journey. The test-scoped child is the one deployable
// (`node server/dist/main.js`, which serves the built SPA from web/dist through server/src/static.ts) started in
// test mode with the fixture identity provider on PLAYWRIGHT_BASE_URL (loopback only) against the real Postgres
// that `.env` names; no external service is reached and nothing here can start the W1-13/W2-10 substitute
// (`tests/integration/w1-int-substitute-absent.test.ts` proves it). The specs reset the database and reload
// fixture set slice1-synthetic@1 through support/real-test.ts while the child is stopped.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8788';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  // Lane B development runs against the W1-13 substitute go through playwright.substitute.config.ts and are
  // named `*.substitute.spec.ts`; they are never evidence and are ignored here (W0-02 section 8.1).
  testIgnore: /.*\.substitute\.spec\.ts$/,
  fullyParallel: false,
  workers: 1, // one database; lifecycle additionally stops/drains all owned work before reset
  forbidOnly: true, // no test.only merges to main (section 6)
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]],
  outputDir: '../../test-results',
  use: { baseURL, trace: 'retain-on-failure', locale: 'th-TH', timezoneId: 'Asia/Bangkok' },
  // The three handoff widths (section 9, item 7): 1440, 834 and 390 CSS px, Chromium only (section 2).
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-834', use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } } },
    { name: 'phone-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  globalSetup: './support/build-real.ts',
});
