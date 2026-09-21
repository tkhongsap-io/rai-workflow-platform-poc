// Part of npm run reset (W0-02 section 3.3): removes rai-web/.local (blobs and mail sink). Development and test only.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env.NODE_ENV ?? 'development';
if (env !== 'development' && env !== 'test') {
  console.error(`reset: refused outside development/test (NODE_ENV=${env})`);
  process.exit(78);
}
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
rmSync(path.join(root, '.local'), { recursive: true, force: true });
console.log('reset: removed rai-web/.local');
