# Change specification

Done when:

- docs/product/decisions.md separates recorded decisions (D01, D02, D03, D05, D06, D11, D12) from open ones (D04, D07-D10), each recorded row carrying the exact answer, approver, date and channel.
- No document still describes D01, D02, D03, D05, D06, D11 or D12 as pending, proposed or awaiting confirmation, except the change history and the board, which describe the state at the time.
- PRD, workflow, data contract, acceptance, BUILD_PLAN, AGENTS, README, TESTING and the delivery pack state that W0-W3 are authorized on synthetic data, W0 is Ready, W1-W3 are blocked only by W0, and W4-W8 remain gated.
- Ticket "Decisions" columns for the resolved IDs read as met; W0-05/W0-06 lose their "provisional" caveats for D05; lane mapping shows the D02 answer as decided.
- The frozen source-spec bytes are unchanged and its SHA-256 still matches docs/sources.md.
- A verification workflow over the finished documents finds no contradiction and confirms the plan matches the source workflow; its confirmed findings are applied and recorded in review.md.

Constraints: Markdown only. No code, manifests, CI or deployment files are created by this change; D03 authorizes the team to create them under W0-02 and later tickets, in reviewed PRs. No dates or estimates. D04, D07-D10 stay open.
