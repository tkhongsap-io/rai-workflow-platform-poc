// W1-INT Done-when "no test imports the substitute; the evidence configuration cannot load the substitute"
// (W0-02 section 8.1: substitute runs are never evidence; section 1.1: the production build never contains the
// substitute marker). Three guarantees, each checked against the files as committed and one against the running
// process:
//   1. No evidence test imports the W1-13 substitute: every `tests/browser/*.spec.ts` outside `*.substitute.spec.ts`,
//      every `tests/integration/**/*.test.ts` and everything they reach through relative imports under `tests/`
//      imports nothing under `fixtures/src/substitutes/api/` (the W1-13 API substitute), not `substitute-marker`,
//      and not `tests/browser/support/substitute-server.ts` (which exists for playwright.substitute.config.ts
//      only). The in-process QC and mail-sink substitutes (W1-10, W1-11) are what the integration layer binds
//      by design (section 8.1) and are not what this clause is about.
//   2. The evidence configuration (tests/browser/playwright.config.ts) ignores `*.substitute.spec.ts`, starts the
//      built deployable only, names no substitute process and sets no substitute variable; the product source
//      (server/src, web/src outside tests) reads no substitute variable and imports no substitute module.
//   3. The real server process started with every substitute-shaped variable in its environment starts
//      unchanged and serves nothing of the substitute (the built-server half is
//      tests/browser/w1-int-evidence-config.spec.ts).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { RAI_WEB_ROOT, startTestServer } from '../support/process.js';
import evidenceConfig from '../browser/playwright.config.js';

// Split so this file never contains the marker itself (as scripts/check-substitute-absent.mjs does).
const MARKER = ['RAI_DESK', 'SUBSTITUTE', 'MARKER'].join('_');
const TESTS_DIR = path.join(RAI_WEB_ROOT, 'tests');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every module specifier a file imports (static and dynamic). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? '');
  return out.filter((s) => s !== '');
}

/** Resolves a relative `.js` specifier to the `.ts` source next to it (the tests import `./x.js` for `./x.ts`). */
function resolveRelative(from: string, specifier: string): string {
  const target = path.resolve(path.dirname(from), specifier);
  for (const candidate of [
    target,
    target.replace(/\.js$/, '.ts'),
    `${target}.ts`,
    path.join(target, 'index.ts'),
  ])
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next form
    }
  return target;
}

function isSubstituteSpecifier(specifier: string, resolved: string | undefined): boolean {
  if (/substitutes\/api(\/|$)/.test(specifier) || /substitute-marker/.test(specifier)) return true;
  if (/support\/substitute-server/.test(specifier)) return true;
  return resolved !== undefined && /tests\/browser\/support\/substitute-server\.ts$/.test(resolved);
}

/** The evidence tests: real-server browser specs and every integration test. */
function evidenceEntryFiles(): string[] {
  const browser = walk(path.join(TESTS_DIR, 'browser')).filter(
    (f) => /\.spec\.ts$/.test(f) && !/\.substitute\.spec\.ts$/.test(f),
  );
  const integration = walk(path.join(TESTS_DIR, 'integration')).filter((f) => /\.test\.ts$/.test(f));
  return [...browser, ...integration].sort();
}

describe('W1-INT: no evidence test imports the substitute', () => {
  it('every real-server browser spec and integration test, and everything it reaches under tests/, imports nothing of the W1-13 substitute', () => {
    const entries = evidenceEntryFiles();
    assert.ok(entries.length >= 20, `${entries.length} evidence test files found`);
    assert.ok(entries.some((f) => f.endsWith('w1-int-journey.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w1-int-07-shell-sign-in-cases.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w1-int-06-case-pack-versions.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w2-int-journey.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w2-int-07-reviewer-workspace.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w2-int-09-disposition.spec.ts')));
    assert.ok(entries.some((f) => f.endsWith('w2-int-negatives.test.ts')));
    assert.ok(!entries.some((f) => /\.substitute\.spec\.ts$/.test(f)));

    const seen = new Set<string>();
    const queue = [...entries];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (readFileSync(file, 'utf8').includes(MARKER))
        offenders.push(`${path.relative(RAI_WEB_ROOT, file)}: carries the marker`);
      for (const specifier of importsOf(file)) {
        const relative = specifier.startsWith('.');
        const resolved = relative ? resolveRelative(file, specifier) : undefined;
        if (isSubstituteSpecifier(specifier, resolved))
          offenders.push(`${path.relative(RAI_WEB_ROOT, file)} imports ${specifier}`);
        if (resolved !== undefined && resolved.startsWith(TESTS_DIR) && resolved.endsWith('.ts'))
          queue.push(resolved);
      }
    }
    assert.deepEqual(offenders, []);
    // The walk really followed the support modules the specs share.
    assert.ok([...seen].some((f) => f.endsWith(path.join('tests', 'support', 'db.ts'))));
    assert.ok([...seen].some((f) => f.endsWith(path.join('tests', 'browser', 'support', 'database.ts'))));
    assert.ok(![...seen].some((f) => f.endsWith('substitute-server.ts')));
  });

  it('the substitute-side files are exactly the ones the substitute configuration owns (a control for the scan)', () => {
    const substituteSpecs = walk(path.join(TESTS_DIR, 'browser')).filter((f) =>
      /\.substitute\.spec\.ts$/.test(f),
    );
    assert.ok(substituteSpecs.length >= 4, 'the Lane B development specs still exist (W1 + W2)');
    assert.ok(substituteSpecs.some((f) => f.endsWith('w2-07-reviewer-workspace.substitute.spec.ts')));
    assert.ok(substituteSpecs.some((f) => f.endsWith('w2-09-disposition.substitute.spec.ts')));
    const server = path.join(TESTS_DIR, 'browser', 'support', 'substitute-server.ts');
    const serverImports = importsOf(server);
    assert.ok(
      serverImports.some((s) => isSubstituteSpecifier(s, undefined)),
      'the scan recognises a real substitute import (support/substitute-server.ts)',
    );
  });
});

describe('W1-INT: the evidence configuration cannot load the substitute', () => {
  it('playwright.config.ts ignores *.substitute.spec.ts, starts the built deployable only and sets no substitute variable', () => {
    const ignore = evidenceConfig.testIgnore;
    assert.ok(ignore instanceof RegExp, 'testIgnore is one pattern');
    assert.equal(ignore.test('tests/browser/w1-06-case-pack-versions.substitute.spec.ts'), true);
    assert.equal(ignore.test('tests/browser/w1-int-journey.spec.ts'), false);
    assert.equal(evidenceConfig.workers, 1);
    assert.equal(evidenceConfig.forbidOnly, true);
    const webServer = evidenceConfig.webServer;
    assert.ok(webServer !== undefined && !Array.isArray(webServer), 'one web server: the deployable');
    const command = webServer.command;
    assert.match(command, /node server\/dist\/main\.js/);
    assert.doesNotMatch(command, /substitute/i);
    assert.doesNotMatch(command, /vite(?!\s+build)/); // no dev server, no proxy
    const env = webServer.env ?? {};
    for (const name of Object.keys(env)) assert.doesNotMatch(name, /SUBSTITUTE/i, name);
    assert.equal(env.RAI_IDENTITY_MODE, 'fixture');
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.QC_MODE, 'substitute'); // the W1-10 QC substitute is the slice-1 QC implementation by design (section 1.1); it is not the W1-13 API substitute
    const source = readFileSync(path.join(TESTS_DIR, 'browser', 'playwright.config.ts'), 'utf8');
    assert.doesNotMatch(source, /substitute-server|substitutes\/api|VITE_API_SUBSTITUTE/);
    // The build the web server runs forces the product bundle: web/package.json's build script.
    const webPackage = JSON.parse(readFileSync(path.join(RAI_WEB_ROOT, 'web', 'package.json'), 'utf8')) as {
      scripts: { build: string };
    };
    assert.match(webPackage.scripts.build, /VITE_API_SUBSTITUTE=false vite build/);
  });

  it('the product source reads no substitute variable and imports no substitute module', () => {
    const product = [
      ...walk(path.join(RAI_WEB_ROOT, 'server', 'src')),
      ...walk(path.join(RAI_WEB_ROOT, 'web', 'src')),
      ...walk(path.join(RAI_WEB_ROOT, 'shared', 'src')),
    ].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$|test-bytes\.ts$/.test(f));
    assert.ok(product.length > 50);
    const offenders: string[] = [];
    for (const file of product) {
      const text = readFileSync(file, 'utf8');
      if (text.includes(MARKER)) offenders.push(`${path.relative(RAI_WEB_ROOT, file)}: marker`);
      for (const specifier of importsOf(file))
        if (/substitutes\/api(\/|$)|substitute-marker|substitute-server/.test(specifier))
          offenders.push(`${path.relative(RAI_WEB_ROOT, file)} imports ${specifier}`);
      // config.ts is the only process.env reader (section 1.1); it must not know the substitute flag, and
      // web/src only ever sees the build-time boolean vite.config.ts defines from VITE_API_SUBSTITUTE.
      if (
        file.endsWith(path.join('server', 'src', 'config.ts')) &&
        /SUBSTITUTE/.test(text.replace(/'substitute'/g, ''))
      )
        offenders.push('server/src/config.ts names a substitute variable');
    }
    assert.deepEqual(offenders, []);
  });

  it('the real server process started with every substitute-shaped variable set ignores them: no marker header, no reset hook, no banner flag', async () => {
    const server = await startTestServer({
      env: {
        VITE_API_SUBSTITUTE: 'true',
        RAI_API_SUBSTITUTE: 'true',
        API_SUBSTITUTE: 'true',
        API_PROXY_TARGET: 'http://127.0.0.1:8789',
        SUBSTITUTE_PORT: '8789',
        SUBSTITUTE_WEB_PORT: '5175',
      },
    });
    try {
      assert.equal(server.linesFor('process.started').length, 1);
      const users = await fetch(`${server.baseUrl}/auth/fixture/users`);
      assert.equal(users.status, 200);
      assert.equal(users.headers.get('x-rai-substitute'), null);
      const body = (await users.json()) as { users: { fixtureUserId: string }[] };
      assert.equal(body.users.length, 8, 'the eight W0-03 fixture identities from @rai/fixtures/data/users');
      const reset = await fetch(`${server.baseUrl}/__substitute/reset`, { method: 'POST' });
      assert.equal(reset.status, 404);
      assert.equal(((await reset.json()) as { error: { code: string } }).error.code, 'not_found');
      assert.equal(reset.headers.get('x-rai-substitute'), null);
      const session = await fetch(`${server.baseUrl}/api/session`);
      assert.equal(session.status, 401);
      assert.equal(session.headers.get('x-rai-substitute'), null);
    } finally {
      await server.stop();
    }
  });
});
