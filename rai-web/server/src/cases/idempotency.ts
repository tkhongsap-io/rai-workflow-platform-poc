// W0-06 section 5.3 / W0-04 `idempotency_key` for `case.create` (W1-02): the key is scoped to the actor; a replay
// with the same request digest returns the stored status and body and writes nothing (not even an audit event);
// the same key with a different digest is 422 `error.invalid_input.idempotency_key_reused`; a key is stored only
// on success, inside the action's transaction. Create has no case row to lock yet, so the (actor, key) pair is
// serialised with a transaction-scoped advisory lock instead. W1-05 generalises this for submit in versions/.

import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { InvalidInputError } from '@rai/shared/errors';
import type { Tx } from '../db/client.js';
import { idempotencyKey } from '../db/schema/idempotency-key.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key' as const;
export const IDEMPOTENCY_HEADER_PATH = 'header.idempotency-key' as const;
export const IDEMPOTENCY_KEY_REUSED = 'error.invalid_input.idempotency_key_reused' as const;
const KEY_MAX = 128;

/** The header value, or the 422 the contract prescribes when it is missing or malformed. */
export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim() === '' || value.length > KEY_MAX || value.trim() !== value)
    throw new InvalidInputError([{ path: IDEMPOTENCY_HEADER_PATH, messageKey: 'validation.required' }]);
  return value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** SHA-256 over the action name and the canonical (key-sorted) JSON of the body (W0-04 `request_digest`). */
export function requestDigest(action: string, body: unknown): string {
  return createHash('sha256')
    .update(`${action}\n${JSON.stringify(canonical(body))}`)
    .digest('hex');
}

/** Serialises every request carrying the same (actor, key) pair for the rest of the transaction. */
export async function lockIdempotencyKey(tx: Tx, actorSubjectId: string, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${actorSubjectId}\n${key}`}))`);
}

export interface StoredReplay {
  status: number;
  body: unknown;
}

/**
 * The stored response for (actor, key) when the digest matches; undefined when the key is new. Throws the 422
 * when the key was used with a different digest.
 */
export async function findReplay(
  tx: Tx,
  actorSubjectId: string,
  key: string,
  digest: string,
): Promise<StoredReplay | undefined> {
  const [row] = await tx
    .select({
      requestDigest: idempotencyKey.requestDigest,
      responseStatus: idempotencyKey.responseStatus,
      responseBody: idempotencyKey.responseBody,
    })
    .from(idempotencyKey)
    .where(and(eq(idempotencyKey.actorSubjectId, actorSubjectId), eq(idempotencyKey.key, key)))
    .limit(1);
  if (row === undefined) return undefined;
  if (row.requestDigest !== digest)
    throw new InvalidInputError([{ path: IDEMPOTENCY_HEADER_PATH, messageKey: IDEMPOTENCY_KEY_REUSED }]);
  return { status: row.responseStatus, body: row.responseBody };
}

export async function storeIdempotencyKey(
  tx: Tx,
  input: {
    actorSubjectId: string;
    key: string;
    action: string;
    targetCaseId: string;
    digest: string;
    status: number;
    body: unknown;
    now: Date;
  },
): Promise<void> {
  await tx.insert(idempotencyKey).values({
    actorSubjectId: input.actorSubjectId,
    key: input.key,
    action: input.action,
    targetCaseId: input.targetCaseId,
    requestDigest: input.digest,
    responseStatus: input.status,
    responseBody: input.body,
    createdAt: input.now,
  });
}
