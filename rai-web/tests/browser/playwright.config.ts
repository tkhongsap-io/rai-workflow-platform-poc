// Playwright configuration (W0-02 sections 3.5 and 9). W1-00 created the file; W1-12 wires the runner and the CI
// check and adds the harness spec and support helpers (axe audit, keyboard, fixture sign-in). The product specs
// arrive with W1-07, W1-06 and the W1-INT journey. The web server is the one deployable started in test mode with
// the fixture identity provider on PLAYWRIGHT_BASE_URL (loopback only); no external service is reached.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8788';
const port = Number(new URL(baseURL).port || '8788');

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
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
  webServer: {
    command: 'npm run build && node server/dist/main.js',
    cwd: '../..',
    // Readiness: the process listens only after config.ts has accepted the environment (fail closed, exit 78
    // otherwise), so a TCP accept on the port is the ready signal. W3-07a adds GET /healthz; switch to
    // `url: `${baseURL}/healthz`` then (Playwright treats a 404 as not ready, so the URL form cannot be used before).
    port,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      RAI_IDENTITY_MODE: 'fixture',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_BASE_URL: baseURL,
      BLOB_DIR: './.local/test/blobs',
      MAIL_SINK_DIR: './.local/test/mail',
      MAIL_MODE: 'sink-memory',
      QC_MODE: 'substitute',
      LOG_PRETTY: 'false',
    },
  },
});
