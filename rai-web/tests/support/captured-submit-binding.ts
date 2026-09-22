import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import { assertNoLeak } from './log-capture.js';
import { RAI_WEB_ROOT } from './process.js';

/** Fixed scenario only; callback waits for close, after both serialized streams finish. */
export async function runObservedSubmitBinding(
  leakControl = false,
  scenario: 'binding' | 'late' = 'binding',
): Promise<void> {
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
          OBS_SUBMIT_CHILD_SCENARIO: scenario,
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
  if (scenario === 'late') {
    const events = result.stdout
      .split('\n')
      .map((line) => (line.startsWith('# ') ? line.slice(2) : line))
      .filter((line) => line.startsWith('{'))
      .map(
        (line) =>
          JSON.parse(line) as {
            event?: string;
            correlationId?: string;
            fields?: { trigger?: string; qcRunId?: string };
          },
      );
    const late = events.filter((line) => line.event === 'qc.run.late');
    const started = events.filter(
      (line) => line.event === 'qc.run.started' && line.fields?.trigger === 'submit',
    );
    assert.equal(late.length, 1, 'one late-result domain event across restart');
    assert.equal(started.length, 1);
    assert.equal(late[0]?.correlationId, started[0]?.correlationId);
    assert.equal(late[0]?.fields?.qcRunId, started[0]?.fields?.qcRunId);
  }
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
