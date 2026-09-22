import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const env of [
  { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' },
  { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: '0.0.0.0' },
])
  test(`child refuses before reading config/importing built startup: ${env.NODE_ENV}/${env.HOST}`, async () => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=rai-source',
        'tests/performance/server-process.ts',
        '/does-not-exist',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let output = '';
    child.stdout!.on('data', (b: Buffer) => {
      output += b.toString();
    });
    child.stderr!.on('data', (b: Buffer) => {
      output += b.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
      });
      assert.equal(code, 1);
      assert.equal(output, 'performance_guard_failed\n');
    } finally {
      clearTimeout(timer);
    }
  });
