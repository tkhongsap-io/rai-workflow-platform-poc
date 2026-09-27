# Build board — Lead / integration

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W0-01 merged
- What: ADR-0003 stack and deployment boundary (D04): Fastify API serving React SPA, Postgres, Drizzle, openid-client; scored against seven criteria. PR #57.
- Why: Ticket W0-01 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/57

## 2026-09-21 (time not recorded) — W0-02 merged
- What: File-level implementation plan for W1-W3: layout, commands, pinned deps, env list, CI checks, W1 interface shapes, test-layer map, UI quality bar, language rule; architecture paths and TESTING commands filled. PR #65.
- Why: Ticket W0-02 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/65

## 2026-09-21 (time not recorded) — W0-04 merged
- What: Persistence and artifact-store spec: entities, immutability, transactions, audit log, schema evolution, retention options for D08. PR #61.
- Why: Ticket W0-04 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/61

## 2026-09-21 (time not recorded) — W0-06 merged
- What: Workflow transition and error contract: states, events, lane-mapping constant, D05 rules, owning-lane assignment, seven error types with HTTP codes. PR #63.
- Why: Ticket W0-06 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/63

## 2026-09-21 (time not recorded) — W0-10 merged
- What: Observability contract for the desk runtime: correlation IDs, redaction, readiness, error capture, operator view. PR #59.
- Why: Ticket W0-10 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/59

## 2026-09-21 (time not recorded) — W0-03 merged
- What: Identity adapter spec: modes local-google/network/production with fail-closed start-up table S1-S18, session, fixture provider with dual-role identity, test obligations. PR #62.
- Why: Ticket W0-03 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/62

## 2026-09-21 (time not recorded) — W0-08 merged
- What: Upload safety policy and synthetic fixture strategy: allowed types, limits, sniffing rules, filename rule, hostile test rows, four fixture cases and users. PR #64.
- Why: Ticket W0-08 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/64

## 2026-09-21 (time not recorded) — W0-07 merged
- What: QC boundary and mail sink spec: typed findings with owning lane, run keys, unavailable results, substitute with timeout; mail sink with dedup key aligned to the W0-04 notification index and W0-10 log fields. PR #60.
- Why: Ticket W0-07 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/60

## 2026-09-21 (time not recorded) — W0-05 merged
- What: Authorization policy matrix: role x action x scope with D05 rows, status-field projection rule, route-verbatim middleware facts, unresolved-target rule, 34+ test obligations; aligned to merged W0-02/W0-04/W0-06/W0-10. PR #58.
- Why: Ticket W0-05 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/58

## 2026-09-21 (time not recorded) — W0-09 merged
- What: W0 exit: cross-spec consistency pass over all nine W0 documents (error envelope, ExpectedVersion, routes, paths, log fields, dedup key, fixtures aligned to their owners), performance targets recorded, exit checklist ticked, changes/2026-09-21-w0-exit/review.md. PR #66.
- Why: Ticket W0-09 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/66

## 2026-09-21 (time not recorded) — W1-INT merged
- What: SPA served by the real server; Lane B journeys promoted to evidence against real Postgres (108 browser tests); create→attach→submit→restart→reopen journey with byte-identical download; SPOC-on-behalf positive; all exit negatives; fixed a graceful-shutdown hang on idle sockets found by the restart test; 347 unit + 135 integration. PR #87.
- Why: Ticket W1-INT of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/87

## 2026-09-21 (time not recorded) — W1-08 merged
- What: W1 exit (Milestone M1): clean-checkout evidence for A01/A02/A07 with every command and output, explicit fail-closed and scope negatives, hand-run restart journey with byte-identical bodies and download; Google-on-loopback runbook in TESTING.md pending Ta; W2 issues flipped to ready; epic #52 closed. PR #88.
- Why: Ticket W1-08 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/88

## 2026-09-22 — CLAIM W3-INT planning only
- Author: operator=ta session=codex-w3-int model=GPT-6
- Takes over from: none (reason: parent-delegated #49 planning only; parent retains lead/exit authority)
- What: Isolated `/tmp/rai-w3-integration`, `codex/w3-int` at `fe65fc1`; no code or other agents' ownership taken. W3-06/performance and 03b/04/07a/07b remain separately owned.
- Next: Lead review of [file-level plan](../../changes/2026-09-22-w3-int/plan.md) before implementation; separate final reviewer due to queue UI authorship.

## 2026-09-22 — CLAIM W3-06 performance harness preparation only
- Author: operator=Codex session=w3-06-performance
- Takes over from: none; parent delegates only isolated harness preparation, not lead-lane integration ownership.
- Scope: guards, real-API seed and measurement functions, pure tests; no DB actions, benchmark, PR or M3 acceptance.
- Evidence: [plan](../../changes/2026-09-22-w3-06-performance/plan.md).

## 2026-09-25 15:25 — CLAIM lead-integration: W3 hardening close-out
- Author: operator=ta session=claude-code-w3-hardening-closeout model=claude-opus-5-5
- Takes over from: session=none (reason: new; the hardening lead session ended with #157 merged)
- Scope: records only, per [close-out plan](../../changes/2026-09-23-w3-hardening/closeout-plan.md): final-head CI evidence, board entry, local branch pruning. No code, no decision.

## 2026-09-25 15:40 — W3 hardening H1-H29 merged; records closed
- What: The retro-review of the unreviewed W2/W3 PRs confirmed 71 findings. H1-H23 (#128-#150) closed 67 of them, 3 were deferred to Ta and 1 was withdrawn. H24 (#151) fixed what the final verification found, and H25-H29 (#152-#156) fixed defects found by running the Nakhun walkthrough. #157 added the review record, the walkthrough script and the #35 decision brief. `main` `aa9e8ab` passed CI run 36041409928 (12/12). The close-out cited that run in the review, added the missing #157 row, added this board record and pruned the 29 merged local branches.
- Why: Ta's 2026-09-23 instruction not to accept W3 until the unreviewed code was reviewed, fixed and simplified. The board had no record of that work.
- Next: Ta's W3 package review (epic #54) and the synthetic walkthrough with Nakhun. Section 5 of the review lists the items only Ta can decide, including #35. W4-W8 are not authorized.
- Author: operator=ta session=claude-code-w3-hardening-closeout model=claude-opus-5-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/158

## 2026-09-26 09:10 — W3 accepted; M3 reached
- What: Ta accepted the W3 package after the synthetic walkthrough with Nakhun (no change requested). Recorded in BUILD_PLAN (2026-09-26 status), the W3 exit review, the walkthrough notes, DEVLOG, CHANGELOG, README and the delivery pack; epic #54 closes.
- Why: the last gate of slice 1 (BUILD_PLAN W3 exit), after the hardening and W2-05. Hardening review section 5 items 2-9 and 12 remain deferred to Ta; they did not block acceptance.
- Next: D08/D09 decision briefs and a draft W4 gate for Ta (lead, documentation only); the W3-07 desk-health follow-up (the outage finding's lane) as a ticket. W4-W8 remain unauthorized.
- Author: operator=ta session=claude-code-w3-acceptance model=claude-opus-5-5
- Evidence: PR on `codex/w3-acceptance`

## 2026-09-26 11:40 — CLAIM lead-integration: W3-F1 display names, part 1 (contract and server)
- Author: operator=ta session=claude-code-w3-f1-display-names model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #163, lane A+B, human-review-required)
- Scope: per changes/2026-09-26-w3-f1-display-names/: read shapes and server; the UI is part 2.

## 2026-09-26 13:10 — W3-F1 display names, part 2 (UI)
- What: the five surfaces render display names with a subject-ID fallback; browser specs updated; part 1 (#172, `a8d4ec5`) supplied the fields.
- Why: ruling item 8 (register row "W3 deferred rulings"), ticket #163.
- Next: two reviewers and CI on this PR; on merge, #163 closes with status evidence-recorded, then W3-F2 (#164).
- Author: operator=ta session=claude-code-w3-f1-display-names model=claude-opus-5-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/173

## 2026-09-26 18:30 — W3 follow-ups closed (#163-#169)
- What: W3-F1 to W3-F7 merged through PRs #172-#179; issues closed with status evidence-recorded; worktrees, test databases and branches removed.
- Why: register row "W3 deferred rulings" (Ta, 2026-09-26).
- Next: docs sync (this PR); then record Ta's W4 gate decisions in the register (Ta's choice of W4 shape and the slot-5/9 upload rule were given in the session of 2026-09-26 and are not recorded until that PR merges). W3-F8 (#180, PR #181) runs in a separate session.
- Author: operator=ta session=claude-code-w3-followups-closeout model=claude-opus-5-5
- Evidence: changes/2026-09-26-w3-f*/review.md; PRs #172-#179

## 2026-09-26 19:00 — CLAIM lead: W4-00a file-level plan
- Author: operator=ta session=claude-code-w4a-gate model=claude-opus-5-5
- Takes over from: session=none (reason: new; W4a gate entry of 2026-09-26)
- Scope: docs/engineering/implementation-plan-w4a.md and the gate records, one PR.

## 2026-09-27 14:58 — CLAIM lead-integration: W4a exit record (W4a-EXIT)
- Author: operator=ta session=claude-code-w4a-exit model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #190, all six W4a tickets merged #192-#197)
- Scope: changes/2026-09-27-w4a-exit/ and status text only (plan section 10 exit evidence, section 8 gate); no application code, no decision.

## 2026-09-27 15:19 — W4a engineering exit recorded (W4a-EXIT)
- What: all six W4a tickets merged (W4-11a #192, W4-02 #193, W4-03 #194, W4-13 #195, W4-04 #196, W4-12 #197; plan #183). From a clean checkout of `da3d815` and a fresh database: W4-03 fixture tests 6/6, W4-04 fixture tests 10/10, real-server test 6/6, W4-12 journeys on the real server 6 passed, readiness `qc.kind` `deterministic` under `QC_MODE=deterministic`, `check:substitute-absent` 0 of 675 files; section 8 gate: 648 unit, 374 integration, 202 real-server browser, 48 substitute browser, lint and typecheck clean. Rule revision `w4a.1` (revision 1), runner `deterministic` `0.0.0`, fixture set `slice1-synthetic@1 7c80ccd43663`. Status text updated in BUILD_PLAN, README, the delivery README and the W4 work breakdown.
- Why: W4a plan section 10; ticket #190; register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)", "W4a kickoff rulings".
- Next: two reviewers and CI on this PR; then Ta's package review of the record (not accepted yet). Two deferred items are marked for Ta (no upload run when no runner is bound; locator heading/cell text served). W4b stays unauthorized; labels provisional until D09.
- Author: operator=ta session=claude-code-w4a-exit model=claude-opus-5-5
- Evidence: changes/2026-09-27-w4a-exit/review.md
