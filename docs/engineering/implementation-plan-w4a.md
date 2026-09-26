# W4a file-level plan: metadata-only deterministic QC (W4-00a)

Status: plan, 2026-09-26 (W4-00a). Authority: the register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26). This plan must merge before any W4a code. It extends the [W0-02 file-level plan](implementation-plan-w1-w3.md) and the [W0-07 QC boundary](qc-boundary-and-mail-sink.md); where it does not say otherwise, both apply unchanged. Synthetic data only.

## 0. Scope

W4a delivers QC that reads **only structured pack data**: slot dispositions and reasons, `stage_context`, `model_type`, `vendor_involved`, `checklist_template_version`. It parses no document contents, calls no model and sends no data anywhere. Everything that reads an artifact's bytes (extraction, `ACC-*` evidence rules, contradictions across documents), the evaluation harness, the frozen set and ADR-0006 belong to W4b, which keeps every precondition of the draft W4 gate entry (D08, D09, named owners).

Tickets in W4a: W4-00a (this plan), W4-11a, W4-02, W4-03, W4-13, W4-04, W4-12, and the W4a exit record. Rule outcomes and fixture labels in W4a are **provisional until D09** is recorded; D09 confirms or replaces them.

Not in W4a: document parsing, a model or provider, the evaluation harness, Admin editing of rules (W6), real data, networked access.

## 1. Decisions this plan applies

| Source | What it fixes here |
|---|---|
| W4a gate entry (Ta, 2026-09-26) | Package scope, synthetic only, the D03 reviewed-ticket flow and its merge amendment |
| D05 refinement (upload slot 5 and 9) (Ta, 2026-09-26) | An upload QC outage on slot 5 is owned by AI/COE; on slot 9 no upload rules run, so there is no run and no finding |
| D05 refinement (#35), W0-06 section 7 | Owning lane of every other finding, unchanged |
| W3 deferred rulings item 2 | A version closed by a send-back takes no new QC evidence (`version_closed`), including a late upload run |
| W3 deferred rulings item 3; W4a kickoff rulings | The in-memory API substitute is kept through W4a (section 10); the four W4a rules of section 4 are accepted as the provisional starting set |
| D11 | `stage_context` is used only as a QC input, never as a lifecycle state |
| D12 | Every new message and label has th and en keys |
| L12 | Rules are selected by the version's `checklist_template_version` and the rules revision frozen on it |

## 2. Configuration (W4-13)

| Key | Values | Rule |
|---|---|---|
| `QC_MODE` | `deterministic`, `substitute` | Required. `deterministic` binds the W4a runner in every `NODE_ENV`. `substitute` binds the scripted W1-10 runner and is refused at start when `NODE_ENV=production` (`invalid:QC_MODE`, exit 78). Any other value, or unset, refuses to start (`invalid:QC_MODE` / `missing:QC_MODE`). There is no fallback from one runner to the other at any point. |

- `.env.example` sets `QC_MODE=deterministic`. CI and the evidence browser configuration keep `QC_MODE=substitute` explicitly, because the W2 and W3 journeys assert scripted `ACC-*` findings that only W4b's content rules will produce. The W4a real-runner evidence runs as integration tests that spawn the built server with `QC_MODE=deterministic` (section 9).
- Readiness reports `qc.kind` as the bound runner's kind (`deterministic` or `substitute`; the schema already allows both); `start.ts` stops hard-coding `substitute`.
- `check:substitute-absent` must still pass: the deterministic runner is product code under `server/src/qc/deterministic/`, never under `fixtures/`.

## 3. Rule catalogue (W4-02)

The `qc_rules` configuration kind (W0-04 `configuration_revision`) gets a real body. It is published like any other kind and frozen on the version at submit (`frozen_configuration.qc_rules`, already the preferred `configuration_revision_id` in `versions/freeze.ts`).

```ts
// shared/src/schemas/cases.ts — replaces QcRulesBodySchema { rulesRevision }
type QcRulesBody = {
  rulesRevision: string;                       // e.g. 'qc-rules/w4a.1'; the value every run records
  templates: Record<string, {                  // keyed by checklist_template_version, e.g. 'v1.0 Sheet3', 'v2.0'
    rules: Array<{
      ruleId: string;                          // QC_RULE_ID_PATTERN
      engine: 'metadata' | 'content';          // W4a runs only 'metadata'; 'content' rules are catalogued for W4b
      triggers: Array<'upload' | 'submit' | 'approve_attempt'>;
      severity: 'high' | 'medium' | 'low' | 'info';
      params?: Record<string, unknown>;        // rule-specific, schema-checked per ruleId
    }>;
  }>;
};
```

- **Seed:** `configuration/seed.ts` publishes `qc_rules` revision 1, `qc-rules/w4a.1`, with both template versions. `v1.0 Sheet3` lists the metadata rules of section 4 plus the content rules `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3` and `ACC-CLASSIC-ML-METRIC` as `engine: 'content'`. `v2.0` lists the same metadata rules and the content rules **without** `ACC-BAND-V1-SHEET3` (the source spec: other versions never inherit the v1.0 bands). Seeding `qc_rules` changes which revision ID a new submit records as `configuration_revision_id` (the freeze prefers it); tests that assert that ID are updated in the same PR.
- **Selection:** `server/src/qc/deterministic/select.ts` `selectRules(body, templateVersion, trigger, modelType)` returns the metadata rules for that template and trigger. An unknown template version yields no rules and makes the run `unavailable:runner_error` (`unknown_template_version`), never a clean pass. `model_type` routes: `ACC-CLASSIC-ML-METRIC` is selected only for `classic_ml`, and `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION` and `ACC-BAND-V1-SHEET3` never for `classic_ml`. W4a proves the routing on the selection function because content rules do not execute until W4b.
- **Revision on a draft (the question W4-00 must answer):** an upload run on a draft reads the `qc_rules` revision **in force at the upload instant**, resolved with the same "published at or before now" rule the freeze uses, and records it on the run. The draft's own `checklist_template_version` selects the template. At submit the version freezes whatever revision is then in force; if it differs from an earlier upload run's, both runs keep their own `rule_revision` and are distinguishable (W4-11a).
- A historical version re-evaluated reads its own frozen revision, never the current one.

## 4. Deterministic runner (W4-03)

`server/src/qc/deterministic/runner.ts` implements the `QcRunner` port (`shared/src/qc/types.ts`) with `identity = { runner: 'deterministic', runnerVersion: <package version> }`. Its output passes W0-07 3.4 validation unchanged. Each rule is a pure function of the request in `server/src/qc/deterministic/rules/<rule-id>.ts`.

Ta accepted these four rules (the three below plus template isolation, section 3) as the provisional W4a set (register row "W4a kickoff rulings"); D09 confirms or replaces them.

| Rule | Trigger | Scope, owning lane | Fires when (W4a provisional definition) |
|---|---|---|---|
| `PACK-SLOT-MISSING` | submit | slot; the single lane of slots 1-4, 6-8 | A lane-gated single-lane slot is `missing` |
| `PACK-SLOT-MISSING` | approve_attempt | slot 5; the run's lane | Slot 5 is `missing` (slot 5 findings belong to the lane whose run raised them; the submit run raises none on slot 5, so no lane is invented) |
| `PACK-STAGE-MISMATCH` | submit | pack; AI/COE | `stage_context = idea` and slot 8 (deployment checklist) is `attached`; or `stage_context = pre_launch` and any lane-gated slot is `not_yet`. These are the source spec's two examples, generalised by the `params` matrix `{ attachedForbiddenAt, notYetForbiddenAt }` |
| `PACK-NA-VENDOR-DOC` (new) | submit | slot 3 or 4; DPO | `vendor_involved = true` and the slot is `not_applicable` (with any typed reason; the non-vendor default cannot survive on a vendor case, `pack/slots.ts` flip rule). A soft finding: the DPO confirms the reason by waiving it, or the owner fixes the slot |

- No rule ever raises a `defect` on slot 9. Content rules (`engine: 'content'`) are selected but not executed in W4a; the run's `rulesEvaluated` counts only executed rules.
- Each rule with a boundary has below-, at- and above-boundary fixtures (for `PACK-STAGE-MISMATCH`: each stage against each forbidden slot state).
- **Dedup (W0-07 3.4 step 6):** the orchestrator stops appending a second open finding for the same `(ruleId, ruleRevision, scopeKey)` on a version; it counts it in `alreadyRecorded` instead. Deterministic rules re-raise the same fact on submit and on each approve attempt, so without this a reviewer would see duplicates. A dispositioned finding does not suppress a new one.
- New locale keys: `qc.finding.pack_na_vendor_doc` (th, en) and a rule-label key per rule ID for the QC log (section 7).

## 5. Upload trigger (W4-04)

- `pack/qc-trigger.ts` gets a real implementation bound in `compose-app-deps.ts`: it calls `runAndPersistUploadQc` for each `UploadTriggerEvent`. `pack/service.ts` `fireUploadTriggers` is tracked by the shutdown drain like the submit trigger (today it is an untracked promise).
- The orchestrator's target loader accepts an **open draft** for `trigger = 'upload'` only. The request uses the draft's `checklist_template_version`, the revision of section 3 and the current lane-mapping constant (the draft has none frozen yet).
- Lane of an upload run: the slot's single lane for slots 1-4 and 6-8; AI/COE for slot 5 (recorded rule). Slot 9 fires **no run** (recorded rule).
- In W4a no metadata rule has the `upload` trigger, so a completed upload run evaluates 0 rules and stores no defect. It is still recorded, still replays nothing (every upload is a new input, W0-07 3.7), and an outage still stores the QC-unavailable finding owned as above. The QC log shows "0 rules evaluated" so a completed run with nothing evaluated never reads as a clean pass (section 7).
- A run that finishes after its target was submitted and then closed by a send-back writes nothing (`version_closed`, W3 deferred rulings item 2). The save-draft response never waits for QC.

## 6. Run identity (W4-11a)

- Forward-only migration on `qc_run`: `runner_version text NOT NULL DEFAULT 'unrecorded'` and `rules_evaluated integer NULL` (NULL on rows written before W4a). `engine_id` keeps the runner name.
- `qc.run.started`, `qc.run.completed` and `qc.run.unavailable` gain `runner`, `runnerVersion`, `ruleRevision`, and `rulesEvaluated` on completion. `qcKind` comes from the bound runner, not a constant. W0-10's catalogue is amended in the same PR; no document text, filename or message parameter is added.
- The operator report's `unavailableQc` and `lateQc` rows gain the runner label.
- Done when two runs on the same version with different rule revisions are distinguishable from rows and log lines alone.

## 7. API and UI (W4-12)

- **Read shapes (W0-02 section 7 amendment):** `StoredFindingSummary` and `FindingWithDisposition` gain `ruleId` and `evidence: Array<{ slot, artifactId, locator }>` (locators only; `excerptHash` is not exposed and no text exists).
- **New endpoint:** `GET /api/cases/{caseId}/versions/{versionId}/qc-runs`, authorized exactly like the version's findings read (W0-05), returns the version's runs in `requested_at` order: `{ runId, trigger, lane, slot, status, unavailableReason, runner, runnerVersion, ruleRevision, rulesEvaluated, findingCount, requestedAt, completedAt }`.
- **UI:** the version view gets a "QC log" section listing every run. The reviewer workspace shows every unavailable run on the version (from any trigger, not only the lane run) above the decision controls. A finding row shows its rule label, rule ID, evidence location (slot and locator kind) and owning lane. An unavailable run and a completed run with 0 rules evaluated are each visibly different from "no findings". Thai and English keys; keyboard-only operation; axe zero critical at 1440, 834 and 390.
- Disposition flow unchanged from W2-05.

## 8. Order, owner types, branches

One ticket per branch `codex/<ticket-id>-<topic>` and per PR; each merges only after two independent reviewer verdicts on its exact head and green CI on that head, and each runs the full local suite before review.

| Order | Ticket | Owner type | Depends on | Main paths |
|---|---|---|---|---|
| 1 | W4-11a run identity | Agent-eligible | this plan | `db/migrations`, `db/schema/qc-run.ts`, `qc/orchestrator.ts`, `qc/repository.ts`, `observability/log.ts`, `observability/operator.ts`, observability docs |
| 2 | W4-02 rule catalogue | HRR | W4-11a | `shared/src/schemas/cases.ts`, `configuration/seed.ts`, `qc/deterministic/select.ts` |
| 3 | W4-03 deterministic runner and dedup | HRR | W4-02 | `qc/deterministic/runner.ts`, `qc/deterministic/rules/*`, `qc/orchestrator.ts`, locales |
| 4 | W4-13 runner selection | Agent-eligible | W4-03 | `config.ts`, `start.ts`, `compose-app-deps.ts`, `observability/health.ts`, `.env.example`, CI env, W0-02 section 5 |
| 5 | W4-04 upload trigger | HRR | W4-03, W4-13 | `pack/qc-trigger.ts`, `pack/service.ts`, `qc/orchestrator.ts`, `constants.ts` (`unavailableOwningLane` upload slot 5/9) |
| 6 | W4-12 API and UI | Agent-eligible (read shapes: contract) | W4-11a, W4-03 | `shared/src/schemas/review.ts`, `findings/routes.ts`, `web/src/screens/case/*`, locales |
| 7 | W4a exit record | Lead | all above | `changes/<date>-w4a-exit/` |

The order is serial because tickets 1-5 share the orchestrator and the migrations chain; serial merges keep every PR tested against the real main.

## 9. Test-layer map and exit evidence

| Layer | W4a adds |
|---|---|
| Unit | Each rule with below/at/above fixtures; `selectRules` template isolation (v2.0 never selects `ACC-BAND-V1-SHEET3`) and `model_type` routing; catalogue schema; config refusals for `QC_MODE`; `unavailableOwningLane` upload slot 5 → AI/COE and slot 9 → no run |
| Integration (real Postgres) | Orchestrator with the deterministic runner: submit and approve-attempt findings, dedup, replay, revision distinguishability; upload trigger: one run per changed attach, none on an unchanged save, slot-9 none, slot-5 outage owned by AI/COE, send-back-closed refusal, response not waiting; qc-runs endpoint scope (403/404 like findings) |
| Real server | A test that spawns the built server with `QC_MODE=deterministic`, submits fixture cases through HTTP and reads the stored `PACK-*` findings and runs (the W4a exit's "real runner on the real server") |
| Browser (evidence config) | QC log and unavailable-before-decision on the real server, th and en, three widths, axe, keyboard |

**W4a exit:** the W4-03 and W4-04 fixture tests and the real-server test pass from a clean checkout; the W4-12 journeys pass on the real server; readiness reports `deterministic` under `QC_MODE=deterministic`; `check:substitute-absent` passes; the record lists the rule revision, runner version and fixture set identity next to each output and states that labels are provisional until D09. Ta reviews the exit record.

## 10. In-memory API substitute revisit (W3 deferred rulings item 3)

Recorded outcome (register row "W4a kickoff rulings", Ta, 2026-09-26): **keep it through W4a and revisit at the W4b kickoff.** It serves the one remaining substitute spec (`w3-07b-operator.rehearsal.substitute.spec.ts`) and Lane B development; W4a adds no substitute routes, and every W4a UI proof runs on the real server, so the substitute is not extended. Removing it would need a real-server twin of the operator rehearsal first.

## 11. What this plan changes in other documents

- W0-02 section 5 (`QC_MODE` row) and section 7 (read shapes, new endpoint), as dated amendments.
- W0-07 section 3.5 (rule table: the W4a metadata rules and `PACK-NA-VENDOR-DOC`) and 3.9 (`production` refusal of the substitute), in the owning tickets' PRs.
- W0-10 log catalogue (section 6), in W4-11a.
- The W4 work breakdown: W4a tickets move to Ready when this plan merges; GitHub issues are opened for them then.
