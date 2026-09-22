# Build board — Lane A: workflow and server

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W1-00 merged
- What: First code: rai-web workspaces, docker compose Postgres, Drizzle base migration (case, pack_version, artifact_slot, configuration_revision, append-only audit_event with DB trigger), shared error module, policy module, fixture identity provider, configuration seed, logger; 58 unit + 14 integration tests. PR #67.
- Why: Ticket W1-00 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/67

## 2026-09-21 (time not recorded) — W1-03 merged
- What: Artifact upload/download per 7.4: content-hash blob store behind an interface, sniffing not extension, size limits, unresolved-id rule, Thai filenames, direct URL without session refused; store:verify/cleanup operator commands; 197 unit + 53 integration. PR #78.
- Why: Ticket W1-03 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/78

## 2026-09-21 (time not recorded) — W1-04 merged
- What: Nine-slot draft pack per 7.5: four slot states, mandatory N/A reason, slots 3/4 default N/A only when vendor_involved is false, checklist_template_version and stage_context on the draft, expectedVersion 409 rule, audit events; 285 unit + 103 integration. PR #80.
- Why: Ticket W1-04 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/80

## 2026-09-21 (time not recorded) — W1-00-w1-06-locale-contract merged
- What: W1-00 amendment (contract PR for W1-06): locale keys for the case overview, pack editor and version navigation. PR #86.
- Why: Ticket W1-00-w1-06-locale-contract of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/86

## 2026-09-22 11:01 — CLAIM Lane A
- Author: operator=ta session=w2-01 model=grok-4.7
- Takes over from: session=none (reason: new)

## 2026-09-22 11:01 — W2-01 open three lanes on submit
- What: Submit opens ai_coe, dpo and it_security in one transaction (lane.opened × 3 with D02 slotsForLane, three lane_open notification rows to the single-role fixture reviewers); failure on any lane rolls back the whole submit; high risk still opens all three; notification table migration 0004.
- Why: A partial lane open must not commit; W0-06 4.3 (d)+(f) belong in the same freeze transaction as W1-05.
- Next: W2-02a/W2-02 (decisions) — not this session.
- Author: operator=ta session=w2-01 model=grok-4.7
- Evidence: branch codex/w2-01-open-lanes (commit pending land)

## 2026-09-22 11:25 — CLAIM Lane A
- Author: operator=ta session=w2-02 model=composer
- Takes over from: session=w2-01 (reason: handoff)

## 2026-09-22 11:40 — W2-02 lane decision landed
- What: Lane approve/send-back (own lane, expected version, idempotency, D05 self-exclusion); D05 policy rows for dispositions; successor draft on first send-back; decision audit; migration 0005 lane_decision.
- Why: Ticket W2-02 (#32); proves A01 and A09; decision D05. Contract for W2-05 disposition authority.
- Next: W2-03 concurrent send-backs share one draft — not this session.
- Author: operator=ta session=w2-02 model=composer
- Evidence: branch codex/w2-02-lane-decision

## 2026-09-22 11:58 — CLAIM Lane A
- Author: operator=ta session=w2-03 model=composer
- Takes over from: session=w2-02 (reason: handoff)

## 2026-09-22 11:58 — W2-03 successor draft concurrency
- What: Concurrent send-backs share one N+1 draft (case row lock + draft_version_id reuse); stale decide/send-back returns 409 with refresh guidance and writes nothing; wrong-revision and post-draft-edit regressions; N stays readable and frozen.
- Why: Ticket W2-03 (#33); proves A07; decision D05. Completes the concurrent-send-back half of W0-06 4.5 / 5.2.
- Next: W2-04 resubmit reopens all lanes — not this session.
- Author: operator=ta session=w2-03 model=composer
- Evidence: branch codex/w2-03-successor-draft

## 2026-09-22 12:12 — W2-03 fix: drop UniqueViolation reclaim
- What: Correction to the prior W2-03 entry — sharing one draft is the case lock plus draft_version_id reuse, not UniqueViolation reclaim (removed). Unknown version UUID → not_found.
- Why: Independent review of PR #92.
- Next: W2-04 resubmit — not this session.
- Author: operator=ta session=w2-03 model=composer
- Evidence: branch codex/w2-03-successor-draft

## 2026-09-22 12:17 — W2-03 note: §4.5 unique-index retry not implemented
- What: W0-06 §4.5's "retry the transaction once from the lock" if the one-draft unique index fires is not implemented. The case lock makes that path unreachable for send-back; a retry belongs at the transaction boundary only if a later ticket creates a draft without the lock.
- Why: Independent review of PR #92 (existence-before-Ready reorder in the same fix).
- Next: W2-04 resubmit — not this session.
- Author: operator=ta session=w2-03 model=composer
- Evidence: branch codex/w2-03-successor-draft

## 2026-09-22 12:25 — CLAIM Lane A
- Author: operator=ta session=w2-04 model=composer
- Takes over from: session=w2-03 (reason: handoff)

## 2026-09-22 12:25 — W2-04 resubmit N+1 under D05
- What: Resubmit via existing draft/submit: freeze N+1, version.resubmitted + lane.opened × 3, projections pending and ai_readiness_status not_ready, idempotency action case.resubmit; N stays readable; decide on N after resubmit is 409 version_superseded. Not the W2 exit.
- Why: Ticket W2-04 (#34); proves A07; decision D05. Completes W0-06 §4.6 / persistence Resubmit row.
- Next: W2-05 dispositions — not this session.
- Author: operator=ta session=w2-04 model=composer
- Evidence: branch codex/w2-04-resubmit

## 2026-09-22 13:36 — CLAIM Lane A
- Author: operator=ta session=w2-06 model=composer
- Takes over from: session=w2-04 (reason: handoff; W2-05 landed on main)

## 2026-09-22 13:36 — W2-06 Ready predicate
- What: Ready inside approve/disposition under the case lock (three current-version approvals + zero undispositioned findings); pack_version.ready_at, desk_status/ai_readiness_status ready, case.ready_for_launch audit, ready notification (lane `-`); no POST /ready; version_closed after Ready on approve and disposition. Not the W2 exit; UI and mail delivery remain later.
- Why: Ticket W2-06 (#36); proves A09 Ready half; decisions D05. Completes W0-06 §4.9 / §6 / persistence Ready row.
- Next: W2-08 exit evidence / remaining W2 — not this session.
- Author: operator=ta session=w2-06 model=composer
- Evidence: branch codex/w2-06-ready

## 2026-09-22 14:40 — W2-07 review locale keys
- What: Contract-only additions to both catalogues for the reviewer workspace (`review.*`, `finding.severity.*`). No workflow change.
- Why: shared locales are Lane A; the W2-07 screen PR must not carry them.
- Next: W2-07 UI against these keys.
- Author: operator=ta session=w2 model=grok-4.7
- Evidence: branch codex/w2-07-review-locale-keys

## 2026-09-22 16:58 — CLAIM Lane A
- Author: operator=ta session=w2-int model=composer
- Takes over from: session=w2-06 (reason: handoff; W2-INT real-server journey)


## 2026-09-22 16:58 — W2-INT real-server journey (Lane A half)
- What: W2-INT suite authored against the real server: journey + negatives (concurrent send-back, stale approval, undispositioned finding, Admin/self-approval). Substitute remains out of the evidence app path; W2-10 substitute specs kept for W3. Not the W2 exit.
- Why: Ticket W2-INT (#40); proves A04, A07, A09 at the integration layer. Doc wins over issue wording.
- Next: W2-08 exit evidence (Lead) runs this suite and records it — not this session.
- Author: operator=ta session=w2-int model=composer
- Evidence: branch codex/w2-int-real-server-journey

## 2026-09-22 17:29 — CLAIM Lane A
- Author: operator=ta session=w2-08 model=composer
- Takes over from: session=w2-int (reason: handoff)

## 2026-09-22 17:29 — W2-08 W2 exit recorded
- What: W2 exit evidence only — no product code. Ran lint, typecheck, W2-INT Playwright (15 passed), W2-INT negatives (6 pass), `npm run build && npm run check:substitute-absent` (463/0), `w1-00-audit.test.ts` (4 pass). Recorded under changes/2026-09-22-w2-exit/review.md; BUILD_PLAN status table and divergence sentences flipped (M2 reached, M3 unblocked, next W3); DEVLOG updated. Issue #35 stays open; epic #53 remains open; W4–W8 not authorized.
- Why: Ticket W2-08 (#41); proves A04, A07, A09, A11 at the package exit.
- Next: W3 (after Ta accepts this exit) — not this session.
- Author: operator=ta session=w2-08 model=composer
- Evidence: branch codex/w2-08-w2-exit; changes/2026-09-22-w2-exit/review.md

## 2026-09-22 19:55 — CLAIM Lane A
- Author: operator=ta session=w3-05 model=grok-4.7
- Takes over from: session=w2-08 (reason: handoff; W3 starts at W3-05)

## 2026-09-22 19:55 — W3-05 working-day SLA
- What: Due dates from the frozen SLA and calendar (Asia/Bangkok, weekends and holidays skipped). Breach query returns pending lanes on the current review target that are past due. No mail sink, no HTTP SLA route, no escalation.
- Why: Ticket W3-05 (#46); proves A05's due-date and breach-query half. D06. Issue #35 and epic #53 stay open.
- Next: review this PR, then W3-01 can take the due-date shape. Mail sink stays off main until just before W3-03.
- Author: operator=ta session=w3-05 model=grok-4.7
- Evidence: branch codex/w3-05-working-day-sla

## 2026-09-22 20:45 — W3-05 merged; handoff
- What: PR #104 squash-merged to main as 39bbf0a. CHANGELOG, BUILD_PLAN status, and README build status now name W3-01 as the next ticket and the mail sink as still off main. Issue #46 closed. Issue #35 and epic #53 stay open.
- Why: The lane entry above stopped at "review this PR". The team log has to say what to pick up.
- Next: W3-01 (queue), using the W3-05 due-date shape. W3-03 waits on the W1-11 mail sink.
- Author: operator=ta session=w3-05 model=grok-4.7
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/104

## 2026-09-22 — CLAIM Lane A: W3-01
- Author: operator=ta session=codex-w3-continuation model=GPT-6
- Takes over from: session=w3-05 (reason: handoff; owner requests W3 completion)
- What: Queue contract first, then server implementation; separate PRs, independent review and green verification before merge.
- Evidence: changes/2026-09-22-w3-01-queue-contract/plan.md

## 2026-09-22 — CLAIM Lane A: W3-01 delegated server slice
- Author: operator=ta session=codex-w3-01-scoped-queue model=GPT-6
- Takes over from: session=codex-w3-continuation (reason: delegated server implementation only; parent retains integration)
- What: Prepare #42 in /tmp/rai-w3-queue-server, branch codex/w3-01-scoped-queue at ae8e25d. No parent-checkout writes, push, PR or merge; shared contract PR #106 remains prerequisite.
- Evidence: [server plan](../../changes/2026-09-22-w3-01-queue-server/plan.md)
