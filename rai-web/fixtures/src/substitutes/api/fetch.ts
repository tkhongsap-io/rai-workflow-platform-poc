// W1-13: a `fetch`-shaped adapter over the in-memory substitute, so a typed API client or a test can call the
// substitute in-process with `Request`/`Response` objects and no socket. It keeps one cookie jar per adapter so
// the session cookie the sign-in sets travels on later calls, the way a browser context would. Only same-origin
// paths and absolute URLs on any host are accepted; the host is ignored because there is only one substitute.

import type { ApiSubstitute } from './handler.js';
import type { SubstituteRequest } from './types.js';

export interface SubstituteFetch {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** The cookies this adapter currently sends (name → value). */
  readonly cookies: ReadonlyMap<string, string>;
  clearCookies(): void;
}

export function createSubstituteFetch(substitute: ApiSubstitute): SubstituteFetch {
  const jar = new Map<string, string>();

  const fetchLike = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(
            new URL(input instanceof URL ? input.toString() : input, 'http://substitute.invalid'),
            init,
          );
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    if (jar.size > 0 && headers.cookie === undefined)
      headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    headers['sec-fetch-site'] ??= 'same-origin';
    const body = new Uint8Array(await request.arrayBuffer());
    const substituteRequest: SubstituteRequest = {
      method: request.method.toUpperCase(),
      url: `${url.pathname}${url.search}`,
      headers,
    };
    if (body.byteLength > 0) substituteRequest.body = body;
    const response = await substitute.handle(substituteRequest);
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (name === 'set-cookie') {
        const [pair] = value.split(';', 1);
        const eq = pair?.indexOf('=') ?? -1;
        if (pair !== undefined && eq > 0) {
          const cookieName = pair.slice(0, eq).trim();
          const cookieValue = pair.slice(eq + 1).trim();
          if (cookieValue === '') jar.delete(cookieName);
          else jar.set(cookieName, cookieValue);
        }
      }
      responseHeaders.append(name, value);
    }
    return new Response(response.status === 204 ? null : (response.body ?? null), {
      status: response.status,
      headers: responseHeaders,
    });
  };

  return Object.assign(fetchLike, {
    cookies: jar,
    clearCookies: () => jar.clear(),
  });
}
