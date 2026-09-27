// The `@rai/server` package version, read once from server/package.json. W4-03: the deterministic QC runner reports it
// as its `runnerVersion` (W4a plan section 4). The file sits one level below the package root both as source
// (server/src) and as build output (server/dist), so the same relative URL resolves in both.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readServerVersion(): string {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as {
    name?: unknown;
    version?: unknown;
  };
  if (pkg.name !== '@rai/server' || typeof pkg.version !== 'string' || pkg.version.length === 0)
    throw new Error('server/package.json does not name @rai/server with a version');
  return pkg.version;
}

export const SERVER_PACKAGE_VERSION: string = readServerVersion();
