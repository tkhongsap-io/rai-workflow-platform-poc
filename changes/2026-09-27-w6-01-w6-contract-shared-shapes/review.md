# Review: W6 contract — shared shapes, policy rows, error codes (W6-01, #206)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: the W6-01 row of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 4.1, 4.2, 4.3, 8.1, 8.2, 10, 11, 17); the plan wins over issue #206. Decisions applied: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)"; every choice below is a provisional agent-team ruling under that delegation. D07, D08, D09 and D10 stay open for their owners: this ticket only names who owns which configured values. HRR. Contract only: no route, repository, migration or screen. Synthetic data only; no network call; nothing deploys.

## Change

- **`shared/src/errors.ts`**:
  - ninth code `desk_frozen` → HTTP 503, and `DeskFrozenError` (no details: `ErrorDetails.desk_frozen: never`);
  - `STALE_REASONS` gains `configuration_changed`;
  - `stale_version` details become `VersionStaleDetails | ConfigurationStaleDetails`. The version shape is unchanged, only named. The configuration shape carries `current: { kind, revisionId, draftVersion }` and the guidance key `error.stale_version.guidance.configuration_changed`;
  - `NotFoundResource` gains `configuration`.
- **`shared/src/schemas/configuration-admin.ts`** (new): TypeBox schemas and types for the Admin configuration API (plan section 4.2):
  - revision summary and detail;
  - draft summary and detail (with `problems`);
  - index, revision list (with its `page`/`pageSize` query), draft response;
  - the save, discard, publish and restore request bodies;
  - the path params, typed as plain strings so that an unknown kind or a malformed ID is a 404;
  - the constants `CHANGE_NOTE_MAX_LENGTH` (500), `CONFIGURATION_DRAFT_MAX_BYTES` (64 KiB) and `CONFIGURATION_REVISION_LIST_DEFAULTS`, and `CONFIGURATION_VALUES_OWNER` (exhaustive per kind: `risk_rubric` D07, `group_role_mapping` D10, the rest Admin);
  - `FrozenConfigurationEntrySchema`.
- **`shared/src/schemas/dashboard.ts`** (new): `DashboardResponseSchema` as the plan's section 8.1 interface: `byStatus` over every case status, `unavailableOpen` over every lane, severity `high | medium | low`, and the two-form `risk`. Also `DASHBOARD_ACTIVITY_WEEKS = 8`.
- **`shared/src/constants.ts`**: `DASHBOARD_DUE_SOON_WORKING_DAYS = 2` (Q14).
- **`shared/src/schemas/queue.ts`**: `QueueDrilldownQuerySchema` (`lane`, `laneStatus`, `sla`, `findingLane`, `findingSeverity`, `findingKind`). It is not merged into the served `QueueQuerySchema` yet; see Deviations.
- **`shared/src/schemas/versions.ts`**: optional `SubmittedVersion.frozenConfiguration?: FrozenConfigurationEntry[]`. `submittedVersionView` is unchanged and still type-checks.
- **`shared/src/schemas/observability.ts`**:
  - `ErrorCategorySchema` gains `desk_frozen`;
  - `SafeErrorFieldsSchema` gains `{ category: 'desk_frozen' }` (no other field);
  - the `not_found` `targetType` gains `configuration`.
- **`server/src/observability/errors.ts`**:
  - `levels.desk_frozen = 'info'`;
  - an `http()` branch maps `DeskFrozenError` to `{ category: 'desk_frozen' }`;
  - the `stale_version` branch logs `currentVersionId` only when the details carry a version reference.
- **`server/src/authz/policy.ts`**:
  - actions `qc.recheck` and `dashboard.view`;
  - rows `qc.recheck` Admin `all_cases` (target: the case) and `dashboard.view` for the six `VIEW_ROLES` (target `none`; scope applied in SQL by `caseScopeWhere`);
  - the `config.publish` comment names what it covers from W6-04.

  No other row changes.
- **`web/src/i18n/operator-labels.ts`**: `desk_frozen` → `operator.value.desk_frozen`. The map is exhaustive by `satisfies`, so the new category was a type error until this line was added.
- **Locales** (th, en): `error.desk_frozen`, `error.stale_version.guidance.configuration_changed`, `operator.value.desk_frozen`.
- **Docs**, each a dated W6-01 note:
  - W0-02 new section 7.10 "W6 shapes" (`implementation-plan-w1-w3.md`);
  - W0-05: the `Action` union, a rows table (`config.publish` now live, `config.read_revisions`, `qc.recheck`, `dashboard.view`) and test obligation T40 (`authorization-policy-matrix.md`);
  - W0-06 8.1 (`desk_frozen`) and 8.3 (`configuration_changed`, resource `configuration`, desk frozen), in `workflow-transition-and-error-contract.md`;
  - W0-10 6.1: category `desk_frozen` at info, and `targetType` `configuration` (`observability-contract.md`).
- **Tests** (written first and watched failing; see Evidence):
  - `shared/src/errors.test.ts`:
    - `EXPECTED_STATUS` gains `desk_frozen: 503`;
    - the locale-key test covers both new keys in th and en;
    - new tests for `DeskFrozenError`, the configuration stale details and `NotFoundError('configuration')`.
  - `server/src/observability/errors.test.ts` (+1): a `DeskFrozenError` is captured as `desk_frozen`, 503, at `info`, with no `stack` or `stackHash`, and counted under `desk_frozen` only. `NotFoundError('configuration')` is captured as `not_found` with `targetType: 'configuration'`.
  - `shared/src/schemas/observability.test.ts`: `desk_frozen` safe fields accepted; extra fields refused.
  - `server/src/authz/policy.test.ts` (+3):
    - `qc.recheck` is Admin only, and every reviewer role is denied with reason `role`;
    - `dashboard.view` has exactly the six `VIEW_ROLES` rows;
    - T40 at the unit level: each non-Admin role, alone and combined, is denied `config.read_revisions`, `config.publish` and `qc.recheck` with reason `role`. Admin holds no `lane.*` or `finding.*` row (T18).

    The table-driven role × action sweep now covers both new actions.
  - `shared/src/schemas/configuration-admin.test.ts` (new, 8), `dashboard.test.ts` (new, 2) and `versions.test.ts` (new, 2).
  - `queue.test.ts` (+2): the drill-down values, and that the served query still refuses them.
  - `constants.test.ts` (+1).

## Deviations (choices made under the delegation where the plan is silent or would break something)

1. **Drill-down filters are declared, not yet served.** The W6-01 row says "`QueueQuerySchema` additions". If they were added to the served `QueueQuerySchema` now, the server (`GET /api/queue`) and the SPA's `parseQueueQuery` would accept `?lane=dpo&sla=breached` while `readQueue` ignores it until W6-14. The result would be a list labelled "DPO breached" that shows every in-scope case. That breaks the queue's recorded rule "never widen a URL silently" (`web/src/screens/queue/view-model.ts`). The filters are therefore a separate `QueueDrilldownQuerySchema`, and a test pins that the served query still refuses them. W6-14 adds them to `QueueQuerySchema` in the PR that applies them inside the scoped query (and flips that one test). No scope leak was possible either way (the list stays in scope); the choice is about honesty of a label.
2. **`stale_version` details are a union.** The plan adds `configuration_changed` but a configuration conflict has no version to reference. Its details carry `current: { kind, revisionId, draftVersion }` (`ConfigurationStaleDetails`). The existing version shape keeps its fields under the name `VersionStaleDetails`, and its `reason` stays the full `StaleReason`, so the frozen in-memory API substitute (plan section 11.2: no W6 ticket edits it) compiles unchanged. Two type-only follow-ons:
   - `server/src/observability/errors.ts` logs `currentVersionId` only when the details carry a version;
   - `tests/integration/w1-05-submit.test.ts` `staleOf` casts to `VersionStaleDetails`. This is a type narrowing; every assertion is unchanged.
3. **`targetType: 'configuration'` on `not_found` captures.** The plan did not list it. Without it, capturing a `NotFoundError('configuration')` (W6-04's 404) fails `SafeErrorFieldsSchema`, and `capture()` falls back to an `internal_error` record. The new test proves the fix.
4. **Publish takes an optional `changeNote`.** Plan section 4.2 lists `{ expectedDraftVersion, expectedCurrentRevisionId }`, and section 9 gives the publish dialog a required change note. The optional field lets the dialog's note reach the server in the publish request itself; otherwise the draft's note is used, and a publish with neither is 422 (W6-04). Restore keeps its required note.
5. **Shapes the plan names without fields.** These are my choices:
   - `ConfigurationDraftSummary` is `{ kind, baseRevisionId, draftVersion, updatedBy, updatedByDisplayName?, updatedAt, changeNote, problemCount }`;
   - `DraftDetail` adds `body` and `problems`;
   - the revision list query is `page` (≥1) and `pageSize` (1-100, default 25), as the queue's.
6. **`FrozenConfigurationEntrySchema` lives in `configuration-admin.ts`**, and `versions.ts` imports its type only. `cases.ts` loads `versions.ts` at runtime, so a runtime import of `cases.ts` from `versions.ts` would be an ESM cycle that reads `CONFIGURATION_KINDS` before it is initialised.
7. **`desk_frozen` carries no details.** The SPA banner reads readiness (W6-17). A 503 from a frozen desk names nothing about the refused target.

## Existing test expectations changed (and why)

- `policy.test.ts`: the "actions with rows" list gains `dashboard.view` and `qc.recheck`, and `targetFor` maps `dashboard.view` to `none`. The plan adds these rows (section 4.1). No existing row or assertion is loosened.
- `errors.test.ts`: the code count reads nine, and `EXPECTED_STATUS` gains `desk_frozen: 503`. The plan requires both (W6-01 row).
- `w1-05-submit.test.ts`: the type-only cast in Deviation 2. Its assertions are unchanged.

## Notes for the next tickets

- W6-02: adding `desk_controls` to `CONFIGURATION_KINDS` makes `CONFIGURATION_VALUES_OWNER` a type error until the kind names its owner (`admin`). That is intended.
- W6-04: answer an unknown kind, or a revision of another kind, with `NotFoundError('configuration')`. Throw `configuration_changed` through `ConfigurationStaleDetails` with `refreshPath` `/admin/configuration/{kind}`. Count `problems` with the same function the draft read uses.
- W6-09: declare `frozenConfiguration: Type.Optional(Type.Array(FrozenConfigurationEntrySchema))` in `SubmittedVersionResponseSchema`.
- W6-14: `QueueQuerySchema` = the base fields plus `QueueDrilldownQuerySchema`'s properties, and flip the "served queue query does not accept" test.
- W6-17: throw `DeskFrozenError`. Its capture and label are in place.

## Evidence

Environment: worktree `/tmp/rai-w6-01-w6-contract-shared-shapes` on `origin/main` `0177a5c`; Postgres 16 in `docker compose -p rai-admin` on port 55384; `rai-web/.env` from `.env.example` with ports 8831/8832/8833/5194. Logs in `/tmp/rai-w6-01-w6-contract-shared-shapes-logs/`. Fixture set `slice1-synthetic@1`.

RED, before any implementation (targeted run of the new and changed unit tests): the four policy tests failed (`unknown action: qc.recheck`, and the action-set assertion). The `observability.test.ts` safe-fields test failed. `errors.test.ts`, `observability/errors.test.ts`, `constants.test.ts`, `queue.test.ts`, `versions.test.ts`, `configuration-admin.test.ts` and `dashboard.test.ts` failed to load (missing `DeskFrozenError`, `DASHBOARD_DUE_SOON_WORKING_DAYS`, `QueueDrilldownQuerySchema`, `FrozenConfigurationEntrySchema`, and the new modules). GREEN: the same run passed 66/66.

Full gate (W6 plan section 12), one suite at a time, from `rai-web/` after `set -a; . ./.env; set +a`:

| Command | Result |
|---|---|
| `npm ci` | ok |
| `npm run lint` | exit 0 (eslint, prettier, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 670 tests, 670 pass, 0 fail |
| `npm run test:integration` | 374 tests, 374 pass, 0 fail |
| `npm run build && npm run check:substitute-absent` | exit 0; scanned 675 files, 0 with the marker |
| `npm run test:browser:server` | 202 passed (8.5m) |
| `npm run test:browser:substitute` | 48 passed (29.1s) |
| `node scripts/check-links.mjs` (repo root) | 372 Markdown files, 1065 relative links, 0 broken; rerun after the records: 373 files, 1070 links, 0 broken |
| `git diff --check` (and `git diff --cached --check` after staging) | clean |

No browser re-runs were needed. No migration. The in-memory API substitute is unchanged (plan section 11.2).
