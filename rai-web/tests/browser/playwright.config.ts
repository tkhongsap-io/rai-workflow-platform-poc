// Playwright configuration (W0-02 sections 3.5 and 9). W1-00 creates the file so `tests/` typechecks and W1-12 can
// wire the CI check; no spec exists until the first Lane B ticket (W1-07) and the W1-INT journey. The web server is
// the one deployable started in test mode with the fixture identity provider (W1-01a) on PLAYWRIGHT_BASE_URL.
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
    url: `${baseURL}/healthz`,
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
