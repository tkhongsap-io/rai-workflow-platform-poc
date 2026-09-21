// Playwright configuration for Lane B specs against the W1-13 in-memory API substitute (W0-02 sections 3.4 and
// 8.1; W1-07 adds it). Two loopback processes: the substitute CLI (fixtures/src/substitutes/api/serve.ts, fixture
// state, NODE_ENV=test) and the Vite dev server with VITE_API_SUBSTITUTE=true proxying /api and /auth to it. The
// three handoff widths run as projects; one worker, because the substitute's state is shared by every spec.
//
// Never evidence: a Lane B ticket's Proves IDs are realised only when Wx-INT runs the same spec against the real
// server through playwright.config.ts (section 8.1). Specs for this configuration are named `*.substitute.spec.ts`
// and are ignored by the real-server configuration.
import { defineConfig, devices } from '@playwright/test';

const substitutePort = Number(process.env.SUBSTITUTE_PORT ?? '8789');
const webPort = Number(process.env.SUBSTITUTE_WEB_PORT ?? '5175');
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.substitute\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true, // no test.only merges to main (section 6)
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/substitute' }]],
  outputDir: '../../test-results/substitute',
  use: { baseURL, trace: 'retain-on-failure', locale: 'th-TH', timezoneId: 'Asia/Bangkok' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-834', use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } } },
    { name: 'phone-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `npx tsx --conditions=rai-source fixtures/src/substitutes/api/serve.ts --port ${substitutePort}`,
      cwd: '../..',
      port: substitutePort,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: '../../web',
      port: webPort,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test',
        VITE_API_SUBSTITUTE: 'true',
        API_PROXY_TARGET: `http://127.0.0.1:${substitutePort}`,
      },
    },
  ],
});
