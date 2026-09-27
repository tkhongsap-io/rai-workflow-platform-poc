// W4-05b (W4b plan section 4.2, ADR-0006 isolation, decision 5 WA-D08): the extraction host. Every `extract` call
// forks one fresh worker process (worker/main), sends it one request over IPC, reads one reply, and SIGKILLs it, so
// no parser shares the server's heap and no state survives between artifacts or cases.
//
//   - fork: `env: {}`, `serialization: 'advanced'`, stdio ignored (nothing the worker prints reaches the logs), the
//     parent's loader flags only when the entry is TypeScript, `--max-old-space-size`, and Node's permission model
//     when the entry is JavaScript (the built layout; see `permissionFlagsFor`);
//   - fails closed: input over the byte cap → `limit_bytes` (no fork); the wall clock from fork or an abort → SIGKILL,
//     `limit_time`; a reply over the output caps → SIGKILL, `limit_output`; a heap death (SIGABRT, exit 134) →
//     `limit_memory`; any other exit before a reply, a spawn or send error, or a malformed reply → `crash`;
//   - a FIFO semaphore of `maxConcurrency` counts live processes: a slot frees when the process has exited.
//
// The host keeps no logger and no state between calls: nothing extracted is logged, stored or cached (decision 23).
// The content runner (W4-06a) maps the reasons to run outcomes and logs `qc.extract.failed` (W4-11b).
import { fork } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import { SERVER_PACKAGE_VERSION } from '../../server-version.js';
import { extractionLimitsProblems, workerLimitsOf, type ExtractionLimits } from './limits.js';
import type { ExtractFailureReason, ExtractResult, Extractor } from './port.js';
import { buildWorkerRequest, classifyReply, type ClassifiedReply, type WorkerLimits } from './protocol.js';

export const EXTRACTOR_PROTOCOL = 'rai-extract/1';

export interface WorkerExtractorOptions {
  /** Absolute path of the worker entry. Defaults to worker/main.ts from source, worker/main.js from the build. */
  entry?: string;
  /** Called with each forked worker's PID (observability; W4-10a checks one process per extraction). */
  onFork?: (pid: number | undefined) => void;
}

const LOADER_FLAGS = new Set([
  '--import',
  '--require',
  '-r',
  '--loader',
  '--experimental-loader',
  '--conditions',
  '-C',
]);

/** The module-loading flags of an execArgv (`--import tsx`, `--conditions=rai-source`, ...), in order; nothing else. */
export function loaderFlagsOf(execArgv: readonly string[]): string[] {
  const flags: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i]!;
    const eq = arg.indexOf('=');
    if (!LOADER_FLAGS.has(eq > 0 ? arg.slice(0, eq) : arg)) continue;
    flags.push(arg);
    if (eq < 0 && i + 1 < execArgv.length) flags.push(execArgv[++i]!);
  }
  return flags;
}

const isTypeScript = (file: string) => /\.[cm]?ts$/.test(file);

function loaderFlagsFor(file: string, parentExecArgv: readonly string[]): string[] {
  if (!isTypeScript(file)) return [];
  const flags = loaderFlagsOf(parentExecArgv);
  return flags.length > 0 ? flags : ['--import', 'tsx'];
}

/**
 * The worker entry next to this host: `worker/main.ts` when the host itself runs from source (tests, `tsx`), with
 * the parent's loader flags so the child can load TypeScript; `worker/main.js` from the build, with none.
 */
export function workerEntryFor(
  hostModuleUrl: string,
  parentExecArgv: readonly string[],
): { file: string; loaderFlags: string[] } {
  const ext = isTypeScript(fileURLToPath(hostModuleUrl)) ? 'ts' : 'js';
  const file = fileURLToPath(new URL(`./worker/main.${ext}`, hostModuleUrl));
  return { file, loaderFlags: loaderFlagsFor(file, parentExecArgv) };
}

/**
 * Node's permission model, for a JavaScript entry (the built layout): no file write, no child process, no worker
 * thread, no native addon, no WASI, and reads only of the worker's own directory and the package.json files Node
 * consults to resolve its module type. A TypeScript entry (the source layout) gets none: `tsx` transforms the worker
 * with esbuild, which needs a worker thread and a child process, so the model would have to allow exactly what it is
 * for (W4-05b review, "Deviations"). The module-graph test is the network guard in both layouts: Node 24's model does
 * not restrict sockets.
 */
export function permissionFlagsFor(file: string): string[] {
  if (isTypeScript(file)) return [];
  const reads = [path.dirname(file)];
  for (let dir = path.dirname(file); ;) {
    reads.push(path.join(dir, 'package.json'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ['--permission', ...reads.map((read) => `--allow-fs-read=${read}`)];
}

type Release = () => void;

/** FIFO counting semaphore; an aborted waiter leaves the queue holding nothing. */
function semaphore(permits: number) {
  let free = permits;
  const queue: Array<(release: Release) => void> = [];
  const releaser = (): Release => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next === undefined) free++;
      else next(releaser());
    };
  };
  return (signal: AbortSignal): Promise<Release | undefined> => {
    if (free > 0 && queue.length === 0) {
      free--;
      return Promise.resolve(releaser());
    }
    return new Promise((resolve) => {
      const waiter = (release: Release) => {
        signal.removeEventListener('abort', onAbort);
        resolve(release);
      };
      const onAbort = () => {
        const at = queue.indexOf(waiter);
        if (at >= 0) queue.splice(at, 1);
        resolve(undefined);
      };
      queue.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}

type Outcome = ClassifiedReply | { ok: false; reason: ExtractFailureReason };

function runWorker(
  launch: { file: string; execArgv: string[] },
  request: ReturnType<typeof buildWorkerRequest>,
  limits: ExtractionLimits & { worker: WorkerLimits },
  signal: AbortSignal,
  release: Release,
  onFork: WorkerExtractorOptions['onFork'],
): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    let exited = false;
    let child: ReturnType<typeof fork> | undefined;
    const onAbort = () => finish({ ok: false, reason: 'limit_time' });
    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (child !== undefined && !exited) child.kill('SIGKILL');
      resolve(outcome);
    };
    const timer = setTimeout(onAbort, limits.timeoutMs);
    try {
      child = fork(launch.file, [], {
        env: {},
        execArgv: launch.execArgv,
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
    } catch {
      settled = true;
      clearTimeout(timer);
      release();
      resolve({ ok: false, reason: 'crash' });
      return;
    }
    const worker = child;
    onFork?.(worker.pid);
    worker.once('exit', () => {
      exited = true;
      release();
    });
    // Classified on 'close' (after the IPC channel has drained), so a reply sent just before an exit is still read.
    worker.once('close', (code, exitSignal) => {
      const heapDeath = exitSignal === 'SIGABRT' || code === 134;
      finish({ ok: false, reason: heapDeath ? 'limit_memory' : 'crash' });
    });
    // `on`, not `once`: a second 'error' (a failed kill after a failed send) must never reach the server unhandled.
    worker.on('error', () => {
      if (worker.pid === undefined) release(); // never spawned: no 'exit' will come
      finish({ ok: false, reason: 'crash' });
    });
    worker.once('message', (message: unknown) => finish(classifyReply(message, limits.worker)));
    signal.addEventListener('abort', onAbort, { once: true });
    worker.send(request, (error) => {
      if (error) finish({ ok: false, reason: 'crash' });
    });
  });
}

const SELF_TEST_PROBE = {
  mediaType: 'application/pdf' as AllowedMediaType,
  bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
};

export function createWorkerExtractor(
  limits: ExtractionLimits,
  options: WorkerExtractorOptions = {},
): Extractor {
  const problems = extractionLimitsProblems(limits);
  if (problems.length > 0) throw new RangeError(`invalid extraction limits: ${problems.join(', ')}`);
  const settings = { ...limits, worker: workerLimitsOf(limits) };
  const entry =
    options.entry === undefined
      ? workerEntryFor(import.meta.url, process.execArgv)
      : { file: options.entry, loaderFlags: loaderFlagsFor(options.entry, process.execArgv) };
  // The permission model matches real paths (macOS /tmp is /private/tmp). A missing entry is left as given: every
  // fork then fails as `crash` and `selfTest()` is false, but the server still starts (QC is soft).
  let file = entry.file;
  try {
    file = realpathSync(entry.file);
  } catch {
    // keep the path as given
  }
  const launch = {
    file,
    execArgv: [
      ...entry.loaderFlags,
      `--max-old-space-size=${limits.maxMemoryMb}`,
      ...permissionFlagsFor(file),
    ],
  };
  const acquire = semaphore(limits.maxConcurrency);
  const version = `${EXTRACTOR_PROTOCOL}+${SERVER_PACKAGE_VERSION}`;

  const extract: Extractor['extract'] = async (input, signal) => {
    const fail = (reason: ExtractFailureReason): ExtractResult => ({
      ok: false,
      extractorVersion: version,
      reason,
    });
    if (input.bytes.byteLength > limits.maxInputBytes) return fail('limit_bytes');
    if (signal.aborted) return fail('limit_time');
    const release = await acquire(signal);
    if (release === undefined) return fail('limit_time');
    if (signal.aborted) {
      release();
      return fail('limit_time');
    }
    const outcome = await runWorker(
      launch,
      buildWorkerRequest(input, settings.worker),
      settings,
      signal,
      release,
      options.onFork,
    );
    return outcome.ok
      ? { ok: true, extractorVersion: version, segments: outcome.segments }
      : fail(outcome.reason);
  };

  return {
    version,
    extract,
    /**
     * W4-05b: true when a worker starts, reads a request and answers with a well-formed reply. W4-05c tightens it to
     * the embedded synthetic DOCX yielding segments; W4-13b caches it as the readiness probe answer.
     */
    async selfTest() {
      const result = await extract(SELF_TEST_PROBE, new AbortController().signal);
      return result.ok || result.reason === 'unreadable';
    },
  };
}
