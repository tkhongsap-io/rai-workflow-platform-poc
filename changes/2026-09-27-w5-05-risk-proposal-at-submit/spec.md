# Specification

Source: W5 plan section 9 (the W5-05 row), section 0 ("Contract changes made on purpose"), section 2 (fail-closed rows), section 4 ("Submit", "The Ready predicate is untouched"), section 5 (the `risk_proposal` table), section 8 (logs and audit) and section 12 (W0-06 4.3, 9.2, 9.4; W0-04 `risk_tier` writer; W0-10 events). The plan wins over issue #229.

Done when:

1. **Proposal at submit** (`server/src/risk/propose.ts` `proposeAtSubmit`, called by `versions/service.ts` `submitDraft` `apply` right after `freezeDraft`, before `closeDraftOnCase`):
   - reads the `risk_rubric` revision the version froze (`frozen.byKind.risk_rubric`);
   - none frozen → `status = 'unavailable'`, `unavailable_reason = 'not_configured'`, no rubric id;
   - the frozen row is missing, or its body fails `RiskRubricBodySchema` or `riskRubricBodyProblems` → `unavailable`, `rubric_invalid` (rubric id kept);
   - the engine throws → `unavailable`, `engine_error` (rubric id and label kept); the error goes to `errors.internal`; the submit commits;
   - otherwise `proposed` with `tier`, `lowest_tier`, `highest_tier`, `rubric_revision_id`, `rubric_label`, `engine_version`, `inputs_hash` and `explanation` (`questions`, `counts`, `matchedRule`, `escalation`, `unknownCount`: ids and enums only, never attribution or text).
   - Engine inputs: the frozen row's `risk_answers` values (attribution dropped), the version's slot states (slot number → state), the frozen rubric body. `trigger = 'submit'`, `correlation_id` = the submit's, `created_at` = the submit instant.
   - Insert through `server/src/risk/repository.ts` `insertRiskProposal` (the only writer).
2. **`case.risk_tier`**: `closeDraftOnCase` takes `riskTier` and writes it in the same UPDATE (under `rai.workflow_write`): the proposal's tier (`high`, `medium`, `low` or `unknown`), NULL when `unavailable`. Resubmit writes the new version's tier; v1's proposal row stays unchanged.
3. **Audit** `risk.proposed` in `AUDIT_ACTIONS` (workflow group); written after `version.submitted` / `version.resubmitted` and before the three `lane.opened`, same correlation ID, `targetCaseId`, `targetVersionId`, `targetRef { proposal_id, status, unavailable_reason, tier, lowest_tier, highest_tier, unknown_count, rubric_revision_id, rubric_label, engine_version, inputs_hash }` (nulls where not applicable; no answer value, no text, no name).
4. **Logs** (`observability/log.ts` `EVENT_CATALOGUE`, after commit, fresh submits only): `risk.proposal.recorded` (info; `proposalId`, `caseId`, `versionId`, `status`, `tier`, `rubricRevision`, `engineVersion`, `unknownCount`, `durationMs`) for a proposed row; `risk.proposal.unavailable` (error; `proposalId`, `caseId`, `versionId`, `reason`, `rubricRevision?`) for an unavailable row. No answer value, question text or name.
5. **Replay** of the same Idempotency-Key writes no second proposal, audit or log line.
6. **`RiskTier`** in `shared/src/schemas/cases.ts` becomes `'high' | 'medium' | 'low' | 'unknown'` (R-9); `CaseView.riskTier` carries it.
7. **Ready untouched**: `workflow/ready.ts` and `authz/policy.ts` reach no `risk` module (transitive module-graph unit test); no `ACTIONS` entry names risk; a Low-tier case with no approvals is not Ready; a High proposal opens all three lanes.
8. **Intended changes to existing tests** (and no other): (1) `w1-05-submit.test.ts` projections test renamed "…risk tier is the recorded proposal", `risk_tier` leaves the untouched list, asserts `'unknown'` in the row and the view; (2) the same file's audit allow-list gains `'risk.proposed'`; (3) `w2-01-lanes.test.ts` "risk_tier = high" test reaches High through three saved high answers (slot 1 attached) instead of a raw UPDATE, then asserts the proposal, `case.risk_tier` and three `lane.opened`; (4) `audit/store.test.ts` names `risk.proposed`.
9. **Docs**: W0-06 4.3 (tier moves from "After commit" into the transaction), 9.2 (closing note), 9.4 (`risk.proposed`); W0-04 `risk_tier` writer text; W0-10 catalogue gains the two events. Dated notes.
10. New `tests/integration/w5-05-risk-submit.test.ts`: none, partial and all answers; `evidence_not_attached`; `not_configured`; `rubric_invalid`; injected engine error still commits; `case.risk_tier` on submit and resubmit (v1 unchanged); High opens three lanes; Low with no approvals not Ready; log lines and audit; replay.
11. Full W5 plan section 10 gate green. No migration, no route, no UI.
