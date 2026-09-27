# Plan

1. Board entry in `docs/board/lane-decisions-and-docs.md`.
2. Four package plans, each drafted by a planning agent and put through up to three rounds of two independent reviewers (see [review](review.md)).
3. Consolidation. The consolidator read the four plans together against the code and resolved the cross-plan conflicts and the blockers left open after round 3 in the plan files, with a note in each plan's "Plan review" section.
4. Register rows, the BUILD_PLAN gate section, the authorization lines and the status lines.
5. DEVLOG and CHANGELOG entries.
6. Link check and `git diff --check`, then independent review of this documentation PR, CI and merge through the D03 flow.
7. After merge: one epic per package and one issue per ticket below, then a CLAIM on the lane's board stream before each ticket starts.

## Merged ticket list (dependency-ordered)

Wave = the length of the longest dependency chain to the ticket. Tickets in the same wave whose dependencies have merged can run in parallel, subject to the shared-file rules below. Wave 0 is this change. The lanes are the board streams (A server, B UI, C platform, tests and substitutes, Lead, docs). Each package plan's ticket table is authoritative for done-when and paths.

| Wave | Ticket | Pkg | Outcome | Lane | Owner type | Depends on | Migration |
|---|---|---|---|---|---|---|---|
| 0 | W4-00b | W4B | W4b file-level plan and provisional register rows (this consolidated change) | Lead | HRR | — | no |
| 0 | W5-00 | W5 | W5 file-level plan and register row (this consolidated change) | docs | Lead (HRR) | — | no |
| 0 | W6-00 | W6 | W6 file-level plan (this consolidated change) | Lead | Lead | — | no |
| 0 | W7-00a | W7 | W7 file-level plan, register row, class-map lines in W5/W6 plans (this consolidated change) | Lead | Lead | — | no |
| 1 | W4-01 | W4B | ADR-0006 QC engine and extraction (provisional) | Lead | HRR | W4-00b | no |
| 1 | W4-11b | W4B | Run identity for extraction/model use; unavailable_detail | A | Agent-eligible | W4-00b | **yes** |
| 1 | W4-16 | W4B | Locators carry no document text | A | HRR | W4-00b | no |
| 1 | W4-09a | W4B | Evaluation set generator, dev split, provisional labels | C | Agent-eligible | W4-00b | no |
| 1 | W5-01 | W5 | Rubric schema and pure scoring engine | A | HRR | W5-00 | no |
| 1 | W5-03 | W5 | risk migration and Drizzle schema (restore-required) | A | Agent-eligible | W5-00 | **yes** |
| 1 | W6-01 | W6 | W6 contract: shared shapes, policy rows, error codes | A | HRR | W6-00 | no |
| 1 | W7-01 | W7 | Backup command (+ CI RAI_PG_TOOLS line) | C | HRR | W7-00a | no |
| 1 | W7-03 | W7 | Migration classes, ahead readiness, rollback check | A | HRR | W7-00a | **yes** |
| 1 | W7-05 | W7 | network fail-closed amendments and test seams | A | HRR | W7-00a | no |
| 1 | W7-10 | W7 | Rehearsal templates and timing capture | C | Agent-eligible | W7-00a | no |
| 2 | W4-05a | W4B | Real, revocable artifact read handles in the QC request | A | HRR | W4-11b | no |
| 2 | W4-05b | W4B | Extraction worker host, protocol and limits | A | HRR | W4-01 | no |
| 2 | W5-02 | W5 | Register risk_rubric, seed synthetic placeholder, rubric read endpoint | A | Agent-eligible | W5-01 | no |
| 2 | W6-02 | W6 | Configuration drafts, change note, restore, desk_controls kind (restore-required) | A | HRR | W6-01 | **yes** |
| 2 | W6-13 | W6 | Dashboard API | A | HRR | W6-01 | no |
| 2 | W7-02 | W7 | Restore and verify | C | HRR | W7-01 | no |
| 2 | W7-06 | W7 | subject_profile | A | HRR | W7-03, W7-05 | **yes** |
| 2 | W7-09 | W7 | Sign-in method endpoint and UI | B | HRR | W7-05 | no |
| 3 | W4-15 | W4B | Finding dedup (owning lane, claimKey, recheck-aware); measure columns; already_recorded_count | A | HRR | W4-05a | **yes** |
| 3 | W4-05c | W4B | DOCX and XLSX extraction | A | HRR | W4-05b | no |
| 3 | W4-06a | W4B | Content runner, claim grammar, ACC-METRIC-CITED (+ seed params, claimKey, lane/upload scope) | A | HRR | W4-05b, W4-16 | no |
| 3 | W5-04 | W5 | Draft risk answers | A | Agent-eligible | W5-02, W5-03 | no |
| 3 | W6-03 | W6 | Publish validation (Admin paths only) and implemented-rule registry | A | HRR | W6-02 | no |
| 3 | W6-14 | W6 | Queue drill-down filters | A+B | HRR | W6-13 | no |
| 3 | W7-07 | W7 | Mail file drop, recipient and BU directories | A | HRR | W7-06 | no |
| 4 | W4-17 | W4B | Unbound upload run recorded; slot in upload runKey | A | HRR | W4-15 | no |
| 4 | W4-05d | W4B | PDF text layer; images unreadable | A | HRR | W4-05c | no |
| 4 | W4-06b | W4B | ACC-EXTRACTION-NOT-HALLUCINATION and ACC-CLASSIC-ML-METRIC (+ seed params) | A | HRR | W4-06a | no |
| 4 | W5-05 | W5 | Risk proposal at submit (in transaction); case.risk_tier | A | HRR | W5-04 | no |
| 4 | W5-07 | W5 | Questionnaire UI in the pack editor | B | Agent-eligible | W5-04 | no |
| 4 | W6-04 | W6 | Admin configuration API | A | HRR | W6-03 | no |
| 4 | W6-15 | W6 | Dashboard UI | B | Agent-eligible | W6-14 | no |
| 4 | W7-08 | W7 | A01 network clause suite | C | HRR | W7-05, W7-06, W7-07 | no |
| 4 | W7-16 | W7 | Deployment-readiness note | C | Agent-eligible | W7-00a, W7-07 | no |
| 5 | W4-18 | W4B | Two run parts per trigger (metadata + content); approval names latest part | A | HRR | W4-17 | no |
| 5 | W4-06c | W4B | ACC-BAND-V1-SHEET3 (+ seed params) | A | HRR | W4-06b | no |
| 5 | W4-08a | W4B | Evaluation harness core and report | C | Agent-eligible | W4-09a, W4-06a, W4-05c, W4-05d | no |
| 5 | W5-06 | W5 | Risk proposal read endpoint | A | Agent-eligible | W5-05 | no |
| 5 | W5-09 | W5 | Tier on queue and case list | B | Agent-eligible | W5-05 | no |
| 5 | W5-10 | W5 | RISK-TIER-UNKNOWN QC input; riskProposal on QcRunRequest | A | HRR | W5-05 | no |
| 5 | W6-05 | W6 | Admin UI: index, history, diff, restore | B | Agent-eligible | W6-04 | no |
| 5 | W6-08 | W6 | Activation and historical-evidence proof | C | HRR | W6-04 | no |
| 5 | W6-16 | W6 | Dashboard risk tiers and riskTier filter | A+B | Agent-eligible | W6-15, W5-05 | no |
| 6 | W4-06d | W4B | PACK-CONTRADICTION (+ seed entry, registry entry if W6-03 merged) | A | HRR | W4-06c | no |
| 6 | W4-13b | W4B | QC_MODE=content bound as two parts; extraction keys; readiness; operator label | C | HRR | W4-05a, W4-05d, W4-06a, W4-18 | no |
| 6 | W4-09b | W4B | Held-out split, variants, freeze | C | Agent-eligible | W4-08a | no |
| 6 | W4-12b | W4B | UI: measures, ordinal locators, detail codes, identities, run parts | B | Agent-eligible | W4-11b, W4-15, W4-16, W4-18 | no |
| 6 | W5-08 | W5 | Proposal display: version, reviewer, overview | B | Agent-eligible | W5-06, W5-07 | no |
| 6 | W6-06 | W6 | Admin UI: simple-kind editors, draft and publish | B | Agent-eligible | W6-05 | no |
| 6 | W6-09 | W6 | Explicit QC recheck (advisory), desk_paused reason, frozenConfiguration (restore-required) | A | HRR | W6-02, W4-15, W4-17, W4-18 | **yes** |
| 7 | W4-13c | W4B | Seed label w4b.1 and the content real-server test | C | Agent-eligible | W4-13b, W4-06d, W4-15 | no |
| 7 | W4-07a | W4B | Model port, prompt identity, output validation, local fake, QC_MODEL | A | HRR | W4-13b | no |
| 7 | W5-11 | W5 | Reference cases and A03 evidence | C | Agent-eligible | W5-08, W5-10 | no |
| 7 | W6-10 | W6 | Version configuration panel and recheck UI | B | Agent-eligible | W6-09 | no |
| 7 | W6-11 | W6 | Identity-mapping configuration contract | A | Agent-eligible | W6-03, W6-06 | no |
| 7 | W6-17 | W6 | Desk controls (freeze writes, pause mail, pause QC) | A | HRR | W6-04, W6-06, W6-09 | no |
| 7 | W6-19 | W6 | Risk recheck (advisory) | A+B | HRR | W6-09, W5-05, W5-06 | no |
| 8 | W4-07b | W4B | claimSource grammar+model in the runner | A | HRR | W4-07a, W4-11b | no |
| 8 | W4-08b | W4B | Threshold gate, stale check, CI step | C | Agent-eligible | W4-09b, W4-13c | no |
| 8 | W4-10b | W4B | Failure probes, server level | C | HRR | W4-13c | no |
| 8 | W5-EXIT | W5 | W5 exit record (A03 partial pending D07) | docs | Lead | W5-09, W5-11 | no |
| 8 | W6-07 | W6 | Admin UI: QC rule catalogue editor | B | Agent-eligible | W6-06, W4-13c | no |
| 8 | W6-12 | W6 | Risk rubric editing (D07 badge) | B | Agent-eligible | W6-11, W5-02 | no |
| 8 | W6-18 | W6 | Operator guide | C | Agent-eligible | W6-17, W6-15 | no |
| 8 | W7-11 | W7 | Rehearsal case set and loader | C | Agent-eligible | W7-10, W5-05, W4-13c, W6-17 | no |
| 9 | W4-10a | W4B | Critical probes, runner level | C | HRR | W4-07b, W4-09b | no |
| 9 | W4-INT-a | W4B | Real-server W4b integration journeys | A | Agent-eligible (lead reviews) | W4-13c, W4-07b, W4-17, W4-10b | no |
| 9 | W6-EXIT | W6 | W6 engineering exit record (qualified coverage statement) | Lead | Lead | W6-07, W6-08, W6-10, W6-12, W6-16, W6-18, W6-19 | no |
| 9 | W7-04 | W7 | Backup/restore and rollback runbooks; operator guide W7 sections | C | Agent-eligible | W7-02, W7-03, W7-05, W6-18 | no |
| 9 | W7-12 | W7 | Scripted dress rehearsal | C | HRR (CI) | W7-11, W6-18 | no |
| 10 | W4-INT-b | W4B | Browser journey on QC_MODE=content | B | Agent-eligible (lead reviews) | W4-INT-a, W4-12b | no |
| 10 | W7-13 | W7 | W7-00 synthetic restore and rollback rehearsal record | Lead | Lead | W7-02, W7-03, W7-04, W7-06, W7-11 | no |
| 11 | W4-14 | W4B | W4b exit record | Lead | HRR | W4-01, W4-08b, W4-10a, W4-INT-a, W4-INT-b | no |
| 11 | W7-14 | W7 | Agent dress rehearsal and findings | Lead | Lead | W7-12, W7-13, W7-08, W6-EXIT | no |
| 12 | W7-15.n | W7 | Blocking-defect fixes (one PR per defect) | per defect | per defect | W7-14 | no |
| 13 | W7-EXIT | W7 | W7 synthetic engineering exit record | Lead | Lead | W7-09, W7-15.n, W7-16, W4-14, W5-EXIT | no |

## What runs in parallel

- **Immediately after this change merges (wave 1):**
  - W4b: W4-01, W4-16, W4-09a, and W4-11b (migration);
  - W5: W5-01, and W5-03 (migration);
  - W6: W6-01;
  - W7: W7-01, W7-05, W7-10, and W7-03 (migration).

  These touch disjoint files, apart from the three migrations, which queue on the `MIGRATION-SLOT`.
- **Independent tracks that then proceed side by side:**
  - W4b extraction (W4-05b → c → d);
  - W4b rules (W4-06a → d);
  - W4b evaluation (W4-09a → W4-08a → W4-09b);
  - W4b orchestrator (W4-11b → W4-05a → W4-15 → W4-17 → W4-18);
  - W5 server (W5-01/W5-03 → W5-02 → W5-04 → W5-05 → W5-06, W5-10);
  - W5 UI (W5-07, W5-08, W5-09);
  - W6 Admin (W6-02 → W6-03 → W6-04 → W6-05 → W6-06, with W6-08 beside them);
  - W6 dashboard (W6-13 → W6-14 → W6-15);
  - W7 backup (W7-01 → W7-02);
  - W7 identity (W7-05 → W7-09);
  - W7 directories (W7-03 → W7-06 → W7-07 → W7-08);
  - W7 kit (W7-10, W7-16 draft).
- **Convergence points across packages:**
  - W6-09 waits for W4-15, W4-17 and W4-18 (orchestrator);
  - W6-07 waits for W4-13c (params schemas);
  - W6-12, W6-16 and W6-19 wait for W5;
  - W7-11 waits for W5-05, W4-13c and W6-17;
  - W7-04 and W7-12 wait for W6-18;
  - W7-14 waits for W6-EXIT.
- **A failed W4b exit** (a held-out threshold missed, W4b plan section 11.3) is recorded honestly. It does not stop W5-W7, which depend on W4b tickets, not on its exit verdict. W7-EXIT cites the W4-14 and W5-EXIT records as they stand.

## Migration queue (`MIGRATION-SLOT`)

Only one migration-bearing PR across all packages is in review at a time. The holder takes the `MIGRATION-SLOT` claim on `docs/board/lane-lead-integration.md` and releases it at merge. The number is the next free one on `main` at rebase (today `0010`). `meta/_journal.json` and the snapshot are regenerated with `npm run migrate:generate`, and the lists in `tests/integration/w1-00-migrations.test.ts` are merged as a union. A merged migration is never renumbered or edited. The expected order, by readiness, with each migration's rollback class (W0-04 values; W7-03 class map):

| Order | Ticket | Migration | Class |
|---|---|---|---|
| 1 | W5-03 | `risk_answers`, `case_risk_tier_check` with `unknown`, `risk_proposal` | restore-required |
| 2 | W4-11b | `qc_run` extraction/model identity, `unavailable_detail` | additive |
| 3 | W7-03 | `schema_migration_class` | additive |
| 4 | W6-02 | `configuration_draft`, `change_note`, `restores_id`, `desk_controls` kind | restore-required |
| 5 | W7-06 | `subject_profile` | additive |
| 6 | W4-15 | `qc_finding` `scope_key`, `claim_key`, measure columns; `qc_run.already_recorded_count` | additive |
| 7 | W6-09 | `qc_run.recheck`, `requested_by`, `desk_paused` reason | restore-required |

Any of them merged before W7-03 gets its class entry when W7-03 rebases. Any merged after W7-03 adds its own entry and a header with its class.

## Shared-file serialization

| File or area | Tickets | Rule |
|---|---|---|
| `server/src/qc/orchestrator.ts`, `qc/repository.ts` | W4-11b, W4-05a, W4-15, W4-17, W4-18, W5-10, W6-09, W6-17 | One open PR at a time, in that order where the dependencies allow. W5-10 rebases after the W4b orchestrator ticket in flight |
| `compose-app-deps.ts`, `app.ts`, `start.ts`, `config.ts`, `.env.example` | W4-05a, W4-17, W4-13b, W4-07a, W5-06, W6-04, W6-13, W6-17, W7-01, W7-02, W7-05, W7-07 | Rebase before review; never reorder another package's keys or routes |
| `configuration/seed.ts`, `seed.test.ts`, `shared/src/schemas/cases.ts` | W4-06a-d, W4-13c, W5-02, W5-10, W6-02, W6-11 | Each adds its own block. The `qc_rules` label names the last ticket that changed the seeded body (W4b plan section 3.3). `UNSEEDED_KINDS` comes from W6-02 |
| `shared/src/qc/rule-registry.ts` | W6-03, W4-06d, W5-10 | Whichever merges second adds the missing entry |
| `shared/src/schemas/review.ts` | W4-11b, W4-15, W4-16, W4-18, W6-09 | Fields on shapes the API substitute builds stay `Type.Optional` |
| `shared/src/schemas/observability.ts`, `web/src/i18n/operator-labels.ts`, `web/src/screens/case/view-model.ts` | W4-11b, W4-13b, W4-12b, W6-09, W6-10, W6-17, W7-03 | A widened enum gets its `operator.value.*` label in the same PR. Map entries only |
| `versions/service.ts`, `notifications/service.ts`, `workflow/service.ts` | W5-05, W7-07; W6-17, W7-07; W4-18, W6-09 | One-line widenings or filters; the second PR rebases and keeps both |
| `queue/repository.ts`, `shared/src/schemas/queue.ts` | W5-09, W6-14, W6-16 | W5-09 adds a column; W6 adds filters inside the scoped sub-select |
| `.github/workflows/ci.yml` | W4-08b, W7-01, W7-02, W7-12 | Lead-reviewed; one step or env line each |
| `shared/src/locales/{th,en}.json`, `keys.ts` | every UI ticket | Keys only in existing namespaces or the package's own (`risk.*`, `dashboard.*`, `admin.config.*`, `desk_controls.*`); union on rebase; `locales.test.ts` guards parity |
| `docs/operations/operator-guide.md` | W6-18, W7-04 | W6-18 owns it; W7-04 edits only its sign-in, incident and known-limits sections |
| `fixtures/src/substitutes/api/*` | W5-07, W5-08 | The only additions to the frozen API substitute in W4b-W7 (W5 R-16) |
