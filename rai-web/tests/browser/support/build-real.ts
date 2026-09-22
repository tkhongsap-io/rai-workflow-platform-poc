// Build once; the per-test fixture owns every listening child.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrowserEnv, validateRealBrowserConfig } from './real-browser-config.js';

const RAI_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default async function buildReal(): Promise<void> {
  validateRealBrowserConfig(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8788', readBrowserEnv());
  const execute = promisify(execFile);
  await execute('npm', ['run', 'build'], { cwd: RAI_WEB_ROOT, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  await execute('npm', ['run', 'build', '-w', 'fixtures'], {
    cwd: RAI_WEB_ROOT,
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
