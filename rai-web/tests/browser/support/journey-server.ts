import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { RAI_WEB_ROOT, freeLoopbackPort, testServerEnv } from '../../support/process.js';

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
  child.stdout!.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr!.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  const message = async (key: string) => {
    const timeout = AbortSignal.timeout(30000);
    while (true) {
      const [value] = await Promise.race([
        once(child, 'message', { signal: timeout }) as Promise<[unknown]>,
        exited.then(() => {
          throw new Error(`Journey process exited: ${output}`);
        }),
      ]);
      if (typeof value === 'object' && value !== null && key in value) return;
    }
  };
  try {
    await message('ready');
  } catch (error) {
    child.kill('SIGKILL');
    await exited;
    throw error;
  }
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    pid: child.pid,
    async bindCase(caseId: string) {
      const bound = message('bound');
      child.send({ caseId });
      await bound;
    },
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
