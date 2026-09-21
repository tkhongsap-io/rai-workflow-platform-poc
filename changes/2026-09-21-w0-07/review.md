# Review: W0-07 — QC boundary and mail sink specs with test substitutes

2026-09-21. Ticket W0-07 (issue #12), lane Lead, branch `codex/w0-07-qc-and-mail-boundaries`, worktree `/Users/tkhongsap/github/rai-wt/W0-07`. Agent-eligible draft; human review per the ticket's owner type and independent reviewer agents before merge per the D03 amendment.

## Intent and plan (recorded before writing)

Write the W0-07 interface spec at `docs/engineering/qc-boundary-and-mail-sink.md`, concrete for the D04 stack (ADR-0003), covering for each boundary: interface in TypeScript notation, error contract mapped to the ADR-0003 codes, test substitute with its control API and the tests W1-10 and W1-11 must ship, configuration keys, observability fields, and cross-links to every consuming ticket. Carry D05, D06, D12, L7 and L8 as written; leave D07-D10 open; do not fill the W0-06 owning-lane refinement; do not edit any other lane's document or the frozen source spec.

## What landed

- `docs/engineering/qc-boundary-and-mail-sink.md` (new; this bullet describes the spec as it stands after fix round 6). Sections: what is and is not decided; placement in the D04 stack at the W0-02 paths (`shared/src/qc/types.ts`, `shared/src/mail/types.ts`, `server/src/qc/`, `server/src/notifications/`, `fixtures/src/substitutes/qc/`, `fixtures/src/substitutes/mail-sink/`, colocated `*.test.ts`); QC boundary (authority limits; three triggers fired after the action's transaction commits; `QcRunRequest` / `QcFinding` / `QcRunResult` / `QcRunner` types with `EvidenceLocation` carrying locators and an `excerptHash` only, never document text; orchestrator steps with one immutable `qc_run` insert after the runner answers, an in-process in-flight table, the late check that refuses an append on a Ready version and emits `qc.run.late`; scripted rule families with stable IDs and reserved slot-5/9/pack rows; owning lane per W0-06 7.1 through `owningLaneForSlot` with 7.3 carried open and no provisional value, companion constant or `pending` lane; the QC-unavailable finding template, stored only once 7.3 is recorded; `runKey` over `versionId | trigger | lane | qcRulesRevision | sorted slot:contentHash` with no attempt counter, replay by the W0-04 columns; error mapping in which only the lane-QC run endpoint answers with a run body and upload/submit responses do not wait; the `ScriptedQcRunner` substitute selected by `QC_MODE=substitute` with its control API, including the W0-10 `health()` hook, and ten required W1-10 tests); mail sink (transactional outbox placement, `CommittedEvent` / `AuthorizedRecipient` / `SafeDeepLink` / `DigestCaseRef` / `DeliveryRequest` / `DeliveryReceipt` / `MailSink` types, defensive validation with the five-value `error.code` union, D06 dedup key including the digest-day mapping proposed for W3-03 to confirm, retry ownership in W3-04 with proposed backoff numbers, content and safety rules including the RFC 2606 synthetic-domain rule and the W0-02 `MAIL_MODE` values `sink-memory` | `sink-file`, `MemoryMailSink` and `FileMailSink` with control APIs and nine required W1-11 tests); error summary for both; the W0-02 configuration keys (`QC_MODE`, `MAIL_MODE`, `MAIL_SINK_DIR`, `PUBLIC_BASE_URL`) with this spec's fail-closed rules and no keys of its own; W0-10 observability fields in W0-10's names; test-layer map for A05, A08 and A09; consumer table; open items with the proposed amendments to W0-02, W0-04 and W0-10; W0 contract traceability table.
- `adr/README.md`: row 0006 (reserved) now points at the W0-07 spec as the source of the runner port and substitute, in the same style as rows 0004 and 0005.

Not edited, on purpose: `docs/product/source-spec.md` (frozen; hash verified below), `docs/product/decisions.md` (agents never record decisions), `docs/architecture/README.md` and `TESTING.md` (W0-02 owns those edits), the W0 contract, any other lane's spec, DEVLOG/CHANGELOG/board (appended by the merge step).

## Choices made inside this ticket's remit, flagged for the reviewer (current after fix round 5)

- `production` identity mode plus `QC_MODE=substitute` fails startup (fail closed, mirroring the W0-03 posture); `QC_MODE` and `MAIL_MODE` unset or outside the W0-02 value sets fail startup. W1-00 implements the checks against W0-02's keys.
- Sinks reject any recipient address outside RFC 2606 reserved domains while slice 1 runs; the W0-02 fixture addresses (`rai-desk.example`) and the W0-10 fixture identities (`fixture.invalid`) satisfy it.
- `MAIL_MODE` has exactly the two W0-02 values (`sink-memory`, `sink-file`); no transport that leaves the process exists until D10.
- `qc_run` is inserted once with its final status and never updated (W0-04); there is no in-progress row. In-flight duplicates are joined through an in-process promise table; replay is by the W0-04 columns for `submit` and `approve_attempt` (frozen version) and every `upload` trigger is a new run (W1-03 fires it only on a slot-reference change). A `run_key` column is proposed to W0-04 in section 10, not assumed.
- Evidence carries locators and at most an `excerptHash` (W0-04 `excerpt_hash`); no document text leaves the runner and a result carrying an `excerpt` field is rejected at the boundary.
- Owning lane follows W0-06 section 7 exactly: single-lane slots through `owningLaneForSlot`; slot 5, slot 9, pack-level and `unavailable` findings wait for the 7.3 record, with the 7.4 interim posture carried as written (no lane on the `unavailable` result, no such finding in the scripts, the `unavailable` run row stored but no `unavailable` finding until the record exists). The QC-unavailable finding template is kept for that moment.
- The QC-unavailable finding is one per run, scoped by trigger and lane, and never auto-closed by a later successful run.
- `DeliveryRequest.deepLinks` is a list plus `digestCases` for the operator digest, so the SLA-breach digest carries one validated `case` link per breached case (source-spec Notifications table, A05) and the sink validates every link, failing the whole delivery on one bad link (spec 4.2, 4.3, 4.8).
- Values W0-02 does not make configurable (QC timeout, retry backoff, forced sink failure, a disabled QC mode) are module constants or control-API calls in slice 1 and are listed in section 10 as proposed W0-02 additions, not read from the environment.
- Proposed numbers (backoff 1 s / 5 s / 25 s, QC timeout 10 000 ms, feedback summary 500 code units) are defaults for W3-04, W1-00 and W1-10 to confirm, not decisions of record.
- QC placement follows W0-06 4.3/9.1 (after commit, own transaction under the case lock), not W0-04's in-transaction wording; the disagreement between the two merged specs is stated in 3.4 and proposed as a W0-04 amendment in section 10, not resolved here.
- A run whose findings arrive after the version is Ready writes nothing at all (no finding, no `qc_run` row) and emits `qc.run.late`; the no-row choice follows W0-06 2.2 ("a Ready version accepts only reads") and avoids a zero-finding run row that would read as clean. A version closed by a send-back but not Ready still accepts the append, because W0-06 section 6 refuses only the Ready case and a closed version can never become Ready. Both are reviewer calls if W0-06 is read differently.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the two touched files (GitHub slug rule, one hyphen per space) | 21 links, 0 broken |

No product suite exists yet (the `rai-web` skeleton arrives with W1-00), so `npm test`, `npm run lint`, `npm run typecheck` and Playwright do not apply to this ticket. No Postgres container was started.

## Fix round 1 (review findings on PR #60)

Two blocking findings, both resolved in `docs/engineering/qc-boundary-and-mail-sink.md`:

1. **3.7 contradicted 3.6 and 3.4 step 2** (a unique `runKey` returned an `unavailable` or crashed `running` run forever). Now: `attempt` on `QcRunRequest` and the run row; unique `(runKey, attempt)` plus a partial unique index on completed `runKey`; a lookup table in 3.7 (replay only on `completed`; new attempt after `unavailable` or age-out; in-flight `running` returned); 3.4 step 2 states the age-out margin and that the age-out and the next attempt share a transaction; 3.6 ties "fixed by a later completed run" to the next attempt; the W2-05 integration list gains "a second run after `unavailable` completes and appends; the unavailable finding stays open" and the replay and age-out cases; section 7 logs `attempt`; sections 9 and 11 updated.
2. **The SLA-breach digest could not carry validated per-case links** (one `deepLink`, scalar `templateParams`). Now: `deepLinks: SafeDeepLink[]` (at least one), `SafeDeepLink.caseId`, `DigestCaseRef { caseId, lane, deepLinkIndex }` and `digestCases` on `DeliveryRequest`; 4.3 validates every link, checks each link's `caseId` against the event or its digest entry, and requires every URL in `textBody`, failing the whole delivery on one bad link; 4.6, 4.8 (accepts-inputs and unsafe-link rows, including a digest with one bad link among several), section 7, 8, 9 and the section 11 traceability row updated.

Checks rerun after the fix: table below refreshed (same commands; link audit now 21 links, 0 broken over the three touched files).

## Fix round 2 (review findings on PR #60)

Three blocking findings, all resolved in `docs/engineering/qc-boundary-and-mail-sink.md`:

1. **Mail error contract incomplete** (two findings on 4.2/4.3/4.8, resolved together). `DeliveryReceipt.error.code` gains `'malformed_request'`; 4.3 now ends every check with its `→ otherwise <code>` clause (`textBody` links → `unsafe_link`; `auditEventId` → `malformed_request` naming the field; subject > 998 bytes or body > 64 KiB → `sink_failure` naming the field and byte size), states the check order and that `malformed_request` is reserved for a structurally invalid request; 4.8 gains the row "malformed or oversize request rejected" (empty `auditEventId`, 65 537-byte body, 999-byte subject; nothing recorded; the key is still deliverable afterwards); sections 5, 8 and 11 name the five-value union.
2. **Fail-closed `QC_RUNNER` rule had no test row.** 3.9 gains the row "fail closed on configuration" (owner W1-00 for the loader, W1-10 for the runner identity; same pattern as the 4.8 "no external mail path" row): `production` + `QC_RUNNER=scripted` throws, `QC_RUNNER=other` throws in every mode, unset throws, `none` loads with `unavailable:not_configured`, readiness reports the runner identity. Section 6's `QC_RUNNER` row and section 8's A08 unit row point at it.

Checks rerun after the fix: same commands as the table above; results recorded in the PR body.

## Fix round 4 (review findings on PR #60; the review workflow numbers this round 4, no round-3 commit exists on this branch)

Two blocking findings, both resolved in `docs/engineering/qc-boundary-and-mail-sink.md`:

1. **`runKey` omitted the slot.** On the `upload` trigger `versionId` is the draft ID, so the same bytes uploaded to a second slot hashed to the first slot's key and 3.7 treated the second upload as a replay, skipping that slot's own completeness rules (source spec: "On each upload: that artefact's own completeness rules"). Now 3.7 hashes sorted `${slot}:${contentHash}` pairs; the same bytes in two slots are two keys and two runs, the same bytes in the same slot again replay, and `artifactId` stays out of the key (a row identity, not a QC input). The W2-05 integration list in 3.9 gains "same bytes uploaded to two slots on one draft → two runs".
2. **No source for the owning lane of orchestrator-built findings.** 3.4 step 5 said provisional scopes take "the runner's value", but the QC-unavailable finding is built by the orchestrator and no runner value exists for an `unavailable` result, an aged-out `running` row or the `QC_RUNNER=none` runner. Now 3.6 names one source per producer without choosing a lane: runner-produced provisional findings (slot 5, slot 9, pack) keep the script value; the orchestrator-built QC-unavailable finding reads a **provisional owning-lane companion** (`PROVISIONAL_OWNING_LANE_BY_MAPPING`, a separate shared constant keyed by the W0-06 mapping version string, resolved by the `laneMappingVersion` recorded on the version, `run` field by trigger with `'trigger_lane'` allowed for `approve_attempt`, deleted when W0-06 records the rule) through `resolveOwningLane(scope, request, runnerValue | null)`, which wraps `owningLaneForSlot`. Startup fails closed when an exported mapping version has no entry or an unset field (added to the 3.9 "fail closed on configuration" row); a run-time miss throws before the run row is written. 3.4 step 5 now restricts "the runner's value" to runner-produced findings; step 4 rejects a runner-produced `run`-scoped or `QC-UNAVAILABLE` finding as `runner_error`; 3.5 and the 3.9 "provisional owning lane visible" row say scripts never contain that finding; the W2-05 list gains the unavailable-finding-lane and unknown-mapping-version cases; sections 9, 10 and 11 updated. Section 10 also records that W0-06 section 7.4 (merged after this branch was cut) states a different interim posture for W1-10 and W2-05, that the W0-09 exit review picks one, and that neither posture chooses a lane.

Checks rerun after the fix: same commands as the table above (`node --test tests/*.test.mjs` 22 pass, 0 fail; `git diff --check` clean; source-spec hash unchanged; link audit 21 links, 0 broken).

## Fix round 5 (review findings on PR #60 after W0-02, W0-04, W0-06 and W0-10 merged; the review workflow restarted its counter at "round 1" for this pass)

Eight findings, resolved by a rebase onto `main` and a rewrite of the affected sections of `docs/engineering/qc-boundary-and-mail-sink.md`:

1. **Rebase and `adr/README.md` conflict.** Branch rebased onto `main` (`32e16ee`); the `adr/README.md` conflict resolved by keeping both link edits (row 0005 from W0-04 on `main`, row 0006 from this PR). Force-pushed.
2. **W0-04 immutability of `qc_run`** (two findings). 3.4 no longer inserts a `running` row, updates it or ages it out: one INSERT with the final status after the runner answers, under the case lock, with the W0-04 column mapping stated for `qc_run` and `qc_finding`; in-flight duplicates are joined through an in-process promise table and a crash leaves no row. 3.7 drops `attempt`, keeps `runKey` as the deterministic input identity on the request and log line, and looks up "the latest run for the same input" through the W0-04 columns (`submit`, `approve_attempt`: exact on a frozen version; `upload`: always a new run because W1-03 fires the trigger only on a slot-reference change). `EvidenceLocation.excerpt` is replaced by `excerptHash` (W0-04 `excerpt_hash`); 3.1, 3.4 step 4, 3.9 and 4.8 reject any document-text field. The `run_key` column and index are moved to section 10 as a proposed W0-04 amendment for the lead.
3. **W0-06 sections 7.3/7.4 owning-lane posture** (two findings). `PROVISIONAL_OWNING_LANE_BY_MAPPING`, `resolveOwningLane`, `OwningLaneBasis`/`owningLaneBasis` and the W1-00 startup check are deleted. The `unavailable` result carries no lane; 3.4 step 5 checks runner values against `owningLaneForSlot` for single-lane slots and rejects (fail closed, `owning_lane_rule_pending`) any slot-5, slot-9 or pack finding until 7.3 is recorded; 3.5 marks those rule IDs reserved; 3.6 carries 7.4 as written and keeps the QC-UNAVAILABLE template with its storage explicitly waiting for 7.3; the 3.9 row now asserts "every scripted finding is on a single-lane slot with `owningLane === owningLaneForSlot`, no slot-5/9/pack, run-scoped or `QC-UNAVAILABLE` finding in any script"; the W2-05 list, 3.8 (`findingId: string | null`), sections 8, 9, 10 and 11 follow. The W0-09 item is dropped from section 10; the W0-06 posture is not disputed.
4. **W0-02 paths, keys and test layer** (two findings). Section 2 uses `shared/src/qc/types.ts`, `shared/src/mail/types.ts`, `fixtures/src/substitutes/qc/`, `fixtures/src/substitutes/mail-sink/` and colocated `*.test.ts`; sections 3.9, 4.6-4.8, 6 and 7 use `QC_MODE=substitute`, `MAIL_MODE=sink-memory|sink-file`, `MAIL_SINK_DIR` and `PUBLIC_BASE_URL` with the two fail-closed test rows rewritten against those keys and value sets (`QC_MODE` unset/`scripted`/`none`/`model` throw; `MAIL_MODE=smtp`/`sink-smtp`/`memory`/unset throw); `QC_TIMEOUT_MS`, `MAIL_RETRY_BACKOFF_MS`, `MAIL_SINK_FAIL_NEXT`, a disabled `QC_MODE` value, the `test:unit` glob and the W0-10 `qc.run.*` labels are listed in section 10 as proposed amendments; the "W1-00 adds them to the sample env file" framing is gone; the file sink writes one JSON file per attempt as W0-02 section 5 states; the runner identity is W0-04's `substitute-scripted`; section 7 is restated in W0-10's event, readiness and operator-view names, with the W0-10 `health()` hook added to the substitute control API; section 9 links point at the merged `docs/engineering/` files for W0-02, W0-04, W0-06 and W0-10.

Checks rerun after the fix: table below.

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the three touched files (GitHub slug rule) | 33 links, 0 broken |
| `gh pr view 60 --json mergeable` | `MERGEABLE` after the force-push |

## Fix round 6 (review findings on PR #60; the review workflow numbers this pass "round 2")

Five blocking findings, four in `docs/engineering/qc-boundary-and-mail-sink.md` and one in this record:

1. **Late findings after Ready** (two findings on 3.4 step 6, resolved together). Step 6 now begins with a late check under the case lock: if V's `ready_at` is set, no `qc_finding` and no `qc_run` row is written, the in-flight entry is removed, one `qc.run.late` line is emitted (`correlationId`, `caseId`, `versionId`, `qcRunId` minted in step 1, `trigger`, `lane?`, `status`, `refusedFindingCount`) and the run result carries `late: { reason: 'ready', refusedFindingCount }`; `ready_at`, transitions, decisions, dispositions and notifications are untouched. A version closed by a send-back but not Ready still accepts the append (W0-06 6 refuses only Ready), and an `approve_attempt` run cannot reach the branch because the run endpoint applies the 4.4 preconditions. Step 7 emits `qc.run.late` in place of `completed`/`unavailable`; 3.8 gains the row "Findings arrive after the version is Ready"; section 7 gains the `qc.run.late` row marked proposed; section 8's A09 row names it; the W2-05/W2-06 integration list in 3.9 gains "findings arriving after Ready are refused, not appended" (a gated test-local `QcRunner` around the substitute; no rows, `ready_at` unchanged, one `qc.run.late` line with the submit's correlation ID, version ID and `qcRunId`) and its mirror after a send-back; section 10 proposes `qc.run.late` and a `lateQc` operator-view list to W0-10 3.3/7.2 (gate: before W2-06).
2. **3.8 row 1 contradicted W0-06 4.3.** The row now states that upload and submit responses do not wait for QC and carry no QC field; only the lane-QC run endpoint of W0-06 4.4 returns the run body synchronously; for upload and submit the run (`completed`, `unavailable` or late) is visible on the version's QC log, in the operator view and on the log line with the action's correlation ID. 3.4 step 6 ("the run body carries `findingId: null`"), 3.6 (visibility sentence) and section 5 (`qc_unavailable` row) were reworded to match.
3. **3.4 claimed to follow W0-04 "exactly" while placing QC after commit per W0-06.** The intro now says it follows W0-04's row rules, cites W0-06 4.3 and 9.1 as the placement source, states that W0-04's `qc_run` paragraph and Submit row place the run inside the trigger's transaction and that the two merged specs disagree, and section 10 proposes the W0-04 amendment ("inserted once, with its final status, after the trigger's transaction has committed, in its own transaction under the case lock"; the Submit and Decide rows drop the QC statements) with owner W0-04 and gate before W1-05 and W2-05.
4. **This record's "What landed" bullet described the pre-round-5 spec.** Rewritten above to the current spec (W0-02 paths and keys, `MAIL_MODE` with `sink-memory` | `sink-file`, ten W1-10 and nine W1-11 tests, owning lane per W0-06 7.1 with 7.3 carried open and no provisional value, `runKey` without attempt, `excerptHash` only, the late check and the three amendment groups in section 10). Two new reviewer-flagged choices (placement source; late runs write nothing) are added to the choices list.

Checks rerun after the fix: table below.

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the two touched files (GitHub slug rule) | 30 links, 0 broken |

## Done-when check (W0-07 section and W0 exit checklist row "Identity, persistence/artifacts, QC and mail interfaces with error contracts and test substitutes")

- [x] QC inputs: version reference and authorized artifact references (spec 3.1, 3.3).
- [x] QC outputs: typed findings with rule ID, rule revision, evidence location, metric/denominator/threshold where relevant, severity, `owning_lane` in {AI/COE, DPO, IT/Security} assigned by the W0-06 rule (3.3, 3.6).
- [x] Explicit `unavailable` result recorded as a finding with an `owning_lane` under the same rule (3.3, 3.6): the shape and the finding template are specified; the lane is the W0-06 rule, whose `unavailable` category is open (W0-06 7.3), so the run row is stored `unavailable` now and the finding is appended once the rule is recorded (W0-06 7.4), never defaulted.
- [x] QC has no approval, mail or write access to workflow state, with structural and behavioural tests (3.1, 3.4, 3.9).
- [x] Slice-1 substitute returns scripted synthetic findings and can simulate a timeout (3.9).
- [x] No model chosen; D08 and D09 left open (1, 10).
- [x] Mail accepts committed event, authorized recipients, safe deep link and dedup key; returns delivery status (4.2, 4.4).
- [x] Local substitute writes to a file or in-memory sink; no external mail in any configuration (4.6, 4.7, 4.8).
- [x] Error contract for both boundaries mapped to the ADR-0003 codes (3.8, 4.5, 5).
- [x] Cross-linked to the consuming tickets and to the other W0 specs, merged ones by file, unmerged ones by contract anchor (9).
- [x] Frozen source spec unchanged; no decision recorded; no other lane's file edited.
