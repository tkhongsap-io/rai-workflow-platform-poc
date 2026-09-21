# Plan

Recorded before the document edits.

1. Rewrite docs/product/decisions.md: recorded table (D01, D02, D03, D05, D06, D11, D12 with answer, approver, date, channel, affected documents) and open table (D04, D07-D10).
2. Propagate to product documents: PRD status, users and authority, primary journey step 5, document pack, SLA paragraph, non-goals; workflow.md heading and proposed markers; data-contract.md D11 and D05 sentences; acceptance.md A04/A05/A06/A07 wording.
3. Propagate to control documents: BUILD_PLAN (G0 closed, decisions-to-lock recorded, status table, W0 Ready), AGENTS.md authorization line, README status and "Before building", TESTING.md.
4. Propagate to the delivery pack: README status and path, decision briefs marked recorded, W0 contract status and D05 caveats, slice-1 Decisions columns, team-and-roles D03 references, design-to-build map D05 line.
5. Update DEVLOG, CHANGELOG and the decisions board lane.
6. Run a multi-agent verification workflow (contradictions, pending-marker sweep, workflow alignment, build-readiness) with a skeptic per finding; apply confirmed findings.
7. Run repository checks: git diff --check, link audit, source hash, node tests, ticket-ID consistency. Record everything in review.md.

Scope: documentation only. Commit, push and PR only on Ta's instruction.
