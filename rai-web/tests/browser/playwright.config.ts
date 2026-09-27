// The EVIDENCE configuration (W0-02 sections 3.5 and 9). The test-scoped child is the one deployable
// (`node server/dist/main.js`, serving the built SPA from web/dist) started in test mode with the fixture identity
// provider on PLAYWRIGHT_BASE_URL (loopback only) against the real Postgres that `.env` names; no external service
// is reached and nothing here can start the API substitute (`tests/integration/w1-int-substitute-absent.test.ts`
// proves it). The specs reset the database and reload fixture set slice1-synthetic@1 through support/real-test.ts
// while the child is stopped. The child's QC runner is pinned to `QC_MODE=substitute` by support/real-server-lifecycle.ts
// and tests/support/process.ts (W4a plan section 2), whatever `.env` says: the W2/W3 journeys assert scripted `ACC-*`
// findings that only W4b's content rules will produce.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8788';
const narrowIgnore = [/.*\.substitute\.spec\.ts$/, /w3-int-fault-controls\.spec\.ts$/];

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
    // The fault-controls spec drives the API only, so the viewport adds nothing past the first width. A
    // project-level testIgnore replaces the top-level one, hence the substitute pattern is repeated.
    {
      name: 'tablet-834',
      testIgnore: narrowIgnore,
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } },
    },
    {
      name: 'phone-390',
      testIgnore: narrowIgnore,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  globalSetup: './support/build-real.ts',
});
