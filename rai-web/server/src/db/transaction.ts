// Transaction primitives (W0-04 "Transactions and idempotency"): a plain transaction, the workflow-write setting the
// case projection gate requires, and the case row lock. Keyed actions compose them in `withWorkflowTransaction`
// (versions/transaction.ts), which adds idempotency replay and audit-before-commit.
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';

export const LOCK_TIMEOUT = '5s'; // performance targets: lock wait 5 s

export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`));
    return fn(tx);
  });
}

/** Marks the transaction as a workflow write so the `case` projection gate admits projection changes (W0-04 fields). */
export async function setWorkflowWrite(tx: Tx): Promise<void> {
  await tx.execute(sql`SET LOCAL rai.workflow_write = 'on'`);
}

/** Serialisation point for every business action on one case (W0-06 9.1): SELECT ... FOR UPDATE on the case row. */
export async function lockCase(tx: Tx, caseId: string): Promise<boolean> {
  const result = await tx.execute(sql`SELECT id FROM "case" WHERE id = ${caseId} FOR UPDATE`);
  return result.rows.length === 1;
}
