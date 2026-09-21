// W1-13: `startApiSubstitute()` binds the in-memory substitute to node:http on loopback so a Playwright
// configuration (Lane B specs), `npm run dev -w web` behind the Vite proxy, or a node:test suite can talk to it
// over a socket. Fail closed like the fixture loader (W0-08 8.1 rule 5): it refuses to start unless NODE_ENV is
// `test` or `development` and the host is a loopback address, so no configuration outside development and test
// can run it. Never deployed; never evidence (W0-02 section 8.1).

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import type { ApiSubstituteOptions, SubstituteRequest } from './types.js';

export const SUBSTITUTE_NODE_ENVS = ['test', 'development'] as const;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);

export class SubstituteRefused extends Error {
  constructor(readonly reason: 'node_env' | 'not_loopback') {
    super(`api substitute refused: ${reason}`);
    this.name = 'SubstituteRefused';
  }
}

export interface StartOptions extends ApiSubstituteOptions {
  /** Loopback only; anything else is refused. Default 127.0.0.1. */
  host?: string;
  /** 0 (default) asks the kernel for a free port. */
  port?: number;
  /** Defaults to process.env.NODE_ENV; must be `test` or `development`. */
  nodeEnv?: string | undefined;
  /** Reuse a substitute (and its state) instead of creating a fresh one. */
  substitute?: ApiSubstitute;
}

export interface RunningSubstitute {
  baseUrl: string;
  host: string;
  port: number;
  substitute: ApiSubstitute;
  close(): Promise<void>;
}

export function assertSubstituteAllowed(nodeEnv: string | undefined, host: string): void {
  if (!(SUBSTITUTE_NODE_ENVS as readonly string[]).includes(nodeEnv ?? ''))
    throw new SubstituteRefused('node_env');
  if (!LOOPBACK_HOSTS.has(host)) throw new SubstituteRefused('not_loopback');
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function toSubstituteRequest(req: http.IncomingMessage, body: Uint8Array): SubstituteRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  const request: SubstituteRequest = {
    method: (req.method ?? 'GET').toUpperCase(),
    url: req.url ?? '/',
    headers,
  };
  if (body.byteLength > 0) request.body = body;
  return request;
}

export async function startApiSubstitute(options: StartOptions = {}): Promise<RunningSubstitute> {
  const host = options.host ?? '127.0.0.1';
  const nodeEnv = options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv;
  assertSubstituteAllowed(nodeEnv, host);
  const substitute = options.substitute ?? createApiSubstitute(options);

  const server = http.createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://${host}:${address.port}`,
    host,
    port: address.port,
    substitute,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined ? resolve() : reject(err)));
        server.closeAllConnections();
      }),
  };
}
