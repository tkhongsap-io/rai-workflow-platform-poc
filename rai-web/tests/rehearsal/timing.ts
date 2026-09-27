// W7-10 rehearsal step timer (W7 plan section 9 row W7-10; section 2 `REHEARSAL_OUT_DIR`; W7-D18).
//
// Test support, not product code: the scripted rehearsal (W7-12) and the loader (W7-11) import it; the server never
// does. `createStepTimer(runId)` records each rehearsal step's start, end, duration and outcome and rewrites
// `timings.json` and `timings.csv` under `REHEARSAL_OUT_DIR/<runId>/` after every ended step, so a run that stops
// mid-way keeps what it measured. The directory must be strictly inside rai-web/.local/ (gitignored): rehearsal
// outputs never enter Git, and a real rehearsal's contents never do (BUILD_PLAN W7). The CSV columns are the ones
// the timing-sheet template (docs/operations/rehearsal/timing-sheet-template.md) uses; a unit test keeps them equal.
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's rai-web/ directory (tests/rehearsal/ is two levels below it). */
export const RAI_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TIMING_CSV_COLUMNS = [
  'run_id',
  'step_id',
  'section',
  'started_at',
  'ended_at',
  'duration_ms',
  'outcome',
  'note',
] as const;

export type StepOutcome = 'completed' | 'failed' | 'skipped';

export interface StepTiming {
  stepId: string;
  section: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: StepOutcome;
  note: string;
}

export interface TimingsFile {
  runId: string;
  startedAt: string;
  updatedAt: string;
  steps: StepTiming[];
}

export interface StepTimer {
  readonly runId: string;
  /** Absolute run directory, `<REHEARSAL_OUT_DIR>/<runId>`. */
  readonly dir: string;
  start(stepId: string, options?: { section?: string }): void;
  end(stepId: string, options?: { outcome?: StepOutcome; note?: string }): StepTiming;
  /** Times `fn` as one step: `completed` when it resolves, `failed` (note = error message) when it throws. */
  time<T>(stepId: string, fn: () => T | Promise<T>, options?: { section?: string }): Promise<T>;
  entries(): readonly StepTiming[];
}

/** A refused directory or run ID. Codes: `invalid:REHEARSAL_OUT_DIR`, `invalid:runId`. */
export class RehearsalConfigError extends Error {
  constructor(readonly code: 'invalid:REHEARSAL_OUT_DIR' | 'invalid:runId') {
    super(code);
    this.name = 'RehearsalConfigError';
  }
}

/** Misuse of the timer: an empty step ID, a step started twice or ended without being started. */
export class TimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimingError';
  }
}

export interface Where {
  /** Working directory a relative `REHEARSAL_OUT_DIR` resolves against. Default `process.cwd()`. */
  cwd?: string;
  /** The rai-web/ directory whose `.local/` bounds the output. Default {@link RAI_WEB_ROOT}; tests pass a stand-in. */
  raiWebRoot?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isStrictlyInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * `REHEARSAL_OUT_DIR` resolved: unset or blank → `<rai-web>/.local/rehearsal`; otherwise against the working
 * directory. Refused (`invalid:REHEARSAL_OUT_DIR`) unless strictly inside `<rai-web>/.local/`. Pure: no I/O.
 */
export function resolveRehearsalOutDir(env: Env, where: Where = {}): string {
  const raiWebRoot = path.resolve(where.raiWebRoot ?? RAI_WEB_ROOT);
  const local = path.join(raiWebRoot, '.local');
  const value = env.REHEARSAL_OUT_DIR?.trim();
  const outDir =
    value === undefined || value === ''
      ? path.join(local, 'rehearsal')
      : path.resolve(where.cwd ?? process.cwd(), value);
  if (!isStrictlyInside(local, outDir)) throw new RehearsalConfigError('invalid:REHEARSAL_OUT_DIR');
  return outDir;
}

/** The nearest existing ancestor of `p` (or `p` itself), resolved through symlinks. */
function realExistingAncestor(p: string): string {
  let current = p;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(realpathSync(current), path.relative(current, p));
}

/** Refuses a run directory that a symlink would carry out of `<rai-web>/.local/`. */
function assertRealInside(local: string, dir: string): void {
  const realLocal = existsSync(local) ? realpathSync(local) : local;
  if (!isStrictlyInside(realLocal, realExistingAncestor(dir)))
    throw new RehearsalConfigError('invalid:REHEARSAL_OUT_DIR');
}

const FORMULA_START = /^[=+\-@]/;

function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(runId: string, steps: readonly StepTiming[]): string {
  const rows = [TIMING_CSV_COLUMNS.join(',')];
  for (const s of steps) {
    rows.push(
      [runId, s.stepId, s.section, s.startedAt, s.endedAt, s.durationMs, s.outcome, s.note]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.map((row) => `${row}\r\n`).join('');
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * A step timer for one rehearsal run. Refuses an invalid run ID or a directory outside `<rai-web>/.local/`
 * (lexically, and through symlinks) before creating anything; then creates `<REHEARSAL_OUT_DIR>/<runId>/`.
 */
export function createStepTimer(
  runId: string,
  options: Where & { env?: Env; now?: () => Date } = {},
): StepTimer {
  if (!RUN_ID.test(runId)) throw new RehearsalConfigError('invalid:runId');
  const raiWebRoot = path.resolve(options.raiWebRoot ?? RAI_WEB_ROOT);
  const outDir = resolveRehearsalOutDir(options.env ?? process.env, { ...options, raiWebRoot });
  const local = path.join(raiWebRoot, '.local');
  const dir = path.join(outDir, runId);
  assertRealInside(local, dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertRealInside(local, dir);

  const now = options.now ?? (() => new Date());
  const runStartedAt = now().toISOString();
  const open = new Map<string, { section: string; startedAt: Date }>();
  const steps: StepTiming[] = [];

  const flush = (updatedAt: string) => {
    const file: TimingsFile = { runId, startedAt: runStartedAt, updatedAt, steps };
    writeAtomic(path.join(dir, 'timings.json'), `${JSON.stringify(file, null, 2)}\n`);
    writeAtomic(path.join(dir, 'timings.csv'), toCsv(runId, steps));
  };

  const timer: StepTimer = {
    runId,
    dir,
    start(stepId, opts = {}) {
      if (stepId.trim() === '') throw new TimingError('step ID is empty');
      if (open.has(stepId)) throw new TimingError(`step ${stepId} is already running`);
      open.set(stepId, { section: opts.section ?? '', startedAt: now() });
    },
    end(stepId, opts = {}) {
      const running = open.get(stepId);
      if (running === undefined) throw new TimingError(`step ${stepId} was not started`);
      open.delete(stepId);
      const endedAt = now();
      const entry: StepTiming = {
        stepId,
        section: running.section,
        startedAt: running.startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: Math.max(0, Math.round(endedAt.getTime() - running.startedAt.getTime())),
        outcome: opts.outcome ?? 'completed',
        note: opts.note ?? '',
      };
      steps.push(entry);
      flush(entry.endedAt);
      return entry;
    },
    async time(stepId, fn, opts = {}) {
      timer.start(stepId, opts);
      let result: Awaited<ReturnType<typeof fn>>;
      try {
        result = await fn();
      } catch (err) {
        timer.end(stepId, { outcome: 'failed', note: err instanceof Error ? err.message : String(err) });
        throw err;
      }
      timer.end(stepId);
      return result;
    },
    entries: () => steps.map((s) => ({ ...s })),
  };
  return timer;
}
