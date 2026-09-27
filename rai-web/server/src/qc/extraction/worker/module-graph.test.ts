// W4-05b (W4b plan section 4.2, ADR-0006 isolation): the worker parses untrusted bytes, so its reach is tested, not
// just stated. Every non-test module under worker/ imports only `node:zlib`, `node:buffer` and other files under
// worker/: no filesystem, network, child process or database module, no other server code, and no dynamic import or
// `require` that could load one at run time. This is the network guard whether or not the permission flags apply.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(WORKER, '../../../../..'); // rai-web/
const ALLOWED_BUILTINS = new Set(['node:zlib', 'node:buffer']);

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const LOADERS = [
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bcreateRequire\b/,
  /\bprocess\s*\.\s*(binding|dlopen)\b/,
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.test-helper.ts'))
      yield full;
  }
}

function importGraph(roots: string[]) {
  const modules = new Set<string>();
  const external = new Map<string, string>(); // non-relative specifier → first importer
  const loaders: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const text = readFileSync(file, 'utf8');
    if (LOADERS.some((pattern) => pattern.test(text))) loaders.push(path.relative(WEB, file));
    for (const match of text.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2]!;
      if (!specifier.startsWith('.')) {
        if (!external.has(specifier)) external.set(specifier, path.relative(WEB, file));
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      const found = [base.replace(/\.js$/, '.ts'), `${base}.ts`, base].find(
        (c) => existsSync(c) && statSync(c).isFile(),
      );
      assert.ok(found, `cannot resolve ${specifier} from ${path.relative(WEB, file)}`);
      queue.push(found);
    }
  }
  return { modules, external, loaders };
}

test('the worker imports only node:zlib, node:buffer and its own files', () => {
  const roots = [...sourceFiles(WORKER)];
  assert.ok(roots.some((f) => f.endsWith(path.join('worker', 'main.ts'))));
  const { modules, external, loaders } = importGraph(roots);

  const outside = [...modules]
    .filter((m) => !m.startsWith(WORKER + path.sep))
    .map((m) => path.relative(WEB, m));
  assert.deepEqual(outside, [], 'no server, shared or other module outside worker/');
  const forbidden = [...external].filter(([specifier]) => !ALLOWED_BUILTINS.has(specifier));
  assert.deepEqual(forbidden, [], 'no package or built-in other than node:zlib and node:buffer');
  assert.deepEqual(loaders, [], 'no dynamic import, require, createRequire, binding or dlopen');
});

test('the graph check sees a forbidden import when there is one', () => {
  const blobs = importGraph([path.join(WEB, 'server/src/artifacts/blob-store.ts')]);
  assert.ok([...blobs.external.keys()].some((s) => !ALLOWED_BUILTINS.has(s)));
  const host = importGraph([path.join(WORKER, '..', 'client.ts')]);
  assert.ok(host.external.has('node:child_process'), [...host.external.keys()].join());
  const escaping = importGraph([path.join(WORKER, '..', 'protocol.ts')]);
  assert.ok([...escaping.modules].some((m) => !m.startsWith(WORKER + path.sep)));
});
