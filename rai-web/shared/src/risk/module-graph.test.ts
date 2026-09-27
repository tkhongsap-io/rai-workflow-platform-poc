// W5-01 (W5 plan sections 3 and 11): the engine runs unchanged on the server (submit, W5-05) and in the browser (the
// pack editor preview, W5-07), so the non-test modules of shared/src/risk, and everything they import inside the
// workspace, reach no Node built-in, no DOM global and no package but typebox, and load nothing dynamically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.resolve(HERE, '..'); // shared/src/

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(|\brequire\s*\(/;
/** Host globals that exist only in Node or only in a browser. */
const HOST_GLOBALS =
  /\b(?:process|Buffer|__dirname|__filename|window|document|navigator|localStorage|sessionStorage|crypto|TextEncoder|TextDecoder|fetch|XMLHttpRequest)\b/;

function engineModules(): string[] {
  return readdirSync(HERE)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.test-helper.ts'))
    .map((f) => path.join(HERE, f));
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function importGraph(roots: string[]) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const dynamic: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    const text = readFileSync(file, 'utf8');
    if (DYNAMIC_IMPORT.test(stripComments(text))) dynamic.push(path.relative(SHARED, file));
    for (const match of text.matchAll(STATIC_IMPORT)) {
      const specifier = match[1] ?? match[2]!;
      if (!specifier.startsWith('.')) {
        packages.add(specifier.split('/')[0]!);
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      const found = [base.replace(/\.js$/, '.ts'), base].find((c) => existsSync(c) && statSync(c).isFile());
      assert.ok(found, `cannot resolve ${specifier} from ${path.relative(SHARED, file)}`);
      if (found.endsWith('.ts')) queue.push(found);
    }
  }
  return { modules, packages, dynamic };
}

test('the engine modules exist: types, score and inputs', () => {
  const names = engineModules()
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(names, ['inputs.ts', 'score.ts', 'types.ts']);
});

test('shared/src/risk reaches no Node built-in, no DOM and no package but typebox, and loads nothing dynamically', () => {
  const { modules, packages, dynamic } = importGraph(engineModules());
  assert.ok(
    [...modules].some((m) => m.endsWith(path.join('schemas', 'cases.ts'))),
    'the graph follows imports',
  );
  assert.deepEqual([...packages].sort(), ['typebox']);
  assert.deepEqual(dynamic, []);
  for (const file of engineModules()) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.doesNotMatch(code, HOST_GLOBALS, path.basename(file));
  }
});

test('the graph check sees a Node import and a host global when there is one', () => {
  const probe = importGraph([path.join(HERE, 'inputs.test.ts')]);
  assert.ok(probe.packages.has('node:crypto'));
  assert.match(stripComments('const x = globalThis.crypto; // ok'), HOST_GLOBALS);
  assert.doesNotMatch(stripComments('// window and process in a comment'), HOST_GLOBALS);
});
