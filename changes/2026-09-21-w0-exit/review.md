# Review: W0 exit — technical contract and reproducible development plan

2026-09-21. Ticket W0-09 (issue #14), lane Lead, owner type Human; the record is written by the delegated ticket flow (D03 amendment) for Ta's review. Branch `codex/w0-09-w0-exit-review`, worktree `/Users/tkhongsap/github/rai-wt/W0-09`, base `main` at `d16ddaf` (W0-05 merged). Proves: W0 exit. All nine other W0 tickets were merged on `main` before this review started (PRs #57, #65, #61, #63, #59, #62, #64, #60, #58).

This record holds (1) the document and link audit, (2) the cross-spec consistency read with every mismatch and the fix applied to the non-owning document, (3) the TESTING check, (4) the performance targets, (5) the W0-08 acceptance, (6) the W0 exit checklist with evidence, (7) the recorded decisions carried, (8) the stop-condition check, (9) the exact commands and outputs, (10) what remains for Ta and the lead, and (11) the tracker actions.

## 1. Documents and links

Every W0 document exists on `main`:

| Ticket | Document | PR |
|---|---|---|
| W0-01 | `adr/0003-stack-and-deployment-boundary.md` | #57 |
| W0-02 | `docs/engineering/implementation-plan-w1-w3.md` | #65 |
| W0-03 | `docs/engineering/identity-adapter.md` | #62 |
| W0-04 | `docs/engineering/persistence-and-artifact-store.md` | #61 |
| W0-05 | `docs/engineering/authorization-policy-matrix.md` | #58 |
| W0-06 | `docs/engineering/workflow-transition-and-error-contract.md` | #63 |
| W0-07 | `docs/engineering/qc-boundary-and-mail-sink.md` | #60 |
| W0-08 | `docs/engineering/upload-safety-and-fixtures.md` | #64 |
| W0-10 | `docs/engineering/observability-contract.md` | #59 |
| W0-09 | `docs/engineering/performance-targets.md` (new), this review | this PR |

Link and anchor audit: a zero-dependency Node script (kept in the session scratchpad, reproduced in section 9 so it can be rerun; W1-12 ships the permanent `scripts/check-links.mjs`) resolves every relative Markdown link in the ten documents above plus `adr/README.md`, `docs/delivery/w0-technical-contract.md`, `docs/architecture/README.md`, `TESTING.md`, `BUILD_PLAN.md` and this review, and checks every `#anchor` against the target's headings using GitHub's slug rule (lower-case, punctuation dropped, one hyphen per space, so `## W0-02 — file-level implementation plan` is `#w0-02--file-level-implementation-plan`). Links inside fenced code blocks are ignored.

- Before any edit (14 documents present, the two this ticket creates missing): `relative links: 366; broken: 0`.
- After the reconciliation edits and the two new files: `Documents checked: 16/16; relative links: 426; broken: 0; missing documents: 0`, exit 0.

## 2. Cross-spec consistency read

Owner per topic, as the ticket brief fixes it and as the specs themselves recorded it: W0-02 routes, request/response shapes, commands, layout paths and non-identity environment names; W0-03 identity behaviour, the fixture identities and the `RAI_IDENTITY_*` / `RAI_SECRET_*` / `RAI_SESSION_*` names (W0-03 section 9.1, which W0-02 accepted); W0-04 storage, indexes, column vocabularies and database roles; W0-05 the 403/404 choice (assigned to it by ADR-0003 and W0-06); W0-06 the error contract and the order of checks and events; W0-07 the QC and mail interface vocabularies; W0-08 upload safety and the fixture content; W0-10 the log field allow-list. Each mismatch below was fixed in the non-owning document; every applied change is marked "W0-09:" in the document so a reader sees what the exit review touched. Where the owner was silent and a sibling depended on an addition (marked *addition*), the addition was carried into the owner with the sibling's name.

### 2.1 Error codes and HTTP statuses (W0-06 vs W0-02 vs W0-05)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| E1 | Codes and statuses: W0-02 7.1, W0-06 8.1 and W0-05 section 4 all list the same eight codes (`unauthenticated` 401, `forbidden` 403, `stale_version` 409, `invalid_input` 422, `unsafe_upload` 422, `qc_unavailable` 503, `mail_delivery_failed` 502, `not_found` 404) and the 500 `internal_error` catch-all | — | No mismatch. |
| E2 | Envelope: W0-02 7.1 had a flat `ApiError { code, messageKey, correlationId, details }` and `HTTP_STATUS`; W0-06 8.2 has `ErrorResponse { error: { code, messageKey, correlationId, details } }` and `HTTP_STATUS_BY_CODE`; W0-05 already quotes the W0-06 form | W0-06 | W0-02 7.1 rewritten to the W0-06 envelope, `ErrorDetails` map and `StaleReason`, with `internal_error` noted. |
| E3 | `stale_version` details: W0-02 carried `{ current: { revision, versionId?, draftId? } }`; W0-06 carries `reason`, `guidanceKey`, `current { versionId, versionNumber, revision, state, ready }`, `refreshPath` | W0-06 | W0-02 7.1 and the 7.3/7.5/7.6 route rows use the W0-06 reasons (`revision_changed`, `version_superseded`). |
| E4 | `unsafe_upload` details: W0-02 listed five `upload.*` reason keys; W0-08 section 5 owns a 13-value `UnsafeUploadReason` with keys `error.unsafe_upload.<reason>`; W0-06 8.2 had `{ reasonKey }` only; W0-08 5 had its own snake_case body with a top-level `reason`, `message_key`, `correlation_id`, `limits` | W0-06 (envelope), W0-08 (vocabulary) | W0-02 7.1 `unsafe_upload: { reasonKey: 'error.unsafe_upload.<UnsafeUploadReason>', params? }`; W0-08 section 5 rewritten to the W0-06 envelope with `details.reasonKey` and `params`, its `error.unsafe_upload.generic` row withdrawn in favour of W0-06's `error.unsafe_upload`; W0-06 8.2 `unsafe_upload` details gain `params?` (*addition*, for the W0-08 limit placeholders). |
| E5 | Expected version: W0-02 used `expectedDraftRevision` / `expectedCaseRevision`; W0-06 5.1 defines `ExpectedVersion { versionId, revision }` and its stale reasons need the version id; W0-06's consumer table expects W0-02 to carry the shape | W0-06 | W0-02 7.5 `PackDraftUpdateRequest.expectedVersion`, 7.6 `SubmitRequest.expectedVersion` and the `ExpectedVersion` type (verbatim from W0-06, placed in `shared/src/schemas/versions.ts`); `expectedCaseRevision` kept for `PATCH /api/cases/{caseId}` as the same counter. W0-06 5.1 path updated to the W0-02 file; 4.2 notes the two W0-02 routes. |
| E6 | Revision counter: W0-04 stores one `case.row_version`; W0-06 spoke of a per-version `revision`; W0-02 had both `caseRevision` and `draftRevision` | W0-04 | W0-02 and W0-06 record that `draftRevision`, `caseRevision` and `ExpectedVersion.revision` are the one W0-04 `case.row_version` counter (W0-04 `row_version` row says so). |
| E7 | `PUT /api/cases/{caseId}/draft` answered 404 when no draft is open (W0-02); W0-06 4.2 says a save on a draft that was submitted meanwhile is 409 `version_superseded` | W0-06 | W0-02 7.5 row: 404 only for an unknown case; 409 `version_superseded` when the named draft is not the open draft. |
| E8 | Case status vocabulary: W0-02 `CaseStatus` had a `submitted` value "replaced by W2-01"; W0-06 2.4 says there is no other value than its five | W0-06 | W0-02 7.3 `CaseStatus` is the W0-06 2.4 list verbatim; W0-04 `desk_status` row records that its three stored values are a coarse mirror, never the API value. |
| E9 | Idempotency: W0-06 5.3 named `idempotency_records (actor_id, action, key)` and a 24-hour expiry; W0-04 owns `idempotency_key (actor_subject_id, key)` with `action` and `request_digest` columns and `IDEMPOTENCY_TTL_HOURS = 72`; W0-02 listed submit only as keyed in W1 | W0-04 (table), W0-06 (which actions) | W0-06 5.3 and 9.3 use the W0-04 table and 72 h; W0-02 section 7 conventions list create and submit in W1 and drop Ready; W0-04 idempotency rules cite W0-06 5.3 for which actions carry a key. |
| E10 | Projected-field rejection key: W0-05 section 5 uses `error.invalid_input.projected_field`; W0-06 8.5 had no such key | W0-06 (keys) | W0-06 8.5 gains the key with th/en strings (*addition*); W0-02 7.3 rows name it. |
| E11 | 403/404: W0-06 sections 4, 8.3, 8.4 and its open-items table still said "open, W0-05 records"; W0-05 section 4 recorded 403 with non-guessable ids and asked the W0-06 owner to close it; ADR-0003 and W0-02 7.1 carried the open wording | W0-05 (the assigned decider) | W0-06 steps 2-3, 8.3, 8.4 and the open-items row now state the recorded rule; W0-02 7.1 scope rule rewritten; ADR-0003 open item ticked with the pointer; W0-04 download paragraph and open items updated; W0-10 6.1 note updated. |
| E12 | Fixture sign-in errors: W0-03 6.1 had `POST /auth/fixture/sign-in { userId } → 204`, unknown user 422; W0-02 7.2 has `{ fixtureUserId } → 200 SessionInfo`, unknown 404 | W0-02 | W0-03 6.1 and 6.4 follow W0-02. |
| E13 | `unauthenticated` body: W0-03 6.1 read the identity mode from a 401 body `{ code, identityMode }`; W0-06 8.2 forbids details on 401 | W0-06 | W0-03 6.1: the sign-in page probes `GET /auth/fixture/users` (200 in fixture mode, 404 otherwise); W0-02 7.2 states the same. |
| E14 | Category name for the 500 catch-all: W0-10 used `internal`; W0-06 8.1 and W0-04 use `internal_error` | W0-06 | W0-10 6.1, 6.2, 6.3, 6.4 and OBS-14 use `internal_error`. |

### 2.2 Route paths (W0-02 vs W0-05 vs W0-04)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| R1 | W0-05 uses the W0-02 7.4 routes verbatim (`POST /api/cases/{caseId}/artifacts`, `GET /api/artifacts/{artifactId}[/meta]`) | — | No mismatch. |
| R2 | W0-04 "Download" said "route by `artifact_id` inside a case URL" and "an artifact ID under a different case's URL gets 404" | W0-02 | W0-04 paragraph rewritten to the W0-02 route and the W0-05 unresolvable-id rule. |
| R3 | W0-08 section 4 described the upload as a POST "to the draft version's slot" with `slot`, `expected_version` and `idempotency_key` multipart fields, and check 12 set the slot to `attached`; W0-02 7.4 takes one `file` part and attaches through `PUT /api/cases/{caseId}/draft` (7.5); W0-06 5.3 says uploads carry no key | W0-02 | W0-08 section 3 (no non-file fields) and section 4 (route, checks 3, 4, 10, 12, 13) rewritten; W0-02 7.4/7.5 rows state where the pack total is re-checked and when the QC trigger fires; W0-07 3.2 `upload` row names the attaching save-draft. |
| R4 | W0-08 section 6 named the download route `GET /api/.../artifacts/<artifact_id>/content` | W0-02 | W0-08 section 6 uses `GET /api/artifacts/{artifactId}`. |
| R5 | W0-03 6.1 had `GET /auth/session`, `GET /auth/sign-in` (302), `GET /auth/callback` (302), sign-out 204 without a session; W0-02 7.2 has `GET /api/session`, `POST /auth/sign-in → 200 { redirectUrl }`, `GET /auth/callback → 303`, sign-out 401 without a session; W0-03 14(d) had already deferred to W0-02 pending W0-09 | W0-02 | W0-03 section 6.1 rewritten to the W0-02 table; the W0-03 `Sec-Fetch-Site` CSRF check on sign-out is kept and noted in W0-02's row. |
| R6 | `GET /auth/fixture/users` existed only in W0-03 | W0-02 (silent) | *Addition*: carried into W0-02 7.2 with the W0-02 field names (`fixtureUserId`). |
| R7 | Readiness route: W0-04 said `/ready`; W0-02 and W0-10 say `/readyz` | W0-02 | W0-04 uses `GET /readyz` and the W0-10 5.3 field names. |
| R8 | W0-10 section 1 placed the health and operator routes in `server/src/routes/`, the page in `web/src/pages/` and the test helpers in `tests/helpers/`; W0-02 section 1 has `server/src/observability/`, `web/src/screens/`, `tests/support/`; W0-10 8.1 placed the substitutes at `rai-web/fixtures/mail-sink.ts` and `qc-substitute.ts` | W0-02 | W0-10 sections 1, 4.3, 8.1 use the W0-02 paths. |
| R9 | W0-06 placed the lane mapping in `shared/src/workflow/lane-mapping.ts` and `ExpectedVersion` in `shared/src/workflow/expected-version.ts`; W0-02 has `shared/src/constants.ts` (which W0-07 already imports) and `schemas/versions.ts` | W0-02 | W0-06 sections 3 and 5.1 use the W0-02 files. |
| R10 | W0-04 named the migrations path `rai-web/server/migrations/`, the commands `db:migrate` / `db:reset`, the blob default `./var/blobs` and the restart test `restart.test.ts`; W0-02 has `rai-web/server/drizzle/`, `migrate` / `reset`, `./.local/blobs`, `<ticket>-<topic>.test.ts` | W0-02 | W0-04 "Schema evolution", "Layout", "Restart proof" and "Configuration and commands" use the W0-02 names. |
| R11 | Operator commands `db:cleanup`, `store:verify`, `store:cleanup` (W0-04) and `fixtures:generate` (W0-08) were absent from W0-02 3.3 | W0-02 (silent) | *Addition*: carried into W0-02 3.3 under the sibling's names; TESTING mirrors them. |
| R12 | Correlation header: W0-02 named `X-Correlation-Id` and allowed a client-supplied value; W0-10 named `X-Request-Id` and never trusts the client | W0-02 (name), W0-10 (trust rule) | W0-10 uses `X-Correlation-Id` (2.2, OBS-06, OBS-13); W0-02 section 7 states the value is always server-minted. |

### 2.3 Log field allow-list (W0-10 vs W0-07 vs W0-05)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| L1 | W0-05 needs `reason` (`role` / `scope` / `lane` / `self_approval`) on `authz.denied`; W0-10 3.3 did not list it, so the emitter would drop it and T30 could not assert it | W0-10 (silent) | *Addition*: `reason` registered on `authz.denied` (3.3) and on the `forbidden` capture (6.1); W0-05 principle 7, section 4, section 7 preamble, T30 and section 8 updated from "once registered" to registered. |
| L2 | W0-06 section 6 requires an "operator-visible QC-late event (W0-10)"; W0-07 3.4 and section 7 emit `qc.run.late`; W0-10 3.3 had no such event | W0-10 (silent), W0-06 (requirement) | *Addition*: `qc.run.late` registered in W0-10 3.3 with W0-07's fields; W0-07 section 7, 3.8 and section 10 mark it registered; the durable `lateQc` operator record stays open for W3-07 (W0-10 7.3, W0-07 10). |
| L3 | `qc.run.started.trigger`: W0-10 had `artifact/pack/lane`; W0-04 `qc_run.trigger` and W0-07 use `upload/submit/approve_attempt` | W0-04 | W0-10 3.3 and 7.2 use the W0-04 values; `lane?` registered on `qc.run.started` (W0-07 proposal, needed to read an `approve_attempt` line). |
| L4 | `qc.run.unavailable.reason`: W0-10 had `timeout/error/disabled`; W0-07 `QcUnavailableReason` is `timeout/runner_error/not_configured/artifact_unreadable`; `owningLane` was required in W0-10 but absent until W0-06 7.3 is recorded | W0-07 (vocabulary), W0-06 (7.3 open) | W0-10 3.3, 6.1 and 7.2 use the W0-07 values and `owningLane?`; OBS-10 asserts the run row now and the finding row once 7.3 is recorded. |
| L5 | `upload.rejected.reason`: W0-10 had `type_sniff/size/pack_total/extension_mismatch`; W0-08 owns the 13-value vocabulary; W0-08 5.1 named its own event `upload_rejected` with snake_case fields (`version_id`, `slot`, `sniffed_kind`, `declared_extension`, `actor_subject`) | W0-10 (fields), W0-08 (reasons) | W0-10 3.3 and 6.1 carry the W0-08 reasons and make `slot` optional (the upload route is not slot-bound); W0-08 5.1 emits `upload.rejected` with the W0-10 fields only. |
| L6 | `mail.enqueued` / `DeskHealthReport.failedMail.eventType` used `sla_breach`; W0-04 `notification.event` and W0-07 use `sla_breach_digest` | W0-04 | W0-10 3.3 and 7.2 use the W0-04 values. |
| L7 | `auth.signin.failed.reason` and `process.refused.reason` in W0-10 used its own labels; W0-03 owns `SignInReasonCode` and `StartupReasonCode` and amended W0-10 5.4 (`health()` replaces `validateIdentityConfig`, four-value `IdentityMode`) | W0-03 | W0-10 3.3, 5.2, 5.3, 5.4, 5.5, 8.1, OBS-01, OBS-02, section 11 and open items apply the W0-03 amendment. |
| L8 | Fixture canary: W0-10 4.3 and W0-07 4.8 named `RAI-FIXTURE-CANARY-*` and `reviewer.dpo@fixture.invalid`; W0-08 owns the sentinel `RAI-DESK-SYNTHETIC-FIXTURE` and W0-03 the addresses | W0-08, W0-03 | W0-10 4.3, OBS-14 and W0-07 4.6, 4.8 use the sentinel and the `rai-desk.example` addresses. |
| L9 | W0-10 2.3 stated `correlation_id uuid NOT NULL`; W0-04 stores `text` | W0-04 | W0-10 2.3 says `text` holding the UUID string. |
| L10 | W0-10 7.2 queried `notification.delivery_status IN (retrying, failed)` and `qc_run.result`; W0-04 columns are `status` (`queued` / `sent` / `failed`) with `attempts`, and `qc_run.status` / `requested_at` | W0-04 | W0-10 7.2 shape and queries use the W0-04 columns. |
| L11 | W0-10 section 9 named `BLOB_ROOT`, `MAIL_SINK_KIND`, `IDENTITY_MODE`, `HEALTH_PROBE_TIMEOUT_MS`; W0-02 has `BLOB_DIR`, `MAIL_MODE`, `RAI_IDENTITY_MODE` and no probe key | W0-02 | W0-10 section 9 uses the W0-02 names; the probe timeout is a constant recorded in performance targets; `BUILD_COMMIT` added to W0-02 section 5 (*addition*). |
| L12 | W0-07 section 7 fields still proposed (`runKey`, `alreadyRecordedCount`, `runner`, `runnerVersion`) | W0-10 | Left as W0-07's open proposal for W3-07; W0-07 section 10 updated to say which parts were applied. |

### 2.4 Dedup key (W0-04 vs W0-07)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| D1 | W0-04 `UNIQUE (event, version_id, lane, recipient)` with `'-'` for the two lane-less events; W0-07 4.4 `buildDedupKey` builds `<event>:<versionId>:<lane or ->:<address>` from the same four W0-04 values, first component the W0-04 `event` value | — | No mismatch; verified component by component. |
| D2 | Digest: W0-04 stores `version_id NULL` for `sla_breach_digest`, so the unique index cannot enforce one digest per day; W0-07 puts `digestDay` in the version position and enforces per-day identity in the dispatcher and the sinks until W3-03's contract PR records the day on the row | W0-04 | Not a contradiction; carried open in W0-07 section 10 for the W3-03 contract PR (recorded here, no edit). |

### 2.5 Fixture users and the dual-role identity (W0-03 vs W0-08)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| F1 | W0-08 8.2 had `fx-owner`, `fx-spoc-cm`, `fx-coe`, `fx-dpo`, `fx-sec`, `fx-admin`, the dual-role `fx-dual-coe-spoc-rpc` (AI/COE + SPOC of `bu-rpc`), BUs `bu-cm` / `bu-rpc`; W0-03 section 7 (which W0-02 8.3 and W0-05 already follow) has `fx-user-*`, the dual-role `fx-user-dpo-spoc-hr` (DPO + SPOC of `HR`), BUs `CM` / `HR`; W0-08 itself says identities are "owned by W1-00; shape from W0-03" | W0-03 (identities), W0-02 (naming convention) | W0-08 8.2 rewritten to the W0-03 table; W0-08 8.3 cases moved to `CM` / `HR` with the W0-03 SPOC ids and D05 statements corrected to the DPO lane. |
| F2 | W0-05 section 8 needs a second `owner` in `CM` (`owner-b`) for T3, T7, T8, T11, T27, T31, T32, T33; no spec had one; W0-03 required "exactly seven entries" | W0-03 | `fx-user-owner-cm-2` (Prasit W., `owner.cm2@rai-desk.example`, owns no fixture case) added to W0-03 section 7 (eight entries; ID-03, ID-04 updated), W0-02 8.3 and W0-08 8.2; W0-05 placeholder table and section 8 updated. The W0 contract's "six single-role users plus one dual-role identity" set is unchanged; the eighth user is an extra single-role owner for the scope negatives (see section 10). |
| F3 | Case ids: W0-08 used `RAI-FX-0001`-`0004`, which is not a valid W0-04 `registry_id` (`RAI-YYYY-NNNN`); W0-02 8.3 names `fx-case-<kind>` ids and the reserved year `RAI-2000-<nnnn>`; W0-03 ID-13 and W0-05 T19/T25/T32 name `fx-case-hr-dualrole`, which W0-08 did not have | W0-02 (convention), W0-04 (format), W0-08 (content) | W0-08 8.3 uses `fx-case-nonvendor` / `-vendor` / `-missing-slot` / `-na-reasons` with registry ids `RAI-2000-0001`-`0004`, and adds the fifth case `fx-case-hr-dualrole` (`RAI-2000-0005`, `HR`, non-vendor, six documents) so every reference resolves; W0-08 8.4 adds its documents. |
| F4 | Documents: W0-02 8.3 exampled `fx-doc-<slot>-<kind>.<ext>` and a Thai file `fx-doc-05-แผนธุรกิจ.pdf`; W0-08 8.4 owns the content: ids `fx-doc-<case>-<slot>` and the Thai file `เอกสารประกอบ_ผู้ให้บริการ_2569.pdf` (slot 9 of the vendor case) | W0-08 | W0-02 8.3 example aligned to W0-08. |
| F5 | Operator recipient: W0-02 8.3 and W0-07 4.6/4.8 said `operator@rai-desk.example`; W0-08 8.2 owns `operator-digest@rai-desk.example` | W0-08 | W0-02, W0-07 and W0-10 use `operator-digest@rai-desk.example`. |
| F6 | Fixture set identity: W0-08 8.1 used `fixture_set_id = rai-fx-1`; W0-02 8.3 owns the convention `slice1-synthetic@1` plus manifest hash | W0-02 | W0-08 8.1(6) and 8.7 use the W0-02 convention; TESTING cites it. |
| F7 | W0-08 8.1(5) and 8.7 named `db:reset` and generic env names; loader identity-mode names | W0-02, W0-03 | W0-08 uses `reset`, `NODE_ENV`, `RAI_IDENTITY_MODE`. |

### 2.6 Status-field projection rule (W0-04 vs W0-05 vs register)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| P1 | Register: read-only projections written only by the workflow (DPO → `privacy_status`, IT/Security → `security_status`, AI/COE → `rai_status`, Ready → `ai_readiness_status`), never editable by owner or SPOC, never a second record. W0-04 and W0-06 4.10 carry it and add the workflow's other writes (`sent_back` on send-back, reset to `pending` on submit and resubmit, `not_ready` on resubmit); W0-05 section 5's table listed approval writes only | W0-04 (vocabulary and when written) | W0-05 section 5 table now lists decision (approved / sent_back) and the submit/resubmit reset; the authorization consequence (no role has a write row; 422 `error.invalid_input.projected_field`) is unchanged and is consistent across W0-02 7.3, W0-04 enforcement layer 1, W0-05 section 5 and W0-06 4.1. |
| P2 | W0-06 4.10 used the words "not yet reviewed", "pending review", "approved", "sent back", "ready" and listed the vocabulary as open; W0-04 owns `pending` / `approved` / `sent_back` and `not_ready` / `ready`; W0-02 7.3 already uses them | W0-04 | W0-06 4.10 records the W0-04 words and its section 11 item is closed. |
| P3 | W0-04 said the `ai_readiness_status` reset on resubmit depends on "whether resubmission after Ready is reachable"; W0-06 4.12 records that no mutating event is accepted on a Ready case in slice 1 | W0-06 | W0-04 row notes the reset is unreachable in slice 1 and stays as the rule for a later reopen decision. |

### 2.7 Other contradictions found on the way (fixed under the same ownership rules)

| # | Mismatch | Owner | Fix |
|---|---|---|---|
| O1 | QC run placement: W0-04 `qc_run` paragraph and its Submit / Decide rows ran QC and inserted `qc_run` + `qc_finding` inside the trigger's transaction; W0-06 4.3 / 9.1 and W0-07 3.4 run it after commit in its own transaction under the case lock; W0-10 2.4 also said "same transaction" | W0-06 (order) | W0-04 `qc_run` paragraph, Submit and Decide rows rewritten; W0-10 2.2 and 2.4 state the after-commit exception; W0-07 section 10 marks the amendment applied. |
| O2 | Audit event names: W0-04 listed `case.edited`, `finding.recorded`, `qc.unavailable`, `case.ready`; W0-06 9.4 owns `draft.saved`, `qc.run_recorded`, `case.ready_for_launch`, `lane.opened`, `disposition.proposed` / `.confirmed`; W0-02 and W0-05 used `case.updated`; W0-03's `identity.*` events were not in the W0-04 catalogue | W0-06 (workflow events), W0-03 (identity events) | W0-04 `audit_event.action` catalogue rewritten (workflow names verbatim from W0-06 9.4, the non-workflow names W0-04 adds, the three W0-03 identity names); W0-04 transaction rows and projection table renamed; W0-02 7.3 and W0-05 (four places) use `draft.saved`. |
| O3 | Disposition kinds: W0-06 4.8 and W0-05 (`finding.mark_fixed`) have `fixed` (owning lane directly); W0-04 `disposition_event.kind` and `DispositionKind` lacked it | W0-06 | W0-04 kind list, dispositioned rule and `DispositionKind` include `fixed`. |
| O4 | Lane-decision values: W0-04 stores `approve` / `send_back`; W0-06 2.1 and 2.3 wrote `approved` / `sent_back` on the decision row | W0-04 | W0-06 2.1, 2.3, 4.4, 4.5 use the stored values; the derived lane states keep `approved` / `sent_back`. |
| O5 | W0-06 needs `pack_version.ready_at` (4.9, 6, 9.2); W0-04 had no such column; W0-06 also used plural table names and `state` / `revision` / `latest_submitted_version_id` / `ready_version_id` / `actor_id` / `qc_run_id` / `config_revision_id` that W0-04 names differently | W0-04 (which committed to providing W0-06's fields) | W0-04 `pack_version` gains `ready_at` with the W0-06 9.2 trigger exception; W0-06 2.5 gains a mapping table from its field names to the W0-04 columns, and 9.2 / 9.3 / 10 use the singular W0-04 table names and `submitted_at`. |
| O6 | Session mechanism (W0-03 14 b, assigned to W0-09): W0-02 had `SESSION_SECRET` (signed cookie) and `SESSION_TTL_MINUTES=480`; W0-03 6.3 has a random cookie looked up by hash, `RAI_SESSION_ABSOLUTE_HOURS=12`, `RAI_SESSION_IDLE_MINUTES=120` | W0-03 | Confirmed 6.3: W0-02 3.1 (no `openssl rand` step), 4.1 (`@fastify/cookie` reason), section 5 (rows) and TESTING updated; W0-03 14(b) records the confirmation. |
| O7 | Variable names (W0-03 14 d): W0-02 had `IDENTITY_MODE`, `OIDC_ISSUER`, `OIDC_CLIENT_ID/SECRET`, `OIDC_REDIRECT_URI`; W0-03 owns `RAI_IDENTITY_MODE`, `RAI_IDENTITY_GOOGLE_CLIENT_ID/SECRET`, `RAI_IDENTITY_OIDC_*`, `RAI_IDENTITY_ALLOW_LIST_JSON`, `RAI_IDENTITY_ENTRA_TENANT_ID`, `RAI_IDENTITY_LOCAL_ROLE_MAP`, `RAI_IDENTITY_NETWORK_SOURCE`, `RAI_SECRET_SOURCE/DIR`; W0-03 used `RAI_BIND_HOST`, `RAI_PORT`, `RAI_PUBLIC_BASE_URL`, `RAI_TRUST_PROXY` where W0-02 owns `HOST`, `PORT`, `PUBLIC_BASE_URL` | W0-03 (identity names), W0-02 (the rest) | W0-02 section 5 carries the W0-03 names (placeholder `local-google` kept as W0-02's `.env.example` default; W0-03 9.1 placeholder aligned) plus `TRUST_PROXY` (*addition*, W0-03's proposed variable under W0-02's naming); W0-03 sections 2, 4.1, 5, 9.1 use `HOST`, `PUBLIC_BASE_URL`, `TRUST_PROXY`; W0-02 3.4, 3.5, 6 and W0-10 9 use `RAI_IDENTITY_MODE`. The result is a mixed prefix scheme (`RAI_IDENTITY_*` beside `HOST`), recorded in section 10 for the lead. |
| O8 | Identity shape: W0-03 section 2 had `owned_cases` with `ownerSubjectId`, reviewer scopes without `lane`, `Principal` with `identityMode` and `signedInAt`, path `shared/src/identity.ts`; W0-02 7.2 (which W0-05 follows) has `own_cases`, `lane` on reviewer scopes, `SessionInfo`, `schemas/auth.ts` | W0-02 | W0-03 section 2 reproduces the W0-02 shape and marks the earlier draft withdrawn (W0-03 14 d). |
| O9 | Database roles: W0-04 requires `rai_owner` / `rai_app` / `rai_operator` with grants and an init script; W0-02's compose had one `rai` user and no init mount; W0-04 needed `DATABASE_MIGRATE_URL` / `DATABASE_OPERATOR_URL`, `IDEMPOTENCY_TTL_HOURS`, `BLOB_ORPHAN_MIN_AGE_HOURS`, `BLOB_TMP_MAX_AGE_HOURS` in W0-02 | W0-04 (roles), W0-02 (names) | W0-02 section 1 adds `docker/postgres/init/`, section 5 adds the five variables and the compose block mounts the init script; `DATABASE_URL` is the `rai_app` connection. |
| O10 | Upload limit names and values: W0-04 named `UPLOAD_MAX_BYTES` / `PACK_MAX_BYTES`; W0-08 named `UPLOAD_MAX_FILE_BYTES` / `UPLOAD_MAX_PACK_BYTES` / `UPLOAD_MAX_IMAGE_PIXELS` and `BLOB_ROOT`; W0-02 had the first two with `<value from W0-08>` | W0-02 (names), W0-08 (values) | W0-02 section 5 carries the three with `26214400` / `157286400` / `40000000`; W0-04 and W0-08 use `BLOB_DIR`. |
| O11 | Blob layout: W0-08 wrote `<BLOB_ROOT>/objects/<h[0:2]>/<h[2:4]>/<h>`, `staging/`, object mode `0400`; W0-02 wrote `<sha256[0:2]>/<sha256>`; W0-04 owns `sha256/<h[0:2]>/<h[2:4]>/<h>`, `tmp/`, `0600` | W0-04 | W0-02 section 5 `BLOB_DIR` row and W0-08 sections 4, 6, 8.7 use the W0-04 layout. |
| O12 | Sniffing dependency: W0-02 4.1 pinned `file-type` and 7.4 said "sniff with `file-type`"; W0-08 2.5 specifies a hand-written sniff over Node built-ins and no detector | W0-08 | W0-02 4.1 row removed, "Not added, on purpose" says why, 7.4 pipeline rewritten to the W0-08 checks. |
| O13 | `test:unit` glob: W0-07 puts the substitute unit tests under `fixtures/src`; W0-02 3.5 and 8.1 globbed `server/`, `shared/`, `web/` only | W0-02 (silent) | *Addition*: `fixtures/src` in the glob (W0-02 1.1, 3.5; TESTING). |
| O14 | Slot vocabulary in W0-07 3.3 (`na_with_reason`) vs W0-04 / W0-02 (`not_applicable`) | W0-04 | W0-07 `SlotDisposition` uses `not_applicable`. |
| O15 | W0-05 requested a `businessUnitId` key beside the descriptive `businessUnit` text (W0-02 7.3) and a rule for the `business_owner` text column (W0-04) | W0-02 (shape), W0-04 (column) | W0-02 7.3 adds `businessUnitId` (validated against the configured BU list) and states that the server fills `business_owner` from the owner subject's display name; W0-04 `case` rows record both; W0-05 create/edit targets and T6, T13, T31 use `businessUnitId`; section 8 rows closed. |
| O16 | W0-02 4.1 `@fastify/cookie` reason said "signed"; W0-03 6.3 has no signature | W0-03 | W0-02 4.1 row rewritten. |
| O17 | Merged-file links: W0-02, W0-03, W0-05, W0-07, W0-08 and W0-10 still pointed several siblings at contract anchors "until the spec merges" | — | All sibling links now point at the merged `docs/engineering/` files; the audit in section 1 confirms every anchor resolves. |

Not changed, on purpose: the frozen `docs/product/source-spec.md`; the register (`docs/product/decisions.md`; no D-item is recorded or altered, D07-D10 stay open); the W0 contract's ticket sections other than W0-09's own line and the exit checklist; the legacy `demo/`; `docs/board` and DEVLOG/CHANGELOG (appended by the merge step).

## 3. TESTING.md "Product build (W0-W3)"

Confirmed present and mirroring W0-02 section 3 before the reconciliation. After the reconciliation changed section 3 (no `SESSION_SECRET` step, `RAI_IDENTITY_*` names, `fixtures:generate`, the three operator commands, `fixtures/src` in `test:unit`), the mirror was updated in the same PR so the two do not drift. No product command was run: `rai-web/` does not exist until W1-00, and this review claims no runtime success for any of them.

## 4. Performance targets

Recorded in `docs/engineering/performance-targets.md`, marked **targets, not measurements**: ≤ 50 cases per month; packs ≤ 9 files × 25 MiB and ≤ 150 MiB per version; p95 page < 1 s and p95 API < 300 ms on localhost; plus the time budgets the specs asked W0-09 to fix (lock wait 5 s, API request 30 s, upload request 120 s, in-flight uploads per session 2, QC deadline 10 s, mail backoff 1/5/25 s, readiness probe 2 s and 5 s cache, graceful shutdown 10 s). W0-06 section 11 and W0-08 sections 3 and 10 now point at it. The operator has not confirmed the workload numbers; W7-00 records that.

## 5. W0-08 acceptance (synthetic data)

Accepted on Ta's behalf under the D03 delegated ticket flow (register row "D03 (amendment)": the ticket flow implements and Ta reviews the package exit record), for synthetic data only: the allowed list PDF / DOCX / XLSX / PNG / JPEG with everything else refused; 25 MiB per file, 150 MiB per pack version, 40 MP images, the ZIP bounds and the 200-code-point filename rule; the byte-level PDF active-content scan; no malware scanning in slice 1; the fixture identities (W0-03), business-unit labels, cases and the operator address; and that IT/Security was not named by W0 exit, so D08 re-examines every limit before real data. Recorded in W0-08's status line and section 9. If Ta rejects any item on reviewing this record, the W0-08 owner amends the spec before W1-03 starts.

## 6. W0 exit checklist

Ticked in `docs/delivery/w0-technical-contract.md` with evidence per line; repeated here:

- [x] Stack ADR reviewed and accepted by Ta (W0-01): ADR-0003 Accepted; register D04 (Ta, 2026-09-21).
- [x] File-level plan with paths, commands, pinned deps, fixtures and CI checks (W0-02): implementation plan sections 1-6, 8.3; architecture "Path in repo" filled.
- [x] Identity, persistence/artifacts, QC and mail interfaces with error contracts and test substitutes (W0-03, W0-04, W0-07): identity adapter 2 / 6.4 / 7; persistence "Interfaces" / "Error contract" / "Test substitutes"; QC and mail 3.3 / 3.8 / 3.9 / 4.2 / 4.7 / 5.
- [x] Recorded D05, D06 and D11 rules carried as written; D04 recorded; D07-D10 open at their gates: section 7 below.
- [x] `vendor_involved`, `model_type` and the four status fields confirmed and recorded (W0-04): register row "W0-04 fields"; W0-04 "Desk-local Case fields"; W0-05 section 5; W0-06 4.10.
- [x] Upload types and safety limits defined (W0-08): sections 2, 3, 9; accepted for synthetic data (section 5 above).
- [x] Repeatable verification commands specified, no claim of runtime success (W0-09): TESTING mirrors W0-02 section 3; performance targets are targets.
- [x] Observability contract, audit-log rules, schema-evolution rules, UI quality bar and language rule written (W0-02, W0-04, W0-10): observability contract; W0-04 "Audit log" and "Schema evolution"; W0-02 sections 9 and 10.
- [x] Stop condition checked: section 8 below.

## 7. Recorded decisions carried

| Decision | Rule as recorded | Where the specs carry it (unchanged wording) |
|---|---|---|
| D01 | Review desk, not the register; Nakhun is the gate operator; DPO SLA 3 working days, others 5, as Admin configuration | W0-02 7.3 `slaWorkingDays { ai_coe: 5, dpo: 3, it_security: 5 }`; W0-04 `configuration_revision` `sla` body; W0-04 `source_record_id` never validated externally; W0-10 section 1 (never writes to TPM / VRO / AI Reporting Tool) |
| D02 | AI/COE lane = slots 1 and 5; lane mapping is a versioned constant recorded on each submitted version, not Admin configuration | W0-06 section 3 `LANE_MAPPING_V1` (`ai_coe: [1, 5]`, `dpo: [2, 3, 4, 5]`, `it_security: [5, 6, 7, 8]`), unit-frozen; W0-04 `pack_version.lane_mapping_version` + `lane_mapping`; W0-02 `shared/src/constants.ts`; W0-07 3.3 imports it |
| D03 (+ amendment) | W0-W3 authorized on synthetic data; branches, one ticket per PR, reviewed PRs; merge delegated to the ticket flow; Ta reviews package exit records | This branch and PR; W0-08 8.1 (synthetic only); W0-07 4.6 synthetic-domain rule; this record |
| D04 | TypeScript on Node 24, one Fastify deployable serving the React + Vite SPA, Postgres 16 with Drizzle and forward-only migrations, openid-client, local blob store, node:test and Playwright | ADR-0003; W0-02 sections 2 and 4; every spec's "Stack" paragraph |
| D05 | Full re-review after resubmission; concurrent send-backs merge into one successor draft; waived and N/A by the owning lane; owner proposes "fixed", owning lane confirms; no owner or BU SPOC approves a lane on their case | W0-06 4.5, 4.6, 4.7, 4.8, 6; W0-05 3.1 rows and `isOwnerOrSpocOnCase`, `excludeOwnerOrSpoc`, `laneRule: 'owning_lane'`; W0-04 `disposition_event` and Ready predicate; W0-03 section 7 dual-role identity; W0-07 3.6 |
| D06 | Asia/Bangkok; Thai holidays as Admin configuration; SLA clock from lane open, restarts on each new version; one daily breach digest to `operator_recipients` (Admin-editable, seeded in slice 1); failures visible to Admin; mail retried three times with backoff, dedup by (event, version, lane, recipient); no seventh role | W0-02 `APP_TIMEZONE`, section 10.5; W0-04 `calendar` and `operator_recipients` revisions, `notification` unique index, `submitted_at` as the clock start; W0-07 4.1, 4.4, 4.5; W0-05 3.3; W0-10 7.1 |
| D11 | `use_case_group` inherited as required with the value list in Admin configuration; one `stage_context` per version (idea / pre-build / pre-launch), QC input only | W0-02 7.3 `useCaseGroup`, 7.5 `StageContext`; W0-04 `case.use_case_group`, `pack_version.stage_context`; W0-07 `QcRunRequest.stageContext` |
| D12 | Bilingual, Thai default; every user-facing string, email template and finding message carries a locale key; dates in the D06 timezone | W0-02 section 10; W0-03 section 12; W0-06 8.5; W0-07 `message.key`, `RenderedMail.templateKey`; W0-08 section 5 strings; W0-10 7.4 |
| W0-04 fields | `vendor_involved` and `model_type` desk-local; the four status fields are read-only projections written only by the workflow; never editable by owner or SPOC; never a second record | W0-04 "Desk-local Case fields" (three enforcement layers); W0-05 section 5; W0-06 4.10; W0-02 7.3 |
| D07-D10 | Open | D07: W0-02 `RiskTier` placeholder, W0-04 `risk_tier` write gate reserved for W5; D08: W0-04 "Retention and deletion: options" (none chosen), W0-08 section 10; D09: W0-07 section 1 (no model chosen), ADR-0006 reserved; D10: W0-03 section 8 custody mechanism (`env` / `file`, a third by D10), ADR-0004 / 0007 reserved. No spec picks a default for any of them. |

## 8. Stop condition

- **No unrestricted network login.** `local-google` and `fixture` refuse a non-loopback bind or base URL before and after `listen` (W0-03 S2, S3, S14, S16); `network` admits allow-listed or AD-mapped accounts only and refuses to start without custody secrets (S6-S9); `production` is Entra only, refuses any Google variable and a non-`https` base URL (S10, S11, S17); discovery failure refuses start in every provider mode (S18). ADR-0003 "Stop conditions"; W0-03 section 15; W0-10 5.2. Passed.
- **No external-register writes.** No spec names a client, endpoint or credential for TPM, VRO or the AI Reporting Tool (W0-02 section 5 "No TPM, VRO or AI Reporting Tool endpoint or credential exists in any configuration"; W0-04 `source_record_id` "never validated against an external system"; W0-10 section 1). Passed.
- **AI never approves.** QC returns data only, has no write path to workflow state (W0-07 3.1, 3.9), and Ready is a server predicate (W0-06 4.9). Passed.

## 9. Commands and outputs

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0). No Postgres and no product command: document ticket; `rai-web/` does not exist.

| Command | Output |
|---|---|
| `node /…/scratchpad/check-w0-links.mjs .` (before edits) | `Documents checked: 14/16; relative links: 366; broken: 0; missing documents: 2` (the two files this ticket creates), exit 1 |
| same, after edits | `Documents checked: 16/16; relative links: 426; broken: 0; missing documents: 0`, exit 0 |
| `node --test tests/*.test.mjs` | `tests 22, pass 22, fail 0, skipped 0` |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, equals `docs/sources.md` |

The link script, for reruns (place anywhere, run with the repository root as the argument; it lists the 16 documents at the top):

```js
// check-w0-links.mjs — relative-link and anchor audit over the W0 documents (zero dependencies)
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
const root = resolve(process.argv[2] ?? '.');
const docs = ['adr/0003-stack-and-deployment-boundary.md', 'adr/README.md',
  'docs/engineering/implementation-plan-w1-w3.md', 'docs/engineering/identity-adapter.md',
  'docs/engineering/persistence-and-artifact-store.md', 'docs/engineering/authorization-policy-matrix.md',
  'docs/engineering/workflow-transition-and-error-contract.md', 'docs/engineering/qc-boundary-and-mail-sink.md',
  'docs/engineering/upload-safety-and-fixtures.md', 'docs/engineering/observability-contract.md',
  'docs/engineering/performance-targets.md', 'docs/delivery/w0-technical-contract.md',
  'docs/architecture/README.md', 'TESTING.md', 'BUILD_PLAN.md', 'changes/2026-09-21-w0-exit/review.md'];
const stripFences = (s) => s.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
const slug = (h) => h.trim().replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase()
  .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
const cache = new Map();
function anchorsOf(file) {
  if (cache.has(file)) return cache.get(file);
  const set = new Set(); const counts = new Map();
  for (const line of stripFences(readFileSync(file, 'utf8')).split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line); if (!m) continue;
    let s = slug(m[2]); const n = counts.get(s) ?? 0; counts.set(s, n + 1); if (n > 0) s = `${s}-${n}`; set.add(s);
  }
  cache.set(file, set); return set;
}
let total = 0, broken = 0; const missing = [];
for (const doc of docs) {
  const file = resolve(root, doc);
  if (!existsSync(file) || !statSync(file).isFile()) { missing.push(doc); continue; }
  const re = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g; let m;
  const text = stripFences(readFileSync(file, 'utf8'));
  while ((m = re.exec(text)) !== null) {
    const target = m[1]; if (/^(https?:|mailto:)/i.test(target)) continue; total++;
    const [pathPart, anchor] = target.split('#');
    const targetFile = pathPart ? resolve(dirname(file), pathPart) : file;
    if (!existsSync(targetFile)) { broken++; console.log(`BROKEN file   ${doc}: ${target}`); continue; }
    if (anchor && !anchorsOf(targetFile).has(decodeURIComponent(anchor))) {
      broken++; console.log(`BROKEN anchor ${doc}: ${target} (no heading in ${relative(root, targetFile)})`);
    }
  }
}
for (const d of missing) console.log(`MISSING document: ${d}`);
console.log(`\nDocuments checked: ${docs.length - missing.length}/${docs.length}; relative links: ${total}; broken: ${broken}; missing documents: ${missing.length}`);
process.exit(broken || missing.length ? 1 : 0);
```

## 10. Limitations and items for Ta and the lead

- **UI quality bar (W0-02 section 9) and the sub-ticket split (W0-02 11.1, now including W3-07a/b):** written, as the exit checklist requires; Ta's confirmation of the bar as the UI tickets' Done-when standard and the lead's confirmation of the split are still due before W1-06 and W1-01 start. This review could not confirm them on Ta's behalf: the W0 contract names Ta and the lead, not the ticket flow.
- **Eighth fixture identity.** The W0 contract's W0-03 text says "six synthetic single-role users plus one dual-role identity". W0-05's scope negatives need a second owner in the same BU, so `fx-user-owner-cm-2` was added as an additional single-role user (the contract's set is intact). If Ta prefers the contract's count kept literal, W0-05 T3, T7, T8, T11, T27, T31, T32 and T33 need another actor and the lead decides which.
- **Fifth fixture case** `fx-case-hr-dualrole` added to W0-08 so the case that W0-02, W0-03 and W0-05 already named exists; the contract's four required cases are unchanged.
- **Mixed variable prefixes.** Following the recorded ownership (W0-03 owns `RAI_IDENTITY_*`, `RAI_SECRET_*`, `RAI_SESSION_*`; W0-02 the rest) leaves `.env.example` with `RAI_IDENTITY_MODE` beside `HOST` and `DATABASE_URL`. Consistent and unambiguous, but a lead who wants one prefix can rename in the W1-00 PR by editing W0-02 section 5 and W0-03 9.1 together.
- **Delivery README** (`docs/delivery/README.md`) still says "W1-W3 tickets are blocked by W0 exit" in its status line; the ticket brief limited status edits to BUILD_PLAN, so it is left for the merge step or a docs PR.
- **Operator workload numbers** in the performance targets are Ta's planning figures, not yet confirmed by the operator (W7-00).
- The consistency read covered the six named seams and the items the specs assigned to W0-09, plus the contradictions met on the way (section 2.7); it does not claim that no wording difference remains anywhere in about 4,700 lines of specs. Every reconciliation is marked "W0-09:" in the document it touched, so a reviewer can find and revert any single one. No runtime claim is made for any command in TESTING's product section.

## 11. Tracker actions

Run after the branch was pushed, as the ticket brief instructs (results recorded verbatim in the commit that follows):

TRACKER_RESULTS_PLACEHOLDER
