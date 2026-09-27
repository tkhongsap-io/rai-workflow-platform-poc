# W6 file-level plan: Admin configuration, desk dashboard and operator guide (W6-00)

Status: plan, 2026-09-27 (W6-00). Authority: Ta's delegation of 2026-09-27 (north star: a working RAI review platform that streamlines the review workflow, tracks version history and shows a dashboard, on synthetic data, end to end; details tuned with the team later). Every open question this plan answers is a **provisional choice made by the agent team under Ta's delegation of 2026-09-27**, or, where the recorded owner is not Ta (D07, D08, D09, D10), a **provisional working assumption** held as configuration, never hard-coded, and left open for that owner. Nothing here claims that an owner approved anything.

Precondition before any W6 code: this plan merged, and the gate entry recorded. The consolidated planning change [2026-09-27-w4b-w7-plans](../../changes/2026-09-27-w4b-w7-plans/intent.md) records it: the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)" in [decisions](../product/decisions.md), the BUILD_PLAN gate entries for W4b-W7, and the authorization lines in AGENTS and [team and roles](../delivery/team-and-roles.md), which now extend the D03 merge delegation to W4b-W7 (W8 still gated).

This plan extends the [W0-02 file-level plan](implementation-plan-w1-w3.md), the [W0-05 policy matrix](authorization-policy-matrix.md), the [W0-07 QC boundary](qc-boundary-and-mail-sink.md) and the [W4a plan](implementation-plan-w4a.md). Where it does not say otherwise, they apply unchanged. Synthetic data only; no external network call from the product or the tests; nothing deploys.

## 0. Scope and non-goals

W6 delivers requirement R10 and acceptance A10 on localhost, plus a scoped desk dashboard:

- **Versioned Admin editing** of every Admin-owned configuration kind: checklist templates, the QC rule catalogue (severities, triggers, per-template rule lists and rule `params`, which hold the thresholds), SLA working days, the working-day calendar, `use_case_groups`, `operator_recipients`, the W5 `risk_rubric` and the identity group-to-role mapping (contract only).
- **Server-side drafts, publish, rollback, audit history and a diff view**, with role checks. Publishing needs no redeploy. New submissions freeze the revisions in force at their submit instant. Historical versions keep the revisions frozen on them.
- **An explicit Admin recheck** of a submitted version under a named `qc_rules` revision. It writes new run and finding records and never rewrites old ones.
- **The identity-mapping configuration contract.** Actual AD behaviour is W8 and out of scope.
- **Desk controls:** freeze writes, pause mail, pause QC. These are the incident shutdown path the operator guide needs.
- **The operator guide** (`docs/operations/operator-guide.md`), which W7 consumes.
- **The desk dashboard.** This is not in the PRD; it was added under Ta's delegation of 2026-09-27. It is a scoped page of case counts by status and lane, SLA due and breached, open findings by lane and severity, QC-unavailable counts, W5 risk tiers and version activity, with drill-down links to the queue and the case.

Not in W6:
- AD or Entra verification, the `network` identity mode and production group values (W7/W8, D10).
- Real data (D08).
- Any model call. A model adapter, if W4b adds one, stays disabled by default and is not configured here.
- Editing the lane mapping. It is a versioned constant fixed by D02 (`shared/src/constants.ts` `CURRENT_LANE_MAPPING`) and has no Admin surface.
- Monitoring dashboards, telemetry or a control tower. The dashboard counts desk records only ([later packages](../delivery/later-packages-outline.md) "Explicitly not added").
- Writes to TPM, VRO or the AI Reporting Tool (L2, L3, L6).
- W8.

## 1. Decisions

### 1.1 Recorded decisions this plan applies

| Source | What it fixes here |
|---|---|
| L12, R10, A10 | QC rules, thresholds and SLA are configuration keyed to `checklist_template_version`, editable by Admin without redeploy. Existing pack evidence stays reproducible |
| D02 | The lane mapping is not configuration and gets no editor |
| D01, D06 | SLA values (DPO 3, others 5) and the Asia/Bangkok calendar are the seed. The clock restarts per submitted version. `operator_recipients` is an Admin value |
| D11 | `use_case_groups` is an Admin value list |
| D12 | Every new label, message and dashboard string has th and en keys; dates render in Asia/Bangkok |
| W0-05 | Admin holds `config.read_revisions` and `config.publish` and never a lane authority. `caseScopeWhere` is the one scope predicate for every count |
| W3 deferred rulings item 2 | A version closed by a send-back takes no new QC evidence. This includes a recheck |
| W4a plan section 3 | The run records the `qc_rules` `configuration_revision.id`. A historical version reads its own frozen revision |

### 1.2 Open questions and rulings

Status key:
- **PR**: a provisional ruling made by the agent team under Ta's delegation of 2026-09-27.
- **PWA (Dxx)**: a provisional working assumption for a decision owned by someone else, held as configuration and left open.

| # | Question | Options and trade-offs | Recommended | Status |
|---|---|---|---|---|
| Q1 | Draft model | (a) **Separate mutable `configuration_draft` table**, one draft per kind, published by copying into the immutable `configuration_revision`. Keeps the W0-04 immutability trigger untouched and lets a draft be saved half-finished. One more table. (b) Nullable `published_at` on `configuration_revision`, with the trigger relaxed to allow updates while unpublished. No new table, but it weakens the one immutability guarantee A07 and L12 rely on. (c) No server drafts: the form publishes directly. Simplest, but work is lost on refresh and there is nothing to review before publishing | (a) | PR |
| Q2 | Activation and effective time | (a) **Keep the existing `after_publish` rule**: in force for events strictly after the publish instant (`configuration/activation.ts` `appliesAt`). Nothing changes in freeze, SLA or QC resolution. (b) Add a scheduled `effective_at`: Admin can pre-publish "from Monday", but every in-force query (`currentRevision`, `revisionsInForce`) gains a second time axis, plus pending-revision UI and tests. (c) Both | (a). Scheduling is deferred and can be added later by a migration (`ACTIVATION_RULES` already anticipates new values) | PR |
| Q3 | Rollback semantics | (a) **Restore = publish a new revision N+1 whose body copies revision K**, recording `restores_id = K`. History stays forward-only, runs and versions keep citing the revision they used, and the audit trail reads naturally. (b) An "active pointer" table that re-activates K. That breaks "latest published in force" and would need changes to every resolver. (c) No rollback; Admin re-edits by hand. Error-prone during an incident | (a). A restore is refused when K is the revision in force, or when K's body fails today's cross-kind validation (section 2.4) | PR |
| Q4 | Who may edit configuration | (a) **Admin only, one Admin publishes with a required change note.** Matches W0-05 and the source spec's Admin row. (b) Two-person rule: a second Admin approves each draft. Safer for production, but the PoC may have one Admin. (c) Lane leads edit their own lane's rules. Contradicts the source spec's Admin row | (a) for W6 on localhost. Whether production needs (b) is left to D10 | PR (single-Admin publish); PWA (D10) for production |
| Q5 | Concurrency and replay of publish | (a) **Optimistic checks**: `expectedDraftVersion` plus `expectedCurrentRevisionId`; a mismatch is 409 `stale_version` with the new reason `configuration_changed`. (b) `Idempotency-Key`. `idempotency_key.target_case_id` is `NOT NULL`, so this needs a migration for a non-case target. (c) Both | (a). A replayed publish finds the draft consumed and gets 409, which the SPA answers by reloading | PR |
| Q6 | Which QC catalogue fields Admin may edit | (a) **Structured editing**: include or exclude a rule per template, `severity`, `triggers` and schema-checked `params`. The rule ID must be one the product implements, and the engine must match. (b) Free JSON body. Flexible, but an unknown rule ID would silently not run and read as a pass. (c) Severity and params only | (a). An unimplemented rule ID is refused on publish (section 2.4) | PR |
| Q7 | Values of D09-owned thresholds (W4b content-rule `params`) | (a) **Editable, labelled**: Admin can edit them, but the values are D09's; the editor labels each such value "provisional until D09" and the seed keeps W4b's values. (b) Alternative: hide these params from the editor until D09 decides (safer against accidental edits, but tuning with the team then needs a code change) | Editable configuration; labels in UI | PWA (D09) |
| Q8 | Values of the W5 rubric | (a) **Editable, labelled**: Admin can edit the `risk_rubric` revision W5 registers. The UI labels it "provisional until D07"; W6 never codes rubric content. (b) Alternative: hide the kind from the editor until D07 decides (the rubric could then only change by code or seed) | Editable configuration | PWA (D07) |
| Q9 | Identity mapping | (a) **Contract plus editor**: register the `group_role_mapping` body schema in `@rai/shared`, and let Admin publish placeholder synthetic mappings. The mapping is read only in `network`/`ad` and `production` modes, at start (`start.ts` `groupMappingSource`). (b) Contract only, with no editor. (c) Defer to W8 | (a). Real group IDs, tenant and verification stay with D10/W8; local modes ignore the mapping | PWA (D10) |
| Q10 | Explicit recheck | (a) **Admin requests a recheck of a submitted version under a named `qc_rules` revision.** It writes a new run flagged `recheck = true` with its findings. The findings are **advisory**: visible in the QC log, excluded from every gating read (Ready, `awaiting_disposition` status), and not dispositionable. The version's frozen revision is untouched. (b) Recheck findings gate like any finding. The rules of an in-review version would then change under a configuration it did not freeze, which is exactly the "configuration changing historical evidence" risk. (c) A dry run with no record. Contradicts BUILD_PLAN "explicit rechecks create new records" | (a). A reviewer who agrees with an advisory finding sends the version back through the normal flow | PR |
| Q11 | Who may request a recheck | (a) **Admin only** (`qc.recheck`): the recheck exists because configuration changed. (b) Admin and the three reviewer roles. (c) Reviewers only | (a). Widening it later is one policy row | PR |
| Q12 | Incident shutdown path | (a) **A `desk_controls` configuration kind** `{ writesFrozen, mailPaused, qcPaused }`, published by Admin like any kind and read per request. No restart is needed and the change is audited. (b) Environment variables, which need a restart and have no audit trail. (c) The guide says "stop the server", which takes the whole desk offline, reads included | (a). The guide also documents (c) as the last resort | PR |
| Q13 | Which roles see the dashboard | (a) **All six roles, each scoped by `caseScopeWhere`**: owner sees own cases, BU SPOC sees the BU, reviewers and Admin see all. Uses the existing scope rule. (b) Reviewers and Admin only. (c) Admin only | (a), through a new action `dashboard.view` with `VIEW_ROLES` rows | PR |
| Q14 | Dashboard SLA "due soon" horizon | (a) **A constant `DASHBOARD_DUE_SOON_WORKING_DAYS = 2`** in `shared/src/constants.ts`. (b) An Admin configuration kind. (c) A per-user setting | (a). It is a display threshold, not a product rule. Making it configuration later is one kind | PR |
| Q15 | Dashboard presentation | (a) **Tables with inline CSS bars**, where the numbers are the text and the bars are `aria-hidden`. No new dependency (W0-02 section 4 list). (b) A chart library, which is a dependency change and needs extra accessibility work | (a) | PR |
| Q16 | Admin UI shape | (a) **One `/admin/configuration` index**, with a page per kind (current, draft editor, history, diff, restore). Kind-specific forms for the simple kinds, a table editor for `qc_rules`, and a schema-validated JSON editor for `group_role_mapping` and `risk_rubric`. (b) A generic JSON editor for every kind. Quick to build, but error-prone for the operator. (c) Separate screens per domain spread across the app | (a) | PR |
| Q17 | Root landing page | (a) **Keep `/` → `/cases`** and add "Dashboard" as the first navigation link. No existing browser journey changes. (b) `/` → `/dashboard` | (a). The team can switch it later in one line (`web/src/router.tsx`) | PR |
| Q18 | Draft validity | (a) **A draft saves any JSON object up to 64 KiB of its kind**, and the response lists schema and cross-kind `problems`. Only publish refuses. (b) Validate on save. This blocks saving half-edited work | (a) | PR |

## 2. Configuration model and fail-closed rules

### 2.1 Kinds

| Kind | W6 editor | Values owned by | Frozen on a version | Fail-closed rule |
|---|---|---|---|---|
| `checklist_templates` | list form | Admin (L12) | yes | Every listed version must have a template entry in the `qc_rules` revision in force at publish (section 2.4) |
| `qc_rules` | rule table per template | Admin; D09 for content thresholds (PWA) | yes (the FK) | Unknown rule ID, engine mismatch or params failing `QC_RULE_PARAMS_SCHEMAS` → 422. It must cover every version in the `checklist_templates` revision in force |
| `sla` | three integer fields | Admin (D01 seed) | yes | `SlaBodySchema` (1-60) |
| `calendar` | holiday date list | Admin (D06) | yes | `CalendarBodySchema`; the timezone stays the literal `Asia/Bangkok` |
| `use_case_groups` | list form | Admin (D11) | yes | Non-empty; a value in use on existing cases may be removed, and those cases keep their stored value |
| `operator_recipients` | address list | Admin (D06) | yes | Synthetic `.example` addresses only while `MAIL_MODE` is a sink; mail never leaves the sink in W6 |
| `risk_rubric` | JSON editor with schema | D07 (PWA) | yes (W5) | Whatever schema W5 registers in `CONFIGURATION_BODY_SCHEMAS`; no schema means no publish (existing deny-by-default in `validateConfigurationBody`) |
| `group_role_mapping` | JSON editor with schema | D10 (PWA) | **no** | `GroupRoleMappingSchema` moved to shared; `tenantId` checked at start (S12), unchanged |
| `desk_controls` (new) | three switches | Admin | **no** | `{ writesFrozen: boolean, mailPaused: boolean, qcPaused: boolean }`. If the revision is missing or its body is invalid, the desk runs as if all three were `false`, and readiness reports `deskControls: "unconfigured"` |

- **Not frozen.** `resolveFrozenConfiguration` (`versions/freeze.ts`) freezes every kind in force today. W6-02 adds `UNFROZEN_KINDS = ['desk_controls', 'group_role_mapping']`, which it skips. Neither kind is evidence about a case. `group_role_mapping` has never been published, so no existing version changes.
- **No new environment variable.** Every W6 switch is a configuration revision. `config.ts` is unchanged.

### 2.2 Activation (Q2)

- The rule stays `after_publish`: a revision applies to events strictly after its `published_at` (`appliesAt`, `revisionInForce`, `currentRevision`).
- **What follows the new revision:**
  - a new submit freezes it;
  - a new case's template list (`cases/service.ts`) and a new draft's template check (`pack/service.ts`) read it;
  - an upload run on a draft reads the `qc_rules` in force then (W4a plan section 3);
  - the next breach digest reads the current `operator_recipients`.
- **What keeps its frozen revisions:** a submitted version, for SLA due dates (`sla/due-dates.ts` reads the frozen `sla` and `calendar`), for QC re-evaluation (`qc/rules-revision.ts` `ruleContextOf`) and for the W5 risk proposal.
- The Admin page says so beside the publish button: "applies to submissions after publishing; existing versions keep their configuration".

### 2.3 Drafts, publish and restore

- **One draft per kind** (`configuration_draft.kind` is the primary key). It records the revision it was based on and a `draft_version` counter for optimistic updates.
- **Publish runs in one transaction:**
  1. `pg_advisory_xact_lock` per kind, as `publishRevision` already does;
  2. check `draft_version` and that the revision in force is still the draft's base (otherwise 409 `configuration_changed`);
  3. full validation (section 2.4);
  4. `publishRevision` with the change note;
  5. delete the draft;
  6. audit `configuration.published`.
- **Restore** (Q3) publishes a copy of revision K's body as N+1, with `restores_id = K` and a required change note, under the same lock and validation. A draft that exists for the kind is kept, and its base becomes stale, so it must be rebased: the SPA offers "discard draft" or "start again from current".
- **Change note:** 1-500 characters. It is required on every publish and restore made by a person. Seed rows keep `NULL`. It is stored on the revision row, never in the audit ref: audit refs admit only IDs (`audit/store.ts` `REF_STRING`).

### 2.4 Cross-kind and registry validation (W6-03)

`configuration/validate.ts` has one function, `publishProblems(kind, body, inForce, mailMode)`, used **only by the Admin paths** `publishDraft` and `restoreRevision`. It returns `string[]`, and any problem is a 422 `invalid_input` whose `fields` carry the JSON path and a locale key.

**Where each check runs (round 3).** `store.ts` `publishRevision`, which the seed (`applyConfigurationSeed`), `fixtures/src/load.ts` and the integration tests call directly, keeps exactly today's checks: `validateConfigurationBody` (the schema plus `qcRulesBodyProblems`, and W5-02's `risk_rubric` branch). It gains none of the registry, template-coverage or recipient checks. Three reasons, each checked in the code: the seed publishes `checklist_templates` before `qc_rules` on an empty database, so a coverage check would refuse the seed; `tests/integration/w4-02-rule-catalogue.test.ts` publishes the partial catalogue `w4a.partial` through `publishRevision` on purpose to prove the unknown-template fail-closed path; and `tests/integration/w3-03b-digest.test.ts` publishes `operator_recipients ['external@real.com']` through `publishRevision` on purpose to prove the digest refuses a real address. `validateConfigurationBody` also has no `inForce` or `MAIL_MODE` input. So `publishDraft` and `restoreRevision` call `publishProblems` (which runs `validateConfigurationBody` first, then the cross-kind checks below) inside their transaction and then call `publishRevision`; the seed, fixtures and those tests are unchanged.

- **Schema:** `validateConfigurationBody` (existing), which already covers `qcRulesBodyProblems`.
- **Implemented-rule registry:** `shared/src/qc/rule-registry.ts` exports `IMPLEMENTED_RULES: Record<ruleId, { engine, triggers }>`.
  - It is a static list in `@rai/shared`, because shared cannot import server code. A server unit test (`server/src/qc/rule-registry.test.ts`) asserts that its `metadata` entries equal `Object.keys(METADATA_RULES)` (`server/src/qc/deterministic/rules/index.ts`), so the two cannot drift.
  - The content rules W4b implements are added by W4b. Until then the four catalogued `ACC-*` rules are listed as `engine: 'content'`.
  - A catalogue entry whose rule ID is not in the registry, whose engine differs, or whose triggers are not a subset of the registry's triggers is refused. A rule that would silently not run can never be published.
- **Template coverage:**
  - Publishing `checklist_templates` needs every version to have a `templates` entry in the `qc_rules` revision in force.
  - Publishing `qc_rules` needs an entry for every version in the `checklist_templates` revision in force.
  - The order to add a template is therefore `qc_rules` first, then `checklist_templates`. The editor says so. A new submission can then never reach `unknown_template_version`.
- **Template isolation (L12):** a `v2.0` entry may not list `ACC-BAND-V1-SHEET3`. The rule is expressed in the registry as `templates: ['v1.0 Sheet3']`.
- **`operator_recipients`:** every address must end in `.example` or `.test` while the configured `MAIL_MODE` is a sink. This is synthetic-only, enforced; real addresses are D08 and W7.

## 3. Schema and migrations (forward-only, `server/drizzle/`)

Both migrations follow the house header (migration, ticket, `rewrites frozen rows`, rollback expectation). Their index is assigned at merge time (section 11.2). **Rollback classes (W0-04 values, the W7-03 class map; consolidated 2026-09-27):** both are `restore-required`. After W6-02 a `desk_controls` revision exists that an older binary's kind list does not know; after W6-09 a `desk_paused` run row can exist that an older binary cannot serialize. Each header reads `-- rollback expectation: restore-required;`, and if W7-03 has merged, the same PR adds its `MIGRATION_CLASSES` entry.

**`00NN_w6_02_configuration_admin.sql` (W6-02).** Nothing in it touches existing rows:

```sql
ALTER TABLE "configuration_revision" ADD COLUMN "change_note" text;          -- NULL on seed rows; ADD COLUMN fires no UPDATE trigger
ALTER TABLE "configuration_revision" ADD COLUMN "restores_id" uuid REFERENCES "configuration_revision"("id");
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_change_note_check"
  CHECK ("change_note" IS NULL OR char_length("change_note") BETWEEN 1 AND 500);
ALTER TABLE "configuration_revision" DROP CONSTRAINT "configuration_revision_kind_check";
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_kind_check" CHECK ("kind" IN
  ('checklist_templates','qc_rules','sla','calendar','operator_recipients','use_case_groups','risk_rubric','group_role_mapping','desk_controls'));
CREATE TABLE "configuration_draft" (
  "kind" text PRIMARY KEY,                    -- same CHECK list as above
  "base_revision_id" uuid REFERENCES "configuration_revision"("id"),
  "body" jsonb NOT NULL,
  "change_note" text,
  "draft_version" integer NOT NULL CHECK ("draft_version" >= 1),
  "updated_by" text NOT NULL, "updated_role" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON "configuration_draft" TO rai_app;   -- a draft is not evidence; its save and discard are audited
```

- The `configuration_revision_frozen` trigger and the grants on `configuration_revision` (`SELECT, INSERT` only) are unchanged.
- Drizzle: `db/schema/configuration-revision.ts` gains both columns and `desk_controls`. A new file, `db/schema/configuration-draft.ts`, is exported from `db/schema/index.ts`.
- **Shared registration, same ticket (W6-02).** `publishRevision` calls `validateConfigurationBody`, which refuses any kind without a `CONFIGURATION_BODY_SCHEMAS` entry, and the seed type is keyed by `SeedableConfigurationKind = keyof ConfigurationBodies`. So W6-02, not W6-03, adds to `shared/src/schemas/cases.ts`: `'desk_controls'` in the shared `CONFIGURATION_KINDS` (read by `resolveFrozenConfiguration`, the route kind list and the 404 kind check), `DeskControlsBodySchema`, its `CONFIGURATION_BODY_SCHEMAS.desk_controls` entry and its `ConfigurationBodies.desk_controls` type. Both copies of `CONFIGURATION_KINDS` (shared and `db/schema/configuration-revision.ts`) change together, and a unit test asserts they are equal.
- **Registered kinds versus seeded kinds (W6-02).** Today `seed.ts` declares `type ConfigurationSeed = { [K in SeedableConfigurationKind]: ConfigurationBodies[K] }`, so every key of `ConfigurationBodies` must be seeded. Once `group_role_mapping` is registered (W6-11), that type would force a seeded mapping body, which section 6 forbids. W6-02 therefore separates the two sets before any unseeded kind is registered:
  - `server/src/configuration/seed.ts` gains `export const UNSEEDED_KINDS = ['group_role_mapping'] as const` and `type UnseededConfigurationKind = (typeof UNSEEDED_KINDS)[number]`;
  - `ConfigurationSeed` becomes `{ [K in Exclude<SeedableConfigurationKind, UnseededConfigurationKind>]: ConfigurationBodies[K] }` (`Exclude` of a key that is not yet a member is a no-op, so this compiles before and after W6-11);
  - `SEED_KINDS` stays `Object.keys(CONFIGURATION_SEED)`, now typed `Array<keyof ConfigurationSeed>`; `applyConfigurationSeed` is unchanged apart from that type;
  - `seed.test.ts` is rewritten to assert by kind: the expected seeded set (the six W1-W4a kinds plus `desk_controls`; W5 adds `risk_rubric` in its own PR), and that no member of `UNSEEDED_KINDS` is in `SEED_KINDS`. The "every seed body validates" test is unchanged.
  - `SeedableConfigurationKind` keeps its name and meaning ("a kind with a registered body schema"); `publishRevision`, `currentBody` and `PublishInput` keep using it, so registered-but-unseeded kinds can still be published by Admin.
- The migration contract test (`tests/integration/w1-00-migrations.test.ts`) checks the following:
  - an `UPDATE` of a published revision still raises `rai.frozen_revision`;
  - `rai_app` still cannot update a revision;
  - `rai_app` can delete a draft.

**`00NN_w6_09_qc_recheck.sql` (W6-09).**

```sql
ALTER TABLE "qc_run" ADD COLUMN "recheck" boolean NOT NULL DEFAULT false;   -- constant default: no UPDATE trigger fires; default kept
ALTER TABLE "qc_run" ADD COLUMN "requested_by" text;
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_recheck_requester_check"
  CHECK (("recheck" = false AND "requested_by" IS NULL) OR ("recheck" = true AND "requested_by" IS NOT NULL));
ALTER TABLE "qc_run" DROP CONSTRAINT "qc_run_unavailable_reason_check";   -- 0007 list plus 'desk_paused' (section 7)
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_unavailable_reason_check" CHECK ("qc_run"."unavailable_reason" IS NULL OR ("qc_run"."status" = 'unavailable' AND "qc_run"."unavailable_reason" IN ('timeout', 'runner_error', 'not_configured', 'artifact_unreadable', 'desk_paused')));
```

- The existing `rai_app` `SELECT, INSERT` grant covers both columns, as it did for `0009`.
- Raw `qc_run` inserts in `tests/integration/w3-07a-migration-contract.test.ts` need no change, because of the default.

## 4. API shapes and authorization

### 4.1 Policy rows (W6-01, contract)

`authz/policy.ts` changes:
- `config.publish` (Admin, `all_cases`) now covers save draft, discard draft, publish and restore.
- `config.read_revisions` (Admin) covers every Admin read.
- New action `qc.recheck`: Admin, `all_cases`, target `case`.
- New action `dashboard.view`: `VIEW_ROLES`, target `none`; scope is applied in SQL by `caseScopeWhere`.

No other row changes, and Admin still has no `lane.*` or `finding.*` row (T18).

The W0-05 matrix gains the rows, and a new test **T40** covers them: every non-Admin role gets 403 `role` on each Admin route, and `qc.recheck` by a reviewer is 403 `role`.

### 4.2 Admin configuration routes (`server/src/configuration/routes.ts`, W6-04)

All Admin configuration routes live under `/api/admin/configuration`. Shapes are in `shared/src/schemas/configuration-admin.ts`. Any `kind` outside `CONFIGURATION_KINDS` is a 404 `not_found` with the new resource `configuration`.

| Route | Action | Body / query | Response | Errors |
|---|---|---|---|---|
| `GET /api/admin/configuration` | `config.read_revisions` | — | `200 { kinds: Array<{ kind, editable, valuesOwner: 'admin'\|'D07'\|'D09'\|'D10', current: RevisionSummary \| null, draft: DraftSummary \| null }> }` | 401, 403 |
| `GET …/{kind}/revisions` | `config.read_revisions` | `page, pageSize` | `200 { items: RevisionSummary[], total }`, newest first | 401, 403, 404 |
| `GET …/{kind}/revisions/{revisionId}` | `config.read_revisions` | — | `200 RevisionDetail` (`RevisionSummary & { body }`) | 401, 403, 404 `configuration` |
| `GET …/{kind}/draft` | `config.read_revisions` | — | `200 { draft: DraftDetail \| null }` | 401, 403, 404 |
| `PUT …/{kind}/draft` | `config.publish` | `{ baseRevisionId: string \| null, expectedDraftVersion: number \| null, body: object, changeNote?: string }` | `200 DraftDetail` (`problems: FieldError[]`) | 409 `stale_version` `configuration_changed` (draft moved), 422 (body not an object, or over 64 KiB) |
| `DELETE …/{kind}/draft` | `config.publish` | `{ expectedDraftVersion }` | `204` | 409 |
| `POST …/{kind}/draft/publish` | `config.publish` | `{ expectedDraftVersion, expectedCurrentRevisionId: string \| null }` | `201 RevisionSummary` | 409 `configuration_changed`, 422 with problems, 503 never (desk controls do not block configuration) |
| `POST …/{kind}/revisions/{revisionId}/restore` | `config.publish` | `{ expectedCurrentRevisionId, changeNote }` | `201 RevisionSummary` (`restoresRevisionNumber` set) | 409, 422 (`restore_current`, or problems) |

- `RevisionSummary` is `{ revisionId, kind, revisionNumber, publishedAt, publishedBy, publishedByDisplayName?, changeNote: string | null, restoresRevisionNumber: number | null, inForce: boolean, frozenOnVersionCount: number }`.
  - `frozenOnVersionCount` counts `pack_version.frozen_configuration ->> kind = id`. The history page uses it to show which versions used a revision.
- The existing `GET /api/configuration/current` (`config.read_effective`) and its `ConfigurationView` stay unchanged.
- Error contract (W0-06 8.1 and 8.3):
  - `STALE_REASONS` gains `configuration_changed`;
  - `NotFoundResource` gains `configuration`;
  - a new code `desk_frozen` (HTTP 503, section 7) is added, with locale keys `error.desk_frozen` and `error.stale_version.guidance.configuration_changed`.

### 4.3 Version configuration read (W6-09)

`SubmittedVersion` (W0-02 7.6) gains `frozenConfiguration: Array<{ kind, revisionId, revisionNumber, label: string | null }>`, read from `pack_version.frozen_configuration` joined to `configuration_revision`. `label` is the `qc_rules` body label, else `null`. It is read-only and is the "configuration used" panel of section 8.2.

- W6-01 declares the field **optional** on the shared `SubmittedVersion` type, so `submittedVersionView` keeps type-checking until W6-09 serves it.
- W6-09 fills it in `submittedVersionView` and adds `frozenConfiguration: Type.Optional(...)` to the route-local `SubmittedVersionResponseSchema` in `server/src/versions/routes.ts`; without that entry Fastify's serializer silently strips it. It stays optional there because an idempotent submit replay returns the body stored at submit time, and a body stored before W6 has no such field; a required property would make that replay fail serialization. Such a replay simply omits the panel data; a later `GET` of the version serves it. A test replays a pre-W6-shaped stored body and gets 200.

### 4.4 Recheck route (W6-09)

`POST /api/cases/{caseId}/versions/{versionId}/qc-rechecks`, action `qc.recheck`, with `{ qcRulesRevisionId?: string, trigger: 'submit' | 'approve_attempt', lane?: Lane }`:

- `qcRulesRevisionId` defaults to the revision in force now.
- `lane` is required for `approve_attempt` and forbidden for `submit`.
- It returns `202 { correlationId }`. The run happens after the response, like the other triggers, tracked by the drain in `app.ts`.
- Refusals:
  - a draft ID or an unknown ID: 404 `version`;
  - a version closed by a send-back: 409 `stale_version` `version_closed` (W3 ruling 2);
  - a revision ID that is not of kind `qc_rules`: 422.

## 5. Explicit recheck (W6-09)

- `buildRequest` and `runKeyOf` are module-private in `qc/orchestrator.ts`, so the recheck runner lives there: `qc/orchestrator.ts` exports `runAndPersistRecheckQc(deps, { caseId, versionId, trigger, lane, qcRulesRevisionId, requestedBy, correlationId })` beside the other `runAndPersist*` functions. `qc/recheck.ts` holds only the route-facing checks (revision kind, version closed, lane rule) and calls it. It works like the other triggers:
  - `buildRequest` already takes `ruleRevision` and `rules` as parameters, so it is reused unchanged;
  - the new `ruleContextForRevision(exec, revisionId)` in `rules-revision.ts` is used for the recheck instead of `ruleContextOf`, so the named revision is used, never the frozen one;
  - the recheck's run key is `runKeyOf(...)` hashed with a `recheck|<correlationId>` suffix, so each request is a new run and never a replay.
- **Records:** the run row has `recheck = true` and `requested_by` set, with the version's own `checklist_template_version` and `model_type`. Findings are ordinary `qc_finding` rows under that run.
- **Advisory:** the gating reads join `qc_run` and exclude `recheck = true`:
  - `workflow/ready.ts` (the undispositioned-findings query);
  - `cases/status.ts` `caseStatusSql` (`awaiting_disposition`);
  - `qc/orchestrator.ts` unavailable-finding reuse (`findLatestUnavailableFinding`);
  - `qc/repository.ts` `findLatestQcRun`, and so `findLatestSubmitRun` and `findLatestApproveAttemptRun`, gain `eq(qcRun.recheck, false)`. Without it, a recheck under the frozen revision (the default whenever configuration has not changed) would become the "latest" run for its `(version, trigger, lane, rule_revision)`: `workflow/service.ts` `approveLane` would refuse the reviewer's approval with 409 `qc_run_superseded` because the observed `qcRunId` is no longer the latest, and `orchestrator.ts` `replayPrior` (and the lane qc-run route that uses it) would replay the recheck's advisory findings as the gating lane-QC result. A submit-trigger recheck would be replayed by `findLatestSubmitRun` the same way. `approveLane` itself keeps its check unchanged; it is listed in W6-09's paths for the regression test.
  - `findings/service.ts` refuses a disposition on a recheck finding with 422 `invalid_input` (`error.invalid_input.advisory_finding`).
  - Tests prove that a recheck finding neither blocks nor causes Ready, and does not change the case status.
- **API exposure (W6-09, `shared/src/schemas/review.ts`).** `listFindingsForVersion` and `listQcRunsForVersion` are served through TypeBox response schemas, and Fastify's serializer drops any property a schema does not declare, so the recheck state must be declared there or the UI never sees it:
  - `QcRunSummarySchema` gains `recheck: boolean` and `requestedBy: string | null` (a subject ID; the UI shows the display name through the existing directory lookup), filled by `listQcRunsForVersion`;
  - `FindingWithDispositionSchema` gains `runId: string` (`qc_finding.run_id`) and `advisory: boolean` (the run's `recheck`), filled by `listFindingsForVersion` through a join to `qc_run`;
  - both new finding fields and both new run fields are `Type.Optional` in the shared schema, as W4-12 did for `evidence`, so the in-memory API substitute still validates; the real server always serves them, and the web view-model reads an absent `advisory` as `false` (the server still refuses a disposition on an advisory finding, so the fallback cannot waive anything);
  - `server/src/findings/routes.ts` needs no new code, since it serves these schemas, but is in W6-09's paths for the route tests that read both fields over HTTP.
- **The `desk_paused` reason (W6-09).** The reason lists are closed today and not derived from one another: `shared/src/qc/types.ts` `QcUnavailableReason`, `review.ts` `QC_UNAVAILABLE_REASONS`, the inline unions `QcRunSummarySchema.unavailableReason` and `LaneQcRunResponseSchema.reason`, and `observability.ts` `QcUnavailableReasonSchema`. A `desk_paused` run served through an inline union that lacks it would make serialization throw, so `GET .../qc-runs` and `POST .../lanes/:lane/qc-run` would answer 500. W6-09 adds `'desk_paused'` to `QC_UNAVAILABLE_REASONS` and rewrites the two inline unions (and `QcUnavailableReason`, and `QcUnavailableReasonSchema`) to derive from that one list, alongside the migration's CHECK. A test inserts a `desk_paused` run row and reads it through both endpoints with 200. W6-17 only starts producing the reason.
  - A test proves the approval path is isolated: with a pending lane whose reviewer observed approve-attempt run R, an Admin `approve_attempt` recheck on that lane **under the frozen revision** completes; `approveLane` with `qcRunId = R` still succeeds (no 409 `qc_run_superseded`); a following lane-QC request replays R, never the recheck run; and a `submit` recheck is likewise never returned by `findLatestSubmitRun`.
- **Dedup (W4-15, consolidated).** The W4-15 dedup lookup ("do not append while an open finding with the same rule, revision and scope key exists") joins `qc_run` and ignores findings of recheck runs, and a recheck run appends its findings without a dedup lookup. Without the first rule an advisory finding, which can never be dispositioned, would stay "open" forever and suppress every later gating finding on the same claim; without the second, a recheck under the frozen revision would record nothing new. W6-09 adds the `recheck` predicate to the W4-15 lookup in `persistResult` (or W4-15 includes it if W6-09 merges first; W4b plan section 6).
- **Two run parts (W4-18, consolidated).** Under `QC_MODE=content` a recheck runs every bound part (metadata and content), each as its own `recheck = true` row with the recheck's correlation ID. `findLatestQcRun` then carries both the optional engine ID W4-18 adds and `recheck = false`. The lane QC response's `parts[].reason` is typed from `QC_UNAVAILABLE_REASONS` and so gains `desk_paused` with the other unions.
- **Outage:** an unavailable recheck writes the run row only and no `QC-UNAVAILABLE` finding, because nothing it produces gates.
- **Ready versions:** a recheck of a Ready version is allowed and recorded, and the version stays Ready. The W4a "late" rule does not apply to a recheck, because the recheck asks for a record on a fixed version.
- **Frozen revision:** `pack_version.configuration_revision_id` never changes; the recheck's revision is on its run row only.

### 5.1 Risk recheck (W6-19)

The W5 plan reserves `risk_proposal.trigger = 'recheck'` for W6. W6-19 adds `POST /api/cases/{caseId}/versions/{versionId}/risk-rechecks { riskRubricRevisionId? }`, under the same `qc.recheck` action (Admin), refusals and 202 response as section 4.4.

- It scores the version's stored answers with W5's pure engine (`shared/src/risk/score.ts`) under the named rubric revision, and inserts a `risk_proposal` row with `trigger = 'recheck'`.
- It never touches `case.risk_tier` or the submit-time proposal. The recheck is advisory, like a QC recheck.
- It needs no migration: W5's table already allows the value.
- The version view lists recheck proposals under the submit proposal, labelled `risk.recheck.label`.

## 6. Identity-mapping configuration contract (W6-11)

- **The schema moves and is registered, in W6-11 only.** `GroupRoleMappingSchema` moves from `server/src/identity/group-mapping.ts` to `shared/src/schemas/identity-mapping.ts` and is re-exported from the old path, so no import breaks. W6-11 (and no other ticket) registers it in `CONFIGURATION_BODY_SCHEMAS.group_role_mapping` and `ConfigurationBodies.group_role_mapping` in `shared/src/schemas/cases.ts`, and adds its `publishProblems` tests. W6-03 does not touch the kind. The seed type already excludes it (W6-02, section 3), so registration needs no seed change and `CONFIGURATION_SEED` keeps type-checking.
- **Publishing.** Admin may publish revisions. The editor warns that the mapping is read only at start in `network`/`ad` and `production` modes (`identity/adapter.ts`, S12) and is ignored by `fixture` and `local-google`.
- **Synthetic values only.** The fixtures and the seed contain no mapping (`UNSEEDED_KINDS`, section 3; `seed.test.ts` asserts its absence). A test fixture uses the all-zero tenant and `fx-group-*` IDs.
- [Identity adapter 9.2](identity-adapter.md) is amended: the kind name is `group_role_mapping`, the body literal stays `identity.group_role_mapping`, publishing needs no redeploy but needs a restart to apply, and real values are D10 and W8.
- Whether a change should apply without restart in `network` mode is left to W7/W8 (PWA, D10).

## 7. Desk controls (W6-17)

`configuration/desk-controls.ts` `readDeskControls(exec)` reads the `desk_controls` body in force at the request instant. A missing or invalid body means all switches are `false`, and readiness reports `unconfigured`. The seed publishes all three as `false`.

- **`writesFrozen`**: deny by default. An `onRoute` hook (beside the existing W0-05 `onRoute` guard) attaches a `preHandler`, after authorization, to **every** route whose method is not `GET` or `HEAD` and that is not on an explicit exemption list; the `preHandler` refuses with 503 `desk_frozen`. No path prefix is enumerated, so routes that W4b, W5 and W6 add (the `qc-rechecks` and `risk-rechecks` POSTs, the lane `qc-run` POST, dispositions, uploads) are covered automatically.
  - The exemption list is exact: `/api/admin/configuration/*` (so the switch can be turned off), `POST /api/session/locale` (`identity/routes.ts:110`), `POST /auth/sign-out`, and the sign-in routes under `/auth/*` (`POST /auth/fixture/sign-in` and the `local-google` sign-in and callback routes). A language switch changes only the viewer's session preference, not desk records, so it is not a "write" for this purpose (PR under the delegation); a frozen desk must stay readable in both languages.
  - A test walks the registered routes (`app.printRoutes` or the hook's own record) and asserts that every non-`GET`/`HEAD` route outside the exemption list answers 503 while frozen; a route added later without an exemption fails closed.
  - Reads keep working.
  - The SPA shows a banner (`desk_controls.frozen_banner`).
- **`mailPaused`**: `notifications/service.ts` `deliverPending` returns without claiming rows. Outbox rows stay pending, retry counters do not move, and enqueueing continues, so nothing is lost. The daily digest still records its run.
- **`qcPaused`**: the orchestrator answers every new run as `unavailable: desk_paused` without calling the runner; under `QC_MODE=content` each part that would have run gets its own `desk_paused` row, with one QC-UNAVAILABLE finding per open run scope as for any outage (W4b plan section 3.4). That produces the normal `QC-UNAVAILABLE` findings, because an outage is never a clean pass (A08). The distinct reason (added by W6-09 to the one `QC_UNAVAILABLE_REASONS` list from which `QcUnavailableReason`, the `review.ts` inline unions and the `observability.ts` schema now derive, and to the `qc_run_unavailable_reason_check` in W6-09's migration, with th/en keys `review.qc.reason.desk_paused` and `operator.value.desk_paused`; section 5) lets the QC log, desk health and the dashboard tell an operator pause from a provider outage. Recheck requests are refused with 503 `desk_frozen`. W6-17 therefore depends on W6-09.
- **Readiness and desk health:** readiness (`observability/health.ts`) gains `deskControls: { writesFrozen, mailPaused, qcPaused } | 'unconfigured'`, and the desk-health screen shows it. If `'unconfigured'` joins `OperatorValue` (`web/src/i18n/operator-labels.ts`, exhaustive by `satisfies`), W6-17 adds `operator.value.unconfigured` in th and en. The same readiness report is widened by W4-13b (`qc.kind: content`, `qc.model`) and W7-03 (`store.migrations: ahead`); each adds only its own field. The desk stays `ready`: a switch is an operator choice, not a fault.

## 8. Dashboard (W6-13, W6-14, W6-15, W6-16)

### 8.1 API

`GET /api/dashboard` has action `dashboard.view`. The shapes are in `shared/src/schemas/dashboard.ts` and `server/src/dashboard/repository.ts` computes them. Every query starts from `caseScopeWhere(actor)` inside one read-only transaction, as `queue/repository.ts` `readQueue` does.

```ts
interface DashboardResponse {
  asOf: string;                 // ISO instant; `today` is its Asia/Bangkok date
  today: string;
  cases: { total: number; byStatus: Record<CaseStatus, number> };      // equals the queue's statusCounts for the same actor
  lanes: Array<{ lane: Lane; pending: number; approved: number; sentBack: number; dueSoon: number; breached: number }>;
  findings: {
    open: Array<{ lane: Lane; severity: Severity; count: number }>;  // Severity = 'high' | 'medium' | 'low' (shared/src/qc/types.ts; no 'info'); defects, undispositioned, current version, recheck excluded
    unavailableOpen: Record<Lane, { outage: number; paused: number }>;   // QC-UNAVAILABLE findings still open; `paused` = run reason desk_paused
    advisory: number;                                                    // recheck findings on current versions
  };
  qc: { runs30d: number; unavailableRuns30d: number; pausedRuns30d: number; rechecks30d: number }; // run rows: under QC_MODE=content one trigger writes two rows (W4b metadata and content parts), each counted; runs30d and unavailableRuns30d exclude recheck runs; pausedRuns30d is a subset of unavailableRuns30d
  risk: { available: false } | { available: true; tiers: Array<{ tier: string; count: number }>; notAssessed: number }; // W6-16
  activity: Array<{ weekStart: string; submitted: number; resubmitted: number; sentBack: number; ready: number }>;     // last 8 Bangkok weeks
}
```

- **Counting rules.** Lane and finding counts use each in-scope case's **current submitted version** (`case.current_version_id`), which is what the queue shows.
  - SLA uses `sla/breach.ts` `openReviewTargets`, extended with an optional scope predicate. `breached` means due before `today`, as in `listSlaBreaches`. `dueSoon` means pending, not breached, and due within `DASHBOARD_DUE_SOON_WORKING_DAYS` working days (`shared/src/sla/working-days.ts` with the frozen calendar).
  - Activity reads `pack_version.submitted_at` (with `version_number > 1` for resubmitted), `ready_at` and the `lane_decision` send-back rows, each joined to in-scope cases.
- **Consistency invariant (tested):** for every fixture identity, `cases.byStatus` equals `readQueue(...).statusCounts`, and `lanes[*].breached` summed over lanes equals the breaches `listSlaBreaches` returns for the in-scope cases.
- **Performance:** p95 < 500 ms at 1,000 cases, measured with the existing `tests/performance` queue seed. A miss is a finding, as in [performance targets](performance-targets.md).
- **Risk tiers (W6-16)** group in-scope cases by the W5 projection `case.risk_tier` (W5-05), which W5 writes from the submit-time proposal of the current version, with labels from the rubric revision frozen on it. `NULL` (no submitted version, or no rubric in force) counts as `notAssessed`, and the W5 `unknown` value is its own bucket, never folded into a low tier. W6 recheck proposals (section 5.1) never change `case.risk_tier`, so they are not counted. The labels are D07's (PWA) and are rendered as stored, never translated into approval language. Until W5 merges, `risk: { available: false }`.

### 8.2 Drill-down (W6-14)

`QueueQuerySchema` gains optional `lane`, `laneStatus` (`pending|approved|sent_back`), `sla` (`due_soon|breached`, which needs `lane` or applies across lanes), `findingLane`, `findingSeverity`, `findingKind` (`defect|unavailable`) and, in W6-16, `riskTier`.

- Each filter is applied **inside** the scoped `visible` sub-select, before counts and pagination (A06).
- SLA filters resolve through the scoped `openReviewTargets` to a case-ID set.
- The queue screen reads and writes these filters in the URL, so a dashboard link such as `/queue?lane=dpo&sla=breached` opens the filtered list.
- Every dashboard number is a link to its queue filter, or to the case when the count is 1. A 0 is plain text.

## 9. UI

**Routes** are added to `web/src/routes.ts` and `web/src/router.tsx`, all under `RequireSession`:
- `dashboard: '/dashboard'`
- `adminConfiguration: '/admin/configuration'`
- `adminConfigurationKind: (kind) => …`
- `adminConfigurationRevision: (kind, id) => …`

**Navigation** (`screens/shell/app-shell.tsx`):
- "Dashboard" is first, for every signed-in user.
- "Configuration" appears beside "Desk health" when `isOperatorAdmin(session)`.
- The server still decides access: a non-Admin opening an Admin URL sees the 403 notice (`components/error-notice.tsx`).

**Screens:**
- `web/src/screens/dashboard/`: `dashboard-screen.tsx`, `dashboard.view-model.ts`, `dashboard.css`. It has tiles for status, lanes and SLA, findings by lane and severity, QC, risk and activity. Each tile is a `<table>` with a `<caption>` and header cells. Bars are `aria-hidden` spans whose width comes from the count. The empty state is `dashboard.empty`.
- `web/src/screens/admin/`:
  - `configuration-index.tsx`
  - `configuration-kind.tsx` (current, draft, history)
  - `revision-diff.tsx`: a structured diff of two bodies by JSON path, via `admin/diff.ts`, a pure tested function
  - `editors/{sla,calendar,list,recipients,desk-controls,qc-rules,json}-editor.tsx`
  - `publish-dialog.tsx` and `restore-dialog.tsx`, both with a required change note, built on `components/dialog.tsx`

  Owner-labelled values show a badge: `admin.config.values_owner.D07` "provisional until D07", with the same pattern for D09 and D10.
- The case screen (`screens/case/`):
  - `version-configuration.tsx` shows the `frozenConfiguration` list, with revision numbers linking to the Admin history for Admin only.
  - `qc-log.tsx` labels a recheck run as `qc.recheck.run_label` (revision and requester) and marks its findings `qc.recheck.advisory`.
  - `recheck-dialog.tsx` is shown to Admin only.
- The desk-controls banner appears in the shell when readiness reports a switch on.

**Locale keys** (th and en, D12): `dashboard.*`, `admin.config.*` (kind names, fields, problems, dialogs, owner badges), `qc.recheck.*`, `desk_controls.*`, `error.desk_frozen`, `error.stale_version.guidance.configuration_changed`, `error.invalid_input.advisory_finding` and `validation.configuration.*`. Keys are added in contiguous blocks per ticket to limit merge conflicts; `shared/src/locales/locales.test.ts` guards parity.

**Accessibility:**
- Everything works from the keyboard.
- Focus moves to the page heading on route change (`route-focus.tsx`).
- Dialogs trap focus.
- Numbers are text.
- Colour never carries meaning alone: severity and breach also carry a word.
- Axe reports zero critical violations at 1440, 834 and 390 px, in th and en.

## 10. Logs and audit

- **Audit (`audit/store.ts` `AUDIT_ACTIONS`):**
  - new actions `configuration.draft_saved`, `configuration.draft_discarded` and `qc.recheck_requested`;
  - `configuration.published` (existing) gains `afterRef.restores_configuration_revision_id` on a restore;
  - refs stay IDs only, and the change note is on the revision row.
- **Log events** (W0-10 catalogue, amended in the owning PR):
  - `configuration.published` `{ kind, revisionId, revisionNumber, restoresRevisionId? }` (info);
  - `configuration.publish_refused` `{ kind, reason: 'stale' | 'invalid', problemCount }` (warn);
  - `desk_controls.changed` `{ writesFrozen, mailPaused, qcPaused }` (warn);
  - `desk.write_refused` `{ route }` (info);
  - `qc.run.*` gain `recheck: boolean`;
  - `dashboard.read` is **not** an event: `request.completed` already covers it.
  - No body values, addresses or notes are logged.

## 11. Tickets

One ticket per branch `codex/<ticket-id>-<topic>` and per PR. Each keeps the whole gate green (section 12) and merges after two independent reviewer verdicts on its exact head and green CI. The lanes are A (server), B (UI) and C (platform, tests and docs).

| Order | ID | Outcome | Done when | Owner type | Lane | Depends on | Main paths | Migr. |
|---|---|---|---|---|---|---|---|---|
| 0 | W6-00 | This plan | Merged, with the register gate row recorded by the lead | Lead | — | — | `docs/engineering/implementation-plan-w6.md` | no |
| 1 | W6-01 | W6 contract: shared shapes, policy rows, error codes | `configuration-admin.ts`, `dashboard.ts` shapes, `QueueQuerySchema` additions and the optional `SubmittedVersion.frozenConfiguration` type-check. Policy unit tests show the Admin-only rows, `qc.recheck` Admin-only and `dashboard.view` for six roles. Error-code tests are green. W0-02, W0-05 and W0-06 are amended | HRR | A | W6-00 | `shared/src/schemas/{configuration-admin,dashboard,queue,versions}.ts`, `shared/src/errors.ts`, `shared/src/constants.ts`, `server/src/authz/policy.ts`, `policy.test.ts`, the three spec docs | no |
| 2 | W6-02 | Drafts, change note, restore and `desk_controls` in the store | Migration applied. `desk_controls` registered in shared (`CONFIGURATION_KINDS`, `DeskControlsBodySchema`, `CONFIGURATION_BODY_SCHEMAS`, `ConfigurationBodies`) and in the db kind list, with a test that the two kind lists are equal. Store functions `saveDraft`, `discardDraft`, `publishDraft` and `restoreRevision` pass integration tests (stale base 409, draft consumed, restore N+1, trigger still blocks UPDATE). The seed publishes `desk_controls` through `publishRevision`. `ConfigurationSeed` excludes `UNSEEDED_KINDS` (section 3), and `seed.test.ts` asserts the seeded set by kind and the absence of `group_role_mapping`. The freeze skips unfrozen kinds | HRR | A | W6-01 | `shared/src/schemas/cases.ts`, `server/drizzle/`, `db/schema/configuration-*.ts`, `configuration/store.ts`, `configuration/seed.ts` (seed type, `UNSEEDED_KINDS`), `versions/freeze.ts`, `configuration/seed.test.ts`, `w1-00-migrations.test.ts`, `w1-05-submit.test.ts` | **yes** |
| 3 | W6-03 | Publish validation | `publishProblems` unit tests: unknown rule, engine mismatch, trigger superset, template coverage in both orders, v2.0 band isolation, non-synthetic recipient; the seed, `fixtures:load`, `w4-02-rule-catalogue` (partial catalogue) and `w3-03b-digest` (real recipient) still publish through `publishRevision` unchanged (section 2.4). Registry lists `PACK-CONTRADICTION` and `RISK-TIER-UNKNOWN` if W4-06d or W5-10 merged first. It does not register `group_role_mapping` (W6-11 does) | HRR | A | W6-02 | `configuration/validate.ts`, `configuration/validate.test.ts`, `configuration/store.ts` (`publishDraft` and `restoreRevision` call `publishProblems`; `publishRevision` and `validateConfigurationBody` unchanged), `shared/src/qc/rule-registry.ts`, `server/src/qc/rule-registry.test.ts`; `w4-02-rule-catalogue` and `w3-03b-digest` stay unchanged and green | no |
| 4 | W6-04 | Admin configuration API | Route tests: T40 (every non-Admin role 403 on each route), 404 `configuration`, 409 `configuration_changed`, 422 with problems, audit rows, log lines | HRR | A | W6-03 | `configuration/routes.ts`, `app.ts`, `audit/store.ts`, `observability/log.ts`, `tests/integration/w6-04-admin-configuration.test.ts` | no |
| 5 | W6-05 | Admin UI: index, history, diff, restore | Browser: Admin sees each kind, its history with change notes and version counts, a two-revision diff, and restores with a note. Non-Admin gets the 403 notice. th/en, keyboard, axe at 3 widths | Agent-eligible | B | W6-04 | `web/src/screens/admin/{configuration-index,configuration-kind,revision-diff,restore-dialog}.tsx`, `admin/diff.ts`, `routes.ts`, `router.tsx`, `app-shell.tsx`, `api/client.ts`, locales, `tests/browser/w6-05-admin-configuration.spec.ts` | no |
| 6 | W6-06 | Admin UI: editors for simple kinds, and draft and publish | Browser: Admin edits SLA, calendar, use-case groups, recipients and templates; saves a draft; sees problems; publishes with a note. The 409 path reloads | Agent-eligible | B | W6-05 | `screens/admin/editors/{sla,calendar,list,recipients}-editor.tsx`, `publish-dialog.tsx`, locales, `w6-06-admin-edit-publish.spec.ts` | no |
| 7 | W6-07 | Admin UI: QC rule catalogue editor | Browser: per-template rule table (include, severity, triggers, `PACK-STAGE-MISMATCH` matrix); registry-refused rules shown as problems; D09 badge on content params | Agent-eligible | B | W6-06; W4-13c (the `w4b.1` content-rule params schemas the editor renders; consolidated with the W4b plan section 15.2) | `editors/qc-rules-editor.tsx`, locales, `w6-07-qc-rules-editor.spec.ts` | no |
| 8 | W6-08 | Activation and historical-evidence proof | Integration and real-server tests: after publishing new `sla`, `calendar` and `qc_rules`, a new submit freezes them and its due dates and QC reflect them; an older version's due dates, findings and re-evaluation are unchanged; a restore brings the old values back for the next submit. The affected W3-05 SLA and W4a runner assertions are repeated under the changed revisions | HRR | C | W6-04 | `tests/integration/w6-08-activation.test.ts`, `w6-int-activation-server.test.ts`, TESTING | no |
| 9 | W6-09 | Explicit recheck, server | Migration applied. The recheck route with scope, 404, 409 `version_closed` and 422. Recheck runs and findings recorded. Ready, status, unavailable reuse and latest-run lookup (`findLatestQcRun`) ignore them; a pending approval naming the earlier `qcRunId` stays valid after a recheck under the frozen revision, and a recheck is never replayed. Disposition refused. A Ready version stays Ready. `GET .../qc-runs` serves `recheck` and `requestedBy`; `GET .../findings` serves `runId` and `advisory` (read over HTTP in the test). `desk_paused` added to `QC_UNAVAILABLE_REASONS`, and the `review.ts` inline unions, `QcUnavailableReason` and `QcUnavailableReasonSchema` derive from it; a `desk_paused` run row reads with 200 through `GET .../qc-runs` and the lane `qc-run` replay; `qcUnavailableReasonKey` and `OPERATOR_VALUE_KEYS` label `desk_paused` (typecheck green); the W4-15 dedup lookup ignores recheck findings and a recheck run appends without dedup (a later gating finding on the same claim is still stored); a recheck under `QC_MODE=content` writes one `recheck = true` row per bound part. `SubmittedVersion.frozenConfiguration` served and declared (optional) in `SubmittedVersionResponseSchema`; a pre-W6 stored submit body replays with 200 | HRR | A | W6-02; after W4b's orchestrator tickets (section 11.2) | `server/drizzle/`, `db/schema/qc-run.ts`, `qc/recheck.ts`, `qc/rules-revision.ts`, `qc/orchestrator.ts` (`runAndPersistRecheckQc`), `qc/repository.ts` (`findLatestQcRun` filter), `workflow/service.ts` (approve regression), `workflow/ready.ts`, `cases/status.ts`, `findings/repository.ts`, `findings/service.ts`, `findings/routes.ts`, `shared/src/schemas/review.ts` (run `recheck`/`requestedBy`, finding `runId`/`advisory`, `desk_paused`), `shared/src/qc/types.ts`, `shared/src/schemas/observability.ts` (reason list), `shared/src/schemas/versions.ts`, `versions/routes.ts`, `versions/freeze.ts` (`submittedVersionView`), `web/src/screens/case/view-model.ts` (`qcUnavailableReasonKey` gains `desk_paused`) and `view-model.test.ts`, `web/src/i18n/operator-labels.ts` (`desk_paused`), locales (`review.qc.reason.desk_paused`, `operator.value.desk_paused`, th and en), `w6-09-recheck.test.ts`, `tests/integration/w1-00-migrations.test.ts` (only if a listed object changes) | **yes** |
| 10 | W6-10 | Version configuration panel and recheck UI | Browser: the "configuration used" panel on each version; the Admin recheck dialog; a recheck run labelled (from `QcRunSummary.recheck`/`requestedBy`) and its findings advisory (from `FindingWithDisposition.advisory`/`runId`) with no disposition controls | Agent-eligible | B | W6-09 | `screens/case/{version-configuration,recheck-dialog,qc-log,finding-list}.tsx`, locales, `w6-10-version-configuration.spec.ts` | no |
| 11 | W6-11 | Identity-mapping configuration contract | Schema moved to shared and registered (sole owner of the `group_role_mapping` entries in `CONFIGURATION_BODY_SCHEMAS` and `ConfigurationBodies`); `CONFIGURATION_SEED` still type-checks with no mapping (W6-02's `UNSEEDED_KINDS`) and `seed.test.ts` stays green unchanged; publish accepted for a synthetic body and refused for an invalid one; adapter tests unchanged and green; identity adapter 9.2 amended; JSON editor with warning text | Agent-eligible | A | W6-03, W6-06 | `shared/src/schemas/{identity-mapping,cases}.ts`, `identity/group-mapping.ts` (re-export), `configuration/validate.test.ts`, `editors/json-editor.tsx`, `docs/engineering/identity-adapter.md` | no |
| 12 | W6-12 | Risk rubric editing | `risk_rubric` editable through the JSON editor with W5's schema, D07 badge; publish then a new submit freezes it (W5 proposal reads it) | Agent-eligible | B | W6-11; W5-02 (kind registered) | `editors/json-editor.tsx`, locales, `w6-12-risk-rubric.spec.ts` | no |
| 13 | W6-13 | Dashboard API | Scope tests per fixture identity; the consistency invariant (section 8.1); SLA due-soon and breached boundaries; recheck findings excluded; perf sample recorded | HRR | A | W6-01; W6-09 for the advisory count (until then `advisory: 0`) | `server/src/dashboard/{repository,routes}.ts`, `sla/breach.ts` (scope parameter), `app.ts`, `w6-13-dashboard.test.ts`, `tests/performance/` | no |
| 14 | W6-14 | Queue drill-down filters | Each new filter applied inside scope before counts and pages (an out-of-scope case never counted); URL round-trip in the queue screen | HRR | A+B | W6-13 | `queue/repository.ts`, `shared/src/schemas/queue.ts`, `screens/queue/{queue-screen.tsx,view-model.ts}`, `w6-14-queue-drilldown.test.ts` | no |
| 15 | W6-15 | Dashboard UI | Browser on the real server: tiles per role (owner, SPOC, reviewer, Admin), drill-down lands on the filtered queue, empty state, th/en, keyboard, axe at 3 widths | Agent-eligible | B | W6-14 | `web/src/screens/dashboard/*`, `routes.ts`, `router.tsx`, `app-shell.tsx`, locales, `w6-15-dashboard.spec.ts` | no |
| 16 | W6-16 | Dashboard risk tiers | `risk.available` true once W5 writes `case.risk_tier`; tiers from frozen rubric labels; `unknown` and `notAssessed` buckets; `riskTier` queue filter | Agent-eligible | A+B | W6-15; W5-05 (proposal at submit) | `dashboard/repository.ts`, `queue/repository.ts`, `screens/dashboard/*`, tests | no |
| 17 | W6-17 | Desk controls | Each switch proven: writes refused with 503 `desk_frozen` on every non-`GET`/`HEAD` route outside the exemption list (a test walks the registered routes), Admin configuration, sign-in/out and the locale switch still writable; mail stays pending and resumes; QC answers unavailable with outage findings; readiness and desk health show the state; banner | HRR | A | W6-04, W6-06, W6-09 (`desk_paused` reason) | `configuration/desk-controls.ts`, `app.ts` (preHandler), `notifications/service.ts`, `qc/orchestrator.ts`, `observability/health.ts`, `shared/src/schemas/observability.ts` (readiness `deskControls` only; the reason list is W6-09's), `web/src/i18n/operator-labels.ts` (if needed), `editors/desk-controls-editor.tsx`, `screens/operator/*`, `w6-17-desk-controls.test.ts` (including the registered-route walk) | no |
| 18 | W6-18 | Operator guide | `docs/operations/operator-guide.md` covers every BUILD_PLAN item (section 16), cites real routes, commands and switches; link check green; marked "operator review pending (W7 entry)" | Agent-eligible | C | W6-17, W6-15 | `docs/operations/operator-guide.md`, `README.md` link, TESTING | no |
| 19 | W6-19 | Risk recheck | Integration: a recheck proposal row with `trigger = 'recheck'` under the named rubric revision; `case.risk_tier` and the submit proposal unchanged; 403 for non-Admin; 409 `version_closed`; the version view lists it | HRR | A+B | W6-09; W5-05, W5-06 | `server/src/risk/recheck.ts`, `risk/routes.ts`, `screens/case/risk-proposal.tsx`, locales, `w6-19-risk-recheck.test.ts` | no |
| 20 | W6-EXIT | Engineering exit record | Section 15 evidence recorded from a clean checkout | Lead | — | all above | `changes/<date>-w6-exit/` | no |

### 11.1 Parallelism inside W6

After W6-01, two streams can proceed without sharing files beyond `app.ts` and locales:
- Admin configuration: W6-02 → W6-03 → W6-04 → W6-05, W6-06, W6-07, W6-08 (W6-08 in parallel with W6-05 to W6-07).
- Dashboard: W6-13 → W6-14 → W6-15.

W6-11 follows W6-06; W6-17 follows W6-06 and W6-09. W6-12, W6-16 and W6-19 wait for W5. W6-18 comes last.

### 11.2 With other packages, and shared-file conflict risks

- **W6-01 to W6-08, W6-11 and W6-13 to W6-15 do not depend on W4b or W5.** W6-09, and through it W6-17 and W6-18, wait for W4b's orchestrator and migration tickets. They can run in parallel with those packages' lanes. BUILD_PLAN's "W6 after W5" order is relaxed for them under the delegation. Only W6-12 (W5-02), W6-16 (W5-05) and W6-19 (W5-05, W5-06) need W5.
- **Dashboard ownership.** The W5 plan calls a tier filter and dashboard aggregates "W7" candidates. Under this plan they are W6 (W6-13 to W6-16). W5-09's single queue column is kept, and W6-14 adds the filters beside it.
- **`validateConfigurationBody`.** W5-02 adds a `risk_rubric` branch. W6-03 moves every per-kind check into `configuration/validate.ts` `publishProblems` and keeps that branch's behaviour.
- **Migration numbering.** W4b, W5 and W6 (W6-02, W6-09) each add migrations.
  - The index `00NN` is assigned **when the PR rebases for merge**: the next free number after `main`.
  - `server/drizzle/meta/_journal.json` and the snapshot are regenerated with `npm run migrate:generate` on the rebased branch, then completed by hand, never hand-merged.
  - Only one migration PR may be open for merge at a time across packages. The lead's board stream holds a `MIGRATION-SLOT` claim.
- **`qc_run` and the orchestrator.** W4b is expected to change `qc/orchestrator.ts` and possibly `qc_run`. W6-09 therefore starts after W4b's orchestrator and migration tickets merge, and rebases on them. If W4b adds a `trigger` value or columns, W6-09's CHECK is written against the merged schema.
- **Locales.** `shared/src/locales/{th,en}.json` are touched by nearly every UI ticket in every package. Keys go in per-namespace blocks, a conflict is resolved by keeping both sides, and `locales.test.ts` guards parity.
- **The configuration seed** (`configuration/seed.ts`) is touched by W4b (a new `qc_rules` label), W5 (`risk_rubric`) and W6-02 (`desk_controls`). Each adds its own entry.
  - Tests assert by kind, never by count or order (`seed.test.ts` is rewritten that way in W6-02).
  - A new seeded kind that is frozen changes `frozen_configuration` on new versions. `w1-05-submit.test.ts` asserts the frozen kinds by name.
- **`CONFIGURATION_BODY_SCHEMAS`** (and `ConfigurationBodies`) is touched by W5 (`risk_rubric`, seeded), W6-02 (`desk_controls`, seeded) and W6-11 alone (`group_role_mapping`, registered but in `UNSEEDED_KINDS`); each change is a one-line entry. A package that registers a kind it does not seed adds it to `UNSEEDED_KINDS` in the same PR.
- **`shared/src/schemas/review.ts`** is touched by W4b (content-rule evidence, if any) and W6-09 (recheck fields, `desk_paused`). New properties are `Type.Optional`, so each side rebases without breaking the substitute.
- **`IMPLEMENTED_RULES`**: W4b adds its content rules, and W5-10 adds the `RISK-TIER-UNKNOWN` metadata rule, to the registry in the same PR that implements them. Because W6-03's test asserts the registry's `metadata` entries equal `Object.keys(METADATA_RULES)`, whichever of W5-10 and W6-03 merges second updates the other side (W6-03 rebasing adds the entry; W5-10 rebasing onto W6-03 adds it to the registry).
- **`app.ts` route registration and `authz/policy.ts`**: W5 may add policy rows (risk). Rows are appended, and the policy test enumerates by action.
- **In-memory API substitute (W4b decision 19 "revisit at the W6 kickoff"; PR, consolidated).** Options: (a) keep it frozen for W6: no W6 route; the dashboard and Admin screens, which no substitute journey opens, show the standard error notice on its 404; (b) add W6 routes to it: a second store to keep in step; (c) retire it: needs a real-server twin of `w3-07b-operator.rehearsal.substitute.spec.ts`. **(a)**. W5 R-16's two read routes are the only additions to it in W4b-W7. `evidence` stays optional; the W6 fields on `QcRunSummary` and `FindingWithDisposition` are optional for the same reason (section 5).
- **Operator labels and the case view model** (`web/src/i18n/operator-labels.ts`, `web/src/screens/case/view-model.ts`): widened by W4-13b (`content`), W4-12b, W6-09 (`desk_paused`), W6-10, W6-17 and W7-03 (`ahead`). Map entries only; whichever PR merges second rebases and keeps both. W6-09 (lane A) touches these lane-B files, and W6-10 edits `view-model.ts` too: W6-10 starts after W6-09 merges.
- **Recheck and the W4b orchestrator** (`qc/orchestrator.ts` `persistResult`, `qc/repository.ts` `findLatestQcRun`): W6-09 runs after W4-15, W4-17 and W4-18 and composes with them as section 5 states.

## 12. Commands

Each W6 ticket runs this gate from a clean worktree before asking for review, with its own Postgres (`POSTGRES_PORT=<port> docker compose -p <project> up -d --wait`, and `rai-web/.env` from `.env.example` with the ports rewritten). The PR states each command and its result.

```bash
cd rai-web
npm ci
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration          # includes w6-int-activation-server.test.ts from W6-08
npm run build && npm run check:substitute-absent
npm run test:browser:server       # evidence configuration
npm run test:browser:substitute
cd .. && node scripts/check-links.mjs && git diff --check
```

- **Real-server evidence:** `tests/integration/w6-int-activation-server.test.ts`. It spawns `server/src/main.ts` through `tsx` with `QC_MODE=deterministic`, as the `w4a-int-deterministic-server.test.ts` harness does. As `fx-user-admin` over HTTP it:
  1. publishes a new `sla` (DPO 4) and a `qc_rules` revision with an edited `PACK-STAGE-MISMATCH` matrix;
  2. submits a fixture case;
  3. reads the version's `frozenConfiguration`, due dates and findings;
  4. checks an older version is unchanged;
  5. restores the earlier revisions;
  6. checks the next submit uses them.

  Run it alone with `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w6-int-activation-server.test.ts` from `rai-web/`.
- **Dashboard performance:** `npm run perf:run` with a new `dashboard` profile in `tests/performance/profiles.ts` (W6-13).
- No new npm script. `npm run reset` remains the fixture reset the operator guide documents.

## 13. Test-layer map

| Layer | W6 adds |
|---|---|
| Unit | <ul><li>`publishProblems` (every rule of section 2.4).</li><li>`admin/diff.ts`.</li><li>Policy rows and T40.</li><li>`resolveFrozenConfiguration` skipping unfrozen kinds.</li><li>`readDeskControls` fallback.</li><li>Dashboard view-model formatting in th and en.</li><li>Queue filter parsing.</li></ul> |
| Integration (real Postgres) | <ul><li>Draft save, discard, publish and restore; stale 409s.</li><li>The immutability trigger and grants after the migration.</li><li>Audit rows.</li><li>A10 unauthorized edits: every non-Admin role on every write.</li><li>Activation and historical evidence (W6-08).</li><li>Recheck records, advisory exclusion from Ready and status, disposition refusal, send-back-closed refusal.</li><li>Dashboard scope per identity and the consistency invariant.</li><li>Drill-down filters inside scope.</li><li>Desk controls, each switch.</li></ul> |
| Real server | `w6-int-activation-server.test.ts` |
| Browser (evidence configuration) | <ul><li>Admin configuration journeys (W6-05, W6-06, W6-07, W6-12).</li><li>Version configuration panel and recheck (W6-10).</li><li>Dashboard per role with drill-down (W6-15).</li><li>`w6-int-journey.spec.ts` in W6-08: Admin changes the DPO SLA, a new submission shows the new due date, the previous version keeps its date, Admin restores.</li><li>th and en; 1440, 834 and 390 px; axe; keyboard.</li></ul> |
| Performance | Dashboard p95 sample at 1,000 cases |

## 14. What the tickets do not claim

- Values published during the tests are synthetic.
- The rubric (D07), content thresholds (D09) and identity mapping (D10) remain those owners' decisions.
- Desk controls are a local operator tool, not production incident response (D10, W8).

## 15. Exit evidence (W6-EXIT)

The exit record, for Ta's review, lists:

- **A10 local:**
  - unauthorized-edit rejection (T40 and the integration matrix);
  - activation: a new submit uses the published configuration with no restart, shown by process ID unchanged in `/healthz`;
  - rollback by restore;
  - the historical-evidence tests (W6-08) and the repeated QC and SLA tests after a change.
- QC and risk recheck records next to the frozen revisions of the same version, showing the revision IDs are distinct and that Ready, status and `case.risk_tier` did not change.
- Dashboard scope and consistency results for each fixture identity, and the performance sample with its environment.
- Desk-control proofs.
- The operator guide merged, marked "operator review pending". Nakhun's review is a W7 entry criterion, not W6's exit.
- The configuration revision IDs, runner version and fixture-set identity next to each output. The provisional labels (D07, D09, D10) are stated.
- A **qualified** coverage statement. BUILD_PLAN's W6 exit wording ("all local A01-A10 coverage has recorded evidence") is cited but not copied, because under the delegation several parts are owner-dependent. The record states that every local A01-A10 criterion has recorded evidence **except** these owner-dependent parts, each listed as pending:
  - **A03 partial pending D07:** the synthetic rubric mechanism is proven, but "approved reference cases" and "reviewer acceptance" are not met until AI/COE records D07 (W5 plan R-1, R-12 and section 11);
  - **A08 and A09 thresholds provisional pending D09:** the content-rule thresholds and evaluation criteria are provisional working assumptions held as configuration;
  - **A10's production group mapping pending D10/W8:** only the configuration contract and synthetic mappings are proven;
  - **production identity checks** (AD/Entra, `network` and `production` modes) pending W7/W8.

  It does not say the owner-dependent criteria are met, and it does not claim any owner approved anything.

## 16. Operator guide outline (W6-18)

`docs/operations/operator-guide.md`, in English, with the Thai UI terms quoted as the SPA shows them. It covers:

1. **Sign-in mode per environment:** `fixture` (tests), `local-google` (localhost), `network` (W7, not built), `production` (W8). What each refuses (W0-03 S-rows).
2. **Queue and SLA report:** the dashboard, the queue filters, the daily digest and where its mail lands in the sink.
3. **Failed-mail and unavailable-QC views:** `/operator/desk-health`, and what each row means and who acts.
4. **Configuration changes:** the draft, publish and restore flow, change notes, the template-before-catalogue order, and what applies to whom (section 2.2).
5. **Recheck:** when to use it, and why its findings are advisory.
6. **Fixture reset outside production:** `npm run reset`, and its refusal conditions.
7. **Incident shutdown path:** desk controls first (freeze writes, pause mail, pause QC), then stopping the server as the last resort, then how to resume and verify through `/readyz`.
8. **Escalation contacts:** role placeholders (operator: Nakhun per D01; IT/Security and AI/COE lead "to be named"), with no personal contact data committed.
9. **Known limits:** synthetic data only (D08), no network mode, no real mail.

## 17. What this plan changes in other documents

Each amendment is dated and lands in the owning ticket's PR:

- **W0-02** section 7: new 7.10 "W6 shapes" (Admin configuration, dashboard, queue filters, optional `SubmittedVersion.frozenConfiguration`, recheck route) in W6-01; the `QcRunSummary`/`FindingWithDisposition` recheck fields in W6-09. Section 7.9's "no configuration write (W6)" line is annotated in W6-04.
- **W0-05:** the `qc.recheck` and `dashboard.view` rows, `config.publish` now live, and T40, in W6-01.
- **W0-06** 8.1 and 8.3: `desk_frozen`, `configuration_changed` and the `configuration` resource, in W6-01.
- **W0-04 / persistence:** `configuration_draft`, the new revision columns and the `desk_controls` kind in W6-02; the `qc_run` recheck columns in W6-09.
- **W0-07:** 3.7 (the recheck `runKey`, and latest-run lookup excluding rechecks) and 3.4 (advisory runs excluded from gating, the `desk_paused` reason and the single `QC_UNAVAILABLE_REASONS` list) in W6-09; section 6 (QC pause) in W6-17.
- **W0-10:** the log events of section 10, each in its ticket. 5.3 `deskControls` in W6-17.
- **Identity adapter 9.2:** in W6-11.
- **TESTING:** a W6 paragraph in W6-08.
- **README:** a link to the operator guide in W6-18.
- **BUILD_PLAN W6:** a note that the dashboard was added under Ta's delegation of 2026-09-27 and is not a PRD requirement, and that W6 tickets not needing W5 may run in parallel with it. This goes in the W6-00 PR or the lead's gate-entry PR.
- **PRD, source spec and acceptance:** unchanged. The dashboard is recorded as a delegated addition, not a new requirement ID.
- **Later packages outline:** the W6 row links this plan (W6-00).
- **W5 plan:** its "dashboard aggregates are W7's" and "a tier filter is a W7 dashboard candidate" lines move to W6 (W6-13 to W6-16), and its reserved `recheck` trigger is written by W6-19. This is a provisional agent-team choice under Ta's delegation of 2026-09-27, not a recorded agreement; the consolidated planning change amended the W5 plan to point here, and the W5 lead may reopen it through the board.

## 18. Plan review

Round 1 (two reviewer agents) raised three blockers; each is resolved in this revision and was checked against `rai-web`.

| # | Blocker | Resolution |
|---|---|---|
| 1 | Section 15's last bullet overstated coverage: A03 stays partial until D07 (W5 plan R-1, R-12, section 11), and A08/A09 thresholds are D09's | Section 15 now cites BUILD_PLAN's wording without copying it and lists the exceptions: A03 partial pending D07, A08/A09 thresholds provisional pending D09, A10's production group mapping pending D10/W8, and production identity checks pending W7/W8 |
| 2 | Recheck not isolated from approve and replay: `qc/repository.ts` `findLatestQcRun` (behind `findLatestSubmitRun` and `findLatestApproveAttemptRun`) has no recheck filter, so a recheck under the frozen revision would trigger 409 `qc_run_superseded` in `workflow/service.ts` `approveLane` and be replayed by `orchestrator.ts` `replayPrior` | Section 5 adds `recheck = false` to `findLatestQcRun`; W6-09's paths add `qc/repository.ts`, `workflow/service.ts` and `findings/repository.ts`; a new test proves a pending approval with the earlier `qcRunId` stays valid after an `approve_attempt` recheck under the frozen revision and that no recheck is ever replayed |
| 3 | W6-02 could not seed `desk_controls`: `validateConfigurationBody` refuses a kind without a body schema, the seed type is `keyof ConfigurationBodies`, and the shared `CONFIGURATION_KINDS` also needs the kind | `DeskControlsBodySchema`, its `CONFIGURATION_BODY_SCHEMAS` and `ConfigurationBodies` entries and the shared `CONFIGURATION_KINDS` addition move to W6-02, with `shared/src/schemas/cases.ts` in its paths and a test that the shared and db kind lists are equal (section 3, section 11.2) |

Notes taken:
- Dashboard `qc.runs30d` and `unavailableRuns30d` exclude recheck runs (advisory); `rechecks30d` counts them separately.
- `qcPaused` uses a distinct unavailable reason `desk_paused` (W6-09 migration extends the 0007 CHECK), so the dashboard's `unavailableOpen` splits `outage` from `paused`; W6-17 now depends on W6-09.
- `IMPLEMENTED_RULES` must also track W5-10's `RISK-TIER-UNKNOWN`; whichever of W5-10 and W6-03 merges second updates the registry (section 11.2).
- `POST /api/session/locale` is exempt from `writesFrozen` (section 7; round 2 corrected the method).
- W6-16's `available: false` fallback until W5-05 writes `case.risk_tier` is kept.

Round 2 (two reviewer agents) raised two blockers; each is resolved in this revision and was checked against `rai-web`.

| # | Blocker | Resolution |
|---|---|---|
| 1 | Registering `group_role_mapping` would break the seed typecheck: `seed.ts` `ConfigurationSeed` maps every `SeedableConfigurationKind` (`keyof ConfigurationBodies`) to a required key, while section 6 forbids a seeded mapping; `seed.ts` and `seed.test.ts` were in neither ticket's paths, and W6-03 and W6-11 both claimed the registration | W6-02 separates registered from seeded kinds: `UNSEEDED_KINDS = ['group_role_mapping']` in `seed.ts`, `ConfigurationSeed` over `Exclude<SeedableConfigurationKind, UnseededConfigurationKind>`, `SEED_KINDS` typed from it, and `seed.test.ts` rewritten to assert the seeded set by kind and the mapping's absence (section 3, W6-02 row). W6-11 is the sole owner of the `group_role_mapping` schema move and registration and needs no seed change; W6-03 no longer touches the kind (sections 6 and 11.2, W6-03 and W6-11 rows) |
| 2 | Recheck and advisory state never reached the API: `FindingWithDispositionSchema` and `QcRunSummarySchema` (`review.ts`) declare no `recheck`, `requestedBy`, `runId` or advisory flag, and Fastify drops undeclared properties; the inline `unavailableReason` and `LaneQcRunResponseSchema.reason` unions would make a `desk_paused` run fail serialization (500) | W6-09 adds `recheck` and `requestedBy` to `QcRunSummarySchema` and `runId` and `advisory` to `FindingWithDispositionSchema` (optional in the schema, always served by the real server), fills them in `findings/repository.ts`, and adds `'desk_paused'` to `QC_UNAVAILABLE_REASONS` with the two inline unions, `QcUnavailableReason` and `QcUnavailableReasonSchema` derived from that one list. `review.ts`, `qc/types.ts`, `observability.ts` and `findings/routes.ts` are in W6-09's paths; its Done-when reads the fields over HTTP and reads a `desk_paused` run with 200 (section 5, W6-09 and W6-10 rows) |

Notes taken in round 2:
- `writesFrozen` is deny-by-default through an `onRoute` hook over every non-`GET`/`HEAD` route outside an exact exemption list, proven by a test that walks the registered routes (section 7, W6-17).
- The exemptions are named exactly: `POST /api/session/locale`, `POST /auth/sign-out`, the `/auth/*` sign-in routes and `/api/admin/configuration/*`.
- `SubmittedVersion.frozenConfiguration` is optional in W6-01; W6-09 declares it (optional) in the route-local `SubmittedVersionResponseSchema`, so a pre-W6 stored submit body still replays (section 4.3).
- `buildRequest` and `runKeyOf` are module-private, so `runAndPersistRecheckQc` lives in `qc/orchestrator.ts`; `qc/recheck.ts` holds only the route-facing checks (section 5).
- Q7 and Q8 now list an alternative (hide from the editor until the owner decides), so every row gives at least two options.
- The W5 plan amendment is recorded as a provisional agent-team choice under the delegation, not as an agreement (section 17).

Round 3 (two reviewer agents: PASS and BLOCK). The workflow stopped after round 3; the consolidator resolved both blockers in the consolidated planning change, each checked against `rai-web`.

| # | Blocker | Resolution |
|---|---|---|
| 1 | W6-03 did not say where the cross-kind checks run; if `publishRevision` gained them, the seed (which publishes `checklist_templates` before `qc_rules`), `fixtures:load`, `w4-02-rule-catalogue` (partial catalogue on purpose) and `w3-03b-digest` (real recipient on purpose) would break, and `validateConfigurationBody` has no `inForce` or `MAIL_MODE` input | `publishRevision` keeps only `validateConfigurationBody` (schema, `qcRulesBodyProblems`, W5's `risk_rubric` branch). `publishProblems(kind, body, inForce, mailMode)` runs only in the Admin `publishDraft` and `restoreRevision` paths. W6-03's paths and done-when say so and keep those suites unchanged (section 2.4, W6-03 row) |
| 2 | W6-09 widened the reason unions without the web files that fail typecheck (`view-model.ts` `qcUnavailableReasonKey`, `operator-labels.ts` `satisfies Record<OperatorValue, LocaleKey>`), and named a locale key in a namespace that does not exist | W6-09's paths add `web/src/screens/case/view-model.ts` (and its test) and `web/src/i18n/operator-labels.ts`, with the keys `review.qc.reason.desk_paused` and `operator.value.desk_paused` in th and en; the shared-file risk with W6-10, W4-12b, W4-13b and W7-03 is named, and W6-10 starts after W6-09 merges (section 11.2) |

Cross-plan consolidation (2026-09-27, the W4b, W5, W6 and W7 plans read together):

- **Recheck versus the W4-15 dedup.** Recheck findings are ignored by the dedup lookup, and recheck runs do not dedup (section 5; W4b plan section 6). Without this an advisory finding would suppress later gating findings.
- **Recheck and QC pause under two run parts (W4-18).** A recheck writes one `recheck = true` row per bound part; `qcPaused` records every part as `desk_paused`; `findLatestQcRun` carries the engine ID and `recheck = false`; `parts[].reason` derives from `QC_UNAVAILABLE_REASONS` (sections 5 and 7).
- **Dashboard.** `findings.open[].severity` uses the real `Severity` (`high | medium | low`; no `info`). QC run counts count run rows, so a two-part trigger counts twice (section 8.1).
- **W6-07 depends on W4-13c**, whose params schemas the catalogue editor renders.
- **Registry entries.** `PACK-CONTRADICTION` (W4-06d) and `RISK-TIER-UNKNOWN` (W5-10) enter `IMPLEMENTED_RULES`, added by whichever PR merges second (W6-03 row).
- **Migration classes.** W6-02 and W6-09 are `restore-required` (section 3).
- **Operator labels.** Readiness widenings need `operator-labels.ts` entries: W6-17 `unconfigured` if needed (section 7).
- **API substitute.** It stays frozen for W6 (W4b decision 19 revisited; PR, section 11.2).
- **Gate entry.** It is recorded by the consolidated planning change; the precondition line is updated.
