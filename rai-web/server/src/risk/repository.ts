// W5-05 (W5 plan section 5): the one writer of `risk_proposal`. The table is append-only (trigger
// risk_proposal_append_only; `rai_app` holds SELECT and INSERT only), so this module has no update or delete path.
// W5 inserts the `submit` proposal inside the submit transaction; `recheck` rows are W6-19's. W5-06 adds the read.

import { and, eq } from 'drizzle-orm';
import type { Executor, Tx } from '../db/client.js';
import { riskProposal } from '../db/schema/risk-proposal.js';

export type RiskProposalRow = typeof riskProposal.$inferSelect;
export type RiskProposalInsert = typeof riskProposal.$inferInsert;

/** Inserts one proposal row and returns it as stored. */
export async function insertRiskProposal(tx: Tx, row: RiskProposalInsert): Promise<RiskProposalRow> {
  const [inserted] = await tx.insert(riskProposal).values(row).returning();
  return inserted!;
}

/** W5-06: the version's `submit` proposal (at most one, unique index), or undefined for a version submitted before W5. */
export async function readSubmitProposal(
  exec: Executor,
  versionId: string,
): Promise<RiskProposalRow | undefined> {
  const [row] = await exec
    .select()
    .from(riskProposal)
    .where(and(eq(riskProposal.versionId, versionId), eq(riskProposal.trigger, 'submit')))
    .limit(1);
  return row;
}
