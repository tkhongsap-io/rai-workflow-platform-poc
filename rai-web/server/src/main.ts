// The composition root: reads config, starts the identity adapter (refuses to start with exit 78 when any W0-03
// section 5 row fails; the process never listens in a degraded state), builds the app and listens; after listen the
// bound address is checked again (S16). The fixture verifier is mounted only in fixture mode, which config.ts and
// the adapter accept only under NODE_ENV=test on a loopback bind (S13, S14). main.ts never migrates (W0-04).

import { readEnv } from './config.js';
import { startServer } from './start.js';

async function main(): Promise<void> {
  const server = await startServer(readEnv());
  const stop = (signal: NodeJS.Signals) => {
    server.emitter.log('process.stopping', { signal });
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({ event: 'process.refused', reason: err instanceof Error ? err.name : 'unknown' }),
  );
  process.exit(1);
});
