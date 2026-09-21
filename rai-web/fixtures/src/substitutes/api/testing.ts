// W1-13: helpers for exercising the substitute in-process (its own suites, and any Lane B unit test that wants
// a signed-in call without a socket). Everything goes through `handle`, so a test never fabricates a session.

import { SESSION_COOKIE, parseCookies } from './support.js';
import type { ApiSubstitute } from './handler.js';
import type { SubstituteRequest, SubstituteResponse } from './types.js';

export interface CallOptions {
  cookie?: string | undefined;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Uint8Array;
  /** Set to false to omit the same-origin fetch metadata the SPA sends. */
  sameOrigin?: boolean;
}

export interface CallResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | undefined;
  text(): string;
  json<T = unknown>(): T;
}

export async function call(
  substitute: ApiSubstitute,
  method: string,
  url: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.sameOrigin !== false) headers['sec-fetch-site'] ??= 'same-origin';
  const request: SubstituteRequest = { method, url, headers };
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    request.body = new TextEncoder().encode(JSON.stringify(options.json));
  } else if (options.body !== undefined) request.body = options.body;
  return wrap(await substitute.handle(request));
}

export function wrap(response: SubstituteResponse): CallResult {
  const text = (): string => (response.body === undefined ? '' : new TextDecoder().decode(response.body));
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    text,
    json: <T = unknown>(): T => JSON.parse(text()) as T,
  };
}

/** Signs in a fixture user and returns the `Cookie` header value to send on later calls. */
export async function signIn(substitute: ApiSubstitute, fixtureUserId: string): Promise<string> {
  const response = await call(substitute, 'POST', '/auth/fixture/sign-in', { json: { fixtureUserId } });
  if (response.status !== 200)
    throw new Error(`sign-in for ${fixtureUserId} answered ${response.status}: ${response.text()}`);
  const setCookie = response.headers['set-cookie'] ?? '';
  const token = parseCookies(setCookie)[SESSION_COOKIE];
  if (token === undefined) throw new Error('sign-in set no session cookie');
  return `${SESSION_COOKIE}=${token}`;
}

/** Builds a multipart/form-data body with one `file` part, as a browser FormData upload sends it. */
export function multipartFile(
  filename: string,
  bytes: Uint8Array,
  partName = 'file',
): { body: Uint8Array; contentType: string } {
  const boundary = `----rai-substitute-${Math.random().toString(16).slice(2)}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="${partName}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
