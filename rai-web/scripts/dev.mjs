// npm run dev: spawns the API (tsx watch) and the Vite dev server (W0-02 section 3.4). No dependency beyond Node.
// The API runs with the developer's .env (RAI_IDENTITY_MODE=local-google by default); Vite proxies /api and /auth.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npm, ['exec', '--', 'tsx', 'watch', '--conditions=rai-source', 'server/src/main.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(npm, ['run', 'dev', '-w', 'web'], { cwd: root, stdio: 'inherit', env: process.env }),
];

function stopAll(signal) {
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

for (const child of children) {
  child.on('exit', (code) => {
    stopAll('SIGTERM');
    process.exitCode = code ?? 1;
  });
}
process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));
