// Test-owned lifecycle for the built API. Never imported by application code.
import assert from 'node:assert/strict';
import { readEnv, type Env } from '@rai/server/config';
import { startTestServer, type TestServerProcess } from '../../support/process.js';
import { resetToFixtureSet } from './database.js';
import { validateRealBrowserConfig } from './real-browser-config.js';

export function realServerOptions(baseURL: string, env: Env) {
  const url = validateRealBrowserConfig(baseURL, env);
  return {
    built: true as const,
    port: Number(url.port),
    env: {
      HOST: url.hostname,
      PUBLIC_BASE_URL: url.origin,
      BLOB_DIR: './.local/test/blobs',
      MAIL_SINK_DIR: './.local/test/mail',
      MAIL_MODE: 'sink-memory',
      QC_MODE: 'substitute',
      LOG_PRETTY: 'false',
    },
  };
}

type Dependencies = {
  start(): Promise<TestServerProcess>;
  reset(): Promise<unknown>;
};
export type ServerMode = 'managed' | 'reset-only';

export function createRealServerLifecycle(
  baseURL: string,
  env: Env = readEnv(),
  dependencies?: Dependencies,
) {
  const options = realServerOptions(baseURL, env); // reject before database/process effects
  const deps = dependencies ?? { start: () => startTestServer(options), reset: resetToFixtureSet };
  let child: TestServerProcess | undefined;
  let busy = false;
  let failed = false;
  async function exclusive<T>(operation: () => Promise<T>, cleanup = false): Promise<T> {
    if (busy) throw new Error('browser lifecycle operation already active');
    if (failed && !cleanup) throw new Error('browser lifecycle failed; refusing another reset/start');
    busy = true;
    try {
      return await operation();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      busy = false;
    }
  }
  async function stopChild() {
    if (!child) return;
    const exit = await child.stop(); // graceful drain and existing capture audit
    assert.deepEqual(exit, { code: 0, signal: null }, 'owned browser child must exit cleanly');
    child = undefined;
  }
  const lifecycle = {
    get child() {
      return child;
    },
    reset(mode: ServerMode = 'managed') {
      return exclusive(async () => {
        await stopChild();
        await deps.reset();
        if (mode === 'managed') child = await deps.start();
      });
    },
    stop() {
      return exclusive(stopChild, true);
    },
    async withTest<T>(mode: ServerMode, body: () => Promise<T>): Promise<T> {
      let bodyFailed = false;
      let original: unknown;
      let result: T | undefined;
      try {
        await lifecycle.reset(mode);
        result = await body();
      } catch (error) {
        bodyFailed = true;
        original = error;
      }
      try {
        await lifecycle.stop();
      } catch (error) {
        if (bodyFailed) throw new AggregateError([original, error], 'browser test and cleanup failed');
        throw error;
      }
      if (bodyFailed) throw original;
      return result as T;
    },
  };
  return lifecycle;
}
