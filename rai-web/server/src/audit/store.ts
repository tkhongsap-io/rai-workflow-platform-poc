// W0-04 "Audit log": the append-only audit store. This module exports insert and read functions only; no update or
// delete function exists in the data-access layer (W0-02 section 1.1 rule; A11). The migration adds a trigger that
// raises on UPDATE and DELETE and grants rai_app neither, as defence in depth. Fields are references, never document
// bytes, filenames of real people, feedback text or finding text: `append` validates every ref against the
// reference-only rule and rejects strings longer than 64 characters.

import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@rai/shared/ids';
import type { Executor, Tx } from '../db/client.js';
import { auditEvent } from '../db/schema/audit-event.js';

/** W0-04 `audit_event.action` vocabulary: W0-06 9.4 names verbatim plus the W0-04 and W0-03 additions. */
export const AUDIT_ACTIONS = [
  // workflow (W0-06 section 9.4)
  'case.created',
  'draft.saved',
  'version.submitted',
  'version.resubmitted',
  'lane.opened',
  'lane.approved',
  'lane.sent_back',
  'draft.successor_created',
  'disposition.proposed',
  'disposition.confirmed',
  'disposition.recorded',
  'case.ready_for_launch',
  'qc.run_recorded',
  // non-workflow (W0-04)
  'artifact.uploaded',
  'artifact.downloaded',
  'configuration.published',
  'configuration.draft_saved', // W6-02 (W6 plan section 10): refs are the kind and draft version only
  'configuration.draft_discarded', // W6-02
  'notification.queued',
  'notification.failed',
  'audit.read',
  // identity (W0-03 section 10)
  'identity.signed_in',
  'identity.sign_in_refused',
  'identity.signed_out',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** A reference value: an id, an enum value, a number, a boolean, null, or a shallow structure of those. */
export type AuditRefValue =
  string | number | boolean | null | AuditRefValue[] | { [key: string]: AuditRefValue };
export type AuditRef = { [key: string]: AuditRefValue };

export interface AuditEventInput {
  actorSubjectId: string; // 'system' for the breach digest and mail retry outcomes
  actorRole: string; // the role the actor acted as; 'system'
  action: AuditAction;
  targetCaseId?: string | null;
  targetVersionId?: string | null;
  targetRef?: AuditRef | null; // {slot, artifact_id, finding_id, ...}: IDs only
  beforeRef?: AuditRef | null;
  afterRef?: AuditRef | null;
  correlationId: string; // W0-10; same value as the log line
  occurredAt?: Date;
}

export interface AuditEventRow {
  id: string;
  seq: number;
  occurredAt: Date;
  actorSubjectId: string;
  actorRole: string;
  action: string;
  targetCaseId: string | null;
  targetVersionId: string | null;
  targetRef: unknown;
  beforeRef: unknown;
  afterRef: unknown;
  correlationId: string;
}

export interface AuditQuery {
  caseId?: string;
  correlationId?: string;
  afterSeq?: number; // exclusive; for reconstruction in seq order (A11)
  limit?: number;
}

export class AuditRefRejected extends Error {
  constructor(
    readonly path: string,
    readonly rule: string,
  ) {
    super(`audit ref rejected at ${path}: ${rule}`);
    this.name = 'AuditRefRejected';
  }
}

export const AUDIT_REF_MAX_STRING = 64;
const REF_STRING = /^[A-Za-z0-9_.:/@-]+$/; // ids, enum values, keys, version strings; no whitespace, no free text
const MAX_DEPTH = 3;
const MAX_KEYS = 32;

function validateValue(value: unknown, path: string, depth: number): void {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new AuditRefRejected(path, 'number must be finite');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > AUDIT_REF_MAX_STRING)
      throw new AuditRefRejected(path, `string longer than ${AUDIT_REF_MAX_STRING} characters`);
    if (!REF_STRING.test(value))
      throw new AuditRefRejected(path, 'string is not a reference (ids and enum values only)');
    return;
  }
  if (depth >= MAX_DEPTH) throw new AuditRefRejected(path, 'nested too deep');
  if (Array.isArray(value)) {
    if (value.length > MAX_KEYS) throw new AuditRefRejected(path, 'array too long');
    value.forEach((item, i) => validateValue(item, `${path}[${i}]`, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_KEYS) throw new AuditRefRejected(path, 'too many keys');
    for (const [key, item] of entries) {
      if (!REF_STRING.test(key) || key.length > AUDIT_REF_MAX_STRING)
        throw new AuditRefRejected(`${path}.${key}`, 'key is not a reference');
      validateValue(item, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new AuditRefRejected(path, `unsupported value type ${typeof value}`);
}

/** The reference-only rule (W0-04 "Fields are references, never document bytes"). Throws AuditRefRejected. */
export function validateAuditRef(ref: unknown, name: string): void {
  if (ref === null || ref === undefined) return;
  if (typeof ref !== 'object' || Array.isArray(ref))
    throw new AuditRefRejected(name, 'ref must be an object');
  validateValue(ref, name, 0);
}

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

/** Appends one event inside the caller's transaction. There is no append without a transaction handle. */
async function append(tx: Tx, event: AuditEventInput): Promise<AuditEventRow> {
  if (!ACTION_SET.has(event.action))
    throw new AuditRefRejected('action', `unknown audit action ${String(event.action)}`);
  validateAuditRef(event.targetRef, 'targetRef');
  validateAuditRef(event.beforeRef, 'beforeRef');
  validateAuditRef(event.afterRef, 'afterRef');
  if (event.correlationId.trim() === '') throw new AuditRefRejected('correlationId', 'required');
  const [row] = await tx
    .insert(auditEvent)
    .values({
      id: uuidv7(),
      occurredAt: event.occurredAt ?? new Date(),
      actorSubjectId: event.actorSubjectId,
      actorRole: event.actorRole,
      action: event.action,
      targetCaseId: event.targetCaseId ?? null,
      targetVersionId: event.targetVersionId ?? null,
      targetRef: event.targetRef ?? null,
      beforeRef: event.beforeRef ?? null,
      afterRef: event.afterRef ?? null,
      correlationId: event.correlationId,
    })
    .returning();
  return row as AuditEventRow;
}

/** Reads events in seq order. The route-level policy check (audit.read, Admin only) happens before this is called. */
async function read(exec: Executor, query: AuditQuery = {}): Promise<AuditEventRow[]> {
  const conditions: SQL[] = [];
  if (query.caseId !== undefined) conditions.push(eq(auditEvent.targetCaseId, query.caseId));
  if (query.correlationId !== undefined) conditions.push(eq(auditEvent.correlationId, query.correlationId));
  if (query.afterSeq !== undefined) conditions.push(gt(auditEvent.seq, query.afterSeq));
  const rows = await exec
    .select()
    .from(auditEvent)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(auditEvent.seq))
    .limit(query.limit ?? 1000);
  return rows;
}

/** The audit store: exactly two functions. A test enumerates the keys of this object (W0-04 audit rule 1). */
export const auditStore = Object.freeze({ append, read });
export type AuditStore = typeof auditStore;
