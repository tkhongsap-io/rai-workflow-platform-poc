// `npm run eval:qc -- --split dev [--out <dir>]` (W4b plan sections 11.2 and 16; W4-08a): runs both QC run parts of
// every labelled trigger of one split of `qc-eval-synthetic@1` in process, without a database, over the real forking
// extraction worker; grades them against the labels; writes `report.json` and `report.md` (identities, hashes,
// locators and counts; no document text) to `--out` (default rai-web/.local/eval/<split>/, gitignored); and prints the
// summary. `--gate` (threshold check) and `--verify <report.json>` (stale check) arrive with W4-08b. No network call,
// no model: `QC_MODEL` is disabled until W4-07a.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { createWorkerExtractor } from '@rai/server/qc/extraction/client';
import type { ExtractionLimits } from '@rai/server/qc/extraction/limits';
import { gradeRun } from './grade.js';
import { catalogueRulesOf, runEvalSet } from './harness.js';
import { RAI_WEB_ROOT, buildIdentity, codeIdentity } from './identity.js';
import { loadEvalSet } from './load-set.js';
import { buildReport, summaryLines, writeReport } from './report.js';

export const DEFAULT_REPORT_ROOT = path.join(RAI_WEB_ROOT, '.local', 'eval');

/**
 * The extraction limits of `.env.example` under `QC_MODE=content` (W4b plan section 2: 4000 ms, 256 MB, 1 000 000
 * characters, concurrency 2) and the W0-08 upload cap. W4-13b reads them from `QC_EXTRACT_*`; the harness pins them
 * so a report does not depend on a local `.env`.
 */
export const EVAL_EXTRACTION_LIMITS: ExtractionLimits = Object.freeze({
  timeoutMs: 4000,
  maxMemoryMb: 256,
  maxTextChars: 1_000_000,
  maxConcurrency: 2,
  maxInputBytes: 26_214_400,
});

export class UsageError extends Error {
  constructor(message: string) {
    super(`${message}\nusage: npm run eval:qc -- [--split dev] [--out <dir>]`);
    this.name = 'UsageError';
  }
}

export interface EvalArgs {
  split: string;
  out: string;
}

export function parseArgs(argv: readonly string[]): EvalArgs {
  let split = 'dev';
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--split') split = value();
    else if (arg === '--out') out = path.resolve(value());
    else if (arg === '--gate' || arg === '--verify')
      throw new UsageError(
        `${arg} arrives with W4-08b (threshold gate and stale check); W4-08a only reports`,
      );
    else throw new UsageError(`unknown argument ${arg}`);
  }
  return { split, out: out ?? path.join(DEFAULT_REPORT_ROOT, split) };
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const set = loadEvalSet(args.split);
  const extractor = createWorkerExtractor(EVAL_EXTRACTION_LIMITS);
  const output = await runEvalSet(set, { extractor });
  const identity = buildIdentity({
    set,
    code: codeIdentity(),
    runners: output.runners,
    extractorVersion: output.extractorVersion,
    catalogue: CONFIGURATION_SEED.qc_rules,
    templateVersions: CONFIGURATION_SEED.checklist_templates.versions,
  });
  const grade = gradeRun(set, output.parts, catalogueRulesOf(CONFIGURATION_SEED.qc_rules));
  const report = buildReport(identity, grade, new Date());
  const written = await writeReport(args.out, report);
  for (const line of summaryLines(report)) console.log(line);
  console.log(
    `eval:qc: wrote ${path.relative(process.cwd(), written.json)} and ${path.relative(process.cwd(), written.md)}`,
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
}
