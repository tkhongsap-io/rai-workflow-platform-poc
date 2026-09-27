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
| 11 | The in-memory API substitute: W4b decision 19 froze it and deferred the question to the W6 kickoff; W5 R-16 adds two routes; W6 was silent | W4b, W5, W6 | The freeze binds W4b tickets only; W5 R-16's two reads are the only additions; W6 keeps it frozen (PR, W6 section 11.2) |
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

## Commands and results

| Command | Result |
|---|---|
| `node scripts/check-links.mjs` | 0 broken (after the fixes below) |
| `git diff --check` | clean |

No application code changed, so the `rai-web` gate is not run by this docs change. Each ticket runs it (plan section 16 of W4b, section 10 of W5 and W7, section 12 of W6).

## Review verdicts on this change

To be recorded when the documentation PR is reviewed: two independent reviewer agents and CI, under the D03 flow.
