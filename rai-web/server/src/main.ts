// The composition root: reads config, starts the identity adapter (refuses to start with exit 78 when any W0-03
// section 5 row fails; the process never listens in a degraded state), builds the app and listens; after listen the
// bound address is checked again (S16). The fixture verifier is mounted only in fixture mode, which config.ts and
// the adapter accept only under NODE_ENV=test on a loopback bind (S13, S14). main.ts never migrates (W0-04).
//
// Shutdown (W0-04 "Restart proof"; performance-targets.md "Graceful shutdown", 10 s): SIGTERM/SIGINT logs
// `process.stopping`, then server.close() drains in-flight requests for up to SHUTDOWN_DRAIN_MS and destroys every
// remaining socket (shutdown.ts), then exit 0. The path is bounded twice: close() itself cannot wait on a socket
// that never sent a byte, and a hard deadline exits 1 should the close still not complete (a pool that will not
// release, for instance), so a stop can never hang. A second signal during the drain is ignored.

import { readEnv } from './config.js';
import { SHUTDOWN_DRAIN_MS } from './shutdown.js';
import { startServer } from './start.js';

/** After the drain budget, this much longer for the close to complete before the hard exit. */
const SHUTDOWN_HARD_EXIT_GRACE_MS = 5_000;

async function main(): Promise<void> {
  const server = await startServer(readEnv());
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    server.emitter.log('process.stopping', { signal });
    const hardExit = setTimeout(() => process.exit(1), SHUTDOWN_DRAIN_MS + SHUTDOWN_HARD_EXIT_GRACE_MS);
    hardExit.unref(); // never the reason the process stays alive
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
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
