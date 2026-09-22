// Test-server process for the integration layer (W0-02 section 8.1: "for restart tests, a spawned process") and
// the log capture the W0-10 test obligations need (OBS-xx assert on emitted lines). Lane C owns this file (W1-12).
//
// Spawns the one deployable (`server/src/main.ts` through tsx, no build step; or, with `built: true`, the built
// `server/dist/main.js` that `npm start` runs, which W1-INT's journey restarts) in test mode on a free loopback
// port (or the `port` the caller names, so a restarted process keeps its origin) with the fixture identity
// provider, the in-memory mail sink and the QC substitute, captures every JSON line the process writes to stdout
// and stderr, waits for `process.started`, and stops it with SIGTERM — escalating to SIGKILL and rejecting with the
// captured lines when the process has not exited within the grace period, so a shutdown hang fails the test with
// the server's last log lines instead of the runner's timeout. Nothing here reaches an external service:
// the database is the local Postgres that `.env` or the shell names, and the identity mode is `fixture`, which
// config.ts accepts only under NODE_ENV=test on a loopback bind (W0-03 S13, S14).

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnv } from '@rai/server/config';

export const RAI_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One parsed JSON line from the process (pino line or a `process.refused` line from main.ts). */
export interface CapturedLine {
  stream: 'stdout' | 'stderr';
  event?: string;
  [key: string]: unknown;
}

export interface TestServerProcess {
  baseUrl: string;
  port: number;
  pid: number;
  /** Every JSON line captured so far, in arrival order; non-JSON output is kept under `raw`. */
  readonly lines: readonly CapturedLine[];
  /** Resolves with the first captured line whose `event` matches, waiting up to `timeoutMs` for it. */
  waitForEvent(event: string, timeoutMs?: number): Promise<CapturedLine>;
  /** Lines whose `event` matches, for assertions after the fact. */
  linesFor(event: string): CapturedLine[];
  /**
   * SIGTERM and wait for exit; resolves with the exit code and signal. Idempotent. When the process is still
   * running after `graceMs` (default STOP_GRACE_MS) it is SIGKILLed and the promise rejects with the captured
   * lines: a graceful shutdown that does not complete is a failure, never a wait.
   */
  stop(graceMs?: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * How long stop() waits for the SIGTERM path before SIGKILL: the W0-04 drain budget (10 s, shutdown.ts
 * SHUTDOWN_DRAIN_MS) plus main.ts's hard-exit grace (5 s), plus a margin; a healthy stop takes milliseconds.
 */
export const STOP_GRACE_MS = 20_000;

/** The variables every spawned test server carries; the caller's `env` overrides only what it names. */
export function testServerEnv(port: number, overrides: Record<string, string> = {}): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(readEnv())) if (value !== undefined) inherited[key] = value;
  return {
    ...inherited,
    NODE_ENV: 'test',
    RAI_IDENTITY_MODE: 'fixture',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    TRUST_PROXY: 'false',
    BLOB_DIR: './.local/test/blobs',
    MAIL_MODE: 'sink-memory',
    MAIL_SINK_DIR: './.local/test/mail',
    QC_MODE: 'substitute',
    LOG_PRETTY: 'false',
    ...overrides,
  };
}

/** Asks the kernel for a free loopback port. The small race with another process is acceptable for tests. */
export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export interface StartOptions {
  env?: Record<string, string>;
  /** How long to wait for `process.started` (or a refusal) before giving up. */
  startTimeoutMs?: number;
  /** Spawn the built deployable (`node server/dist/main.js`, what `npm start` runs) instead of the source through tsx. */
  built?: boolean;
  /** Listen on this loopback port instead of a free one (a restart keeps its origin). */
  port?: number;
}

/** The built entry point `npm start` runs; W1-INT's journey and evidence-configuration checks spawn it. */
export const BUILT_MAIN = path.join(RAI_WEB_ROOT, 'server', 'dist', 'main.js');

export class BuiltServerMissingError extends Error {
  constructor() {
    super(`${BUILT_MAIN} does not exist; run npm run build first`);
    this.name = 'BuiltServerMissingError';
  }
}

/** Starts the server and resolves once it logged `process.started`; rejects with the captured lines otherwise. */
export async function startTestServer(options: StartOptions = {}): Promise<TestServerProcess> {
  const port = options.port ?? (await freeLoopbackPort());
  const env = testServerEnv(port, options.env);
  if (options.built === true && !existsSync(BUILT_MAIN)) throw new BuiltServerMissingError();
  const child = spawn(
    process.execPath,
    options.built === true
      ? [BUILT_MAIN]
      : ['--import', 'tsx', '--conditions=rai-source', path.join('server', 'src', 'main.ts')],
    { cwd: RAI_WEB_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const capture = attachCapture(child);
  const server: TestServerProcess = {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    pid: child.pid ?? -1,
    lines: capture.lines,
    waitForEvent: capture.waitForEvent,
    linesFor: (event) => capture.lines.filter((l) => l.event === event),
    stop: capture.stop,
  };
  const timeoutMs = options.startTimeoutMs ?? 30_000;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        finish();
        reject(
          new Error(
            `no process.started line within ${timeoutMs} ms; captured ${JSON.stringify(capture.lines)}`,
          ),
        );
      }, timeoutMs);
      const unsubscribe = capture.onLine((line) => {
        if (line.event === 'process.started') {
          finish();
          resolve();
        } else if (line.event === 'process.refused') {
          finish();
          reject(new Error(`test server refused to start: ${JSON.stringify(line)}`));
        }
      });
      void capture.exited.then((exit) => {
        finish();
        reject(new Error(`test server exited before process.started: ${JSON.stringify(exit)}`));
      });
      function finish() {
        clearTimeout(timer);
        unsubscribe();
      }
    });
  } catch (err) {
    await capture.stop().catch(() => undefined); // the start failure is the error to report, not a stop hang
    throw err;
  }
  return server;
}

function attachCapture(child: ChildProcess) {
  const lines: CapturedLine[] = [];
  const waiters: { event: string; resolve: (line: CapturedLine) => void }[] = [];
  const listeners = new Set<(line: CapturedLine) => void>();
  const push = (stream: 'stdout' | 'stderr', text: string) => {
    for (const raw of text.split('\n')) {
      if (raw.trim() === '') continue;
      let line: CapturedLine;
      try {
        line = { ...(JSON.parse(raw) as Record<string, unknown>), stream };
      } catch {
        line = { stream, raw };
      }
      lines.push(line);
      for (const listener of listeners) listener(line);
      for (const waiter of waiters.splice(0)) {
        if (waiter.event === line.event) waiter.resolve(line);
        else waiters.push(waiter);
      }
    }
  };
  let buffers = { stdout: '', stderr: '' };
  const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    buffers[stream] += chunk.toString('utf8');
    const cut = buffers[stream].lastIndexOf('\n');
    if (cut === -1) return;
    push(stream, buffers[stream].slice(0, cut));
    buffers = { ...buffers, [stream]: buffers[stream].slice(cut + 1) };
  };
  child.stdout?.on('data', onData('stdout'));
  child.stderr?.on('data', onData('stderr'));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      for (const stream of ['stdout', 'stderr'] as const)
        if (buffers[stream] !== '') push(stream, buffers[stream]);
      resolve({ code, signal });
    });
  });
  const waitForEvent = (event: string, timeoutMs = 10_000): Promise<CapturedLine> => {
    const existing = lines.find((l) => l.event === event);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((w) => w.resolve === settle);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error(`no ${event} line within ${timeoutMs} ms; captured ${JSON.stringify(lines)}`));
      }, timeoutMs);
      const settle = (line: CapturedLine) => {
        clearTimeout(timer);
        resolve(line);
      };
      waiters.push({ event, resolve: settle });
    });
  };
  let stopping: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  const stop = (graceMs = STOP_GRACE_MS) => {
    if (stopping === undefined) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      stopping = new Promise((resolve, reject) => {
        let killed = false;
        const timer = setTimeout(() => {
          killed = true;
          child.kill('SIGKILL');
        }, graceMs);
        void exited.then((exit) => {
          clearTimeout(timer);
          if (killed)
            reject(
              new Error(
                `test server (pid ${child.pid}) did not exit within ${graceMs} ms of SIGTERM; killed. Captured lines: ${JSON.stringify(lines)}`,
              ),
            );
          else resolve(exit);
        });
      });
    }
    return stopping;
  };
  const onLine = (listener: (line: CapturedLine) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { lines, waitForEvent, onLine, exited, stop };
}
