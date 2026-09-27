# Review: W4b-W7 plans under Ta's delegation

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Docs only. The direction recorded here is Ta's instruction in the Claude Code session of 2026-09-27. Every choice made under it is provisional and is recorded as "agent team under Ta's delegation of 2026-09-27; Ta to confirm". D07, D08, D09 and D10 stay open, and no row or plan says that an owner approved anything.

## Plan review rounds

Each package plan was drafted by a planning agent and then reviewed by two independent reviewer agents per round, for at most three rounds. Every blocker was checked against `rai-web` on `main` before it was resolved. Each plan's own "Plan review" section holds the full resolutions.

### W4b ([plan](../../docs/engineering/implementation-plan-w4b.md) section 20)

| Round | Verdicts | Blockers (short) | Resolution |
|---|---|---|---|
| 1 | BLOCK, BLOCK | (1) An extraction outage made the whole run unavailable and dropped the W4a metadata findings. (2) Decision 14 had no options. (3) `message_param_text` would refuse the substitute scripts' `threshold_source: 'v1.0 Sheet3'`. (4) `alreadyRecordedCount` had no stored column. (5) New required read fields would break the frozen API substitute's typecheck | (1) Decision 27: two run parts per trigger (W4-18). (2) Decisions 14 and 14b with options. (3) The template-version string is allowed. (4) `qc_run.already_recorded_count`. (5) The new fields are `Type.Optional` |
| 2 | BLOCK, BLOCK | (1) Approve-attempt content rules were not scoped to the run's lane, which clashed with `finding_outside_lane`. (2) Two run parts broke the `approveLane` latest-run check | (1) Decision 28: lane-scoped reading. (2) Decision 29: parts stamped metadata then content; the combined run ID is the latest part; `approveLane` unchanged |
| 3 | PASS, BLOCK | (1) Params schemas were registered before the seed had params, so the seed would be refused. (2) Decision 22 contradicted section 3.1 for a slot-5 upload. (3) Two defective claims shared one `findingKey`, and dedup dropped the second | Resolved by the consolidator: (1) each W4-06x adds its seed params with the schema. (2) Upload reads only single-lane slots. (3) Decision 30: `claimKey` in the finding key and the dedup key, plus `duplicate_finding_key` |

### W5 ([plan](../../docs/engineering/implementation-plan-w5.md) section 13)

| Round | Verdicts | Blockers (short) | Resolution |
|---|---|---|---|
| 1 | PASS, BLOCK | (1) Submit now writes `risk_tier`, which changes `w1-05-submit`, `w2-01-lanes`, the audit allow-list, `AUDIT_ACTIONS`, W0-06 4.3/9.2 and W0-04, and none of these were named. (2) The wrong migration test file was named | (1) The contract changes and the rewritten tests are named in section 0 and the W5-05 row, with the W0-06/W0-04 amendments. (2) `w1-00-migrations.test.ts` and `tests/support/db.ts` are named |
| 2 | PASS, PASS | — | — |

### W6 ([plan](../../docs/engineering/implementation-plan-w6.md) section 18)

| Round | Verdicts | Blockers (short) | Resolution |
|---|---|---|---|
| 1 | BLOCK, BLOCK | (1) The exit coverage statement overstated A03/A08/A09/A10. (2) Rechecks were not isolated from `findLatestQcRun`, `approveLane` and replay. (3) W6-02 could not seed `desk_controls` | (1) A qualified coverage statement with the owner-dependent exceptions. (2) `recheck = false` in `findLatestQcRun`, plus a regression test. (3) Schema and kind registration moved into W6-02 |
| 2 | PASS, BLOCK | (1) Registering `group_role_mapping` would break the seed type. (2) The recheck and advisory state never reached the API, and `desk_paused` would fail serialization | (1) `UNSEEDED_KINDS` and `ConfigurationSeed` over `Exclude<…>` in W6-02; W6-11 is the sole registrant. (2) Recheck and advisory fields in `review.ts`; one `QC_UNAVAILABLE_REASONS` list |
| 3 | PASS, BLOCK | (1) Where the cross-kind publish checks run was unstated, and `publishRevision` would break the seed, `w4-02` and `w3-03b`. (2) W6-09 failed typecheck in `view-model.ts` and `operator-labels.ts`, and named a non-existent locale namespace | Resolved by the consolidator: (1) `publishProblems` runs only in the Admin `publishDraft`/`restoreRevision` paths, and `publishRevision` is unchanged. (2) W6-09 adds both web files and uses the keys `review.qc.reason.desk_paused` and `operator.value.desk_paused` |

### W7 ([plan](../../docs/engineering/implementation-plan-w7.md) section 15)

| Round | Verdicts | Blockers (short) | Resolution |
|---|---|---|---|
| 1 | PASS, BLOCK | (1) The `discovery` seam guard broke the W4-13 `start.test.ts` cases. (2) A new `MAIL_MODE` parse rule changed existing refusal reasons. (3) A per-send recipient directory needed async changes across four services | (1) Only `exchange` is guarded before parse; `discovery` is refused only under production, after parse. (2) No parse change, only a binding in `start.ts`. (3) W7-D20: an in-memory directory refreshed after each sign-in |
| 2 | PASS, BLOCK | (1) The class writer failed on `w3-07a`'s historical scratch folder. (2) The file drop named files by a notification ID that `DeliveryRequest` does not carry, and the validator lived only in fixtures | (1) The writer runs only when `schema_migration_class` exists; tags come from the journal. (2) `mailFileStem(dedupKey, attempt)` naming, with validate, duplicate and restart-index parity; the validator and `mailFileStem` move to `@rai/shared` |
| 3 | PASS, BLOCK | (1) W7-01's backup integration test had no `RAI_PG_TOOLS` in CI (that line sat in W7-02), and `.env.example`'s compose value does not exist on the runner | Resolved by the consolidator: W7-01 adds the CI `RAI_PG_TOOLS` line and lists `ci.yml`; W7-02 adds only `DATABASE_ADMIN_URL` |

The round-3 blockers were resolved by the consolidator, not by a fourth reviewer round. The independent review of this documentation PR is the check on those resolutions.

## Cross-plan consolidation

The consolidator read the four plans together against the code (`rai-web` on `main`, `c8d64f2`) and fixed these conflicts in the plan files. Each affected plan's "Plan review" section notes the fix.

| # | Conflict | Plans | Fix |
|---|---|---|---|
| 1 | The W4-15 dedup suppresses a finding while an open finding with the same key exists. A W6 recheck finding is advisory and can never be dispositioned, so it would stay open for good and suppress every later gating finding on the same claim; a recheck under the frozen revision would also record nothing new | W4b, W6 | The dedup lookup ignores recheck-run findings, and recheck runs do not dedup (W4b section 6; W6 section 5; W4-15 and W6-09 done-when) |
| 2 | W4-18's two run parts versus W6 rechecks and the QC pause: how many rows a recheck or a pause writes, which filters `findLatestQcRun` carries, and where `parts[].reason` comes from | W4b, W6 | One `recheck = true` row per bound part; `qcPaused` records every part as `desk_paused`; `findLatestQcRun` carries the optional engine ID and `recheck = false`; `parts[].reason` derives from `QC_UNAVAILABLE_REASONS` |
| 3 | The `qc_rules` seed label: W4-13c sets `w4b.1` and W5-10 sets `w5.1`, and each plan asserted its own label | W4b, W5 | The label names the last ticket that changed the seeded body; whichever merges second keeps the other's rules, sets its label and updates the assertions |
| 4 | W6-03's `IMPLEMENTED_RULES` registry refuses unimplemented rule IDs, but W4b never mentioned it (`PACK-CONTRADICTION`), and W5-10 adds `RISK-TIER-UNKNOWN` | W4b, W5, W6 | Whichever of W4-06d/W5-10 and W6-03 merges second adds the entry; a content-registry test mirrors W6-03's metadata test |
| 5 | Readiness and desk-health enum widenings (`content`, `desk_paused`, `unconfigured`, `ahead`) fail typecheck without `operator-labels.ts` entries (`satisfies Record<OperatorValue, LocaleKey>`). W7 named a non-existent `operator.health.*` namespace | W4b, W6, W7 | Each widening adds its `operator.value.*` label in th and en in the same PR. W7 uses `operator.value.ahead` and `operator.field.migrations_ahead_note` |
| 6 | Migration rollback classes: W5-03's header "forward repair only" is not a W0-04 value, and no plan classified W4b's or W6's migrations for W7-03's class map | W4b, W5, W6, W7 | W4-11b and W4-15 `additive`; W5-03, W6-02 and W6-09 `restore-required`, each with its reason. The queue and the single `MIGRATION-SLOT` are in the [plan](plan.md). `w1-00-migrations.test.ts` is serialized by the slot |
| 7 | Dashboard ownership: the W5 plan still called the tier filter and dashboard aggregates "W7", while W6 owns them (W6-13 to W6-16) | W5, W6 | The W5 plan now points to W6 (a provisional agent-team choice, not a recorded agreement) |
| 8 | The dashboard's severity union had `info`, but `Severity` is `high`, `medium` or `low`; its QC run counts were ambiguous under two run parts | W6 | It uses `Severity`; the counts are run rows, so a two-part trigger counts twice |
| 9 | W6-07's `qc_rules` editor needs W4b's params schemas, but its dependencies did not say so | W4b, W6 | W6-07 depends on W4-13c |
| 10 | W5-10 makes `QcRunRequest.riskProposal` required, and W4b adds new request builders (`qc/request.ts`, runner tests, the evaluation harness) | W4b, W5 | W4b builders are in W5-10's list, or set it themselves if written later. `RISK-TIER-UNKNOWN` runs in the metadata part |
| 11 | The in-memory API substitute: W4b decision 19 froze it and deferred the question to the W6 kickoff; W5 R-16 adds two routes; W6 was silent | W4b, W5, W6 | The freeze binds W4b tickets only; W5 R-16's two reads are the only added routes (W5-04 and W5-10 also edit literals: corrected in round 2, B3); W6 keeps it frozen (PR, W6 section 11.2) |
| 12 | The W7 scripted rehearsal and deployment note used `QC_MODE=deterministic`, so R5's content finding could never appear. W7-11 depended on package exits that may honestly fail | W4b, W7 | The rehearsal and deployment note use `QC_MODE=content` with `QC_MODEL=disabled` once W4-13b merges (`deterministic` is the fallback). W7-11 depends on W5-05, W4-13c and W6-17 |
| 13 | Register rows: each plan planned its own gate and ruling rows under different names, and W6 said it did not record the gate row | all | This change records "Ta's delegation (2026-09-27)" plus one "delegated rulings (provisional)" row per package; each plan's section on other documents points here |
| 14 | W7-D12 waited on a possible W6 business-unit kind | W6, W7 | W6 ships none, so option A stands |

Checked and found consistent, with no change needed:

- `configuration_revision` kinds: W5 `risk_rubric` is frozen; W6 `desk_controls` and `group_role_mapping` are unfrozen and unseeded, and `w1-05-submit` is in W6-02's paths.
- `case.risk_tier` with `unknown` feeds the W6 risk tile, and rechecks never write it.
- The `writesFrozen` exemptions cover the W7 `/auth/*` sign-in routes, and `/auth/sign-in-method` is a GET.
- The locale namespaces `risk.*`, `dashboard.*`, `admin.config.*`, `desk_controls.*` and `qc_log.*` exist or are new top-level namespaces.
- The endpoints do not overlap:
  - W5: `/api/configuration/risk-rubric/current` and `…/risk-proposal`;
  - W6: `/api/admin/configuration/*`, `/api/dashboard`, `…/qc-rechecks` and `…/risk-rechecks`;
  - W7: `/auth/sign-in-method`.

## Final reviews of this change and consolidation round 2

Two independent final reviews of this documentation PR ran at `834c95c`, both checked against `rai-web` on `main` (`c8d64f2`):

- **Contract review: PASS.** Register rows, authorization scope, open questions, hard limits and the round-3 fixes were all found faithful; append-only records untouched. Two non-blocking notes: stale register-row names in the W5 and W7 plan bodies, and CI still running at that head.
- **Engineering review: BLOCK.** Three blockers, six missing or implicit cross-lane dependencies and several non-blocking notes.

The consolidator resolved every point in the plan files, checked each against the code, and added a "Consolidation round 2" note to each plan's "Plan review" section.

| # | Point (review) | Resolution |
|---|---|---|
| B1 | W6-02 grants `rai_app` `DELETE` on `configuration_draft`; W7-02's `grants` check required none anywhere (engineering) | One rule in both plans: no `DELETE` for `rai_app` on any table except `configuration_draft`. W6-02 amends W0-04 and the `w1-00-migrations.test.ts` comment; W7-02's check asserts a subset of `{configuration_draft}`, true in either merge order ([W6](../../docs/engineering/implementation-plan-w6.md) section 3, [W7](../../docs/engineering/implementation-plan-w7.md) section 3.2) |
| B2 | No ticket excluded recheck findings from the dashboard and queue filters; `advisory` and `rechecks30d` unwired (engineering) | Moved into W6-09: its paths add `dashboard/repository.ts` and `queue/repository.ts`, its done-when proves the predicate and the two counts, and it depends on W6-13 and W6-14. W6-13 serves both counts as `0` until then. The dashboard lane stays off the W4b orchestrator chain (W6 section 5, W6-09/13/14 rows) |
| B3 | W5-09's required `riskTier` breaks the API substitute's typecheck (engineering) | `riskTier` is `Type.Optional` on `QueueItem` and `CaseSummary`; `workflow.ts` `caseSummary()` and `routes-queue.ts` stay unchanged. The substitute statements now list every W5 edit: W5-04 (`store.ts`, `workflow.ts` draft literals), W5-07, W5-08 and W5-10 (`routes-review.ts`) ([W5](../../docs/engineering/implementation-plan-w5.md) sections 6-8; W4b decision 19; W6 section 11.2; plan) |
| D1 | W6-12 needs W5-05 | W6-12 depends on W5-02, W5-05 and W5-06; its done-when reads the proposal over HTTP |
| D2 | W6-19 needs W5-08 | Added |
| D3 | W6-13/W6-14 need W6-09 | Resolved the other way (B2): W6-09 depends on W6-13 and W6-14 and owns the predicate |
| D4 | W7-11 needs W4-09a and a stated QC mode | Added W4-09a; its test runs `QC_MODE=content`, `QC_MODEL=disabled` |
| D5 | W7-12 needs W5-08 | Added; `QC_MODE=content` without a fallback |
| D6 | W5-10's `RISK-TIER-UNKNOWN` makes every answerless submit's journey depend on its merge order | Option (a), recorded in W5 section 9: W4-13c, W4-INT-a, W4-INT-b, W6-08, W7-11 and W7-12 depend on W5-10, and W5-10's done-when lists every test it changes (the label in `seed.test.ts`, `w4-02`, `w4-12-qc-runs`, `w4a-int-deterministic-server` and `w4-12-qc-log.spec.ts`; the submit rule list in `w4-02`; `rules_evaluated` 3 → 4 and one extra finding per submit in `w4-03` and `w4a-int`; earlier W4b deterministic suites). Option (b), answers on fixture drafts, was rejected: it changes the fixture-set identity (W5 R-12), contradicts W5-05's `risk_tier = 'unknown'` assertion and misses drafts tests create. Only W6-08 moves back a wave (5 → 6) |
| D7 | W4-06a and W4-08a edit `qc/orchestrator.ts` but were outside the one-open-PR rule | Both added to the rule in the plan and in W4b section 15.2; W4-06a's paths list the file |
| N1 | W6-01 `desk_frozen`: locale keys, `errors.test.ts`, `observability/errors.ts` (engineering) | In W6-01's paths and done-when, with a `desk_frozen` error category at info (W6 section 4.2) |
| N2 | W6-02 and `BUSINESS_TABLES` (engineering) | `configuration_draft` added to `tests/support/db.ts` in W6-02 |
| N3 | Typed test literals (engineering) | Named in the paths of W4-11b, W4-13b, W6-17 (`view-model.test.ts`, `client.test.ts`, `operator-rehearsal.ts`), W4-16 (`view-model.test.ts`) and W4-06a (`qc-rules.test.ts`) |
| N4 | Migrations and the merge queue (engineering) | Stated once in each plan and in the [plan](plan.md): a migration is never renumbered by a merge queue; its author rebases and regenerates it by hand at the next free number, keeping hand-written SQL, because `db/migrate.ts` refuses an unapplied migration older than the last one applied |
| N5 | Stale register-row names in the W5 and W7 plans (contract) | W5 section 1 and the W5-00 row name "W5 delegated rulings (provisional)"; the W7 status line names "Ta's delegation (2026-09-27)" as Ta's gate entry and "W7 delegated rulings (provisional)" |

## Commands and results

| Command | Result |
|---|---|
| `node scripts/check-links.mjs` | 0 broken (after the fixes below) |
| `git diff --check` | clean |
| `node scripts/check-links.mjs` (consolidation round 2) | 369 Markdown files, 1058 relative links, 0 broken |
| `git diff --check` (consolidation round 2) | clean |

No application code changed, so the `rai-web` gate is not run by this docs change. Each ticket runs it (plan section 16 of W4b, section 10 of W5 and W7, section 12 of W6).

## Review verdicts on this change

To be recorded when the documentation PR is reviewed: two independent reviewer agents and CI, under the D03 flow.
