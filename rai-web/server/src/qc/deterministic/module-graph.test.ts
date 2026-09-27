// W4-03 (W4a plan section 4): "reads no document bytes" is tested, not just stated. The static import graph of the
// deterministic runner (every non-test module under server/src/qc/deterministic/ and everything it imports inside
// the workspace, transitively) reaches no document parser, no network module, no blob store or upload pipeline and
// no database module, and holds no dynamic import that could load one at run time.
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

test('the deterministic runner imports no parser, no network module, no blob store and no database module', () => {
  const roots = [...sourceFiles(HERE)];
  assert.ok(roots.some((f) => f.endsWith(path.join('deterministic', 'runner.ts'))));
  assert.ok(roots.some((f) => f.includes(`${path.sep}rules${path.sep}`)));
  const { modules, packages, dynamic } = importGraph(roots);
  assert.ok(modules.size > roots.length, 'the graph follows imports into the workspace');

  const forbiddenPackages = [...packages].filter(([name]) => FORBIDDEN_PACKAGES.has(name));
  assert.deepEqual(forbiddenPackages, [], 'no network module or document parser');
  const forbiddenModules = [...modules]
    .filter((m) => FORBIDDEN_DIRS.some((dir) => m.startsWith(dir)))
    .map((m) => path.relative(WEB, m));
  assert.deepEqual(forbiddenModules, [], 'no blob store, upload pipeline or database module');
  assert.deepEqual(dynamic, [], 'no dynamic import');
  // The only built-ins are the ones that read the server's own package.json for the runner version.
  const builtins = [...packages.keys()].filter((name) => !['typebox'].includes(name)).sort();
  assert.deepEqual(builtins, ['fs', 'url']);
});

test('the graph check sees a forbidden import when there is one', () => {
  const probe = importGraph([path.join(WEB, 'server/src/artifacts/blob-store.ts')]);
  assert.ok([...probe.modules].some((m) => m.startsWith(FORBIDDEN_DIRS[0]!)));
  const net = importGraph([path.join(WEB, 'server/src/observability/probes.ts')]);
  assert.ok(
    [...net.packages.keys()].some((name) => FORBIDDEN_PACKAGES.has(name)),
    [...net.packages.keys()].join(),
  );
});
