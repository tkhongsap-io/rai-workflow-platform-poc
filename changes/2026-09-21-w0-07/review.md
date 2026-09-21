# Review: W0-07 — QC boundary and mail sink specs with test substitutes

2026-09-21. Ticket W0-07 (issue #12), lane Lead, branch `codex/w0-07-qc-and-mail-boundaries`, worktree `/Users/tkhongsap/github/rai-wt/W0-07`. Agent-eligible draft; human review per the ticket's owner type and independent reviewer agents before merge per the D03 amendment.

## Intent and plan (recorded before writing)

Write the W0-07 interface spec at `docs/engineering/qc-boundary-and-mail-sink.md`, concrete for the D04 stack (ADR-0003), covering for each boundary: interface in TypeScript notation, error contract mapped to the ADR-0003 codes, test substitute with its control API and the tests W1-10 and W1-11 must ship, configuration keys, observability fields, and cross-links to every consuming ticket. Carry D05, D06, D12, L7 and L8 as written; leave D07-D10 open; do not fill the W0-06 owning-lane refinement; do not edit any other lane's document or the frozen source spec.

## What landed

- `docs/engineering/qc-boundary-and-mail-sink.md` (new). Sections: what is and is not decided; placement in the D04 stack with proposed paths marked for W0-02 confirmation; QC boundary (authority limits, three triggers, `QcRunRequest` / `QcFinding` / `QcRunResult` / `QcRunner` types, orchestrator steps, scripted rule families with stable IDs, owning-lane stamping with the W0-06 refinement carried as `owningLaneBasis = 'provisional_pending_w0_06_refinement'`, the QC-unavailable finding, idempotent `runKey`, error mapping, the `ScriptedQcRunner` substitute with its control API and eight required tests); mail sink (transactional outbox placement, `CommittedEvent` / `AuthorizedRecipient` / `SafeDeepLink` / `DeliveryRequest` / `DeliveryReceipt` / `MailSink` types, defensive validation, D06 dedup key including the digest-day mapping proposed for W3-03 to confirm, retry ownership in W3-04 with proposed backoff numbers, content and safety rules including the RFC 2606 synthetic-domain rule and the two-value `MAIL_TRANSPORT` enum, `MemoryMailSink` and `FileMailSink` with control APIs and nine required tests); error summary for both; configuration keys with placeholders for W1-00; W0-10 observability fields; test-layer map for A05 and A08; consumer table; open items; W0 contract traceability table.
- `adr/README.md`: row 0006 (reserved) now points at the W0-07 spec as the source of the runner port and substitute, in the same style as rows 0004 and 0005.

Not edited, on purpose: `docs/product/source-spec.md` (frozen; hash verified below), `docs/product/decisions.md` (agents never record decisions), `docs/architecture/README.md` and `TESTING.md` (W0-02 owns those edits), the W0 contract, any other lane's spec, DEVLOG/CHANGELOG/board (appended by the merge step).

## Choices made inside this ticket's remit, flagged for the reviewer

- `production` identity mode plus `QC_RUNNER=scripted` fails startup (fail closed, mirroring the W0-03 posture). W1-00 implements the check.
- Sinks reject any recipient address outside RFC 2606 reserved domains while slice 1 runs; fixture user addresses (W1-00) and the synthetic operator address (W0-08, W1-09) must satisfy it.
- `MAIL_TRANSPORT` has exactly two values; a third is a startup error. No transport that leaves the process exists until D10.
- The QC-unavailable finding is one per run, scoped by trigger and lane, and never auto-closed by a later successful run.
- QC runs carry `(runKey, attempt)`: a replay returns the existing run only when it is `completed`; after `unavailable` (or an aged-out `running` row, proposed margin `2 × QC_TIMEOUT_MS`) the next trigger starts `attempt + 1` under the same key and its findings append beside the still-open QC-unavailable finding (spec 3.7, fix round 1).
- `DeliveryRequest.deepLinks` is a list plus `digestCases` for the operator digest, so the SLA-breach digest carries one validated `case` link per breached case (source-spec Notifications table, A05) and the sink validates every link, failing the whole delivery on one bad link (spec 4.2, 4.3, 4.8; fix round 1).
- Proposed numbers (backoff 1 s / 5 s / 25 s, `QC_TIMEOUT_MS` 10000, excerpt 300 code units, feedback summary 500) are defaults for W3-04, W1-00 and W1-10 to confirm, not decisions of record.

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

## Done-when check (W0-07 section and W0 exit checklist row "Identity, persistence/artifacts, QC and mail interfaces with error contracts and test substitutes")

- [x] QC inputs: version reference and authorized artifact references (spec 3.1, 3.3).
- [x] QC outputs: typed findings with rule ID, rule revision, evidence location, metric/denominator/threshold where relevant, severity, `owning_lane` in {AI/COE, DPO, IT/Security} assigned by the W0-06 rule (3.3, 3.6).
- [x] Explicit `unavailable` result recorded as a finding with an `owning_lane` under the same rule (3.3, 3.6); the unrecorded part of that rule is carried visibly, not defaulted.
- [x] QC has no approval, mail or write access to workflow state, with structural and behavioural tests (3.1, 3.4, 3.9).
- [x] Slice-1 substitute returns scripted synthetic findings and can simulate a timeout (3.9).
- [x] No model chosen; D08 and D09 left open (1, 10).
- [x] Mail accepts committed event, authorized recipients, safe deep link and dedup key; returns delivery status (4.2, 4.4).
- [x] Local substitute writes to a file or in-memory sink; no external mail in any configuration (4.6, 4.7, 4.8).
- [x] Error contract for both boundaries mapped to the ADR-0003 codes (3.8, 4.5, 5).
- [x] Cross-linked to the consuming tickets and to the other W0 specs by contract anchor (9).
- [x] Frozen source spec unchanged; no decision recorded; no other lane's file edited.
