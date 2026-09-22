import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { guardLaunch, type LaunchConfig, type Controls } from './server-contract.js';
export async function startPerformanceServer(
  configFile: string,
  logFile: string,
): Promise<Controls & { stop(): Promise<void> }> {
  const config = JSON.parse(await readFile(configFile, 'utf8')) as LaunchConfig;
  try {
    guardLaunch(config);
  } catch {
    throw new Error('performance launch configuration refused');
  }
  const log = createWriteStream(logFile, { flags: 'wx', mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    log.once('open', () => resolve());
    log.once('error', reject);
  });
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--conditions=rai-source',
      'tests/performance/server-process.ts',
      await realpath(configFile),
    ],
    {
      cwd,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });
  let exited = false;
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      exited = true;
      resolve(code);
    });
  });
  // Observe rejection immediately while startup is awaiting its first IPC message.
  void exit.catch(() => {});
  const waiters = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  child.on('message', (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const r = value as { ready?: boolean; id?: string };
    const key = r.ready === true ? 'ready' : r.id;
    if (key) waiters.get(key)?.resolve(value);
  });
  async function wait(key: string, send?: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<unknown>((resolve, reject) => {
          waiters.set(key, { resolve, reject });
          timer = setTimeout(() => reject(new Error('performance IPC deadline')), 70_000);
          send?.();
        }),
        exit.then(() => {
          throw new Error('performance child exited');
        }),
      ]);
    } finally {
      clearTimeout(timer);
      waiters.delete(key);
    }
  }
  let stopped: Promise<void> | undefined;
  const stop = () =>
    (stopped ??= (async () => {
      if (!exited) child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
      try {
        const code = await exit;
        assert.equal(code, 0, 'performance child shutdown failed');
      } finally {
        clearTimeout(timer);
        log.end();
        await finished(log);
      }
    })());
  log.on('error', () => {
    child.kill('SIGTERM');
  });
  try {
    const ready = (await wait('ready')) as Record<string, unknown>;
    assert.equal(ready.head, config[config.target].finalHead);
    assert.equal(ready.database, config[config.target].target.database);
    assert.equal(ready.scenario, config.scenario);
    assert.equal(ready.fixtureSha256, config.fixtureSha256);
  } catch (error) {
    await stop().catch(() => {});
    throw error;
  }
  async function command(body: Record<string, unknown>) {
    const id = randomUUID();
    const reply = (await wait(id, () =>
      child.send({ ...body, id }, (error) => {
        if (error) waiters.get(id)?.reject(error);
      }),
    )) as { ok?: boolean };
    assert.equal(reply.ok, true, 'performance control refused; raw evidence retained');
  }
  return {
    target: config[config.target],
    enroll: (key, caseId) => command({ op: 'enroll', key, caseId }),
    submit: (proof) => command({ op: 'submit', proof }),
    settled: () => command({ op: 'settled' }),
    stop,
  };
}
