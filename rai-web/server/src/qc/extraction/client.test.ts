// W4-05b (W4b plan section 4.2 and 4.4): the forking host. The real worker is driven from source (`tsx`); each limit
// is driven by a fault worker from test-workers/ passed as `entry`, so the product worker carries no test hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import { SERVER_PACKAGE_VERSION } from '../../server-version.js';
import {
  EXTRACTOR_PROTOCOL,
  createWorkerExtractor,
  loaderFlagsOf,
  permissionFlagsFor,
  workerEntryFor,
  type WorkerExtractorOptions,
} from './client.js';
import type { ExtractionLimits } from './limits.js';
import type { ExtractResult } from './port.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAULT = (name: string) => path.join(HERE, 'test-workers', `${name}.mjs`);
const PDF: AllowedMediaType = 'application/pdf';
const MEDIA_TYPES: AllowedMediaType[] = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];
const LIMITS: ExtractionLimits = {
  timeoutMs: 4000,
  maxMemoryMb: 64,
  maxTextChars: 100_000,
  maxConcurrency: 2,
  maxInputBytes: 1024,
};
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const never = () => new AbortController().signal;

function extractor(overrides: Partial<ExtractionLimits> = {}, options: WorkerExtractorOptions = {}) {
  return createWorkerExtractor({ ...LIMITS, ...overrides }, options);
}
function fault(
  name: string,
  overrides: Partial<ExtractionLimits> = {},
  options: WorkerExtractorOptions = {},
) {
  return extractor(overrides, { ...options, entry: FAULT(name) });
}
function failure(result: ExtractResult) {
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.ok ? undefined : result.reason;
}
function echoed(result: ExtractResult): Record<string, unknown> {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.segments.length, 1);
  return JSON.parse(result.segments[0]!.text) as Record<string, unknown>;
}

test('the version names the protocol and the server version', () => {
  assert.equal(EXTRACTOR_PROTOCOL, 'rai-extract/1');
  assert.equal(extractor().version, `rai-extract/1+${SERVER_PACKAGE_VERSION}`);
});

test('limits outside the policy bounds are refused at creation', () => {
  assert.throws(() => extractor({ timeoutMs: 10_000 }), /timeoutMs/);
  assert.throws(() => extractor({ maxConcurrency: 0 }), /maxConcurrency/);
  assert.throws(() => extractor({ maxMemoryMb: 1024 }), /maxMemoryMb/);
});

test('the real worker, from source, answers every media type as unreadable until W4-05c and W4-05d', async () => {
  const worker = extractor();
  for (const mediaType of MEDIA_TYPES) {
    const result = await worker.extract({ mediaType, bytes: BYTES }, never());
    assert.deepEqual(
      result,
      { ok: false, extractorVersion: worker.version, reason: 'unreadable' },
      mediaType,
    );
  }
});

test('selfTest is true when the worker round-trips, false when it cannot', async () => {
  assert.equal(await extractor().selfTest(), true);
  assert.equal(await fault('crash').selfTest(), false);
  assert.equal(await fault('hang', { timeoutMs: 500 }).selfTest(), false);
});

test('a worker that never replies is killed at the wall clock: limit_time', async () => {
  const started = Date.now();
  assert.equal(
    failure(await fault('hang', { timeoutMs: 500 }).extract({ mediaType: PDF, bytes: BYTES }, never())),
    'limit_time',
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 450 && elapsed < 3000, `${elapsed} ms`);
});

test('an abort kills the worker: limit_time', async () => {
  const controller = new AbortController();
  const pending = fault('hang').extract({ mediaType: PDF, bytes: BYTES }, controller.signal);
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  assert.equal(failure(await pending), 'limit_time');
  assert.ok(Date.now() - started < 2000);
});

test('an already aborted signal is limit_time without a fork', async () => {
  const forks: number[] = [];
  const controller = new AbortController();
  controller.abort();
  const result = await fault('echo', {}, { onFork: (pid) => forks.push(pid ?? -1) }).extract(
    { mediaType: PDF, bytes: BYTES },
    controller.signal,
  );
  assert.equal(failure(result), 'limit_time');
  assert.deepEqual(forks, []);
});

test('a worker that exhausts its capped heap is limit_memory', async () => {
  assert.equal(
    failure(await fault('oom').extract({ mediaType: PDF, bytes: BYTES }, never())),
    'limit_memory',
  );
});

test('a worker that throws, exits without a reply, or replies malformed is a crash', async () => {
  for (const name of ['crash', 'exit-silently', 'malformed', 'extra-key'])
    assert.equal(
      failure(await fault(name).extract({ mediaType: PDF, bytes: BYTES }, never())),
      'crash',
      name,
    );
});

test('a worker that returns more text than the cap is limit_output', async () => {
  assert.equal(
    failure(await fault('flood').extract({ mediaType: PDF, bytes: BYTES }, never())),
    'limit_output',
  );
});

test('input over the byte cap is limit_bytes without a fork', async () => {
  const forks: number[] = [];
  const result = await fault('echo', {}, { onFork: (pid) => forks.push(pid ?? -1) }).extract(
    { mediaType: PDF, bytes: new Uint8Array(1025) },
    never(),
  );
  assert.equal(failure(result), 'limit_bytes');
  assert.deepEqual(forks, []);
  const atCap = await fault('echo').extract({ mediaType: PDF, bytes: new Uint8Array(1024) }, never());
  assert.equal(echoed(atCap).byteLength, 1024);
});

test('each call is a fresh process with an empty environment, no stdio and the heap cap', async () => {
  const forks: Array<number | undefined> = [];
  const worker = fault('echo', { maxMemoryMb: 96 }, { onFork: (pid) => forks.push(pid) });
  const first = echoed(await worker.extract({ mediaType: PDF, bytes: BYTES }, never()));
  const second = echoed(await worker.extract({ mediaType: PDF, bytes: BYTES }, never()));
  assert.equal(forks.length, 2);
  assert.notEqual(first.pid, second.pid, 'one process per call');
  assert.deepEqual(forks, [first.pid, second.pid]);
  assert.notEqual(first.pid, process.pid);
  // macOS adds __CF_USER_TEXT_ENCODING to every process it starts; nothing of the parent's environment is passed.
  const envKeys = (first.envKeys as string[]).filter((k) => k !== '__CF_USER_TEXT_ENCODING');
  assert.deepEqual(envKeys, []);
  assert.ok((first.execArgv as string[]).includes('--max-old-space-size=96'));
  assert.equal(first.stdout, false);
  assert.equal(first.bytesIsUint8Array, true);
  assert.equal(first.mediaType, PDF);
  assert.deepEqual(first.limits, {
    maxTextChars: 100_000,
    maxSegments: 50_000,
    maxPartBytes: 20 * 1024 * 1024,
    maxTotalBytes: 100 * 1024 * 1024,
    maxPdfPages: 2000,
    maxPdfObjects: 100_000,
  });
});

test('the worker runs under the permission model: no file write, no child process', async () => {
  const probe = echoed(await fault('permission-probe').extract({ mediaType: PDF, bytes: BYTES }, never()));
  assert.deepEqual(probe, {
    permission: true,
    fsWrite: 'ERR_ACCESS_DENIED',
    childProcess: 'ERR_ACCESS_DENIED',
  });
});

test('no more workers are alive at once than the concurrency cap, and queued calls run in order', async () => {
  const forks: Array<number | undefined> = [];
  const worker = fault('slow', { maxConcurrency: 2 }, { onFork: (pid) => forks.push(pid) });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => worker.extract({ mediaType: PDF, bytes: BYTES }, never())),
  );
  const spans = results.map((r) => echoed(r) as { pid: number; start: number; end: number });
  for (const span of spans) {
    const alive = spans.filter((other) => other.start < span.end && span.start < other.end).length;
    assert.ok(alive <= 2, `${alive} workers alive at once`);
  }
  assert.deepEqual(
    forks,
    spans.map((s) => s.pid),
    'forked in call order',
  );
  const serial = fault('slow', { maxConcurrency: 1 });
  const [a, b] = (
    await Promise.all([1, 2].map(() => serial.extract({ mediaType: PDF, bytes: BYTES }, never())))
  ).map((r) => echoed(r) as { start: number; end: number });
  assert.ok(b!.start >= a!.end, 'concurrency 1 runs one worker at a time');
});

test('a queued call whose signal aborts leaves the queue without a fork', async () => {
  const forks: Array<number | undefined> = [];
  const worker = fault('slow', { maxConcurrency: 1 }, { onFork: (pid) => forks.push(pid) });
  const first = worker.extract({ mediaType: PDF, bytes: BYTES }, never());
  const controller = new AbortController();
  const queued = worker.extract({ mediaType: PDF, bytes: BYTES }, controller.signal);
  controller.abort();
  assert.equal(failure(await queued), 'limit_time');
  echoed(await first);
  assert.equal(forks.length, 1);
  echoed(await worker.extract({ mediaType: PDF, bytes: BYTES }, never()));
  assert.equal(forks.length, 2, 'the aborted call freed nothing it did not hold');
});

test('the entry is main.ts with the loader flags from source, and main.js without them from the build', () => {
  const parent = ['--import', 'tsx', '--conditions=rai-source', '--test-reporter=spec', '--inspect=0'];
  const source = workerEntryFor(
    pathToFileURL('/srv/rai-web/server/src/qc/extraction/client.ts').href,
    parent,
  );
  assert.deepEqual(source, {
    file: '/srv/rai-web/server/src/qc/extraction/worker/main.ts',
    loaderFlags: ['--import', 'tsx', '--conditions=rai-source'],
  });
  const built = workerEntryFor(
    pathToFileURL('/srv/rai-web/server/dist/qc/extraction/client.js').href,
    parent,
  );
  assert.deepEqual(built, { file: '/srv/rai-web/server/dist/qc/extraction/worker/main.js', loaderFlags: [] });
});

test('loader flags are kept in both spellings, everything else is dropped', () => {
  assert.deepEqual(
    loaderFlagsOf([
      '--import=tsx',
      '--require',
      '/x/preflight.cjs',
      '-r',
      '/y.cjs',
      '--loader',
      'l.mjs',
      '--experimental-loader=m.mjs',
      '-C',
      'rai-source',
      '--conditions',
      'rai-source',
      '--max-old-space-size=4096',
      '--test',
      '--inspect-brk',
      '--permission',
    ]),
    [
      '--import=tsx',
      '--require',
      '/x/preflight.cjs',
      '-r',
      '/y.cjs',
      '--loader',
      'l.mjs',
      '--experimental-loader=m.mjs',
      '-C',
      'rai-source',
      '--conditions',
      'rai-source',
    ],
  );
  assert.deepEqual(workerEntryFor(pathToFileURL('/a/client.ts').href, []).loaderFlags, ['--import', 'tsx']);
});

test('the permission model applies to a JavaScript entry, reading only its directory and ancestor package.json files', () => {
  assert.deepEqual(permissionFlagsFor('/srv/app/dist/qc/extraction/worker/main.js'), [
    '--permission',
    '--allow-fs-read=/srv/app/dist/qc/extraction/worker',
    '--allow-fs-read=/srv/app/dist/qc/extraction/worker/package.json',
    '--allow-fs-read=/srv/app/dist/qc/extraction/package.json',
    '--allow-fs-read=/srv/app/dist/qc/package.json',
    '--allow-fs-read=/srv/app/dist/package.json',
    '--allow-fs-read=/srv/app/package.json',
    '--allow-fs-read=/srv/package.json',
    '--allow-fs-read=/package.json',
  ]);
  assert.deepEqual(
    permissionFlagsFor('/srv/app/src/qc/extraction/worker/main.ts'),
    [],
    'tsx needs threads and a process',
  );
});

test('a missing worker entry is a crash on every call and a false selfTest, never a refusal to start', async () => {
  const worker = extractor({}, { entry: path.join(HERE, 'test-workers', 'missing.mjs') });
  assert.equal(failure(await worker.extract({ mediaType: PDF, bytes: BYTES }, never())), 'crash');
  assert.equal(await worker.selfTest(), false);
});
