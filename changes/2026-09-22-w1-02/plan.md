# Plan: W1-02 — create and edit case, read one, list own/BU-scoped

2026-09-22. Ticket W1-02 (issue #18), branch `codex/w1-02-case-crud`, worktree `/Users/tkhongsap/github/rai-wt/W1-02`. Lane A, Agent-eligible. Recorded before code (AGENTS.md).

## Intent

Serve W0-02 section 7.3 verbatim: `POST /api/cases`, `GET /api/cases/{caseId}`, `PATCH /api/cases/{caseId}`, `GET /api/cases?page&pageSize`, `GET /api/configuration/current`. Prove A02 (Unknown saves; known `TPM-…`/`VRO-…` stored and read back unchanged; no register client exists) and A01 (other BU / other owner forbidden on read, list and write; reviewer and Admin never write; T-rows of W0-05 section 7 that name W1-02: T2-T8, T9 (case.view half), T10, T11 (edit half), T13, T31, T33 (case.view half)). Implement D11 (`use_case_group` validated against the current `use_case_groups` revision) and the W0-04 fields rule (desk-local `vendor_involved` / `model_type` stored; the four projections and `risk_tier` rejected at the shape (422 `error.invalid_input.projected_field`, after the policy decision), at the repository (`updateDraftFields` takes a Pick of the editable columns) and at the database (W1-00's `case_projection_gate` trigger; a raw `UPDATE` as `rai_app` outside `rai.workflow_write` fails)).

## Spec (owning documents, read in full)

W0-02 plan sections 1.1, 7.1, 7.3, 8.2, 8.3; W0-04 `case` row, "Desk-local Case fields and the four status projections", "Transactions and idempotency" (Create case, Edit case rows), "Interfaces" (`CaseWriteRepository`, `EditableCaseFields`, `scopedCases`); W0-05 sections 2 (create target, edit target, scope predicate), 4, 5, 6 (middleware order for `case.create` and `case.edit_draft`, query scope), 7 (T-rows); W0-06 sections 2.4, 4 (order of checks), 4.1, 4.2, 5.1-5.3, 8, 9.4; decisions D11 and "W0-04 fields".

## Files (all inside the W1-02 module boundary)

- `rai-web/server/src/cases/` (new module, W0-02 section 1.1 row "Case metadata…"):
  - `source-record-id.ts` — `SourceRecordId` ↔ stored text: `{kind:'unknown'}` ↔ the literal `Unknown`; `{kind:'known', value}` requires the `TPM-` or `VRO-` prefix (7.3 error column) and is stored unchanged; never looked up (L3, L6, L10).
  - `projected-fields.ts` — the seven names 7.3 forbids in a write body (`privacyStatus`, `securityStatus`, `raiStatus`, `aiReadinessStatus`, `riskTier`, `registryId`, `status`) and the `preValidation` check that answers 422 `error.invalid_input.projected_field` (after the policy hook, before schema validation: W0-05 section 5).
  - `scope.ts` — `caseScopeWhere(actor)` and `scopedCases(exec, actor)` (W0-04 Interfaces, W0-05 "Query scope"): built from the actor's grants that hold a `case.view` policy row; `own_cases → owner_subject_id = $subject`; `business_unit → business_unit_id = ANY($bus)`; `all_cases → no filter`; no grant → `FALSE`. Never the descriptive `business_unit` text.
  - `status.ts` — the W0-06 2.4 derivation from rows (`ready_for_launch`, `sent_back`, `draft`, `in_review`; `awaiting_disposition` needs W2's lane and finding rows and is documented as unreachable in slice 1).
  - `business-units.ts` — the configured BU keys (slice 1: the W0-03 fixture BU list, derived from `business_unit` grants; the AD-group mapping arrives at W6/W8).
  - `subject-directory.ts` — resolves a `SubjectId` to a display name for the server-written `business_owner` text (W0-04 `case` row): the actor's own principal, the fixture identities in fixture mode, and any subject that has signed in (the `session` table's stored principal).
  - `repository.ts` — `create` (registry id from the per-year counter, draft v1, nine slots with the non-vendor default), `updateDraftFields` (Pick of the editable columns, `row_version` check), reads for `CaseView` and the scoped list.
  - `service.ts` — the create transaction (advisory lock on (actor, key) → idempotency replay → validation → insert → audit `case.created` → key stored) and the edit transaction (case lock → open-draft and revision checks → write → audit `draft.saved` with the changed-field list and old/new scope values).
  - `routes.ts` — the five routes with `config.auth` per W0-05 (`case.create` target `none` for the role step, the scope step in the handler after validation; `case.view` / `case.edit_draft` target `case`; `case.list` and `config.read_effective` target `none`).
  - `*.test.ts` — unit tests for the pure modules.
- `rai-web/server/src/db/schema/registry-counter.ts` and migration `rai-web/server/drizzle/0003_w1_02_registry_counter.sql` (+ `meta/0003_snapshot.json`, journal entry appended after 0002): the per-year counter behind `RAI-<yyyy>-<nnnn>` (W0-04 `case.registry_id`: "allocated from a per-year sequence inside the create transaction"); grants `rai_app` SELECT, INSERT, UPDATE on it.
- `rai-web/server/src/app.ts`, `start.ts` — register the routes and wire the deps (composition only).
- `rai-web/shared/src/locales/th.json`, `en.json` — two validation keys the 7.3 error column needs and the catalogue lacks: `validation.source_record_id_prefix`, `validation.subject_unresolvable`.
- `rai-web/tests/integration/w1-02-cases.test.ts` — every Done-when clause and the W0-05 T-rows naming W1-02, through `app.inject()` against the real Postgres with the fixture identity provider.
- `docs/architecture/README.md` "Path in repo" — unchanged (the row already names `rai-web/server/src/cases/`). `TESTING.md` — unchanged (no command changes).

## Order

1. Migration 0003 and schema; `npm run migrate`; `drizzle-kit generate` reports no drift.
2. Pure modules with their unit tests (red → green).
3. Integration test file written against the Done-when clauses and T-rows first, then repository, service and routes until green.
4. `npm run verify`, `npm run build && npm run check:substitute-absent`, repository-root checks; review.md; PR.

## Not done here

No search, filters or counts (W3-01); no slot editing (W1-04); no submit (W1-05); no `allowedActions` on reads (W0-02 section 13). No dependency added. No decision D07-D10 touched.
