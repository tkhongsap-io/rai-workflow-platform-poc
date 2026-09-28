// W4-08a (W4b plan section 16): `npm run eval:qc -- --split dev [--out <dir>]`. The gate and the stale check are W4-08b.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_REPORT_ROOT, UsageError, parseArgs } from './run.js';

test('parseArgs defaults to the dev split under rai-web/.local/eval', () => {
  assert.deepEqual(parseArgs([]), { split: 'dev', out: path.join(DEFAULT_REPORT_ROOT, 'dev') });
  assert.ok(DEFAULT_REPORT_ROOT.endsWith(path.join('rai-web', '.local', 'eval')), DEFAULT_REPORT_ROOT);
  assert.deepEqual(parseArgs(['--split', 'dev', '--out', 'some/dir']), {
    split: 'dev',
    out: path.resolve('some/dir'),
  });
  assert.deepEqual(parseArgs(['--split', 'heldout']), {
    split: 'heldout',
    out: path.join(DEFAULT_REPORT_ROOT, 'heldout'),
  });
});

test('parseArgs refuses the W4-08b flags, unknown arguments and missing values', () => {
  assert.throws(
    () => parseArgs(['--gate']),
    (e: unknown) => e instanceof UsageError && /W4-08b/.test(e.message),
  );
  assert.throws(
    () => parseArgs(['--verify', 'report.json']),
    (e: unknown) => e instanceof UsageError && /W4-08b/.test(e.message),
  );
  assert.throws(() => parseArgs(['--fast']), UsageError);
  assert.throws(() => parseArgs(['dev']), UsageError);
  assert.throws(() => parseArgs(['--split']), UsageError);
  assert.throws(() => parseArgs(['--out']), UsageError);
});
