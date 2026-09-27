// W4-09a done-when: `fixtures:eval:generate` is deterministic (the same bytes twice), writes only into the
// gitignored output directory, and checks every document against the committed manifest (W4b plan section 11.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FIXTURES_PACKAGE_ROOT } from '../manifest.js';
import { EVAL_CASES } from './cases.js';
import {
  DEFAULT_EVAL_OUTPUT_DIR,
  EvalManifestMismatch,
  assertEvalManifestMatches,
  computeEvalSetHash,
  evalManifestFromGenerated,
  evalOutputPath,
  evalSetLabel,
  generateEvalSet,
  listEvalSourceFiles,
  readEvalManifest,
  writeEvalSet,
} from './generate.js';

const generated = generateEvalSet();
const manifest = readEvalManifest();

function tree(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(path.relative(root, full), readFileSync(full));
    }
  };
  walk(root);
  return out;
}

function assertSameTree(a: Map<string, Buffer>, b: Map<string, Buffer>): void {
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [rel, bytes] of a) assert.ok(bytes.equals(b.get(rel)!), rel);
}

test(`${evalSetLabel(manifest)}: every document's SHA-256, size and row equal the manifest, and the set hash is current`, () => {
  assert.equal(manifest.name, 'qc-eval-synthetic');
  assert.equal(manifest.version, '1');
  assert.deepEqual(manifest.split, ['dev']);
  assert.equal(Object.keys(manifest.documents).length, generated.length);
  assert.equal(
    manifest.sha256,
    computeEvalSetHash(manifest.documents),
    'run fixtures:eval:generate -- --write-manifest',
  );
  assert.doesNotThrow(() => assertEvalManifestMatches(manifest, generated));
});

test('the set hash covers the case rows, the renderers and the labels, never the manifest or a test', () => {
  const files = listEvalSourceFiles();
  for (const f of [
    'cases.ts',
    'render.ts',
    'vocabulary.ts',
    'types.ts',
    'README.md',
    'labels/ev-dev-01.json',
  ])
    assert.ok(files.includes(f), f);
  assert.ok(!files.includes('manifest.json'));
  assert.ok(files.every((f) => !f.endsWith('.test.ts')));
});

test('generation is deterministic in memory: a second run yields identical bytes', () => {
  const again = generateEvalSet();
  assert.equal(again.length, generated.length);
  generated.forEach((g, i) => {
    assert.equal(again[i]!.document.documentId, g.document.documentId);
    assert.ok(again[i]!.document.bytes.equals(g.document.bytes), g.document.documentId);
  });
});

test('generation is deterministic on disk: two writes give the same tree, laid out by set, split, case and slot', async () => {
  const a = mkdtempSync(path.join(tmpdir(), 'rai-eval-a-'));
  const b = mkdtempSync(path.join(tmpdir(), 'rai-eval-b-'));
  try {
    await writeEvalSet(generateEvalSet(), manifest, a);
    await writeEvalSet(generateEvalSet(), manifest, b);
    const ta = tree(a);
    assertSameTree(ta, tree(b));
    const g = generated.find((x) => x.document.documentId === 'ev-dev-01-s1')!;
    assert.equal(
      path.relative(a, evalOutputPath(a, g)),
      path.join('qc-eval-synthetic@1', 'dev', 'ev-dev-01', 'slot-1', g.document.filename),
    );
    assert.equal(ta.size, generated.length + 1, 'every document plus the manifest copy');
    assert.ok(ta.has(path.join('qc-eval-synthetic@1', 'manifest.json')));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('the CLI writes the same bytes twice and prints the set identity', () => {
  const run = (out: string): string => {
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions=rai-source',
        path.join('src', 'evaluation', 'generate.ts'),
        '--out',
        out,
      ],
      { cwd: FIXTURES_PACKAGE_ROOT, encoding: 'utf8', env: { ...process.env } },
    );
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const a = mkdtempSync(path.join(tmpdir(), 'rai-eval-cli-a-'));
  const b = mkdtempSync(path.join(tmpdir(), 'rai-eval-cli-b-'));
  try {
    const out = run(a);
    run(b);
    assertSameTree(tree(a), tree(b));
    assert.ok(out.includes(evalSetLabel(manifest)), out);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('the default output directory is rai-web/.local/eval-fixtures (gitignored; no bytes are committed)', () => {
  assert.equal(DEFAULT_EVAL_OUTPUT_DIR, path.resolve(FIXTURES_PACKAGE_ROOT, '..', '.local', 'eval-fixtures'));
});

test('a stale manifest is detected: a changed digest, a missing row and a changed set hash are each reported', () => {
  const stale = structuredClone(manifest);
  stale.documents['ev-dev-01-s1']!.sha256 = '0'.repeat(64);
  delete stale.documents['ev-dev-26-s5'];
  stale.sha256 = '1'.repeat(64);
  assert.throws(
    () => assertEvalManifestMatches(stale, generated),
    (err: unknown) =>
      err instanceof EvalManifestMismatch &&
      err.differences.some((d) => d.startsWith('ev-dev-01-s1:')) &&
      err.differences.some((d) => d.startsWith('ev-dev-26-s5:')) &&
      err.differences.some((d) => d.startsWith('set sha256:')),
  );
});

test('the manifest rows carry the case, split, slot, format and media type of every attached document', () => {
  const fresh = evalManifestFromGenerated(generated);
  for (const c of EVAL_CASES)
    for (const s of c.slots) {
      if (s.disposition !== 'attached') continue;
      const row = fresh.documents[s.document.documentId];
      assert.ok(row, s.document.documentId);
      assert.equal(row.caseId, c.caseId);
      assert.equal(row.split, c.split);
      assert.equal(row.slot, s.slot);
      assert.equal(row.format, s.document.format);
      assert.equal(row.filename, s.document.filename);
    }
});
