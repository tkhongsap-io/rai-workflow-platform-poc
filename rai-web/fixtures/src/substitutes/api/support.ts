// W1-13 helpers shared by the substitute routes: the W0-06 8.2 envelope, TypeBox validation → `FieldError`,
// request parsing (JSON, cookies, query) and the response builders. Nothing here decides access; that is the
// policy module the handler calls (W0-05 section 6 "Substitute (W1-13)").

import { Value } from 'typebox/value';
import type { TSchema } from 'typebox';
import {
  type ContractError,
  InvalidInputError,
  errorResponse,
  type ErrorCode,
  type ErrorDetails,
  type FieldError,
} from '@rai/shared/errors';
import type { CorrelationId } from '@rai/shared/ids';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import type { SubstituteRequest, SubstituteResponse } from './types.js';

export const SUBSTITUTE_HEADER = 'x-rai-substitute';
export const SESSION_COOKIE = 'rai_session'; // loopback http: the plain name (W0-03 section 6.3; W1-01 cookieNames)

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The response headers every substitute answer carries (W0-10 correlation id, W0-06 no-store, the marker). */
export function baseHeaders(correlationId: CorrelationId): Record<string, string> {
  return {
    'x-correlation-id': correlationId,
    'cache-control': 'no-store',
    [SUBSTITUTE_HEADER]: SUBSTITUTE_MARKER,
  };
}

export function json(
  status: number,
  correlationId: CorrelationId,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): SubstituteResponse {
  return {
    status,
    headers: {
      ...baseHeaders(correlationId),
      ...extraHeaders,
      'content-type': 'application/json; charset=utf-8',
    },
    body: encoder.encode(JSON.stringify(body)),
  };
}

export function noContent(
  correlationId: CorrelationId,
  extraHeaders: Record<string, string> = {},
): SubstituteResponse {
  return { status: 204, headers: { ...baseHeaders(correlationId), ...extraHeaders } };
}

export function error<C extends ErrorCode>(
  code: C,
  correlationId: CorrelationId,
  status: number,
  details?: ErrorDetails[C],
): SubstituteResponse {
  return json(status, correlationId, errorResponse(code, correlationId, details));
}

export function fromContractError(err: ContractError, correlationId: CorrelationId): SubstituteResponse {
  return json(err.status, correlationId, err.toResponse(correlationId));
}

/** Route-level not-found: the plain envelope the app's not-found handler sends (no `details`). */
export function routeNotFound(correlationId: CorrelationId): SubstituteResponse {
  return json(404, correlationId, {
    error: { code: 'not_found', messageKey: 'error.not_found', correlationId },
  });
}

/** A body that is not JSON, or not an object, is 422 invalid_input on `body` (never 500). */
export function parseJsonBody(request: SubstituteRequest): unknown {
  if (request.body === undefined || request.body.byteLength === 0)
    throw new InvalidInputError([{ path: 'body', messageKey: 'validation.required' }]);
  let text: string;
  try {
    text = decoder.decode(request.body);
  } catch {
    throw new InvalidInputError([{ path: 'body', messageKey: 'validation.not_in_configured_list' }]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidInputError([{ path: 'body', messageKey: 'validation.not_in_configured_list' }]);
  }
}

/**
 * Validates `value` against a TypeBox schema and maps every failure to the W0-06 8.2 field error the way the
 * server's error handler does (W1-01 `validationToInvalidInput`): `required` → `validation.required` on
 * `<context>.<missing>`, anything else → `validation.not_in_configured_list` on the instance path.
 */
export function fieldErrorsFor(schema: TSchema, value: unknown, context = 'body'): FieldError[] {
  if (Value.Check(schema, value)) return [];
  const out: FieldError[] = [];
  const push = (path: string): void => {
    if (!out.some((f) => f.path === path))
      out.push({ path, messageKey: 'validation.not_in_configured_list' });
  };
  for (const e of Value.Errors(schema, value)) {
    const base = `${context}${e.instancePath.replaceAll('/', '.')}`;
    if (e.keyword === 'required') {
      const missing = (e.params as { requiredProperties?: string[] }).requiredProperties ?? [];
      for (const prop of missing) out.push({ path: `${base}.${prop}`, messageKey: 'validation.required' });
    } else if (e.keyword === 'additionalProperties') {
      const extra = (e.params as { additionalProperties?: string[] }).additionalProperties ?? [];
      for (const prop of extra) push(`${base}.${prop}`);
    } else if (e.keyword === 'boolean') {
      // `schema is false`: the per-property twin of an additionalProperties failure; reported once, above.
      continue;
    } else {
      push(base); // a union failure is reported once at its path; nested branch messages are noise to a client
    }
  }
  return out;
}

export function assertValid<T extends TSchema>(schema: T, value: unknown, context = 'body'): void {
  const fields = fieldErrorsFor(schema, value, context);
  if (fields.length > 0) throw new InvalidInputError(fields);
}

/** Minimal RFC 6265 parse (values are opaque base64url, never quoted). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== '' && out[name] === undefined) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

export function splitUrl(url: string): { path: string; query: URLSearchParams } {
  const q = url.indexOf('?');
  if (q === -1) return { path: url, query: new URLSearchParams() };
  return { path: url.slice(0, q), query: new URLSearchParams(url.slice(q + 1)) };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionCookie(token: string, expiresAt: Date): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
}

/** RFC 8187 `filename*=UTF-8''...` value for the download header (W0-02 7.4); Thai survives the round trip. */
export function contentDispositionFor(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename).replaceAll("'", '%27').replaceAll('*', '%2A')}`;
}

export function decodeText(bytes: Uint8Array | undefined): string {
  return bytes === undefined ? '' : new TextDecoder().decode(bytes);
}
