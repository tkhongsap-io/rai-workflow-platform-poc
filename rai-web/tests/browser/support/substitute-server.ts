// Lane B browser runs against the W1-13 substitute (W0-02 sections 3.4 and 8.1; W1-06). Binds the in-memory
// substitute to node:http on loopback like `fixtures/src/substitutes/api/serve.ts`, and adds one test-only hook
// outside the contract paths, `POST /__substitute/reset`, so every browser test starts from the fixture state
// (the substitute keeps sessions, uploads and versions in memory for the life of the process). Fails closed the
// same way: NODE_ENV must be test or development and the bind loopback. Never deployed; never evidence.
//
//   NODE_ENV=test npx tsx --conditions=rai-source tests/browser/support/substitute-server.ts --port 8789

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SUBSTITUTE_MARKER,
  SubstituteRefused,
  assertSubstituteAllowed,
  createApiSubstitute,
} from '@rai/fixtures/substitutes/api/index';
import { toSubstituteRequest } from '@rai/fixtures/substitutes/api/server';

export const RESET_PATH = '/__substitute/reset';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

const host = argValue('--host') ?? '127.0.0.1';
const port = Number(argValue('--port') ?? '8789');

try {
  assertSubstituteAllowed(process.env.NODE_ENV, host);
} catch (err: unknown) {
  if (err instanceof SubstituteRefused) {
    console.error(JSON.stringify({ event: 'substitute.refused', reason: err.reason }));
    process.exit(78);
  }
  throw err;
}

const substitute = createApiSubstitute();

const server = http.createServer((req, res) => {
  void (async () => {
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === RESET_PATH) {
      substitute.reset();
      res.statusCode = 204;
      res.setHeader('x-rai-substitute', SUBSTITUTE_MARKER);
      res.end();
      return;
    }
    const response = await substitute.handle(toSubstituteRequest(req, body));
    for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
    res.statusCode = response.status;
    if (response.body === undefined) res.end();
    else res.end(Buffer.from(response.body));
  })().catch(() => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
});

server.listen(port, host, () => {
  const address = server.address() as AddressInfo;
  console.log(
    JSON.stringify({
      event: 'substitute.started',
      marker: SUBSTITUTE_MARKER,
      baseUrl: `http://${host}:${address.port}`,
      resetPath: RESET_PATH,
      note: 'Lane B browser runs; dev/test only; never acceptance evidence',
    }),
  );
});

const stop = (): void => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
