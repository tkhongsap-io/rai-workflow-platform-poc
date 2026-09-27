// Tries what the permission model must deny (a file write, a child process) and reports each outcome.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function attempt(action) {
  try {
    action();
    return 'allowed';
  } catch (error) {
    return error?.code ?? 'error';
  }
}

process.once('message', () => {
  const text = JSON.stringify({
    permission: typeof process.permission?.has === 'function',
    fsWrite: attempt(() => writeFileSync(path.join(tmpdir(), `rai-w4-05b-probe-${process.pid}`), 'x')),
    childProcess: attempt(() => {
      const result = spawnSync(process.execPath, ['--version']);
      if (result.error) throw result.error;
    }),
  });
  process.send({ ok: true, segments: [{ locator: { kind: 'absent' }, text }] });
});
