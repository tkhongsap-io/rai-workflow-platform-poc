import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { assertNoLeak } from './log-capture.js';
import { RAI_WEB_ROOT } from './process.js';

/** Fixed scenario only; callback waits for close, after both serialized streams finish. */
export async function runObservedSubmitBinding(leakControl = false): Promise<void> {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT; // an independent node --test runner, not the parent's worker

  const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=rai-source',
        '--test',
        '--test-isolation=none', // server lives in this owned PID; timeout cannot orphan a test worker
        '--test-reporter=tap',
        'tests/support/fixtures/submit-binding-scenario.ts',
      ],
      {
        cwd: RAI_WEB_ROOT,
        env: {
          ...childEnv,
          NODE_ENV: 'test',
          RAI_IDENTITY_MODE: 'fixture',
          OBS_SUBMIT_CHILD_CANARY: leakControl ? '1' : '0',
        },
        timeout: 60000,
        killSignal: 'SIGKILL',
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });
  // Audit failed children too; never include captured values in failure diagnostics.
  assertNoLeak({ text: () => result.stdout });
  assertNoLeak({ text: () => result.stderr });
  assert.equal(result.error === null, true, 'captured submit scenario failed or timed out');
  for (const [key, expected] of [
    ['tests', 1],
    ['pass', 1],
    ['fail', 0],
    ['skipped', 0],
    ['cancelled', 0],
  ] as const) {
    const count = result.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1];
    assert.equal(count, String(expected), `captured submit scenario ${key}`);
  }
}
