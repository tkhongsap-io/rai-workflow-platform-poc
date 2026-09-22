import { test as base } from '@playwright/test';
import { createRealServerLifecycle, type ServerMode } from './real-server-lifecycle.js';

export { expect } from '@playwright/test';
export type { Page, Locator } from '@playwright/test';

export const test = base.extend<{ serverMode: ServerMode; realServer: void }>({
  serverMode: ['managed', { option: true }],
  realServer: [
    async ({ baseURL, serverMode }, use) => {
      if (!baseURL) throw new Error('real browser baseURL required');
      const lifecycle = createRealServerLifecycle(baseURL);
      await lifecycle.withTest(serverMode, () => use());
    },
    { auto: true },
  ],
});
