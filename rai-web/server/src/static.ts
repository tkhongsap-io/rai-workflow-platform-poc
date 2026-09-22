// W0-02 section 1: "static.ts — serves ../web/dist with CSP and history fallback for non-/api paths" (W1-INT).
// The one deployable (ADR-0003 B1) answers the API under /api and /auth and the built SPA everywhere else:
// every file Vite wrote into web/dist is a route of its own (no wildcard file route, so no path outside the
// directory can ever be served), and any other GET outside /api and /auth receives index.html so a deep link such as
// /cases/<id> resolves inside the SPA (W1-07 `RequireSession`). A miss under /api or /auth stays the W0-06 8.2
// JSON not-found envelope of app.ts; a non-GET miss anywhere is the same envelope. Response headers come from
// @fastify/helmet with an explicit content-security policy: same-origin scripts, styles, fonts and requests, no
// object, no framing, no inline script. There is no `upgrade-insecure-requests` (the local modes bind loopback
// HTTP, W0-03) and no HSTS (a host concern under D10, W8). Nothing here reads process.env (config.ts does).
//
// The directory is optional: the integration suites spawn server/src/main.ts without a web build, so an absent
// web/dist leaves the API alone and serves no page; start.ts decides by `webDistPresent()`.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import type { RouteAuth } from './authz/middleware.js';

/** rai-web/web/dist, resolved from this file in both layouts (server/src through tsx, server/dist when built). */
export const WEB_DIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'web',
  'dist',
);

export const INDEX_FILE = 'index.html';

/** The paths the API owns; a miss there is never the SPA (W0-02 section 7 conventions). */
export const API_PATH_PREFIXES = Object.freeze(['/api', '/auth'] as const);

/** True for `/api`, `/api/...`, `/auth`, `/auth/...`; false for `/apix` or `/cases/...`. */
export function isApiPath(pathname: string): boolean {
  return API_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True when `root` holds a built SPA (its index.html exists). */
export function webDistPresent(root: string = WEB_DIST_DIR): boolean {
  const index = path.join(root, INDEX_FILE);
  return existsSync(index) && statSync(index).isFile();
}

/** The policy as sent; exported so the unit test and the browser evidence assert the same string. */
export const CONTENT_SECURITY_POLICY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
});

/** The SPA is public: the session check happens inside it, on the API calls it makes (W1-07 RequireSession). */
const PUBLIC: RouteAuth = { kind: 'public' };

/** Every regular file under `root` as a POSIX-relative path, sorted; the routes the SPA is served from. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(root, path.join(entry.parentPath, entry.name));
    out.push(relative.split(path.sep).join('/'));
  }
  return out.sort();
}

declare module 'fastify' {
  interface FastifyContextConfig {
    observability?: { staticAsset: boolean };
  }
}

export interface StaticOptions {
  /** The built SPA directory; defaults to WEB_DIST_DIR. Must contain index.html (webDistPresent). */
  root?: string;
}

export class WebDistMissingError extends Error {
  constructor(readonly root: string) {
    super(`web/dist is not built at ${root}`);
    this.name = 'WebDistMissingError';
  }
}

/**
 * The SPA plugin: helmet (whole process), one route per built file, the history fallback. Registered on the root
 * instance without encapsulation (`skip-override`, what fastify-plugin sets) so the headers apply to every
 * response, API included. Throws WebDistMissingError at ready() when `root` has no index.html, so a process never
 * registers a fallback that would answer 500 on every page; start.ts checks `webDistPresent()` first.
 */
export function staticPlugin(options: StaticOptions = {}): (fastify: FastifyInstance) => Promise<void> {
  const root = path.resolve(options.root ?? WEB_DIST_DIR);
  const plugin = async (fastify: FastifyInstance): Promise<void> => {
    if (!webDistPresent(root)) throw new WebDistMissingError(root);

    await fastify.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { ...CONTENT_SECURITY_POLICY },
      },
      strictTransportSecurity: false, // loopback HTTP in every local mode; the W8 host adds it under D10
    });

    // @fastify/static only decorates `reply.sendFile` (its own routes cannot carry `config.auth`, which the W0-05
    // onRoute guard demands of every route); the file routes are registered here, one per built file.
    await fastify.register(fastifyStatic, {
      root,
      serve: false,
      decorateReply: true,
      cacheControl: false, // app.ts already sends Cache-Control: no-store on every response (W0-10)
    });

    const files = listFiles(root);
    for (const file of files) {
      fastify.get(
        `/${file}`,
        { config: { auth: PUBLIC, observability: { staticAsset: true } } },
        (_request, reply) => reply.sendFile(file, root),
      );
    }
    fastify.get('/', { config: { auth: PUBLIC, observability: { staticAsset: true } } }, (_request, reply) =>
      reply.sendFile(INDEX_FILE, root),
    );

    // History fallback: the SPA owns every GET outside /api and /auth. A miss under those prefixes goes to the
    // W0-06 not-found handler (app.ts), unchanged.
    fastify.get(
      '/*',
      { config: { auth: PUBLIC, observability: { staticAsset: true } } },
      (request, reply) => {
        const pathname = request.url.split('?', 1)[0] ?? request.url;
        if (isApiPath(pathname)) return reply.callNotFound();
        return reply.sendFile(INDEX_FILE, root);
      },
    );
  };
  Object.defineProperty(plugin, Symbol.for('skip-override'), { value: true });
  return plugin;
}
