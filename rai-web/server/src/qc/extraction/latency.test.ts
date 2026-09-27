// W4-05b (W4b plan section 4.2, "Fork latency"): the worst W4b case is an approve attempt that reads slots 1 and 5,
// so two extractions at concurrency 2. Fork-to-reply is measured under the source layout (the worker loaded through
// `tsx`, as every test suite runs it) and under a precompiled JavaScript worker (the layout `npm run build` produces,
// transpiled here so CI's unit job measures it without a build step). Both must leave at least half of the
// 10 000 ms orchestrator deadline, and each extraction must finish inside QC_EXTRACT_TIMEOUT_MS=4000. The numbers are
// printed as test diagnostics and recorded in the W4-05b review.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createWorkerExtractor, type WorkerExtractorOptions } from './client.js';
import type { ExtractionLimits } from './limits.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEADLINE_MS = 10_000;
const LIMITS: ExtractionLimits = {
  timeoutMs: 4000,
  maxMemoryMb: 256,
  maxTextChars: 1_000_000,
  maxConcurrency: 2,
  maxInputBytes: 26_214_400,
};
const INPUTS = [
  {
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: new Uint8Array(64),
  }, // slot 1
  { mediaType: 'application/pdf', bytes: new Uint8Array(64) }, // slot 5
] as const;

async function twoSlotAttempt(t: TestContext, layout: string, options: WorkerExtractorOptions = {}) {
  const extractor = createWorkerExtractor(LIMITS, options);
  const started = performance.now();
  const each = await Promise.all(
    INPUTS.map(async (input) => {
      const from = performance.now();
      const result = await extractor.extract(input, new AbortController().signal);
      assert.deepEqual(result, { ok: false, extractorVersion: extractor.version, reason: 'unreadable' });
      return Math.round(performance.now() - from);
    }),
  );
  const total = Math.round(performance.now() - started);
  t.diagnostic(
    `fork latency (${layout}): two-slot attempt ${total} ms; per extraction ${each.join(' ms, ')} ms`,
  );
  for (const ms of each) assert.ok(ms < LIMITS.timeoutMs, `${layout}: ${ms} ms >= ${LIMITS.timeoutMs} ms`);
  assert.ok(total < DEADLINE_MS / 2, `${layout}: ${total} ms leaves less than half the deadline`);
}

test('source layout (tsx): a two-slot approve attempt leaves more than half the deadline', async (t) => {
  await twoSlotAttempt(t, 'source, tsx');
});

test('precompiled layout: a two-slot approve attempt leaves more than half the deadline', async (t) => {
  const out = mkdtempSync(path.join(tmpdir(), 'rai-w4-05b-worker-'));
  try {
    const target = path.join(out, 'worker');
    mkdirSync(target);
    for (const name of readdirSync(path.join(HERE, 'worker'))) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const source = readFileSync(path.join(HERE, 'worker', name), 'utf8');
      const { outputText } = ts.transpileModule(source, {
        fileName: name,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: true,
        },
      });
      writeFileSync(path.join(target, name.replace(/\.ts$/, '.js')), outputText);
    }
    writeFileSync(path.join(out, 'package.json'), JSON.stringify({ type: 'module' }));
    await twoSlotAttempt(t, 'precompiled JavaScript', { entry: path.join(target, 'main.js') });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
