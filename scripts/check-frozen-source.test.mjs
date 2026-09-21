// Tests for scripts/check-frozen-source.mjs (W1-12 Done when: a deliberately altered copy of the source snapshot
// fails the hash check). Run from the repository root: node --test scripts/*.test.mjs. Zero dependencies.
// The committed snapshot is never edited; every negative case works on a copy in a temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFrozenSource, parseProvenanceRows, sha256Of, REPO_ROOT } from './check-frozen-source.mjs';

const script = fileURLToPath(new URL('./check-frozen-source.mjs', import.meta.url));

function run(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

/** Copies the committed snapshot and provenance document into a scratch tree and returns its paths. */
function scratchCopy() {
  const root = mkdtempSync(path.join(tmpdir(), 'rai-frozen-source-'));
  mkdirSync(path.join(root, 'docs', 'product'), { recursive: true });
  const file = path.join(root, 'docs', 'product', 'source-spec.md');
  const sources = path.join(root, 'docs', 'sources.md');
  writeFileSync(file, readFileSync(path.join(REPO_ROOT, 'docs', 'product', 'source-spec.md')));
  writeFileSync(sources, readFileSync(path.join(REPO_ROOT, 'docs', 'sources.md')));
  return { root, file, sources, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('the committed snapshot matches the hash docs/sources.md records for the first source', () => {
  const result = run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^check-frozen-source: docs\/product\/source-spec\.md sha256 [0-9a-f]{64} matches docs\/sources\.md row 1/);
});

test('the expected hash comes from docs/sources.md, not from a literal in the script', () => {
  const scriptText = readFileSync(script, 'utf8');
  const rows = parseProvenanceRows(readFileSync(path.join(REPO_ROOT, 'docs', 'sources.md'), 'utf8'));
  assert.ok(rows.length >= 1);
  for (const row of rows) assert.ok(!scriptText.includes(row.sha256), `script must not embed ${row.sha256}`);
});

test('a deliberately altered copy of the snapshot fails with exit 1 and names the file', () => {
  const copy = scratchCopy();
  try {
    const original = readFileSync(copy.file);
    const altered = Buffer.concat([original, Buffer.from('\n<!-- one appended byte sequence -->\n')]);
    assert.notEqual(sha256Of(altered), sha256Of(original));
    writeFileSync(copy.file, altered);
    const result = run(['--file', copy.file, '--sources', copy.sources]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /has changed/);
    assert.match(result.stderr, /expected [0-9a-f]{64}/);
    assert.match(result.stderr, /actual {3}[0-9a-f]{64}/);
    assert.equal(result.stdout, '');
  } finally {
    copy.cleanup();
  }
});

test('a single flipped byte in the middle of the snapshot is detected', () => {
  const copy = scratchCopy();
  try {
    const bytes = Buffer.from(readFileSync(copy.file));
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = bytes[middle] === 0x61 ? 0x62 : 0x61; // 'a' → 'b' or anything → 'a'
    writeFileSync(copy.file, bytes);
    const result = checkFrozenSource({ file: copy.file, sources: copy.sources });
    assert.equal(result.ok, false);
    assert.match(result.message, /has changed/);
  } finally {
    copy.cleanup();
  }
});

test('an unaltered copy passes when the provenance document is the committed one', () => {
  const copy = scratchCopy();
  try {
    const result = checkFrozenSource({ file: copy.file, sources: copy.sources });
    assert.equal(result.ok, true, result.message);
  } finally {
    copy.cleanup();
  }
});

test('a provenance document without the hash row fails instead of passing vacuously', () => {
  const copy = scratchCopy();
  try {
    const provenance = readFileSync(copy.sources, 'utf8')
      .split('\n')
      .filter((line) => !/[0-9a-f]{64}/.test(line))
      .join('\n');
    writeFileSync(copy.sources, provenance);
    const result = run(['--file', copy.file, '--sources', copy.sources]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /0 hash row\(s\); row 1 is missing/);
  } finally {
    copy.cleanup();
  }
});

test('a missing snapshot file fails', () => {
  const result = checkFrozenSource({ file: 'docs/product/does-not-exist.md' });
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot read docs\/product\/does-not-exist\.md/);
});

test('parseProvenanceRows reads every 64-hex row and ignores the header and prose', () => {
  const rows = parseProvenanceRows(
    ['| Source | SHA-256 | State |', '|---|---|---|', '| `a.md` | `' + 'a'.repeat(64) + '` | Clean |', '| `b.md` | not-a-hash | Clean |', 'prose | with | pipes'].join('\n'),
  );
  assert.deepEqual(rows, [{ source: 'a.md', sha256: 'a'.repeat(64) }]);
});

test('an unknown argument exits 2', () => {
  const result = run(['--bogus']);
  assert.equal(result.status, 2);
});
