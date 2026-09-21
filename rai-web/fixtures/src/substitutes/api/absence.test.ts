// W1-13 done-when "the substitute is absent from non-test configuration": the product sources never import it,
// the web workspace only knows the fixtures package as a devDependency, the production build forces
// VITE_API_SUBSTITUTE=false, every substitute module is reachable only through the marked handler, and the
// marker `npm run check:substitute-absent` greps for is referenced from the substitute's entry points.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiWebRoot = path.resolve(here, '..', '..', '..', '..');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(entry)) yield full;
  }
}

describe('W1-13 substitute: absent from non-test configuration', () => {
  it('no file under server/src or web/src imports the substitute or the fixtures package statically', () => {
    for (const root of ['server/src', 'web/src']) {
      for (const file of walk(path.join(raiWebRoot, root))) {
        if (file.endsWith('.test.ts')) continue;
        const text = readFileSync(file, 'utf8');
        assert.ok(
          !text.includes('substitutes/api'),
          `${path.relative(raiWebRoot, file)} references the substitute`,
        );
        assert.ok(
          !/^\s*import\s[^;]*['"]@rai\/fixtures/m.test(text),
          `${path.relative(raiWebRoot, file)} imports @rai/fixtures statically`,
        );
      }
    }
  });

  it('web knows @rai/fixtures only as a devDependency and its build forces VITE_API_SUBSTITUTE=false', () => {
    const pkg = JSON.parse(readFileSync(path.join(raiWebRoot, 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts: Record<string, string>;
    };
    assert.equal(pkg.dependencies?.['@rai/fixtures'], undefined);
    assert.equal(pkg.devDependencies?.['@rai/fixtures'], '0.0.0');
    assert.ok(pkg.scripts.build?.includes('VITE_API_SUBSTITUTE=false'));
    const server = JSON.parse(readFileSync(path.join(raiWebRoot, 'server', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    assert.equal(server.dependencies?.['@rai/fixtures'], undefined);
  });

  it('the substitute entry points reference SUBSTITUTE_MARKER so check-substitute-absent can find a leaked bundle', () => {
    for (const file of ['handler.ts', 'serve.ts', 'support.ts', 'index.ts']) {
      const text = readFileSync(path.join(here, file), 'utf8');
      assert.ok(text.includes('SUBSTITUTE_MARKER'), `${file} must reference the marker`);
    }
    assert.equal(SUBSTITUTE_MARKER, ['RAI_DESK', 'SUBSTITUTE', 'MARKER'].join('_'));
  });

  it('the root check script scans exactly web/dist and server/dist for the marker', () => {
    const script = readFileSync(path.join(raiWebRoot, 'scripts', 'check-substitute-absent.mjs'), 'utf8');
    assert.ok(script.includes("'web/dist'") && script.includes("'server/dist'"));
  });
});
