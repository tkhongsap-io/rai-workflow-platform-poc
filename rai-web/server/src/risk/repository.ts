// W5-05 (W5 plan section 5): the one writer of `risk_proposal`. The table is append-only (trigger
// risk_proposal_append_only; `rai_app` holds SELECT and INSERT only), so this module has no update or delete path.
// W5 inserts the `submit` proposal inside the submit transaction; `recheck` rows are W6-19's.

import type { Tx } from '../db/client.js';
import { riskProposal } from '../db/schema/risk-proposal.js';

export type RiskProposalRow = typeof riskProposal.$inferSelect;
export type RiskProposalInsert = typeof riskProposal.$inferInsert;

/** Inserts one proposal row and returns it as stored. */
export async function insertRiskProposal(tx: Tx, row: RiskProposalInsert): Promise<RiskProposalRow> {
  const [inserted] = await tx.insert(riskProposal).values(row).returning();
  return inserted!;
}
