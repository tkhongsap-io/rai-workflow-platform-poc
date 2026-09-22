// W1-INT: the one deployable serves the built SPA (W0-02 section 1, static.ts). A synthetic web/dist in a temp
// directory stands in for Vite's output; buildApp is exercised with `app.inject()` (no listen, no Postgres): the
// index and a built asset are served with the helmet headers and the content-security policy, every GET outside
// /api and /auth falls back to index.html (history fallback), a miss under /api or /auth and a non-GET miss stay
// the W0-06 8.2 JSON envelope, a path outside the directory is never served, and an absent build fails ready().

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { startServer } from './start.js';
import {
  API_PATH_PREFIXES,
  CONTENT_SECURITY_POLICY,
  WEB_DIST_DIR,
  WebDistMissingError,
  isApiPath,
  staticPlugin,
  webDistPresent,
} from './static.js';

const INDEX_HTML =
  '<!doctype html><html lang="th"><head><meta charset="utf-8"><title></title><script type="module" crossorigin src="/assets/index-abc123.js"></script><link rel="stylesheet" href="/assets/index-abc123.css"></head><body><div id="root"></div></body></html>\n';
const APP_JS = 'console.log("synthetic bundle");\n';

const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl: new URL('http://127.0.0.1:8787'),
};

let root: string;
let app: FastifyInstance;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-web-dist-'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), INDEX_HTML);
  await writeFile(path.join(root, 'assets', 'index-abc123.js'), APP_JS);
  await writeFile(path.join(root, 'assets', 'index-abc123.css'), 'body{margin:0}\n');
  // A file next to the directory must never be reachable through it.
  await writeFile(path.join(path.dirname(root), `${path.basename(root)}-outside.txt`), 'outside\n');
  app = buildApp({ config, static: { root } }).fastify;
  await app.ready();
});
after(async () => {
  await app.close();
  await rm(path.join(path.dirname(root), `${path.basename(root)}-outside.txt`), { force: true });
  await rm(root, { recursive: true, force: true });
});

const expectedCsp = Object.entries(CONTENT_SECURITY_POLICY)
  .map(([name, values]) => `${name} ${values.join(' ')}`)
  .join(';');

describe('W1-INT static.ts: the built SPA from web/dist', () => {
  it('serves index.html on / with the helmet headers, the content-security policy and the W0-10 substrate headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /^text\/html/);
    assert.equal(res.body, INDEX_HTML);
    assert.equal(res.headers['content-security-policy'], expectedCsp);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['strict-transport-security'], undefined); // loopback HTTP; the W8 host adds it
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.headers['x-correlation-id'] as string, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(expectedCsp, /upgrade-insecure-requests/);
    assert.match(expectedCsp, /script-src 'self'/);
    assert.match(expectedCsp, /frame-ancestors 'none'/);
  });

  it('serves a built asset by its exact path and answers HEAD', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /javascript/);
    assert.equal(res.body, APP_JS);
    const head = await app.inject({ method: 'HEAD', url: '/assets/index-abc123.css' });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, '');
  });

  it('history fallback: a deep link and any GET outside /api and /auth receive index.html', async () => {
    for (const url of [
      '/sign-in',
      '/cases',
      '/cases/9c6b1a2e-0000-4000-8000-000000000001',
      '/cases/9c6b1a2e-0000-4000-8000-000000000001/versions/9c6b1a2e-0000-4000-8000-000000000002',
      '/sign-in?returnTo=%2Fcases',
      '/apix',
      '/authz',
      '/no-such-page',
      '/assets/not-built.js', // a missing asset is the page too; the SPA reports its own not-found screen
    ]) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.equal(res.body, INDEX_HTML, url);
      assert.equal(res.headers['content-security-policy'], expectedCsp, url);
    }
  });

  it('a miss under /api or /auth is the W0-06 8.2 JSON envelope, never the page', async () => {
    for (const url of ['/api', '/api/', '/api/w1-int-probe', '/auth', '/auth/nope', '/api/cases?x=1']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 404, url);
      assert.match(res.headers['content-type'] as string, /application\/json/, url);
      const body = res.json<{ error: { code: string; messageKey: string; correlationId: string } }>();
      assert.equal(body.error.code, 'not_found');
      assert.equal(body.error.messageKey, 'error.not_found');
      assert.equal(body.error.correlationId, res.headers['x-correlation-id']);
      assert.equal(res.headers['content-security-policy'], expectedCsp, url); // helmet is process-wide
    }
  });

  it('a non-GET miss anywhere is the JSON envelope (the fallback is GET only)', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      const res = await app.inject({ method, url: '/cases/whatever' });
      assert.equal(res.statusCode, 404, method);
      assert.equal(res.json<{ error: { code: string } }>().error.code, 'not_found');
    }
  });

  it('nothing outside web/dist is reachable: traversal and encoded traversal fall back to the page', async () => {
    const outside = `../${path.basename(root)}-outside.txt`;
    for (const url of [`/${outside}`, `/${encodeURIComponent(outside)}`, '/assets/../../package.json']) {
      const res = await app.inject({ method: 'GET', url });
      assert.notEqual(res.body, 'outside\n', url);
      assert.ok(res.statusCode === 200 || res.statusCode === 404 || res.statusCode === 403, url);
      if (res.statusCode === 200) assert.equal(res.body, INDEX_HTML, url);
    }
  });

  it('isApiPath names exactly /api and /auth and their subpaths; webDistPresent needs index.html', async () => {
    assert.deepEqual([...API_PATH_PREFIXES], ['/api', '/auth']);
    for (const p of ['/api', '/api/', '/api/cases', '/auth', '/auth/fixture/sign-in'])
      assert.ok(isApiPath(p), p);
    for (const p of ['/', '/apix', '/authz', '/cases', '/sign-in', '/api-docs']) assert.ok(!isApiPath(p), p);
    assert.equal(webDistPresent(root), true);
    const empty = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-empty-'));
    try {
      assert.equal(webDistPresent(empty), false);
      assert.equal(webDistPresent(path.join(empty, 'missing')), false);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
    assert.ok(WEB_DIST_DIR.endsWith(path.join('rai-web', 'web', 'dist')), WEB_DIST_DIR);
  });

  it('an absent build fails ready() with WebDistMissingError instead of serving 500 pages', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-absent-'));
    const broken = buildApp({ config, static: { root: empty } }).fastify;
    try {
      await assert.rejects(
        async () => {
          await broken.ready();
        },
        (err: unknown) => err instanceof WebDistMissingError,
      );
    } finally {
      await broken.close();
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('the plugin is registered without encapsulation so the headers apply process-wide', () => {
    const plugin = staticPlugin({ root });
    assert.equal((plugin as unknown as Record<symbol, unknown>)[Symbol.for('skip-override')], true);
  });
});

// Through start.ts: the W0-05 onRoute guard accepts the static routes (each declares `config.auth` public), the
// API keeps its session rule next to the page, an absent build in test mode serves the API alone, and an absent
// build in production refuses to start (exit 78, `missing:web/dist`). A real listen on a loopback port; the
// database URL is never connected to (the fixture adapter and the public routes make no query).
describe('W1-INT static.ts through start.ts', () => {
  const fixtureUsers = [
    {
      fixtureUserId: 'fx-user-admin',
      subjectId: 'fixture:fx-user-admin',
      displayName: 'Desk Admin (fixture)',
      email: 'admin@rai-desk.example',
      roles: [{ role: 'admin' as const, scope: { kind: 'all_cases' as const } }],
    },
  ];
  const envFor = (port: number, nodeEnv: 'test' | 'production') => ({
    NODE_ENV: nodeEnv,
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    TRUST_PROXY: 'false',
    DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:1/rai', // never connected to
    DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:1/rai',
    BLOB_DIR: path.join(tmpdir(), 'rai-w1-int-static-blobs'),
    UPLOAD_MAX_FILE_BYTES: '26214400',
    UPLOAD_MAX_PACK_BYTES: '157286400',
    UPLOAD_MAX_IMAGE_PIXELS: '40000000',
    IDEMPOTENCY_TTL_HOURS: '72',
    BLOB_ORPHAN_MIN_AGE_HOURS: '24',
    BLOB_TMP_MAX_AGE_HOURS: '1',
    RAI_IDENTITY_MODE: nodeEnv === 'test' ? 'fixture' : 'production',
    MAIL_MODE: 'sink-memory',
    MAIL_SINK_DIR: path.join(tmpdir(), 'rai-w1-int-static-mail'),
    QC_MODE: 'substitute',
    LOG_LEVEL: 'error',
    LOG_PRETTY: 'false',
    BUILD_COMMIT: 'test',
  });
  class Exited extends Error {
    constructor(readonly code: number) {
      super(`exit ${code}`);
    }
  }
  const exit = (code: number): never => {
    throw new Exited(code);
  };
  const freePort = (): Promise<number> =>
    new Promise((resolve) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });

  it('the started process serves the page and the API side by side; every static route passed the onRoute guard', async () => {
    const port = await freePort();
    const server = await startServer(envFor(port, 'test'), { exit, fixtureUsers, webDistDir: root });
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(page.status, 200);
      assert.equal(await page.text(), INDEX_HTML);
      assert.equal(page.headers.get('content-security-policy'), expectedCsp);
      const deep = await fetch(`http://127.0.0.1:${port}/cases/9c6b1a2e-0000-4000-8000-000000000001`);
      assert.equal(deep.status, 200);
      assert.equal(await deep.text(), INDEX_HTML);
      const asset = await fetch(`http://127.0.0.1:${port}/assets/index-abc123.js`);
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), APP_JS);
      const session = await fetch(`http://127.0.0.1:${port}/api/session`);
      assert.equal(session.status, 401); // the API's session rule is untouched by the page
      const users = await fetch(`http://127.0.0.1:${port}/auth/fixture/users`);
      assert.equal(users.status, 200);
      assert.equal(users.headers.get('content-security-policy'), expectedCsp); // inherited by the API scopes
      assert.equal(users.headers.get('x-content-type-options'), 'nosniff');
      const miss = await fetch(`http://127.0.0.1:${port}/api/nope`);
      assert.equal(miss.status, 404);
      assert.equal(((await miss.json()) as { error: { code: string } }).error.code, 'not_found');
    } finally {
      await server.close();
    }
  });

  it('without a web build in test mode the process serves the API alone (the integration suites spawn main.ts unbuilt)', async () => {
    const port = await freePort();
    const empty = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-nodist-'));
    const server = await startServer(envFor(port, 'test'), { exit, fixtureUsers, webDistDir: empty });
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(page.status, 404);
      assert.equal(((await page.json()) as { error: { code: string } }).error.code, 'not_found');
      assert.equal(page.headers.get('content-security-policy'), null); // helmet arrives with the page
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/session`)).status, 401);
    } finally {
      await server.close();
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('in production an absent web build refuses to start with exit 78 and missing:web/dist, before any connection', async () => {
    const port = await freePort();
    const empty = await mkdtemp(path.join(tmpdir(), 'rai-w1-int-prod-nodist-'));
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => lines.push(line);
    try {
      await assert.rejects(
        startServer(envFor(port, 'production'), { exit, webDistDir: empty }),
        (err: unknown) => err instanceof Exited && err.code === 78,
      );
    } finally {
      console.error = original;
      await rm(empty, { recursive: true, force: true });
    }
    assert.deepEqual(
      lines.map((l) => JSON.parse(l) as unknown),
      [{ event: 'process.refused', reason: 'missing:web/dist' }],
    );
    const probe = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
    assert.equal(probe, undefined, 'nothing listens');
  });
});
