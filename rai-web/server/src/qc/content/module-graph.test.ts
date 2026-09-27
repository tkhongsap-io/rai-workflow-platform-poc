// W4-06a (W4b plan section 3.1, "Module graph"): the content runner reads document text only through the injected
// `Extractor`, so its static import graph (every non-test module under server/src/qc/content/ and everything it imports
// inside the workspace, transitively) reaches no network module, no child process, no document parser, no database
// module (`pg`, `drizzle-orm`, server/src/db/) and no blob store or upload pipeline (server/src/artifacts/), and holds
// no dynamic import. The extraction host (qc/extraction/client.ts, which forks) is bound by the composition, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../../..'); // rai-web/
const WORKSPACES: Readonly<Record<string, string>> = {
  '@rai/shared/': path.join(WEB, 'shared/src/'),
  '@rai/server/': path.join(WEB, 'server/src/'),
};

/** Network modules (any protocol) and document parsers, by package name. */
const FORBIDDEN_PACKAGES = new Set([
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'child_process',
  'worker_threads',
  'cluster',
  'undici',
  'openid-client',
  'pg',
  'drizzle-orm',
  'pdf-parse',
  'pdfjs-dist',
  'pdf-lib',
  'mammoth',
  'docx',
  'xlsx',
  'exceljs',
  'jszip',
  'yauzl',
  'fflate',
  'sharp',
  'file-type',
  'papaparse',
  'csv-parse',
  'openai',
  '@anthropic-ai/sdk',
]);
/** Workspace modules that read stored bytes, sniff uploads or reach the database. */
const FORBIDDEN_DIRS = ['server/src/artifacts/', 'server/src/db/'].map((d) => path.join(WEB, d));

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.test-helper.ts'))
      yield full;
  }
}

function packageName(specifier: string): string {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function resolveInWorkspace(from: string, specifier: string): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  for (const [prefix, dir] of Object.entries(WORKSPACES))
    if (specifier.startsWith(prefix)) base = path.join(dir, specifier.slice(prefix.length));
  if (base === undefined) return undefined;
  const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, path.join(base, 'index.ts'), base];
  const found = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  assert.ok(found, `cannot resolve ${specifier} from ${path.relative(WEB, from)}`);
  return found;
}

function importGraph(roots: string[]) {
  const modules = new Set<string>();
  const packages = new Map<string, string>(); // package → first importer
  const dynamic: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const text = readFileSync(file, 'utf8');
    if (DYNAMIC_IMPORT.test(text)) dynamic.push(path.relative(WEB, file));
    for (const match of text.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2]!;
      if (specifier.endsWith('.json')) continue; // data (locale catalogues), never code
      const resolved = resolveInWorkspace(file, specifier);
      if (resolved === undefined) {
        if (!packages.has(packageName(specifier)))
          packages.set(packageName(specifier), path.relative(WEB, file));
      } else queue.push(resolved);
    }
  }
  return { modules, packages, dynamic };
}

test('the content runner imports no network, process, parser, database or blob-store module', () => {
  const roots = [...sourceFiles(HERE)];
  for (const file of [
    'runner.ts',
    'claims.ts',
    'decimal.ts',
    'excerpt.ts',
    path.join('rules', 'acc-metric-cited.ts'),
  ])
    assert.ok(
      roots.some((f) => f.endsWith(path.join('content', file))),
      file,
    );
  const { modules, packages, dynamic } = importGraph(roots);
  assert.ok(modules.size > roots.length, 'the graph follows imports into the workspace');

  const forbiddenPackages = [...packages].filter(([name]) => FORBIDDEN_PACKAGES.has(name));
  assert.deepEqual(forbiddenPackages, [], 'no network module, child process or document parser');
  const forbiddenModules = [...modules]
    .filter((m) => FORBIDDEN_DIRS.some((dir) => m.startsWith(dir)))
    .map((m) => path.relative(WEB, m));
  assert.deepEqual(forbiddenModules, [], 'no blob store, upload pipeline or database module');
  assert.deepEqual(dynamic, [], 'no dynamic import');
  const extraction = [...modules]
    .map((m) => path.relative(WEB, m))
    .filter((m) => m.startsWith('server/src/qc/extraction/'));
  assert.deepEqual(
    extraction,
    ['server/src/qc/extraction/port.ts'],
    'only the port, never the forking host or the worker',
  );
  // node:crypto hashes the bytes and excerpts; fs and url read the server's own package.json for the runner version.
  assert.deepEqual([...packages.keys()].sort(), ['crypto', 'fs', 'typebox', 'url']);
});

test('the graph check sees a forbidden import when there is one', () => {
  const fork = importGraph([path.join(WEB, 'server/src/qc/extraction/client.ts')]);
  assert.ok(fork.packages.has('child_process'));
  const probe = importGraph([path.join(WEB, 'server/src/artifacts/blob-store.ts')]);
  assert.ok([...probe.modules].some((m) => m.startsWith(FORBIDDEN_DIRS[0]!)));
});
