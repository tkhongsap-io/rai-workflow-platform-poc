# Specification

Source: W5 plan section 9 (the W5-06 row), section 6 (the endpoint row, `RiskProposalView`, "No new policy row") and R-14. The plan wins over issue #238.

Done when:

1. **Route** `GET /api/cases/{caseId}/versions/{versionId}/risk-proposal` in `server/src/risk/routes.ts`, registered by `server/src/app.ts` next to the version routes (same deps: database, subject directory for names). `config.auth` = W0-05 `version.view` on the case (the middleware answers 401, 403 and the unknown-case 404 before the handler).
2. **404 rule** (the qc-runs rule, `findings/routes.ts`): a malformed version id, an unknown version, or another case's version → `404 not_found` (`version`); additionally a **draft** (an unsubmitted `pack_version`, `submitted_at IS NULL`) → the same 404.
3. **200 body** `{ proposal: RiskProposalView | null }`:
   - `null` when the submitted version has no `submit` proposal (submitted before W5);
   - otherwise the version's `submit` proposal as `RiskProposalView` (section 6): `proposalId`, `versionId`, `trigger`, `status`, `unavailableReason`, `tier`, `bounds` (`{ lowest, highest }` or null), `councilConfirmation` (`required` for `high`; `possible` for `unknown` with highest `high`; `not_indicated` otherwise), `rubric`, `engineVersion`, `inputsHash`, `createdAt` (ISO), `explanation` (null when unavailable).
   - `rubric` is the **frozen** revision the proposal names (`rubric_revision_id`): `{ revisionId, label, provenance, questions, tierLabels }` from that revision's body, never the revision in force today; null when the proposal names none or its body fails `RiskRubricBodySchema` / `riskRubricBodyProblems`.
   - `explanation.questions[]` carry the stored ids and enums plus, for a question with a stored answer on the frozen version, `answeredBy`, `answeredRole`, `answeredAt` and `answeredByName` (when the subject directory resolves it, W3-F1).
4. **Shared schema** `shared/src/schemas/risk.ts`: `RiskProposalViewSchema`, `RiskProposalResponseSchema` and their types, used as the route's 200 response schema.
5. **Reads only**: no row, audit entry or policy row is added; `authz/policy.ts` is unchanged.
6. **Tests** (new `tests/integration/w5-06-risk-proposal-read.test.ts`, real Postgres, fixture app):
   - 200 shape for a proposed High proposal (bounds, Council `required`, frozen rubric, explanation with attribution and name);
   - all-Unknown proposal: `unknown`, bounds low…high, Council `possible`;
   - unavailable `not_configured`: tier, bounds, rubric and explanation null; never Low;
   - `{ proposal: null }` for a submitted version whose proposal row is absent (pre-W5);
   - the frozen rubric is returned after a newer `risk_rubric` revision is published (label and question text of the old revision);
   - the 401/403/404 matrix, identical to the qc-runs read for every session and target, plus the draft 404; the read writes nothing.
   - Unit test on the pure view builder (`server/src/risk/view.test.ts`).
7. **Docs**: W0-02 section 7.7 dated W5-06 amendment (the endpoint row). Full W5 plan section 10 gate green.
