// Bootstrap-safe guard: no workspace imports or built output dependencies.
import assert from 'node:assert/strict';

export type BrowserEnv = Record<string, string | undefined>;

/** Match config.readEnv: local .env never overrides an existing shell variable. */
export function readBrowserEnv(): BrowserEnv {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* A clean CI checkout has no .env. */
  }
  return process.env;
}

function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

export function validateRealBrowserConfig(baseURL: string, env: BrowserEnv): URL {
  assert.equal(env.NODE_ENV, 'test', 'real browser lifecycle requires test mode');
  assert.equal(env.RAI_IDENTITY_MODE, 'fixture', 'real browser lifecycle requires fixture identity');
  const url = new URL(baseURL);
  assert(url.protocol === 'http:' && isLoopbackHost(url.hostname), 'loopback HTTP only');
  assert(
    url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
    'plain explicit loopback origin required',
  );
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATE_URL', 'DATABASE_OPERATOR_URL'] as const) {
    if (!env[key]?.trim()) continue;
    const database = new URL(env[key]);
    assert(
      isLoopbackHost(database.hostname) && !database.search && !database.hash,
      'local database without routing overrides required',
    );
  }
  return url;
}
