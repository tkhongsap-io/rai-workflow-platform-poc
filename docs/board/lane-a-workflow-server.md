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
