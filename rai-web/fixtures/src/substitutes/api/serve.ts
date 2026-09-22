// W1-13 CLI: runs the in-memory API substitute on loopback for a Lane B development session or a Playwright
// `webServer` command. From rai-web/:
//   NODE_ENV=development npx tsx --conditions=rai-source fixtures/src/substitutes/api/serve.ts --port 8789
// The test-only Vite configuration under tests/browser/support/ proxies /api and /auth to that port. The
// process prints one JSON line when it listens and refuses (exit 78, like the server) outside test/development
// or off loopback. Never evidence.

import { startApiSubstitute, SubstituteRefused } from './server.js';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const port = Number(argValue('--port') ?? '8787');
const host = argValue('--host') ?? '127.0.0.1';

startApiSubstitute({ host, port, nodeEnv: process.env.NODE_ENV ?? 'development' })
  .then((running) => {
    console.log(
      JSON.stringify({
        event: 'substitute.started',
        marker: SUBSTITUTE_MARKER,
        baseUrl: running.baseUrl,
        note: 'dev/test only; never acceptance evidence',
      }),
    );
    const stop = (): void => {
      void running.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .catch((err: unknown) => {
    if (err instanceof SubstituteRefused) {
      console.error(JSON.stringify({ event: 'substitute.refused', reason: err.reason }));
      process.exit(78);
    }
    throw err;
  });
