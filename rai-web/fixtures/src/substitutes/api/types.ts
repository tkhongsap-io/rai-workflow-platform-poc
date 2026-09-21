// W1-13: the transport-agnostic request and response of the in-memory API substitute (W0-02 section 1,
// `fixtures/src/substitutes/api/`). The handler never touches a socket; server.ts binds it to node:http on
// loopback and fetch.ts wraps it as a `fetch` function, so the same substitute answers a Playwright run, a
// node:test suite and (through the fetch adapter) a Lane B dev build. Dev and test only; never evidence.

import type { Principal } from '@rai/shared/schemas/auth';

export interface SubstituteRequest {
  method: string; // upper-case
  /** Path plus query, as in the HTTP request line: '/api/cases?page=2'. */
  url: string;
  /** Lower-cased header names; multi-valued headers joined by ', '. */
  headers: Record<string, string>;
  body?: Uint8Array;
}

export interface SubstituteResponse {
  status: number;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/** A session the substitute holds in memory; the cookie value is the key. */
export interface SubstituteSession {
  token: string;
  principal: Principal;
  createdAt: Date;
  expiresAt: Date;
  locale: 'th' | 'en';
  revoked: boolean;
}

export interface ApiSubstituteOptions {
  /** The clock; tests pass a fixed one so every timestamp is reproducible. */
  now?: () => Date;
  /** W0-08 section 3 limits; defaults are the `.env.example` values. */
  uploadMaxFileBytes?: number;
  uploadMaxPackBytes?: number;
  /** Session absolute lifetime (W0-03; `.env.example` RAI_SESSION_ABSOLUTE_HOURS). */
  sessionAbsoluteHours?: number;
}

/** One `authz.denied` line the substitute recorded (W0-10 3.3 fields), so a test can assert the denial reason. */
export interface RecordedLogLine {
  event: string;
  fields: Record<string, unknown>;
}
