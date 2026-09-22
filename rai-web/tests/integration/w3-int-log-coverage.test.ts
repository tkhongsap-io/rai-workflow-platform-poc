import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createAuditedLogStream } from '../support/log-capture.js';
import { integrationEntries, unauditedAppImports } from '../support/integration-log-policy.js';
const root = fileURLToPath(new URL('../..', import.meta.url));
const execute = promisify(execFile);
test('every integration app import uses the audited wrapper, including reachable helpers', () => {
  assert.ok(integrationEntries(root).length >= 17);
  assert.deepEqual(unauditedAppImports(root), []);
});
test('policy rejects aliases, namespaces, dynamic imports, require and helper re-exports', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'rai-log-policy-'));
  try {
    for (const dir of ['server/src', 'tests/support', 'tests/integration'])
      await mkdir(path.join(folder, dir), { recursive: true });
    await writeFile(path.join(folder, 'server/src/app.ts'), 'export function buildApp() {}');
    await writeFile(
      path.join(folder, 'tests/support/observed-app.ts'),
      "export { buildApp } from '@rai/server/app';",
    );
    await writeFile(path.join(folder, 'tests/support/bypass.ts'), "export * from '../../server/src/app.js';");
    const entry = path.join(folder, 'tests/integration/test.ts');
    for (const source of [
      "import { buildApp } from '@rai/server/app';",
      "import { buildApp as make } from '@rai/server/app';",
      "import * as factory from '@rai/server/app';",
      "const module = await import('@rai/server/app');",
      "const module = require('../../server/src/app.js');",
      "import module = require('@rai/server/app');",
      'const module = await import(name);',
      "import { buildApp } from '../support/bypass.js';",
    ]) {
      await writeFile(entry, source);
      assert.ok(unauditedAppImports(folder).length > 0, source);
    }
    for (const source of [
      "import { buildApp } from '../support/observed-app.js';",
      "import type { App } from '@rai/server/app';",
      "import { type AppDeps } from '@rai/server/app';",
      "export type { App } from '@rai/server/app';",
    ]) {
      await writeFile(entry, source);
      assert.deepEqual(unauditedAppImports(folder), [], source);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test('tee preserves bytes and asynchronous stream callbacks without ending the caller stream', async () => {
  const bytes = Buffer.from('{"message":"ภาษาไทยปลอดภัย"}\n');
  const chunks: Buffer[] = [];
  const forward = new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, done) {
      setImmediate(() => {
        chunks.push(Buffer.from(chunk));
        done();
      });
    },
  });
  const audit = createAuditedLogStream(forward);
  for (const byte of bytes) audit.stream.write(Buffer.from([byte]));
  await audit.settled();
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(forward.writableEnded, false);
});
for (const scenario of [
  'safe',
  'marker',
  'email',
  'name',
  'clear-rebuild',
  'tracked-background',
  'post-close',
  'after-final-audit',
  'caught-utf8',
  'forward-error',
]) {
  test(`isolated node:test control: ${scenario}`, async () => {
    const result = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=rai-source',
        'tests/support/fixtures/observed-app-scenario.ts',
        scenario,
      ],
      { cwd: root, timeout: 15000 },
    ).then(
      (output) => ({ ...output, failed: false }),
      (error: unknown) => {
        const failure = error as { code?: unknown; killed?: boolean; stdout?: string; stderr?: string };
        assert.equal(failure.killed, false, 'control must fail itself, not time out');
        assert.equal(failure.code, 1);
        return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', failed: true };
      },
    );
    assert.equal(result.failed, scenario !== 'safe');
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /RAI-DESK-SYNTHETIC-FIXTURE|เอกสารประกอบ_ผู้ให้บริการ/,
    );
  });
}
