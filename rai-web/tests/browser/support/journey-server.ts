import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RAI_WEB_ROOT, freeLoopbackPort, testServerEnv, type CapturedLine } from '../../support/process.js';
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
  let output = '';
  const lines: CapturedLine[] = [];
  for (const [stream, name] of [
    [child.stdout!, 'stdout'],
    [child.stderr!, 'stderr'],
  ] as const) {
    let pending = '';
    stream.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      pending += text;
      const split = pending.split('\n');
      pending = split.pop()!;
      for (const line of split) {
        try {
          lines.push({ ...(JSON.parse(line) as Record<string, unknown>), stream: name });
        } catch {
          lines.push({ stream: name, raw: line });
        }
      }
    });
  }
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  const message = async (matches: (v: Record<string, unknown>) => boolean) => {
    const signal = AbortSignal.timeout(30000);
    while (true) {
      const [value] = await Promise.race([
        once(child, 'message', { signal }) as Promise<[unknown]>,
        exited.then(() => {
          throw new Error(`Journey process exited: ${output}`);
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
    await exited;
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
    capturedLines: (): readonly CapturedLine[] => structuredClone(lines),
    async stop() {
      if (child.exitCode !== null) return child.exitCode;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      try {
        const [code] = await exited;
        if (code !== 0) throw new Error(`Journey shutdown failed: ${output}`);
        return code;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
