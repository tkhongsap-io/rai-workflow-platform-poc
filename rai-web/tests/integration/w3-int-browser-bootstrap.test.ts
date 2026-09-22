// No database or network: build the actual bootstrap with owned, initially missing workspace outputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv, isLoopbackHost } from '@rai/server/config';
import { validateRealBrowserConfig } from '../browser/support/real-browser-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const safe = { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture' };
const origin = 'http://127.0.0.1:58819';

test('bootstrap guard preserves mode, fixture, loopback and all DB routing checks', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'example.com']) {
    const check = () => validateRealBrowserConfig(`http://${host}:58819`, safe);
    if (isLoopbackHost(host)) assert.doesNotThrow(check);
    else assert.throws(check);
  }
  for (const env of [
    { ...safe, NODE_ENV: 'production' },
    { ...safe, RAI_IDENTITY_MODE: 'google' },
  ])
    assert.throws(() => validateRealBrowserConfig(origin, env));
  for (const url of [
    'https://localhost:58819',
    'http://localhost',
    `${origin}/path`,
    `${origin}/?x=1`,
    `${origin}/#x`,
    'http://user@localhost:58819',
  ])
    assert.throws(() => validateRealBrowserConfig(url, safe));
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATE_URL', 'DATABASE_OPERATOR_URL']) {
    for (const url of [
      'postgres://example.com/rai',
      'postgres://localhost/rai?host=remote',
      'postgres://localhost/rai#x',
    ])
      assert.throws(() => validateRealBrowserConfig(origin, { ...safe, [key]: url }));
    assert.doesNotThrow(() =>
      validateRealBrowserConfig(origin, { ...safe, [key]: 'postgres://localhost/rai' }),
    );
  }
});

test(
  'actual browser bootstrap builds owned missing dist before importing its real fixture',
  { timeout: 120000 },
  async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'rai-browser-bootstrap-'));
    const owned = path.join(scratch, 'rai-web');
    try {
      await cp(root, owned, {
        recursive: true,
        filter: (source) => {
          const parts = path.relative(root, source).split(path.sep);
          return !parts.some(
            (part) =>
              ['node_modules', 'dist', '.local', '.env', 'test-results', 'playwright-report'].includes(
                part,
              ) || part.endsWith('.tsbuildinfo'),
          );
        },
      });
      const modules = path.join(owned, 'node_modules');
      await mkdir(path.join(modules, '@rai'), { recursive: true });
      for (const name of await readdir(path.join(root, 'node_modules'))) {
        if (name === '@rai') continue;
        await symlink(path.join(root, 'node_modules', name), path.join(modules, name));
      }
      for (const name of ['server', 'shared', 'fixtures', 'web', 'tests']) {
        await symlink(path.join(owned, name), path.join(modules, '@rai', name));
        assert.equal(
          await realpath(path.join(modules, '@rai', name)),
          path.join(await realpath(owned), name),
        );
        await assert.rejects(stat(path.join(owned, name, 'dist')), { code: 'ENOENT' });
      }
      // Match readEnv semantics while proving the shell's test mode wins over .env.
      await writeFile(path.join(owned, '.env'), 'NODE_ENV=production\nBOOTSTRAP_FILE_ONLY=synthetic\n');
      const env = {
        ...readEnv(),
        ...safe,
        PLAYWRIGHT_BASE_URL: origin,
        NODE_OPTIONS: '',
        BOOTSTRAP_FILE_ONLY: undefined,
      };
      const launch = (script: string, extra: Record<string, string> = {}) =>
        execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
          cwd: owned,
          env: { ...env, ...extra },
          timeout: 90000,
          maxBuffer: 8 * 1024 * 1024,
        });
      const bootstrap = './tests/browser/support/build-real.ts';
      // Real entrypoint guard must run before invoking either build command.
      await launch(
        `import assert from 'node:assert/strict';
      const {default: build} = await import('${bootstrap}');
      await assert.rejects(build(), /test mode/);`,
        { NODE_ENV: 'production' },
      );
      await assert.rejects(stat(path.join(owned, 'server/dist')), { code: 'ENOENT' });
      await launch(`import assert from 'node:assert/strict';
      const {pathToFileURL} = await import('node:url');
      const ownedModule = (relative) => pathToFileURL(process.cwd() + '/' + relative).href;
      const {readBrowserEnv} = await import(ownedModule('tests/browser/support/real-browser-config.ts'));
      assert.equal(readBrowserEnv().NODE_ENV, 'test');
      assert.equal(readBrowserEnv().BOOTSTRAP_FILE_ONLY, 'synthetic');
      const {default: build} = await import('${bootstrap}');
      await build();
      const {readEnv} = await import('@rai/server/config');
      assert.equal(readEnv().NODE_ENV, 'test');
      assert.equal(readEnv().BOOTSTRAP_FILE_ONLY, 'synthetic');
      const {realpathSync} = await import('node:fs');
      const {fileURLToPath} = await import('node:url');
      for (const specifier of ['@rai/server/config', '@rai/fixtures/load', '@rai/shared/schemas/auth'])
        assert.ok(realpathSync(fileURLToPath(import.meta.resolve(specifier))).startsWith(process.cwd() + '/'));
      const fixture = await import(ownedModule('tests/browser/support/real-test.ts'));
      assert.equal(typeof fixture.test, 'function');`);
      for (const [name, file] of [
        ['server', 'config.js'],
        ['shared', 'schemas/auth.js'],
        ['fixtures', 'load.js'],
      ])
        assert.ok((await stat(path.join(owned, name!, 'dist', file!))).isFile());
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
