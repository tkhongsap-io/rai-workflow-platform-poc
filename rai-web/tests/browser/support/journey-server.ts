import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  RAI_WEB_ROOT,
  attachCapture,
  freeLoopbackPort,
  testServerEnv,
  type CapturedLine,
} from '../../support/process.js';
import { assertNoLeak } from '../../support/log-capture.js';
import type { JourneyCommand } from './journey-controls.js';
type Control = JourneyCommand extends infer C ? (C extends JourneyCommand ? Omit<C, 'id'> : never) : never;
export async function startJourneyServer(env: Record<string, string>, requestedPort?: number) {
  const port = requestedPort ?? (await freeLoopbackPort());
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=rai-source', 'tests/browser/support/journey-process.ts'],
    {
      cwd: RAI_WEB_ROOT,
      env: testServerEnv(port, { ...env, MAIL_MODE: 'sink-file' }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const capture = attachCapture(child);
  const message = async (matches: (v: Record<string, unknown>) => boolean) => {
    const signal = AbortSignal.timeout(30000);
    while (true) {
      const [value] = await Promise.race([
        once(child, 'message', { signal }) as Promise<[unknown]>,
        capture.exited.then(() => {
          throw new Error(`Journey process exited; captured line count ${capture.lines.length}`);
        }),
      ]);
      if (typeof value === 'object' && value !== null && matches(value as Record<string, unknown>))
        return value as Record<string, unknown>;
    }
  };
  try {
    await message((m) => m.ready === true);
  } catch (error) {
    child.kill('SIGKILL');
    await capture.exited;
    throw error;
  }
  const command = async (control: Control) => {
    const id = randomUUID();
    const reply = message((m) => m.id === id);
    child.send({ ...control, id });
    if ((await reply).ok !== true) throw new Error('Journey control refused');
  };
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    pid: child.pid,
    bindCase: (caseId: string) => command({ command: 'bindCase', caseId }),
    setMailFailure: (enabled: boolean) => command({ command: 'mailFailure', enabled }),
    setSubmitTimeout: (enabled: boolean) => command({ command: 'submitTimeout', enabled }),
    advanceRetry: (notificationId: string, expectedAttempts: 1 | 2 | 3) =>
      command({ command: 'advanceRetry', notificationId, expectedAttempts }),
    capturedLines: (): readonly CapturedLine[] => structuredClone(capture.lines),
    async stop() {
      const exit = await capture.stop();
      assertNoLeak({ text: () => JSON.stringify(capture.lines) });
      if (exit.code !== 0) throw new Error(`Journey shutdown failed: ${JSON.stringify(exit)}`);
      return exit.code;
    },
  };
}
