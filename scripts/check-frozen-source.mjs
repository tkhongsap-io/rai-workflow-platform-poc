#!/usr/bin/env node
// Frozen-source hash check (W0-02 plan, section 6 row 8; ticket W1-12). Zero dependencies; Node 18 or later.
//
// Reads the SHA-256 that docs/sources.md records for the first source (the row the source specification is a
// byte-identical snapshot of), hashes docs/product/source-spec.md and compares the two. The expected value is
// never a second literal in this script: docs/sources.md is the only place that states it, and
// tests/source.test.mjs keeps its own literal check separately.
//
// Usage: node scripts/check-frozen-source.mjs [--file <path>] [--sources <path>] [--row <n>]
//   --file      the frozen snapshot (default docs/product/source-spec.md)
//   --sources   the provenance document holding the hash table (default docs/sources.md)
//   --row       1-based data row of the provenance table to compare against (default 1, the first source)
// Paths are relative to the repository root (the parent of scripts/) unless absolute.
// Exit 0 when the hashes match; exit 1 on a mismatch, a missing file or a provenance table without the row.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_FILE = 'docs/product/source-spec.md';
export const DEFAULT_SOURCES = 'docs/sources.md';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Parses the provenance table: every row whose second cell is a 64-hex SHA-256. Pure. */
export function parseProvenanceRows(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length < 2 || !SHA256_HEX.test(cells[1])) continue;
    rows.push({ source: cells[0], sha256: cells[1] });
  }
  return rows;
}

export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Runs the check and returns { ok, message }. No process exit, so tests can call it in-process too. */
export function checkFrozenSource({ file = DEFAULT_FILE, sources = DEFAULT_SOURCES, row = 1, root = REPO_ROOT } = {}) {
  const filePath = path.resolve(root, file);
  const sourcesPath = path.resolve(root, sources);
  let provenance;
  try {
    provenance = readFileSync(sourcesPath, 'utf8');
  } catch {
    return { ok: false, message: `check-frozen-source: cannot read provenance ${sources}` };
  }
  const rows = parseProvenanceRows(provenance);
  const expected = rows[row - 1];
  if (expected === undefined) {
    return {
      ok: false,
      message: `check-frozen-source: ${sources} has ${rows.length} hash row(s); row ${row} is missing`,
    };
  }
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return { ok: false, message: `check-frozen-source: cannot read ${file}` };
  }
  const actual = sha256Of(bytes);
  if (actual !== expected.sha256) {
    return {
      ok: false,
      message:
        `check-frozen-source: ${file} has changed\n` +
        `  expected ${expected.sha256} (${sources} row ${row}: ${expected.source})\n` +
        `  actual   ${actual}\n` +
        '  The frozen snapshot is never edited; record an approved successor and its provenance instead (AGENTS.md).',
    };
  }
  return {
    ok: true,
    message: `check-frozen-source: ${file} sha256 ${actual} matches ${sources} row ${row} (${expected.source})`,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--file' && value) options.file = argv[(i += 1)];
    else if (arg === '--sources' && value) options.sources = argv[(i += 1)];
    else if (arg === '--row' && value) options.row = Number.parseInt(argv[(i += 1)], 10);
    else {
      console.error(`check-frozen-source: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  if (options.row !== undefined && (!Number.isInteger(options.row) || options.row < 1)) {
    console.error('check-frozen-source: --row must be a positive integer');
    process.exit(2);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkFrozenSource(parseArgs(process.argv.slice(2)));
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}
