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

## 2026-09-22 — CLAIM W3-07a prerequisite contract
- Author: operator=ta session=codex-w3-07a-observability-contract model=GPT-6
- Takes over from: session=none (reason: parent-assigned isolated prerequisite; other ticket owners retain their modules)
- What: Shared observability shapes and additive persistence only, based on 5fe59ad.
- Evidence: changes/2026-09-22-w3-07a-observability-contract/plan.md

## 2026-09-22 — CLAIM Lane A: W3-01 delegated server slice
- Author: operator=ta session=codex-w3-01-scoped-queue model=GPT-6
- Takes over from: session=codex-w3-continuation (reason: delegated server implementation only; parent retains integration)
- What: Prepare #42 in /tmp/rai-w3-queue-server, branch codex/w3-01-scoped-queue at ae8e25d. No parent-checkout writes, push, PR or merge; shared contract PR #106 remains prerequisite.
- Evidence: [server plan](../../changes/2026-09-22-w3-01-queue-server/plan.md)

## 2026-09-22 — CLAIM W3-07a API consumer
- Author: operator=ta session=codex-w3-07a-observability-api model=GPT-6
- Takes over from: session=codex-w3-07a-observability-contract (reason: owner-authorized successor on d931cea; notification owners retain implementation)
- What: Health/probes, operator queries, safe error capture and correlated QC diagnostics. Isolated DB 54368 and HTTP/SUB/WEB 18788/18789/15175; no publication before prerequisite merge and notification integration proof.
- Evidence: [file-level plan](../../changes/2026-09-22-w3-07a-observability-api/plan.md)

## 2026-09-26 09:40 — CLAIM lane-a: W3-07 desk-health owning lane
- Author: operator=ta session=claude-code-desk-health-owning-lane model=claude-opus-5-5
- Takes over from: session=none (reason: new; follow-up recorded by W2-05)
- Scope: per changes/2026-09-26-desk-health-owning-lane/: the desk-health `unavailableQc` entries name the owning lane. One PR.

## 2026-09-26 15:00 — CLAIM lane-a: W3-F6 remove unused scopedCases (#168)
- Author: operator=ta session=claude-code-w3-f6-remove-scoped-cases model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #168)
- Scope: per changes/2026-09-26-w3-f6-remove-scoped-cases/. One PR, no behaviour change.

## 2026-09-26 17:10 — CLAIM lane-a: W3-F7 BLOB_TMP_MAX_AGE_HOURS minimum 1 (#169)
- Author: operator=ta session=claude-code-w3-f7-blob-tmp-min model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #169)
- Scope: per changes/2026-09-26-w3-f7-blob-tmp-min/. One PR.

## 2026-09-27 09:45 — CLAIM lane-a: W4-11a run identity (#184)
- Author: operator=ta session=claude-code-w4-11a-run-identity model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #184)
- Scope: per changes/2026-09-27-w4-11a-run-identity/: `qc_run.runner_version` and `rules_evaluated`, runner identity on `qc.run.*` lines and on desk-health `unavailableQc` rows. One PR.

## 2026-09-27 10:27 — CLAIM lane-a: W4-02 rule catalogue (#185)
- Author: operator=ta session=claude-code-w4-02-rule-catalogue model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #185)
- Scope: per changes/2026-09-27-w4-02-rule-catalogue/: the `qc_rules` body, seed revision 1 (`w4a.1`), `selectRules`, `request.rules` from the orchestrator, the upload-instant revision, `not_configured` for versions without a `qc_rules` revision. One PR.

## 2026-09-27 11:13 — CLAIM lane-a: W4-03 deterministic runner (#186)
- Author: operator=ta session=claude-code-w4-03-deterministic-runner model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #186)
- Scope: per changes/2026-09-27-w4-03-deterministic-runner/: the `deterministic` QcRunner under `server/src/qc/deterministic/` with `PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH` and `PACK-NA-VENDOR-DOC`, the no-`read()` and module-graph tests, th/en keys, W0-07 3.5 rows and the 3.4 step-6 deferral. One PR.

## 2026-09-27 13:01 — CLAIM lane-a: W4-04 upload trigger (#188)
- Author: operator=ta session=claude-code-w4-04-upload-trigger model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #188)
- Scope: per changes/2026-09-27-w4-04-upload-trigger/: the W0-07 `upload` trigger bound on the save-draft attach (`loadUploadTarget`, `lane = NULL` with `slot`, runKey in-flight key, slot 5 outage to AI/COE, slot 9 no run, per-lane outage reuse), drain-tracked, substitute scripts without upload entries, W0-07 3.2/3.6/3.9 amendments. One PR.

## 2026-09-27 19:40 — CLAIM lane-a: W5-01 rubric schema and pure scoring engine (#204)
- Author: operator=ta session=claude-code-w5-01-rubric-schema-and-pure model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #204)
- Scope: per changes/2026-09-27-w5-01-rubric-schema-and-pure/: `RiskRubricBodySchema` and `riskRubricBodyProblems` in `shared/src/schemas/cases.ts` (schema only, not registered), the pure engine `shared/src/risk/{types,score,inputs}.ts` (`tierOf`, `scoreRisk`, `canonicalInputs`, `inputsHash`, `ENGINE_VERSION`) with unit tests. No migration, no seed, no route. One PR.

## 2026-09-27 20:49 — CLAIM lane-a: W5-03 risk migration and Drizzle schema (#205)
- Author: operator=ta session=claude-code-w5-03-risk-migration-and-drizzle model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #205)
- Scope: per changes/2026-09-27-w5-03-risk-migration-and-drizzle/: one migration (`server/drizzle/0010_w5_03_risk.sql`, class `restore-required`; renumbered by hand at rebase if another migration merges first) adding `pack_version.risk_answers`, `unknown` in `case_risk_tier_check` and the append-only `risk_proposal` table with its grant; Drizzle schema, `meta/`, migration-guard tests, the `w1-00-migrations` lists, `BUSINESS_TABLES` and the W0-04 rows. No writer, route or UI. One PR.

## 2026-09-27 16:00 — CLAIM lane-a: W6-01 W6 contract (#206)
- Author: operator=ta session=claude-code-w6-01-w6-contract-shared-shapes model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #206)
- Scope: per changes/2026-09-27-w6-01-w6-contract-shared-shapes/: shared shapes (`configuration-admin.ts`, `dashboard.ts`, `QueueQuerySchema` filters, optional `SubmittedVersion.frozenConfiguration`), policy rows (`qc.recheck`, `dashboard.view`, `config.publish` scope), error codes (`desk_frozen` 503, `configuration_changed`, `configuration` resource) with capture at info, locale keys, and the W0-02/W0-05/W0-06/W0-10 amendments. One PR, no migration.

## 2026-09-27 21:13 — CLAIM lane-a: W7-03 migration classes, ahead readiness, rollback check (#208)
- Author: operator=ta session=claude-code-w7-03-migration-classes-ahead-readiness model=claude-opus-5-5 (implementation lane ops)
- Takes over from: session=none (reason: new; ticket #208, W7 plan #199 merged)
- Scope: per changes/2026-09-27-w7-03-migration-classes-ahead-readiness/: `MIGRATION_CLASSES` and the header test, migration `0011_w7_03_migration_class` (`schema_migration_class`, guard, grants), the conditional class writer in `runMigrations`, readiness `store.migrations: ahead`, `npm run release:check-rollback`, desk-health `ahead` with th/en keys, W0-04 and W0-10 amendments. Migration-bearing; one PR.

## 2026-09-27 21:40 — CLAIM lane-a: W5-02 register risk_rubric, seed placeholder, rubric read (#213)
- Author: operator=ta session=claude-code-w5-02-register-risk-rubric-seed model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #213)
- Scope: per changes/2026-09-27-w5-02-register-risk-rubric-seed/: `risk_rubric` registered in `CONFIGURATION_BODY_SCHEMAS`/`ConfigurationBodies` with a `riskRubricBodyProblems` branch in `validateConfigurationBody`; the seed publishes revision 1 `synthetic-placeholder.1` (a labelled SYNTHETIC PLACEHOLDER for D07, not the approved instrument); `GET /api/configuration/risk-rubric/current` (200 / 404 `risk_rubric`, `config.read_effective`); seed and configuration tests updated; W0-02 section 7.3 amendment. No migration, no scoring, no UI. One PR.

## 2026-09-27 22:45 — CLAIM lane-a: W4-05b extraction worker host, protocol and limits (#212)
- Author: operator=ta session=claude-code-w4-05b-extraction-worker-host-protocol model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #212)
- Scope: per changes/2026-09-27-w4-05b-extraction-worker-host-protocol/: the `Extractor` port, the IPC protocol with a TypeBox reply check, the limits, the forking host `createWorkerExtractor` (one process per call, empty env, no stdio, heap cap, SIGKILL on time/abort/output, concurrency semaphore) and the worker entry under `server/src/qc/extraction/`; worker module-graph test; fork latency measured under the source and built layouts. No format parser (W4-05c/d), no runner, no config key, no migration. One PR.

## 2026-09-27 22:10 — CLAIM lane-a: W7-05 network fail-closed amendments and test seams (#209)
- Author: operator=ta session=claude-code-w7-05-network-fail-closed-amendments model=claude-opus-5-5 (implementation lane ops)
- Takes over from: session=none (reason: new; ticket #209, W7 plan merged)
- Scope: per changes/2026-09-27-w7-05-network-fail-closed-amendments/: S17 extended to `network` (`base_url_not_https`), the ID-01 `network` http/https rows and the `HOST` table, the `StartOverrides.exchange` seam refused unless `NODE_ENV=test` on loopback (before parse, `test_exchange_override_forbidden`), the `discovery` override refused under `NODE_ENV=production` (after parse, `test_discovery_override_forbidden`), the real-process `network` http refusal, and the W0-03 S17, section 2/3, section 11 and section 14 amendments. No migration; one PR.

## 2026-09-27 22:14 — CLAIM lane-a: W6-02 configuration drafts, change note, restore, desk_controls (#214)
- Author: operator=ta session=claude-code-w6-02-configuration-drafts-change-note model=claude-opus-5-5 (implementation lane admin)
- Takes over from: session=none (reason: new; ticket #214, W6-01 merged #283)
- Scope: per changes/2026-09-27-w6-02-configuration-drafts-change-note/: one migration (`server/drizzle/0011_w6_02_configuration_admin.sql`, class `restore-required`; renumbered by hand at rebase if another migration merges first) adding `configuration_revision.change_note` and `restores_id`, `desk_controls` in the kind CHECK and the `configuration_draft` table (the one `rai_app` `DELETE` grant); `desk_controls` registered in shared and seeded; store `saveDraft`, `discardDraft`, `publishDraft`, `restoreRevision`; `UNSEEDED_KINDS`; the freeze skips `UNFROZEN_KINDS`; W0-04 roles rule amended. No route or UI. One PR.

## 2026-09-27 23:30 — NOTE lane-a: W6-02 round 1, migration renumbered (#214)
- Author: operator=ta session=claude-code-w6-02-configuration-drafts-change-note model=claude-opus-5-5 (implementation lane admin)
- Correction to the 22:14 CLAIM: W7-03 (#287) merged `0011_w7_03_migration_class` first; the branch is rebased onto `main` and the migration regenerated by hand as `server/drizzle/0012_w6_02_configuration_admin.sql` (class `restore-required`, with its `MIGRATION_CLASSES` entry). Details in changes/2026-09-27-w6-02-configuration-drafts-change-note/review.md "Round 1".

## 2026-09-27 23:30 — CLAIM lane-a: W4-05c DOCX and XLSX extraction (#220)
- Author: operator=ta session=claude-code-w4-05c-docx-and-xlsx-extraction model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #220)
- Scope: per changes/2026-09-27-w4-05c-docx-and-xlsx-extraction/: hand-written `worker/zip.ts` (central directory, stored and deflate with `maxOutputLength`, CRC and size checks), `worker/xml.ts` (tokenizer that refuses a DOCTYPE, five predefined and numeric entities only), `worker/docx.ts` (one `section` segment per paragraph ordinal) and `worker/xlsx.ts` (one `cell` segment per non-empty cell, sheet ordinal plus A1 reference) registered in the worker's format registry; text-free ordinal locators accepted on the wire; `selfTest()` extracts an embedded synthetic DOCX; hostile set fed to the extractor. No PDF (W4-05d), no runner, no config key, no migration. One PR.

## 2026-09-27 23:31 — CLAIM lane-a: W5-04 draft risk answers (#222)
- Author: operator=ta session=claude-code-w5-04-draft-risk-answers model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #222)
- Scope: per changes/2026-09-27-w5-04-draft-risk-answers/: `PackDraft.riskAnswers` and `PackDraftUpdateRequest.riskAnswers` (W0-02 7.5), validated against the `risk_rubric` in force (422 `error.risk.not_configured`, `validation.not_in_configured_list`), stored with attribution in `pack_version.risk_answers`, `draft.saved` refs, copied to the successor draft on send-back; the API substitute's draft literals typed with `riskAnswers: {}`. No scoring, no migration, no UI. One PR.

## 2026-09-28 00:45 — CLAIM lane-a: W6-13 dashboard API (#215)
- Author: operator=ta session=claude-code-w6-13-dashboard-api-advisory-and model=claude-opus-5-5 (implementation lane admin)
- Takes over from: session=none (reason: new; ticket #215, W6-01 merged #283)
- Scope: per changes/2026-09-27-w6-13-dashboard-api-advisory-and/: `GET /api/dashboard` (`dashboard.view`) served by `server/src/dashboard/{repository,routes}.ts` inside one read-only snapshot from `caseScopeWhere`; `openReviewTargets` gains an optional scope predicate; `findings.advisory` and `qc.rechecks30d` served as `0` until W6-09; a `dashboard` read in the performance harness and a recorded p95 sample at 1,000 cases. No migration, no UI (W6-15). One PR.

## 2026-09-28 00:30 — CLAIM lane-a: W5-05 risk proposal at submit; case.risk_tier (#229)
- Author: operator=ta session=claude-code-w5-05-risk-proposal-at-submit model=claude-opus-5-5 (implementation lane risk)
- Takes over from: session=none (reason: new; ticket #229, W5-04 merged #292)
- Scope: per changes/2026-09-27-w5-05-risk-proposal-at-submit/: `server/src/risk/{propose,repository}.ts` score the frozen answers against the frozen `risk_rubric` inside the submit transaction and insert the append-only `risk_proposal` row (`proposed`, or `unavailable` with `not_configured` / `rubric_invalid` / `engine_error`, never an exception); `closeDraftOnCase` writes `case.risk_tier`; audit `risk.proposed` between `version.submitted`/`version.resubmitted` and `lane.opened`; log events `risk.proposal.recorded` / `risk.proposal.unavailable`; `RiskTier` widened with `unknown`; the four intended test changes the plan names (`w1-05-submit` x2, `w2-01-lanes`, `audit/store.test.ts`); W0-06 4.3/9.2/9.4, W0-04 `risk_tier` writer and W0-10 amended. No migration, no route, no UI. One PR.

## 2026-09-28 00:30 — CLAIM lane-a: W4-05d PDF text layer; images unreadable (#227)
- Author: operator=ta session=claude-code-w4-05d-pdf-text-layer-images model=claude-opus-5-5 (implementation lane qc-content)
- Takes over from: session=none (reason: new; ticket #227, W4-05c merged #293)
- Scope: per changes/2026-09-27-w4-05d-pdf-text-layer-images/: hand-written `worker/pdf.ts` (classic xref table and trailer with `/Prev`, objects and the `Pages` tree, content streams with no filter or `/FlateDecode` under `maxOutputLength`, `Tj`/`TJ`/`'`/`"` with literal and hex strings, Latin-1 or UTF-16BE with BOM; Type0/CID text not decoded) registered in the worker's format registry: one `{ kind: 'page', page }` segment per text line; `/Encrypt`, xref streams only, broken xref, unsupported filters on every stream, active content or no text → `unreadable`; page and object caps → `limit_output`; PNG and JPEG stay unregistered (`unreadable`). Hostile set and the W4-09a PDF renderings checked. No runner, config key or migration. One PR.

## 2026-09-28 09:00 — CLAIM lane-a: W6-03 publish validation (Admin paths only) and implemented-rule registry (#223)
- Author: operator=ta session=claude-code-w6-03-publish-validation-admin-paths model=claude-opus-5-5 (implementation lane admin)
- Takes over from: session=none (reason: new; ticket #223, W6-02 merged #289)
- Scope: per changes/2026-09-27-w6-03-publish-validation-admin-paths/: `server/src/configuration/validate.ts` `publishProblems(kind, body, inForce, mailMode)` (schema via `validateConfigurationBody`, implemented-rule registry, engine, trigger subset, template isolation, template coverage both ways, synthetic recipients while mail is a sink) called only by `publishDraft` and `restoreRevision`; `shared/src/qc/rule-registry.ts` `IMPLEMENTED_RULES` with a server test tying its metadata entries to `METADATA_RULES`. `publishRevision`, the seed, fixtures, `w4-02-rule-catalogue` and `w3-03b-digest` unchanged. No migration, no route, no UI. One PR.

## 2026-09-28 03:39 — CLAIM lane-a: W7-06 subject_profile (#217)
- Author: operator=ta session=claude-code-w7-06-subject-profile model=claude-opus-5-5 (implementation lane ops)
- Takes over from: session=none (reason: new; ticket #217, W7-03 merged #287, W7-05 merged #291)
- Scope: per changes/2026-09-27-w7-06-subject-profile/: one additive migration (`server/drizzle/0013_w7_06_subject_profile.sql`, renumbered by hand at rebase if another migration merges first) adding `subject_profile` (`SELECT, INSERT, UPDATE` to `rai_app`, no `DELETE`); `CreateSessionInput.profile` upserted inside the `SessionStore.create` transaction (Pg and memory); `establishSession` passes the profile on every non-fixture sign-in and calls the optional `profiles.recorded` hook (bound by W7-07); `createSubjectDirectory` reads `subject_profile` before `session`; W0-03 section 6 and W0-04 amended. No recipient directory (W7-07), no route, no UI. One PR.

## 2026-09-27 19:39 — CLAIM lane-a: W4-11b run identity for extraction/model use (#201)
- Author: operator=ta session=claude-code-w4-11b-run-identity model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #201, implementation lane qc-core)
- Scope: per changes/2026-09-27-w4-11b-run-identity-for-extraction/: `qc_run` identity and usage columns plus `unavailable_detail` (one migration), `QcRunResult.engine`, `recordRun`, the qc-runs read, `qc.run.completed`/`qc.run.unavailable` fields, operator `unavailableQc.unavailableDetail`, W0-02 section 7, W0-04, data contract, W0-07 section 7 and W0-10 amendments. One PR.

## 2026-09-28 10:00 — CLAIM lane-a: W6-14 queue drill-down filters (#224)
- Author: operator=ta session=claude-code-w6-14-queue-drill-down-filters model=claude-opus-5-5 (implementation lane admin)
- Takes over from: session=none (reason: new; ticket #224, W6-13 merged #295)
- Scope: per changes/2026-09-27-w6-14-queue-drill-down-filters/: `QueueQuerySchema` gains the W6-01 drill-down keys (`lane`, `laneStatus`, `sla`, `findingLane`, `findingSeverity`, `findingKind`), applied by `queue/repository.ts` `readQueue` inside the scoped `visible` sub-select before counts, options and pages; `laneStatus=pending` and `sla` use the dashboard's `openReviewTargets` rule through one shared SLA-state helper; the queue screen reads and writes them in the URL, keeps them on Apply and shows them with a clear button (th/en keys). No migration, no dashboard UI (W6-15), no `riskTier` (W6-16), no recheck predicate (W6-09). One PR.

## 2026-09-28 05:11 — CLAIM lane-a: W4-16 locators carry no document text (#202)
- Author: operator=ta session=claude-code-w4-16-locators model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #202, implementation lane qc-core)
- Scope: per changes/2026-09-27-w4-16-locators-carry-no-document/: shared `EvidenceLocator` `section { index? }` and `cell { sheetIndex?, cell? }` (A1 pattern) with no `heading`/`sheet`; the runner schema and the extraction wire refuse the text shapes; `locatorView` serves legacy text rows as the bare kind; substitute scripts migrated; the evidence line renders ordinals; W0-07 3.3 and W0-02 section 7 amendments. One PR.
