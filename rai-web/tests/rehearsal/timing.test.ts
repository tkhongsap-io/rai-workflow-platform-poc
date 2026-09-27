// W7-10 unit tests for the rehearsal step timer (W7 plan section 9 row W7-10, section 2 `REHEARSAL_OUT_DIR`,
// W7-D18). Every test writes under a temporary stand-in for rai-web/, never under the real rai-web/.local/.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RAI_WEB_ROOT,
  RehearsalConfigError,
  TIMING_CSV_COLUMNS,
  TimingError,
  createStepTimer,
  resolveRehearsalOutDir,
  type TimingsFile,
} from './timing.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'rai-w7-10-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A fresh stand-in for `<repo>/rai-web` with its `.local/` directory. */
function fakeRaiWeb(): string {
  counter += 1;
  const root = path.join(scratch, `repo-${counter}`, 'rai-web');
  mkdirSync(path.join(root, '.local'), { recursive: true });
  return root;
}

/** A clock that advances by the given steps (ms) on each call, from 2026-09-28T01:00:00.000Z. */
function steppingClock(stepsMs: number[]): () => Date {
  let t = Date.parse('2026-09-28T01:00:00.000Z');
  let i = 0;
  return () => {
    const now = new Date(t);
    t += stepsMs[i % stepsMs.length] ?? 0;
    i += 1;
    return now;
  };
}

const refusedDir = (fn: () => unknown) =>
  assert.throws(
    fn,
    (err: unknown) => err instanceof RehearsalConfigError && err.code === 'invalid:REHEARSAL_OUT_DIR',
  );

test('RAI_WEB_ROOT is this rai-web directory', () => {
  assert.equal(RAI_WEB_ROOT, path.resolve(HERE, '..', '..'));
  assert.ok(existsSync(path.join(RAI_WEB_ROOT, 'package.json')));
});

test('unset or blank REHEARSAL_OUT_DIR defaults to rai-web/.local/rehearsal', () => {
  assert.equal(resolveRehearsalOutDir({}), path.join(RAI_WEB_ROOT, '.local', 'rehearsal'));
  assert.equal(
    resolveRehearsalOutDir({ REHEARSAL_OUT_DIR: '  ' }),
    path.join(RAI_WEB_ROOT, '.local', 'rehearsal'),
  );
  const root = fakeRaiWeb();
  assert.equal(resolveRehearsalOutDir({}, { raiWebRoot: root }), path.join(root, '.local', 'rehearsal'));
});

test('a relative REHEARSAL_OUT_DIR resolves against the working directory; absolute paths are kept', () => {
  const root = fakeRaiWeb();
  assert.equal(
    resolveRehearsalOutDir({ REHEARSAL_OUT_DIR: './.local/rehearsal-b' }, { raiWebRoot: root, cwd: root }),
    path.join(root, '.local', 'rehearsal-b'),
  );
  assert.equal(
    resolveRehearsalOutDir(
      { REHEARSAL_OUT_DIR: 'runs' },
      { raiWebRoot: root, cwd: path.join(root, '.local') },
    ),
    path.join(root, '.local', 'runs'),
  );
  const abs = path.join(root, '.local', 'x', 'y');
  assert.equal(resolveRehearsalOutDir({ REHEARSAL_OUT_DIR: abs }, { raiWebRoot: root, cwd: '/' }), abs);
});

test('REHEARSAL_OUT_DIR outside rai-web/.local/ is refused, inside or outside the repository', () => {
  const root = fakeRaiWeb();
  const repo = path.dirname(root);
  for (const value of [
    repo,
    root,
    path.join(root, '.local'),
    path.join(root, '.local', '..', 'rehearsal'),
    path.join(root, '.localx', 'rehearsal'),
    path.join(root, 'tests', 'rehearsal'),
    path.join(repo, 'docs', 'rehearsal'),
    path.join(repo, '.local', 'rehearsal'),
    path.join(scratch, 'elsewhere'),
    '/tmp/rehearsal',
  ]) {
    refusedDir(() => resolveRehearsalOutDir({ REHEARSAL_OUT_DIR: value }, { raiWebRoot: root, cwd: root }));
    refusedDir(() =>
      createStepTimer('run-1', { env: { REHEARSAL_OUT_DIR: value }, raiWebRoot: root, cwd: root }),
    );
  }
  refusedDir(() =>
    resolveRehearsalOutDir({ REHEARSAL_OUT_DIR: '../outside' }, { raiWebRoot: root, cwd: root }),
  );
});

test('invalid run IDs are refused before anything is written', () => {
  const root = fakeRaiWeb();
  for (const runId of [
    '',
    '.',
    '..',
    '../x',
    'a/b',
    'a\\b',
    '-lead',
    '.hidden',
    'x'.repeat(65),
    'sp ace',
    'ümlaut',
  ]) {
    assert.throws(
      () => createStepTimer(runId, { raiWebRoot: root }),
      (err: unknown) => err instanceof RehearsalConfigError && err.code === 'invalid:runId',
      runId,
    );
  }
  assert.equal(existsSync(path.join(root, '.local', 'rehearsal')), false);
  createStepTimer('2026-09-28T0100Z_dress.1', { raiWebRoot: root });
  createStepTimer('x'.repeat(64), { raiWebRoot: root });
});

test('a run directory reached through a symlink out of rai-web/.local/ is refused', () => {
  const root = fakeRaiWeb();
  const outside = path.join(scratch, `escape-${counter}`);
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, path.join(root, '.local', 'rehearsal'));
  refusedDir(() => createStepTimer('run-1', { raiWebRoot: root }));
  assert.deepEqual(readdirSync(outside), [], 'nothing is created through the symlink');
});

test('each end() writes timings.json and timings.csv under <out>/<runId>/ with an injected clock', () => {
  const root = fakeRaiWeb();
  // now() calls: create, start a, end a (+1500), start b, end b (+250)
  const timer = createStepTimer('run-a', { raiWebRoot: root, now: steppingClock([0, 1500, 0, 250, 0]) });
  assert.equal(timer.runId, 'run-a');
  assert.equal(timer.dir, path.join(root, '.local', 'rehearsal', 'run-a'));
  timer.start('G1.sign-in', { section: 'Sign-in' });
  const a = timer.end('G1.sign-in');
  assert.deepEqual(a, {
    stepId: 'G1.sign-in',
    section: 'Sign-in',
    startedAt: '2026-09-28T01:00:00.000Z',
    endedAt: '2026-09-28T01:00:01.500Z',
    durationMs: 1500,
    outcome: 'completed',
    note: '',
  });
  const afterOne = JSON.parse(readFileSync(path.join(timer.dir, 'timings.json'), 'utf8')) as TimingsFile;
  assert.equal(afterOne.steps.length, 1);

  timer.start('G2.queue');
  timer.end('G2.queue', { outcome: 'failed', note: 'queue empty' });

  const file = JSON.parse(readFileSync(path.join(timer.dir, 'timings.json'), 'utf8')) as TimingsFile;
  assert.deepEqual(file, {
    runId: 'run-a',
    startedAt: '2026-09-28T01:00:00.000Z',
    updatedAt: '2026-09-28T01:00:01.750Z',
    steps: [
      a,
      {
        stepId: 'G2.queue',
        section: '',
        startedAt: '2026-09-28T01:00:01.500Z',
        endedAt: '2026-09-28T01:00:01.750Z',
        durationMs: 250,
        outcome: 'failed',
        note: 'queue empty',
      },
    ],
  });
  assert.deepEqual(timer.entries(), file.steps);

  const csv = readFileSync(path.join(timer.dir, 'timings.csv'), 'utf8');
  assert.equal(
    csv,
    [
      'run_id,step_id,section,started_at,ended_at,duration_ms,outcome,note',
      'run-a,G1.sign-in,Sign-in,2026-09-28T01:00:00.000Z,2026-09-28T01:00:01.500Z,1500,completed,',
      'run-a,G2.queue,,2026-09-28T01:00:01.500Z,2026-09-28T01:00:01.750Z,250,failed,queue empty',
      '',
    ].join('\r\n'),
  );
});

test('CSV cells are RFC 4180 quoted and formula-like text is neutralised', () => {
  const root = fakeRaiWeb();
  const timer = createStepTimer('run-csv', { raiWebRoot: root, now: steppingClock([0]) });
  const notes = ['a, b', 'say "hi"', 'line1\nline2', '=SUM(A1)', '+1', '-2', '@cmd', 'plain'];
  notes.forEach((note, i) => {
    timer.start(`s${i}`, { section: i === 0 ? '=section' : 'S' });
    timer.end(`s${i}`, { note });
  });
  const rows = readFileSync(path.join(timer.dir, 'timings.csv'), 'utf8').split('\r\n');
  assert.equal(rows[0], TIMING_CSV_COLUMNS.join(','));
  assert.ok(rows[1]?.startsWith("run-csv,s0,'=section,"), rows[1]);
  assert.ok(rows[1]?.endsWith(',completed,"a, b"'), rows[1]);
  assert.ok(rows[2]?.endsWith(',completed,"say ""hi"""'), rows[2]);
  assert.ok(rows[3]?.endsWith(',completed,"line1\nline2"'), rows[3]);
  assert.ok(rows[4]?.endsWith(",completed,'=SUM(A1)"), rows[4]);
  assert.ok(rows[5]?.endsWith(",completed,'+1"), rows[5]);
  assert.ok(rows[6]?.endsWith(",completed,'-2"), rows[6]);
  assert.ok(rows[7]?.endsWith(",completed,'@cmd"), rows[7]);
  assert.ok(rows[8]?.endsWith(',completed,plain'), rows[8]);
  // duration stays a plain number, never prefixed
  assert.match(rows[1] ?? '', /,0,completed,/);
  // JSON keeps the original text
  assert.equal(timer.entries()[3]?.note, '=SUM(A1)');
});

test('time() records completed or failed and passes the result or the error through', async () => {
  const root = fakeRaiWeb();
  const timer = createStepTimer('run-t', { raiWebRoot: root, now: steppingClock([0, 40, 0, 7, 0]) });
  const value = await timer.time('ok', () => Promise.resolve(42), { section: 'A' });
  assert.equal(value, 42);
  const boom = new Error('synthetic failure');
  await assert.rejects(
    timer.time('bad', () => Promise.reject(boom)),
    (err: unknown) => err === boom,
  );
  const [ok, bad] = timer.entries();
  assert.equal(ok?.outcome, 'completed');
  assert.equal(ok?.durationMs, 40);
  assert.equal(bad?.outcome, 'failed');
  assert.equal(bad?.durationMs, 7);
  assert.equal(bad?.note, 'synthetic failure');
  const file = JSON.parse(readFileSync(path.join(timer.dir, 'timings.json'), 'utf8')) as TimingsFile;
  assert.equal(file.steps.length, 2);
});

test('skipped outcome, and step-state errors', () => {
  const root = fakeRaiWeb();
  const timer = createStepTimer('run-s', { raiWebRoot: root, now: steppingClock([0]) });
  const isTimingError = (err: unknown) => err instanceof TimingError;
  assert.throws(() => timer.start(''), isTimingError);
  assert.throws(() => timer.end('never-started'), isTimingError);
  timer.start('x');
  assert.throws(() => timer.start('x'), isTimingError);
  assert.equal(
    timer.end('x', { outcome: 'skipped', note: 'not reachable in fixture mode' }).outcome,
    'skipped',
  );
  assert.throws(() => timer.end('x'), isTimingError);
  // a step ID may be timed again once ended (a retried step is a second row)
  timer.start('x');
  timer.end('x');
  assert.equal(timer.entries().length, 2);
});

test('a clock that goes backwards never yields a negative duration', () => {
  const root = fakeRaiWeb();
  const timer = createStepTimer('run-b', { raiWebRoot: root, now: steppingClock([0, -500, 0]) });
  timer.start('x');
  assert.equal(timer.end('x').durationMs, 0);
});

test('a run that stops mid-way keeps every ended step on disk; an open step is not written', () => {
  const root = fakeRaiWeb();
  const timer = createStepTimer('run-p', { raiWebRoot: root, now: steppingClock([0, 10, 0]) });
  timer.start('done');
  timer.end('done');
  timer.start('open');
  const file = JSON.parse(readFileSync(path.join(timer.dir, 'timings.json'), 'utf8')) as TimingsFile;
  assert.deepEqual(
    file.steps.map((s) => s.stepId),
    ['done'],
  );
  assert.equal(readFileSync(path.join(timer.dir, 'timings.csv'), 'utf8').split('\r\n').length, 3);
});

test('the timing-sheet template has exactly the timings.csv columns', () => {
  const template = readFileSync(
    path.join(RAI_WEB_ROOT, '..', 'docs', 'operations', 'rehearsal', 'timing-sheet-template.md'),
    'utf8',
  );
  const header = template.split('\n').find((line) => line.startsWith('| run_id'));
  assert.ok(header, 'timing sheet table header');
  const cells = header
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '');
  assert.deepEqual(cells, [...TIMING_CSV_COLUMNS]);
});
