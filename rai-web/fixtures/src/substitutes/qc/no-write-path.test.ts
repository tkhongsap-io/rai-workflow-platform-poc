// W0-07 section 3.9 "no write path to workflow state, structural": walking the substitute's module graph from its
// entry point reaches nothing under rai-web/server, no drizzle-orm, pg or fastify, no node:fs write API, no
// node:net or node:http; only rai-web/shared, the substitute's own files and (none needed) node: read-only modules.
// The walk parses import/export specifiers from the source and resolves them the way the runtime does
// (`import.meta.resolve` for bare specifiers, the same package and conditions as the substitute; URL joining for
// relative ones), so a new import that reaches a forbidden module fails this test before it reaches a review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qcDir = path.dirname(fileURLToPath(import.meta.url));
const raiWeb = path.resolve(qcDir, '../../../..');
const sharedDir = path.join(raiWeb, 'shared');
const fixturesSrc = path.join(raiWeb, 'fixtures', 'src');
const serverDir = path.join(raiWeb, 'server');
const entry = path.join(qcDir, 'index.ts');

const FORBIDDEN_PACKAGES = [
  'drizzle-orm',
  'pg',
  'fastify',
  '@rai/server',
  '@rai/fixtures',
  'openid-client',
  'typebox',
];
const FORBIDDEN_NODE_MODULES = [
  'node:fs',
  'node:fs/promises',
  'fs',
  'node:net',
  'net',
  'node:http',
  'http',
  'node:https',
  'https',
  'node:child_process',
  'child_process',
  'node:worker_threads',
  'node:dgram',
  'node:tls',
  'node:cluster',
  'node:process',
  'process',
];

/** Every static import/export specifier and dynamic import() argument in a TypeScript or JavaScript source. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, // import x from '...', import '...', import type ... from '...'
    /\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s+['"]([^'"]+)['"]/g, // export * from, export { } from
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('...')
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...') (never expected in ESM; caught anyway)
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) out.push(match[1]!);
  return out;
}

type Resolved =
  | { kind: 'node'; id: string }
  | { kind: 'file'; file: string }
  | { kind: 'bare'; id: string; file: string; thirdParty: boolean };

function resolveSpecifier(spec: string, fromFile: string): Resolved {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    // TypeScript sources import './x.js' and the runtime maps it to './x.ts' under tsx; JSON keeps its name.
    const target = new URL(spec, `file://${fromFile}`);
    let file = fileURLToPath(target);
    if (file.endsWith('.js')) file = `${file.slice(0, -3)}.ts`;
    return { kind: 'file', file };
  }
  // A bare specifier: resolve with the same conditions the substitute runs under (rai-source, from this package).
  const resolved = import.meta.resolve(spec);
  if (resolved.startsWith('node:')) return { kind: 'node', id: resolved };
  const file = fileURLToPath(resolved);
  return { kind: 'bare', id: spec, file, thirdParty: file.includes(`${path.sep}node_modules${path.sep}`) };
}

interface Edge {
  from: string;
  spec: string;
  resolved: Resolved;
}

interface Walk {
  files: Set<string>; // first-party files reached (never node_modules)
  edges: Edge[];
}

function walk(start: string): Walk {
  const result: Walk = { files: new Set(), edges: [] };
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (result.files.has(file)) continue;
    result.files.add(file);
    if (file.endsWith('.json')) continue; // data, no imports
    const source = readFileSync(file, 'utf8');
    for (const spec of specifiersOf(source)) {
      const resolved = resolveSpecifier(spec, file);
      result.edges.push({ from: file, spec, resolved });
      if (resolved.kind === 'file') queue.push(resolved.file);
      else if (resolved.kind === 'bare' && !resolved.thirdParty) queue.push(resolved.file);
    }
  }
  return result;
}

function isUnder(file: string, dir: string): boolean {
  return file.startsWith(`${dir}${path.sep}`);
}

test('structural: the substitute module graph reaches only @rai/shared and its own files', () => {
  const graph = walk(entry);
  assert.ok(graph.files.size >= 5, 'the walk covered the substitute (index, runner, scripts, version, json)');
  assert.ok(graph.files.has(path.join(qcDir, 'scripted-runner.ts')));
  assert.ok(graph.files.has(path.join(qcDir, 'scripts.ts')));
  assert.ok(
    [...graph.files].some((f) => f.endsWith('fx-case-vendor.json')),
    'bundled scripts are static imports',
  );

  for (const file of graph.files) {
    assert.ok(
      isUnder(file, sharedDir) || isUnder(file, fixturesSrc),
      `${path.relative(raiWeb, file)} is outside shared/ and fixtures/src/`,
    );
    assert.ok(!isUnder(file, serverDir), `${path.relative(raiWeb, file)} is under rai-web/server`);
    assert.ok(
      !file.includes(`${path.sep}node_modules${path.sep}`),
      `${path.relative(raiWeb, file)} is a third-party module`,
    );
    assert.ok(
      !file.endsWith('.test.ts') && !file.endsWith('test-support.ts'),
      `${file} is test code in the runtime graph`,
    );
  }
  const ownEdges = graph.edges.filter(
    (e) => isUnder(e.from, qcDir) || e.from === path.join(fixturesSrc, 'substitute-marker.ts'),
  );
  assert.ok(ownEdges.length > 0);
  for (const edge of ownEdges) {
    const where = `${path.relative(raiWeb, edge.from)} imports ${edge.spec}`;
    assert.notEqual(edge.resolved.kind, 'node', `${where}: the substitute imports no node: module`);
    if (edge.resolved.kind === 'bare') {
      assert.ok(edge.spec.startsWith('@rai/shared/'), `${where}: only @rai/shared is allowed`);
      assert.ok(
        !edge.resolved.thirdParty && isUnder(edge.resolved.file, sharedDir),
        `${where} resolved outside shared/`,
      );
    }
    for (const forbidden of FORBIDDEN_PACKAGES)
      assert.ok(!edge.spec.startsWith(forbidden), `${where} is forbidden`);
    assert.ok(
      !FORBIDDEN_NODE_MODULES.includes(edge.spec),
      `${where} is a write, network or process capability`,
    );
  }
});

test('structural: @rai/shared brings no server, database, network or filesystem module into the graph', () => {
  const graph = walk(entry);
  const sharedEdges = graph.edges.filter((e) => isUnder(e.from, sharedDir));
  assert.ok(sharedEdges.length > 0);
  for (const edge of sharedEdges) {
    const where = `${path.relative(raiWeb, edge.from)} imports ${edge.spec}`;
    assert.notEqual(edge.resolved.kind, 'node', `${where}: no node: module in the shared graph`);
    const isTypebox = edge.spec === 'typebox' || edge.spec.startsWith('typebox/'); // the pure schema library shared pins
    assert.ok(edge.resolved.kind === 'file' || isTypebox, where);
    for (const forbidden of FORBIDDEN_PACKAGES.filter((p) => p !== 'typebox'))
      assert.ok(!edge.spec.startsWith(forbidden), where);
  }
});

test('structural: no process.env, fetch, socket or filesystem-write use in the substitute sources', () => {
  const graph = walk(entry);
  const own = [...graph.files].filter((f) => isUnder(f, qcDir) && f.endsWith('.ts'));
  assert.ok(own.length >= 4);
  for (const file of own) {
    const source = readFileSync(file, 'utf8');
    for (const forbidden of [
      'process.env',
      'globalThis.process',
      'fetch(',
      'WebSocket',
      'XMLHttpRequest',
      'writeFile',
      'appendFile',
      'createWriteStream',
      'mkdir',
      'unlink',
      'net.',
      'http.',
    ]) {
      assert.ok(!source.includes(forbidden), `${path.relative(raiWeb, file)} contains ${forbidden}`);
    }
  }
});
