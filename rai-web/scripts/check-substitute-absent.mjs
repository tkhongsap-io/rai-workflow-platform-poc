// Fails when web/dist or server/dist contains the substitute marker (W0-02 section 1.1: the production build
// must not contain fixtures/src/substitute-marker.ts). Zero dependencies.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// The literal is split so this script never contains the marker itself.
const marker = ['RAI_DESK', 'SUBSTITUTE', 'MARKER'].join('_');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

let failures = 0;
let scanned = 0;
for (const dist of ['web/dist', 'server/dist']) {
  const dir = path.join(root, dist);
  if (!existsSync(dir)) {
    console.error(`check-substitute-absent: ${dist} does not exist; run npm run build first`);
    process.exit(1);
  }
  for (const file of walk(dir)) {
    scanned += 1;
    if (readFileSync(file, 'utf8').includes(marker)) {
      console.error(`check-substitute-absent: substitute marker found in ${path.relative(root, file)}`);
      failures += 1;
    }
  }
}
console.log(`check-substitute-absent: scanned ${scanned} files, ${failures} with the marker`);
process.exit(failures === 0 ? 0 : 1);
