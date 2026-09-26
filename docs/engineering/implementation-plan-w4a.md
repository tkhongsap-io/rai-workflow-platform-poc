# W4a file-level plan: metadata-only deterministic QC (W4-00a)

Status: plan, 2026-09-26 (W4-00a). Authority: the register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26). This plan must merge before any W4a code. It extends the [W0-02 file-level plan](implementation-plan-w1-w3.md) and the [W0-07 QC boundary](qc-boundary-and-mail-sink.md); where it does not say otherwise, both apply unchanged. Synthetic data only.

## 0. Scope

W4a delivers QC that reads **only structured pack data**: slot dispositions and reasons, `stage_context`, `model_type`, `vendor_involved`, `checklist_template_version`. It parses no document contents, calls no model and sends no data anywhere. Everything that reads an artifact's bytes belongs to W4b: extraction, the `ACC-*` evidence rules, contradictions across documents, the evaluation harness, the frozen set and ADR-0006. W4b keeps every precondition of the draft W4 gate entry: D08, D09 and named owners.

Tickets in W4a: W4-00a (this plan), W4-11a, W4-02, W4-03, W4-13, W4-04, W4-12, and the W4a exit record. Rule outcomes and fixture labels in W4a are **provisional until D09** is recorded; D09 confirms or replaces them.

Not in W4a: document parsing, a model or provider, the evaluation harness, finding dedup (W0-07 3.4 step 6, section 4), Admin editing of rules (W6), real data, networked access.

## 1. Decisions this plan applies

| Source | What it fixes here |
|---|---|
| W4a gate entry (Ta, 2026-09-26) | Package scope, synthetic only, the D03 reviewed-ticket flow and its merge amendment |
| D05 refinement (upload slot 5 and 9) (Ta, 2026-09-26) | An upload QC outage on slot 5 is owned by AI/COE; on slot 9 no upload rules run, so there is no run and no finding |
| D05 refinement (#35), W0-06 section 7 | Owning lane of every other finding, unchanged |
| W3 deferred rulings item 2 | A version closed by a send-back takes no new QC evidence (`version_closed`), including a late upload run |
| W3 deferred rulings item 3; W4a kickoff rulings | The in-memory API substitute is kept through W4a (section 11). The four W4a rules (section 4, plus template isolation in section 3) are the provisional starting set |
| D11 | `stage_context` is used only as a QC input, never as a lifecycle state |
| D12 | Every new message and label has th and en keys |
| L12 | Rules are selected by the version's `checklist_template_version` and the rules revision frozen on it |

## 2. Configuration (W4-13)

| Key | Values | Rule |
|---|---|---|
| `QC_MODE` | `deterministic`, `substitute` | Required. `deterministic` binds the W4a runner in every environment. `substitute` binds the scripted W1-10 runner. Start refuses it with `invalid:QC_MODE`, exit 78, when `NODE_ENV=production` **or** when `RAI_IDENTITY_MODE` is not one of the local modes (`fixture`, `local-google`); this replaces today's silent non-binding in production (`start.ts`). An unset value refuses with `missing:QC_MODE`, any other value with `invalid:QC_MODE`. No runner ever falls back to the other. |

- `.env.example` sets `QC_MODE=deterministic`. CI (`.github/workflows/ci.yml`) and the evidence browser configuration keep `QC_MODE=substitute` explicitly: the W2 and W3 journeys assert scripted `ACC-*` findings that only W4b's content rules will produce. The evidence Playwright configuration sets it for its web server so a developer's `.env` cannot change the evidence run.
- Readiness `qc.kind` comes from the bound runner's identity: runner `deterministic` → `deterministic`; the W1-10 `substitute-scripted` → `substitute`. The schema already allows both. `start.ts` stops hard-coding `substitute`, and `qc.run.started` stops hard-coding `qcKind`.
- The test override (`start.ts` `qcRunner`, integration harness) stays allowed only under `NODE_ENV=test`, whatever `QC_MODE` says.
- `check:substitute-absent` must still pass: the deterministic runner is product code under `server/src/qc/deterministic/`, never under `fixtures/`.

## 3. Rule catalogue (W4-02)

The `qc_rules` configuration kind (W0-04 `configuration_revision`) gets a real body. It is published like any other kind and frozen on the version at submit (`frozen_configuration.qc_rules`, already the preferred `configuration_revision_id` in `versions/freeze.ts`).

**Revision identity (one ID).** The ID that runs and findings record, that `runKey` uses and that W0-07 3.3 calls `qcRulesRevision` stays the `configuration_revision.id` of the `qc_rules` revision, as the code already records it (`qc/repository.ts` `ruleRevisionOf`). The body carries a human `label` only (for example `w4a.1`, shown in the QC log). No run records the label as its revision.

```ts
// shared/src/schemas/cases.ts — replaces QcRulesBodySchema { rulesRevision }
type QcRulesBody = {
  label: string;                               // human label, e.g. 'w4a.1'; never the recorded revision
  templates: Record<string, {                  // keyed by checklist_template_version: 'v1.0 Sheet3', 'v2.0'
    rules: Array<{
      ruleId: string;                          // QC_RULE_ID_PATTERN
      engine: 'metadata' | 'content';          // W4a executes only 'metadata'; 'content' rules are catalogued for W4b
      triggers: Array<'upload' | 'submit' | 'approve_attempt'>;
      severity: 'high' | 'medium' | 'low';     // the W0-07 3.3 Severity type; no new value
      params?: Record<string, unknown>;        // rule-specific, schema-checked per ruleId
    }>;
  }>;
};
```

- **The runner receives its rules in the request.** The runner has no store, so the orchestrator loads the catalogue body by the recorded revision ID, selects the rules and passes them as `request.rules: SelectedRule[]`. This amends W0-07 3.3 `QcRunRequest`. The rules are configuration data, never instructions from a document. The scripted substitute ignores the field.
- **Seed:** `configuration/seed.ts` publishes `qc_rules` revision 1 (label `w4a.1`) for both template versions.
  - `v1.0 Sheet3` lists the metadata rules of section 4, plus the content rules `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3` and `ACC-CLASSIC-ML-METRIC` with `engine: 'content'`.
  - `v2.0` lists the same, **without** `ACC-BAND-V1-SHEET3`: the source spec says other versions never inherit the v1.0 bands.
  - Seeding `qc_rules` changes which revision ID a new submit records as `configuration_revision_id`, because the freeze prefers it. W4-02 therefore updates:
    - `w1-05-submit.test.ts` (the frozen-revision assertions);
    - `configuration/seed.test.ts` (which asserts `qc_rules` is absent);
    - W0-02 sections 7.3 and 7.6, with a dated amendment.
- **Selection:** `server/src/qc/select.ts` `selectRules(body, templateVersion, trigger, modelType)` returns the rules for that template and trigger.
  - An unknown template version makes the run `unavailable:runner_error` (`unknown_template_version`), never a clean pass.
  - `model_type` routes the rules: `ACC-CLASSIC-ML-METRIC` is selected only for `classic_ml`; `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION` and `ACC-BAND-V1-SHEET3` are never selected for `classic_ml`.
  - W4a proves the routing on the selection function, because content rules do not execute until W4b.
- **The revision on a draft (the question W4-00 must answer):**
  - An upload run on a draft reads the `qc_rules` revision **in force at the upload instant**. It is resolved with the same rule the freeze uses (published strictly before now) and recorded on the run.
  - The draft's own `checklist_template_version` selects the template.
  - At submit, the version freezes whatever revision is then in force. If that differs from an earlier upload run's revision, each run keeps its own `rule_revision` and they stay distinguishable (W4-11a).
  - A historical version re-evaluated reads its own frozen revision, never the current one.

## 4. Deterministic runner (W4-03)

`server/src/qc/deterministic/runner.ts` implements the `QcRunner` port (`shared/src/qc/types.ts`) with `identity = { runner: 'deterministic', runnerVersion: <server package version> }`. Its output passes W0-07 3.4 validation unchanged. Each rule is a pure function of the request (slots, stage, model type, vendor flag, `request.rules` params) in `server/src/qc/deterministic/rules/<rule-id>.ts`.

Ta accepted these rules, with template isolation (section 3), as the provisional W4a set (register row "W4a kickoff rulings"). D09 confirms or replaces them.

| Rule | Trigger | Scope, owning lane | Fires when (W4a provisional definition) |
|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot; the single lane of slots 1-4, 6-8 | A lane-gated single-lane slot is `missing` |
| `PACK-SLOT-MISSING` | approve_attempt | slot 5; the run's lane | Slot 5 is `missing`. Each lane's approve-attempt run raises its own finding, owned by that lane (D05 refinement (#35)). The submit run raises none on slot 5, so no lane is invented |
| `PACK-STAGE-MISMATCH` | submit | pack; AI/COE | `stage_context = idea` and slot 8 (deployment checklist) is `attached`; or `stage_context = pre_launch` and any lane-gated slot is `not_yet`. These are the source spec's two examples, as the `params` matrix `{ attachedForbiddenAt, notYetForbiddenAt }` |
| `PACK-NA-VENDOR-DOC` (new) | submit | slot 3 or 4; DPO | `vendor_involved = true` and the slot is `not_applicable`, with any typed reason. The non-vendor default cannot survive on a vendor case (`pack/slots.ts` flip rule). A soft finding: the DPO confirms the reason by waiving it, or the owner fixes the slot |

- No rule raises a `defect` on slot 9. Content rules are selected but not executed in W4a. `rulesEvaluated` counts only the executed rules.
- Each rule with a boundary has below-, at- and above-boundary fixtures. For `PACK-STAGE-MISMATCH` that is each stage against each forbidden slot state.
- **Two lanes on slot 5:** a test runs the DPO and IT/Security approve attempts on one version with slot 5 missing. It shows two findings, each owned by its lane and each dispositionable only by that lane.
- **No finding dedup in W4a.** Completed submit and approve-attempt runs already replay (W0-07 3.7, `orchestrator.ts` `replayPrior`), so a deterministic rule is not re-raised for the same input. A new run after an unavailable one has no earlier defect to duplicate. W0-07 3.4 step 6 dedup (`alreadyRecorded`) moves to W4b, where content rules on upload and submit can overlap. Its scope key must then include the owning lane for slot 5.
- **"Reads no document bytes" is tested, not just stated:**
  - a unit test gives the runner artifacts whose `read()` throws and shows it never calls `read()`;
  - a module-graph test shows `server/src/qc/deterministic/` imports no parser, no `node:net` and no `node:http`.
- New locale keys (th, en): `qc.finding.pack_na_vendor_doc`, and one rule-label key per rule ID for the QC log (section 7). W0-07 3.5 gains the W4a rows in the same PR.

## 5. Upload trigger (W4-04)

- **Wiring.** `pack/qc-trigger.ts` gets a real implementation. It is wired in `app.ts`, where the shutdown drain lives, like the submit trigger, and bound through `compose-app-deps.ts`. `pack/service.ts` `fireUploadTriggers` is tracked by the drain; today it is an untracked promise.
- **Target.** The orchestrator's target loader accepts an **open draft** for `trigger = 'upload'` only. The request uses the draft's `checklist_template_version`, the revision of section 3 and the current lane-mapping constant, because a draft has none frozen yet.
- **Run fields.** An upload run records `slot` and has `lane = NULL`. W0-07 sets a run's `lane` only on approve attempts, and that is unchanged.
  - The owning lane of an upload outage finding comes from `unavailableOwningLane({ trigger: 'upload', slot })`: the slot's single lane for slots 1-4 and 6-8, AI/COE for slot 5 (recorded rule). The function stops throwing for slot 5 and 9.
  - Slot 9 fires **no run** (recorded rule).
  - The operator view's owning-lane lookup (`observability/operator.ts`) handles the upload case the same way.
- **Outage reuse key.** An upload outage finding is reused per version and owning lane: `QC-UNAVAILABLE:run:upload:<owningLane>`. Outages on slots of different lanes stay distinct, and a repeat on one lane reuses the open finding. This amends W0-07 3.6 for the upload trigger.
- **In-flight key.** For upload runs the in-flight table uses `runKey` (W0-07 3.7: version, trigger, slot and content hash), not `${caseId}:${versionId}:${lane ?? trigger}`. Two attaches on one save therefore run separately. Upload never replays: every trigger is a new input.
- **Where the result lands.** The draft row is the row that becomes the version at submit (`versions/service.ts`). So:
  - An upload run that completes while the row is still a draft appends to it.
  - A run that completes after the row was submitted, with the version still open, appends to that version. This is intended: upload findings "carry to the version that freezes it" (W0-07 3.2).
  - After Ready, the run is late (nothing written, `qc.run.late`).
  - After a send-back closed the version, the run is refused with `version_closed` (W3 deferred rulings item 2).
  - An upload outage finding carried into a submitted version counts against Ready like any open finding (A08: an outage is never a clean pass). Tests cover each case.
- **Nothing is evaluated yet.** No W4a metadata rule has the `upload` trigger. A completed deterministic upload run evaluates 0 rules and stores no defect; the QC log shows "0 rules evaluated", so it never reads as a clean pass.
- **The substitute under CI.** CI binds the substitute, and its scripts carry `upload` entries (`fx-case-vendor.json`, `fx-case-nonvendor.json`). Once the trigger is bound, every suite that re-attaches a slot would start writing those scripted findings. W4-04 removes the `upload` entries from the bundled scripts: upload content rules are W4b's, and no current test asserts an upload finding. It also makes the substitute answer an unscripted upload with a completed, zero-finding result, not an outage. The full suite shows no other test changes behaviour.
- **Who sees it.** The save-draft response never waits for QC. Draft runs are visible to whoever may read the draft (owner, BU SPOC). Reviewers see them once the version is submitted.

## 6. Run identity (W4-11a)

- **Migration** (`server/drizzle/`, forward-only) on `qc_run`:
  - `ADD COLUMN runner_version text NOT NULL DEFAULT 'unrecorded'`, then `DROP DEFAULT`. Existing rows read `unrecorded`, and every new insert must supply the value.
  - `ADD COLUMN rules_evaluated integer NULL CHECK (rules_evaluated >= 0)`: NULL on rows written before W4a, the executed count on completed runs, 0 on unavailable runs.

  Adding columns fires no UPDATE trigger, and the existing grants cover them (as migration `0007` did). `engine_id` keeps the runner name.
- **Log lines.** `qc.run.started`, `qc.run.completed` and `qc.run.unavailable` gain `runner`, `runnerVersion` and `ruleRevision`; `completed` also gains `rulesEvaluated`. `qcKind` comes from the bound runner. The W0-10 catalogue (`docs/engineering/observability-contract.md`) is amended in the same PR. No document text, filename or message parameter is added.
- **Operator report.** The `unavailableQc` rows gain the runner label. `lateQc` rows are unchanged: a late run writes no run row and `qc_late_result` has no runner column.
- **Done when** two runs on the same version with different rule revisions can be told apart from rows and log lines alone.

## 7. API and UI (W4-12)

- **Read shapes (W0-02 section 7 amendment):** `StoredFindingSummary` and `FindingWithDisposition` already carry `ruleId`. They gain `evidence: Array<{ slot, artifactId, locator }>`. That is locators only: `excerptHash` is not exposed, and no text exists.
- **New endpoint:** `GET /api/cases/{caseId}/versions/{versionId}/qc-runs`, authorized exactly like that version's findings read (W0-05; a draft's runs only for those who may read the draft). It returns the version's runs in `requested_at` order: `{ runId, trigger, lane, slot, status, unavailableReason, runner, runnerVersion, ruleRevision, rulesLabel, rulesEvaluated, findingCount, requestedAt, completedAt }`.
- **UI:**
  - The version view gets a "QC log" section listing every run.
  - The reviewer workspace shows every unavailable run on the version above the decision controls, from any trigger, not only the lane run.
  - A finding row shows its rule label, rule ID, evidence location (slot and locator kind) and owning lane.
  - An unavailable run, and a completed run with 0 rules evaluated, each look visibly different from "no findings".
  - Thai and English keys; keyboard-only operation; axe zero critical at 1440, 834 and 390.
- The disposition flow is unchanged from W2-05. The UI proof runs on the real server under the evidence configuration (`QC_MODE=substitute`, whose scripted findings carry evidence locators): the UI renders what any runner stores.

## 8. Commands

Each W4a ticket runs this gate from a clean worktree before asking for review, with its own Postgres (`POSTGRES_PORT=<port> docker compose -p <project> up -d --wait`, and `rai-web/.env` from `.env.example` with the ports rewritten). The PR states each command and its result.

```bash
cd rai-web
npm ci
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration          # includes the W4a real-server test below
npm run build && npm run check:substitute-absent
npm run test:browser:server       # evidence configuration, QC_MODE=substitute
npm run test:browser:substitute
cd .. && node scripts/check-links.mjs && git diff --check
```

- **Real-server evidence:** `rai-web/tests/integration/w4a-int-deterministic-server.test.ts`. It spawns the built server (`node server/dist/main.js`) with `QC_MODE=deterministic`, as `w1-int-negatives.test.ts` does, submits fixture cases over HTTP, and reads the stored `PACK-*` findings, runs, readiness `qc.kind` and the qc-runs endpoint. It is part of `npm run test:integration`, so CI runs it on every PR from W4-03 on. Run it alone with `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w4a-int-deterministic-server.test.ts` from `rai-web/`.
- No new npm script is added. `TESTING.md` gains a W4a paragraph in the W4-13 PR.

## 9. Order, owner types, branches

One ticket per branch `codex/<ticket-id>-<topic>` and per PR. Each merges only after two independent reviewer verdicts on its exact head and green CI on that head.

| Order | Ticket | Owner type | Depends on | Main paths |
|---|---|---|---|---|
| 1 | W4-11a run identity | Agent-eligible | this plan | `server/drizzle/`, `db/schema/qc-run.ts`, `qc/orchestrator.ts`, `qc/repository.ts`, `observability/log.ts`, `observability/operator.ts`, the W0-10 catalogue |
| 2 | W4-02 rule catalogue | HRR | W4-11a | `shared/src/schemas/cases.ts`, `shared/src/qc/types.ts` (`request.rules`), `configuration/seed.ts`, `qc/select.ts`, `qc/orchestrator.ts` (load and pass rules), W0-02 7.3/7.6, W0-07 3.3 |
| 3 | W4-03 deterministic runner | HRR | W4-02 | `qc/deterministic/runner.ts`, `qc/deterministic/rules/*`, locales, W0-07 3.5, `tests/integration/w4a-int-deterministic-server.test.ts` |
| 4 | W4-13 runner selection | Agent-eligible | W4-03 | `config.ts`, `start.ts`, `compose-app-deps.ts`, `observability/health.ts`, `.env.example`, `.github/workflows/ci.yml`, `tests/browser/playwright.config.ts`, W0-02 section 5, W0-07 3.9 and section 6, TESTING |
| 5 | W4-04 upload trigger | HRR | W4-03, W4-13 | `pack/qc-trigger.ts`, `pack/service.ts`, `app.ts`, `compose-app-deps.ts`, `qc/orchestrator.ts`, `shared/src/constants.ts` (`unavailableOwningLane`), `observability/operator.ts`, substitute scripts, W0-07 3.2/3.6 |
| 6 | W4-12 API and UI | Agent-eligible (read shapes: contract) | W4-11a, W4-03 | `shared/src/schemas/review.ts`, `findings/routes.ts`, `web/src/screens/case/*`, locales, W0-02 section 7 |
| 7 | W4a exit record | Lead | all above | `changes/<date>-w4a-exit/` |

The order is serial because tickets 1-5 share the orchestrator and the migrations chain. Serial merges keep every PR tested against the real main.

## 10. Test-layer map and exit evidence

| Layer | W4a adds |
|---|---|
| Unit | <ul><li>Each rule with below/at/above fixtures.</li><li>`selectRules` template isolation (v2.0 never selects `ACC-BAND-V1-SHEET3`) and `model_type` routing.</li><li>The catalogue schema.</li><li>The no-`read()` test and the module-graph test.</li><li>`QC_MODE` refusals (unset, unknown, substitute under production).</li><li>`unavailableOwningLane` for upload: slot 5 → AI/COE, slot 9 → no run.</li></ul> |
| Integration (real Postgres) | <ul><li>Orchestrator with the deterministic runner: submit and approve-attempt findings, the two-lane slot-5 case, replay, and revision distinguishability.</li><li>Upload trigger: one run per changed attach; none on an unchanged save; none on slot 9.</li><li>Upload outages: slot-5 owned by AI/COE; carried into the submitted version and gating Ready; send-back-closed refusal; the response not waiting; drain on shutdown.</li><li>The qc-runs endpoint's scope, with 403 and 404 as for findings.</li></ul> |
| Real server | `w4a-int-deterministic-server.test.ts` (section 8) |
| Browser (evidence config) | The QC log and unavailable-before-decision on the real server; th and en; three widths; axe; keyboard |

**W4a exit** needs all of the following:
- The W4-03 and W4-04 fixture tests and the real-server test pass from a clean checkout.
- The W4-12 journeys pass on the real server.
- Readiness reports `deterministic` under `QC_MODE=deterministic`.
- `check:substitute-absent` passes.
- The record lists the rule revision (ID and label), the runner version and the fixture set identity next to each output. It states that the labels are provisional until D09.

Ta reviews the exit record.

## 11. In-memory API substitute (W3 deferred rulings item 3)

Recorded outcome (register row "W4a kickoff rulings", Ta, 2026-09-26; the option Ta chose read "keep it unchanged and revisit at W4b kickoff"): **keep it through W4a, and revisit at the W4b kickoff.** It serves the one remaining substitute spec (`w3-07b-operator.rehearsal.substitute.spec.ts`) and Lane B development. W4a adds no substitute routes, and every W4a UI proof runs on the real server, so the substitute is not extended. Removing it would first need a real-server twin of the operator rehearsal.

## 12. What this plan changes in other documents

Each amendment is dated and lands in the owning ticket's PR:
- W0-02 section 5 (`QC_MODE` row): W4-13.
- W0-02 sections 7.3 and 7.6 (frozen revision): W4-02.
- W0-02 section 7 (read shapes, qc-runs endpoint): W4-12.
- W0-07:
  - 3.3 (`request.rules`; the upload revision): W4-02.
  - 3.5 (W4a rule rows, `PACK-NA-VENDOR-DOC`): W4-03.
  - 3.2 and 3.6 (upload run fields, the upload outage key): W4-04.
  - 3.9 and section 6 (a real `QC_MODE` value arrives in W4a without ADR-0006, which stays W4b's; the production refusal): W4-13.
  - 3.4 step 6 (dedup deferred to W4b): W4-03.
- W0-10 log catalogue: W4-11a.
- TESTING: W4-13.
- The W4 work breakdown: the W4a tickets move to Ready when this plan merges, and GitHub issues are opened for them then.
