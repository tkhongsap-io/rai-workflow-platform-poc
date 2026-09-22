// Refuse before importing startup or opening DB; unsafe contexts are tested with IPC present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { RAI_WEB_ROOT } from '../support/process.js';

for (const [env, ipc] of [
  [{ NODE_ENV: 'production', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' }, true],
  [{ NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: '0.0.0.0' }, true],
  [{ NODE_ENV: 'test', RAI_IDENTITY_MODE: 'google', HOST: '127.0.0.1' }, true],
  [{ NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' }, false],
] as const)
  test(`journey process refuses unsafe configuration or missing IPC: ${JSON.stringify(env)}`, async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=rai-source', 'tests/browser/support/journey-process.ts'],
      {
        cwd: RAI_WEB_ROOT,
        env: { ...process.env, ...env },
        stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout!.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr!.on('data', (data: Buffer) => {
      output += data.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('exit', resolve);
        child.once('error', reject);
      });
      assert.notEqual(code, 0);
      assert.match(output, /Synthetic journey requires test fixture loopback IPC/);
      assert.doesNotMatch(output, /process.started/);
    } finally {
      clearTimeout(timer);
    }
  });

test('IPC whitelist rejects arbitrary paths, unbounded clocks, unknown commands and malformed values', async () => {
  const { isJourneyCommand } = await import('../browser/support/journey-controls.js');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(isJourneyCommand({ id, command: 'mailFailure', enabled: true }), true);
  assert.equal(
    isJourneyCommand({ id, command: 'advanceRetry', notificationId: id, expectedAttempts: 1 }),
    true,
  );
  for (const command of [
    { id, command: 'mailFailure', enabled: true, path: '/tmp/other' },
    { id, command: 'mailFailure', enabled: 'true' },
    { id, command: 'advanceRetry', notificationId: id, expectedAttempts: 4 },
    { id, command: 'advanceRetry', notificationId: id, expectedAttempts: 1, milliseconds: 999999 },
    { id, command: 'eval', code: 'anything' },
    { id, command: 'bindCase', caseId: 'not-a-uuid' },
  ])
    assert.equal(isJourneyCommand(command), false);
});
