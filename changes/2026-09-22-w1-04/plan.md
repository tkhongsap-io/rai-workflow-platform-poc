# Plan: W1-04 — nine-slot draft pack

2026-09-22. Ticket W1-04 (issue #20), branch `codex/w1-04-draft-pack`, worktree `/Users/tkhongsap/github/rai-wt/W1-04`, Postgres `rai-w1-04` on port 54324. Lane A, Agent-eligible. Recorded before code (AGENTS.md).

## Intent

Serve W0-02 section 7.5 verbatim: `GET /api/cases/{caseId}/draft` and `PUT /api/cases/{caseId}/draft` (`PackDraftUpdateRequest` with `expectedVersion` per W0-06 5.1). Prove A02: the nine slots hold one of the four facts (attached, not yet, missing, N/A with reason); a reason is mandatory for N/A; slots 3 (DPA) and 4 (SOW) default to N/A with the `default_non_vendor` reason only when the case's `vendor_involved` is false and never when true; `checklist_template_version` is recorded on the draft from the configured list; `stage_context` (D11: idea / pre_build / pre_launch) is stored on the draft and nothing in slice 1 reads it beyond storage. Every save writes the W0-06 `draft.saved` audit event; the W0-07 `upload` trigger hook point exists after commit as a no-op.

## Spec (owning documents, read in full)

W0-02 plan sections 1.1, 7.1, 7.5 (and the 7.3 / 7.4 rows this touches: `POST /api/cases` creates the nine slots; attach is the separate PUT), 8.2; W0-04 `artifact_slot` and `artifact` rows (case binding: `updateDraftSlot` rejects an `artifact_id` of another case with `ArtifactCaseMismatch` → 422 `invalid_input`), "Transactions and idempotency" (Edit case / save draft row: `row_version`, `version_superseded` when the named draft is no longer the open draft), `VersionWriteRepository.updateDraftSlot` / `updateDraftContext`, the W1-04 clause of the proof table; W0-05 edit target (`case.edit_draft`: owner / BU SPOC in scope; reviewers and Admin 403 `role`; out-of-scope 403 `scope`; T10, T11, T33 shape) and section 4; W0-06 section 4 order of checks, 4.2 save draft, 5.1-5.3 (no idempotency key on save draft), 8.2 envelope, 9.4 `draft.saved`, section 10 "stale save draft" row; W0-07 3.2 `upload` trigger (fires after commit, only when the slot's artifact reference actually changed); W0-08 check 10 (per-pack total re-checked at attach); decision D11.

## Files

- `rai-web/server/src/pack/` (new module; W0-02 layout "pack/ — nine-slot draft rules (W1-04)"; same W0-04 boundary as `cases/`):
  - `slots.ts` — pure rules: row ↔ `SlotState` mapping (`default_non_vendor` ↔ the stored locale key `NON_VENDOR_DEFAULT_REASON_KEY`; any other reason text ↔ `{kind:'text'}`), `defaultSlotState(slot, vendorInvolved)` (the create-time default the W1-02 repository now calls), `revertsToMissing` (the 7.5 flip rule: `vendorInvolved` false → true reverts a `default_non_vendor` slot 3/4 to `missing`; a typed reason is kept), `reasonRequiredErrors(rawBody)` (the pre-validation scan that surfaces `validation.reason_required` at `body.slots[n].reason`), `validateSlotValues` (`default_non_vendor` accepted only where the server would set it: slots 3/4 on a non-vendor case; a text reason must be non-blank after trim).
  - `repository.ts` — `readDraftSlots`, `packDraftView` (the 7.5 `PackDraft` from the case row, the draft row and its nine slot rows), `updateDraftSlot` (W0-04: loads the artifact row inside the transaction, throws `ArtifactCaseMismatch` when `case_id` differs or the row is unknown), `updateDraftContext`, `revertVendorDefaults`.
  - `service.ts` — `readDraft` and the save transaction: case lock → step-4 validation (template in the configured list, slot values, artifact case binding) → step-6 expected version (`version_superseded` when `expectedVersion.versionId` is not the open draft or none is open; `revision_changed` when `revision` ≠ `case.row_version`; `version_closed` on a Ready case) → W0-08 check 10 pack total over the slots as they would be after the write (`pack_total_exceeded`, `max_pack_mb`) → apply (slots, context, `row_version + 1`) → audit `draft.saved` (changed fields; slot numbers with new state and, for attached, `artifact_id` and `content_hash`; `row_version` before/after) → commit → `upload` trigger for every slot whose artifact reference changed.
  - `qc-trigger.ts` — the W0-07 hook point: `UploadTrigger` callback type and `noopUploadTrigger`. The W1-10 substitute and the orchestrator (`server/src/qc/`, Lane B/C) are not on `main`, so the server binds the no-op; a failure of a bound trigger is logged as `error.captured` and never reaches the response.
  - `routes.ts` — the two routes, `config.auth` `case.view` (GET) and `case.edit_draft` (PUT) with target `case` (the W1-01 middleware answers 401 / 403 / 404 in the W0-06 order); PUT adds the `preValidation` reason scan so a reason-less N/A is `validation.reason_required`, not a generic shape error.
  - `slots.test.ts` — unit tests for the pure rules.
- `rai-web/server/src/cases/repository.ts` — `insertCase` takes its slot defaults from `pack/slots.ts` (one rule, one place). `cases/service.ts` `updateCase` — when `vendorInvolved` flips false → true, the open draft's `default_non_vendor` slots revert to `missing` in the same transaction and the audit event lists them (7.5 flip rule).
- `rai-web/server/src/app.ts`, `start.ts` — register the routes; `pack` deps (`db`, `limits`, optional `uploadTrigger`).
- `rai-web/tests/integration/w1-04-pack-draft.test.ts` — every Done-when clause, every 7.5 error row, both vendor cases for the slot 3/4 default (create and fixture cases), T10 / T11 / T33 shape for `case.edit_draft` on the PUT, stale `expectedVersion` (409 with the W0-06 8.2 details, nothing written), projections untouched by a draft save, audit shape, pack total re-check, the W0-04 case-binding clause, the upload hook (fires once per changed reference, not on an unchanged one, after commit).
- `docs/architecture/README.md` "Path in repo": `rai-web/server/src/pack/` added to the W0-04 row with W1-04 in its build tickets. `TESTING.md` — unchanged (no command changes). The W1-13 substitute — unchanged (7.5 did not change).
- No migration: the W0-04 case binding is the required repository check; the optional composite FK is left as a follow-up.

## Order

1. Unit tests for `pack/slots.ts` (red → green).
2. Integration test file written against the Done-when clauses and the 7.5 error rows first, then repository, service and routes until green.
3. `npm run verify`, `npm run build && npm run check:substitute-absent`, repository-root checks; review.md; PR.

## Not done here

Submit/freeze (W1-05), the QC orchestrator and the substitute binding (W1-10 is not on `main`; W2-05 / W4), the UI (W1-06), any change to the frozen source spec or to D07-D10.
