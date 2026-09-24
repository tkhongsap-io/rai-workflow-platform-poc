// W0-04 `withWorkflowTransaction`, the recipe every keyed business action runs: one transaction that marks itself a
// workflow write (the projection gate admits projection changes only here), locks the case row (W0-06 9.1: the
// serialisation point for every action on one case) and then the (actor, key) pair (one key reused on two cases
// would otherwise race to the key's primary key), runs the store-backed part of step 4, answers a replay for
// (actor, key) with the stored response (step 5; a different digest under the same key is 422
// `idempotency_key_reused`), runs the action (steps 6 and 7), refuses to commit when the action wrote no audit event
// (W0-04 "Audit log"), and stores the key with the response (W0-04: only on success; `storeAction` lets submit record
// `case.resubmit`). A contract error thrown anywhere rolls everything back, so a failed action leaves no row and can
// be retried under the same key. Lock order is case then key; create-case takes only the key lock, on a new case.

import { NotFoundError } from '@rai/shared/errors';
import type { Principal, Role } from '@rai/shared/schemas/auth';
import { auditStore, type AuditEventInput } from '../audit/store.js';
import { findReplay, lockIdempotencyKey, storeIdempotencyKey } from '../cases/idempotency.js';
import { readCaseRow, type CaseRow } from '../cases/repository.js';
import type { Db, Tx } from '../db/client.js';
import { lockCase, setWorkflowWrite, withTransaction } from '../db/transaction.js';

/** Who acts, as which role (the policy row that allowed), under which correlation id (W0-10). */
export interface ActionContext {
  actor: Principal;
  role: Role;
  correlationId: string;
}

/** The action context with the keyed action it runs. */
export interface WorkflowActionContext extends ActionContext {
  action: string; // the W0-04 `idempotency_key.action` name, e.g. 'case.submit'
  idempotencyKey: string;
  requestDigest: string; // SHA-256 over the action and the canonical body (cases/idempotency.ts)
  now: Date;
}

export interface WorkflowResponse<T> {
  status: number;
  body: T;
  /**
   * Optional override for the stored `idempotency_key.action` (W2-04: `case.resubmit` when the locked
   * draft had a parent). Replay matching stays by actor + key + digest; this field is not part of the digest.
   */
  storeAction?: string;
}

export interface WorkflowResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** What the action receives: the transaction, the locked case row and the audit writer it must call. */
export interface WorkflowScope {
  tx: Tx;
  caseRow: CaseRow;
  /** Appends one audit event; the transaction is refused unless the action called this at least once. */
  audit: (event: Omit<AuditEventInput, 'correlationId' | 'actorSubjectId' | 'actorRole'>) => Promise<void>;
}

export interface WorkflowAction<T> {
  /** Step 4, the part that needs the store (runs before the replay check, W0-06 section 4 order). Optional. */
  validate?(tx: Tx, caseRow: CaseRow): Promise<void>;
  /** Steps 6 and 7: the expected-version checks and the writes; must call `scope.audit` at least once. */
  apply(scope: WorkflowScope): Promise<WorkflowResponse<T>>;
}

export class AuditEventMissing extends Error {
  constructor(readonly action: string) {
    super(`workflow action ${action} returned without writing an audit event (W0-04 audit rule)`);
    this.name = 'AuditEventMissing';
  }
}

export async function withWorkflowTransaction<T>(
  db: Db,
  caseId: string,
  ctx: WorkflowActionContext,
  action: WorkflowAction<T>,
): Promise<WorkflowResult<T>> {
  return withTransaction(db, async (tx) => {
    await setWorkflowWrite(tx);
    if (!(await lockCase(tx, caseId))) throw new NotFoundError('case'); // resolved by the middleware; a race
    const caseRow = (await readCaseRow(tx, caseId))!;
    await lockIdempotencyKey(tx, ctx.actor.subjectId, ctx.idempotencyKey);
    if (action.validate !== undefined) await action.validate(tx, caseRow);
    const replay = await findReplay(tx, ctx.actor.subjectId, ctx.idempotencyKey, ctx.requestDigest);
    if (replay !== undefined) return { status: replay.status, body: replay.body as T, replayed: true };

    let audited = 0;
    const response = await action.apply({
      tx,
      caseRow,
      audit: async (event) => {
        await auditStore.append(tx, {
          ...event,
          actorSubjectId: ctx.actor.subjectId,
          actorRole: ctx.role,
          correlationId: ctx.correlationId,
          occurredAt: event.occurredAt ?? ctx.now,
        });
        audited += 1;
      },
    });
    if (audited === 0) throw new AuditEventMissing(ctx.action);
    await storeIdempotencyKey(tx, {
      actorSubjectId: ctx.actor.subjectId,
      key: ctx.idempotencyKey,
      action: response.storeAction ?? ctx.action,
      targetCaseId: caseId,
      digest: ctx.requestDigest,
      status: response.status,
      body: response.body,
      now: ctx.now,
    });
    return { status: response.status, body: response.body, replayed: false };
  });
}
