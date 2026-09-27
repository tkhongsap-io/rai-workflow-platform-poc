// W5-05 (W5 plan section 4, "The Ready predicate is untouched"; section 6, "No new policy row"): the risk proposal is a
// QC input and a display, never a routing switch or a gate. The Ready predicate (`workflow/ready.ts`) and the policy
// table (`authz/policy.ts`), with everything they import inside the workspace, reach no risk module; and no policy
// action names risk, so no role can write a tier through an action.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, POLICY_ROWS } from '../authz/policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..'); // server/src/
const SHARED = path.resolve(SERVER, '../../shared/src');
const RISK_DIRS = [path.join(SERVER, 'risk') + path.sep, path.join(SHARED, 'risk') + path.sep];

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

function resolve(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else if (specifier.startsWith('@rai/shared/'))
    base = path.join(SHARED, specifier.slice('@rai/shared/'.length));
  else if (specifier === '@rai/shared') base = path.join(SHARED, 'index');
  else return undefined; // a package outside the workspace
  const found = [base.replace(/\.js$/, '.ts'), `${base}.ts`, base].find(
    (c) => existsSync(c) && statSync(c).isFile(),
  );
  assert.ok(found, `cannot resolve ${specifier} from ${path.relative(SERVER, from)}`);
  return found.endsWith('.ts') ? found : undefined;
}

/** Every workspace module reachable from `root`, each with the chain that reached it. */
function importGraph(root: string): Map<string, string[]> {
  const reached = new Map<string, string[]>([[root, [root]]]);
  const queue = [root];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const next = resolve(file, match[1] ?? match[2]!);
      if (next === undefined || reached.has(next)) continue;
      reached.set(next, [...reached.get(file)!, next]);
      queue.push(next);
    }
  }
  return reached;
}

for (const entry of ['workflow/ready.ts', 'authz/policy.ts']) {
  test(`${entry} reaches no risk module (the tier never gates Ready or authorization)`, () => {
    const graph = importGraph(path.join(SERVER, entry));
    assert.ok(graph.size > 1 || entry === 'authz/policy.ts', 'the walk follows imports');
    for (const [file, chain] of graph) {
      assert.ok(
        !RISK_DIRS.some((dir) => file.startsWith(dir)),
        `${entry} reaches ${path.relative(SERVER, file)} via ${chain.map((f) => path.relative(SERVER, f)).join(' -> ')}`,
      );
    }
  });
}

test('the walk would catch a risk import: versions/service.ts does reach server/src/risk/propose.ts', () => {
  const graph = importGraph(path.join(SERVER, 'versions/service.ts'));
  assert.ok(graph.has(path.join(SERVER, 'risk/propose.ts')));
});

test('no policy action or row names risk (W5 plan section 6: no new policy row)', () => {
  for (const action of ACTIONS) assert.doesNotMatch(action, /risk/i, action);
  for (const row of POLICY_ROWS) assert.doesNotMatch(JSON.stringify(row), /risk/i);
});
