# W5 file-level plan: risk proposal (W5-00)

Status: plan, 2026-09-27 (W5-00). Authority: Ta's delegation of 2026-09-27. Ta asked for a working RAI review platform that streamlines the review workflow, tracks version history and shows a dashboard, on synthetic data, end to end. The agent team decides every question that would otherwise stop the build. Each such question gets two or three options and a recommendation. The recommended option is used as a **provisional choice made by the agent team under Ta's delegation of 2026-09-27**. Questions owned by someone other than Ta are not decided here. D07 (the questionnaire, rubric version and reference labels) belongs to AI/COE. For those questions this plan builds on **provisional working assumptions**: they are labelled, held in configuration and left open for their owner.

This plan must merge before any W5 code. It extends the [W0-02 file-level plan](implementation-plan-w1-w3.md), the [W4a plan](implementation-plan-w4a.md) and the [W0-04 persistence spec](persistence-and-artifact-store.md). Where it says nothing different, those apply unchanged. Synthetic data only. No external network calls. No deploy.

## 0. Scope and non-goals

W5 delivers R3 / A03 as far as it can be proved without D07:

- a versioned questionnaire and rubric held as the `risk_rubric` configuration kind and frozen on each version at submit, like `qc_rules`;
- a **SYNTHETIC PLACEHOLDER** rubric as the seed. It is never presented as the approved instrument: a banner and label appear wherever it shows, and the schema refuses any other provenance;
- questionnaire answers entered on the pack draft, attributed to the person who gave them, and frozen with the version;
- a deterministic scoring engine that records its explanation. Missing evidence stays **Unknown** and never becomes Low. A High tier displays "requires RAI Council confirmation";
- the proposal recorded at submit, append-only, and projected to `case.risk_tier`;
- reviewer, Council-note, queue and case-list display;
- a soft QC input, rule `RISK-TIER-UNKNOWN`;
- synthetic reference, boundary, PII and missing-answer tests.

All three lanes open on every submit whatever the tier. No tier grants, skips or routes anything, and no tier value blocks Ready by itself. The one effect on Ready is indirect and ordinary: an `unknown` or `unavailable` proposal adds the soft finding `RISK-TIER-UNKNOWN` (W5-10), which AI/COE must disposition (confirm or waive) before Ready like any other soft QC finding (L7). A `high`, `medium` or `low` proposal adds nothing.

**Contract changes made on purpose.** W5 changes two recorded contracts; each change is named here and in section 12 so that a reviewer can tell it from a regression:
- **Submit writes `case.risk_tier`.** Until now submit left `risk_tier` NULL (W1-05 "projections untouched by submit") and W0-06 4.3 placed the tier write "after commit" with pack QC. W5 writes it inside the submit transaction (R-4). With the placeholder seeded and the fixture drafts carrying no answers, every fixture submit now scores all-Unknown and writes `risk_tier = 'unknown'`. The tests that assert the old behaviour are rewritten in W5-05 (section 9, W5-05 row).
- **A new audit action `risk.proposed`** is written by every submit, so audit allow-lists that enumerate what a submit writes gain it (W5-05).

**Non-goals:**
- **The D07 instrument.** No question text, count threshold or reference label from the operating-model §7 summary is seeded as the approved rubric. The [evaluation plan](../evaluation/plan.md) forbids coding that summary before the approved revision exists. It is used only as an engine expressiveness test, labelled as such.
- **Answers extracted from the slot-1 document** by parsing or by a model. That needs W4b extraction plus D08 and D09; see decision R-3.
- **A model adapter.** W5 has no model port. Nothing here calls a provider.
- **Council workflow.** No Council e-vote and no Council confirmation record: a non-goal of the [PRD](../../PRD.md).
- **Reviewer override of the tier** (decision R-8).
- **Admin editing of the rubric.** That is W6: `config.publish` rows and an editor for every kind. W5 only seeds and reads.
- **Rechecking an old version under a new rubric.** The table allows it (`trigger = 'recheck'`); W6-19 writes it ([W6 plan](implementation-plan-w6.md) section 5.1).
- **Real data and networked access.**

## 1. Decisions

"Ruling" = a provisional ruling by the agent team under Ta's delegation of 2026-09-27; recorded in the register row "W5 kickoff rulings (agent team, delegated)" in the W5-00 PR, revisable by Ta. "Assumption" = a provisional working assumption for a decision owned by someone else (here D07, AI/COE), held in configuration and left open.

| # | Question | Options and trade-offs | Recommended | Kind |
|---|---|---|---|---|
| R-1 | May W5 start with D07 open? (BUILD_PLAN entry: "W4 and D07 approved") | (a) Wait for D07. _The north star is not met; R3 stays dark._ (b) Build the engine, storage and UI now against a clearly labelled synthetic placeholder rubric held in configuration; D07 later publishes a new revision. _Everything except the instrument's content is proved; there is a risk that people mistake the placeholder for the real rubric, which the banner and the provenance rule (R-2) mitigate._ (c) Build without any seed, feature dark. _Nothing to demo._ | **(b)**. The W5 gate entry is recorded as "W5 under delegation, D07 open": D07 is **not** satisfied, only worked around with a labelled placeholder. A03 stays **partial** until D07 (section 11) | Ruling (gate entry); D07 content stays open |
| R-2 | How is the placeholder kept from being read as approved? | (a) A label only. _Easy to overlook._ (b) The body carries `provenance: 'synthetic_placeholder'`; W5's schema accepts **only** that value; every surface that shows a rubric-derived value shows a banner. Publishing the D07 instrument needs a schema change (`provenance: 'd07_recorded'` plus a register reference) in its own PR. _Fail-closed: no code path in W5 can call a rubric approved._ (c) A separate feature flag. _A second switch that can drift from the data._ | **(b)** | Ruling |
| R-3 | Where do the questionnaire answers live? | (a) Structured answers on the pack draft (`pack_version.risk_answers`), entered by the owner or SPOC and frozen by the existing `pack_version_frozen` trigger. _Reuses the draft edit, versioning and freeze; versions stay immutable; history for free._ (b) Case fields. _Not versioned: a send-back would overwrite v1's inputs, breaking A07._ (c) Extracted from the slot-1 risk-screening document. _Needs W4b extraction, D08 and D09; it makes model output an input to a governance-adjacent value._ | **(a)**. Slot 1 remains the evidence the answers cite (R-5). Extraction may later *pre-fill* a draft answer that a human confirms; not in W5 | Ruling |
| R-4 | When does scoring run? | (a) Synchronously inside the submit transaction (`versions/service.ts` `submitDraft`), as a pure function of the frozen answers, the frozen rubric and the frozen slot states. _Every submitted version has exactly one proposal the moment reviewers can see it; atomic with the freeze. A bug could fail a submit, so the call is wrapped and yields `unavailable`, never an exception._ (b) Asynchronously after commit, like QC. _Decoupled, but a window with no proposal, a drain and a late-result case, all for a microsecond pure function._ (c) On every draft change, stored. _Many stored proposals for drafts; noise in history._ | **(a)**, plus a **non-recorded live preview** in the pack editor computed in the browser by the same shared function and labelled "preview, recorded at submit". This deliberately moves the tier write from W0-06 4.3 "After commit" into the submit transaction; W5-05 amends W0-06 4.3 and 9.2 and W0-04 (section 12). The tier stays a QC input, never a routing switch | Ruling |
| R-5 | What counts as "missing evidence → Unknown"? | (a) Only an unanswered question or an explicit "Unknown" answer. _Simple, but an answer with no supporting document counts fully._ (b) (a) plus a per-question `evidenceSlot`: the answer counts only when that slot is `attached` on the frozen version; otherwise the question is Unknown (`evidence_not_attached`). _Matches "missing evidence"; configurable per question._ (c) Reviewer-marked evidence adequacy. _A new human action; out of scope._ | **(b)**. The placeholder sets `evidenceSlot: 1` on every question. Whether D07's instrument ties answers to evidence is D07's call | Mechanism: ruling. Per-question values: assumption (D07) |
| R-6 | How does an Unknown answer affect the overall tier? | (a) Any Unknown makes the tier `unknown`. _Safe but uninformative: two High answers with one Unknown are High whatever the Unknown is._ (b) Exact bounds: enumerate every option of each Unknown question; if the lowest and highest possible tiers are equal, the tier is determinate, otherwise the tier is `unknown` with the range `lowest…highest`. _Exact for any rule shape (no monotonicity assumption); at most 5 options per question gives ≤ 5⁷ = 78,125 evaluations, well under 100 ms._ (c) Treat Unknown as the worst option. _Silently inflates; the displayed tier is not a proposal._ | **(b)** | Ruling (Unknown semantics are required by A03; the enumeration is engineering) |
| R-7 | What can the rubric's scoring rules express? | (a) Points summed into bands. (b) Count rules, first match wins: `tierRules` in order (high, then medium), each an OR of ANDs of `{ level, atLeast }` on exact per-level counts, then `defaultTier: 'low'`; plus per-option `escalatesTo` (for example "personal data → at least High"). _Expresses the §7 summary shape (counts, PII override) and simple bands; engine size stays small._ (c) An expression language. _Powerful but unsafe and unreviewable._ | **(b)**. A unit test proves the §7 summary shape is expressible, labelled "expressiveness only, not the approved rubric". The placeholder uses its own synthetic thresholds, chosen to be **visibly different** from the §7 summary (≥3 high for High; personal data escalates only to Medium; section 3), so nobody can read the seed as the summary coded early | Engine: ruling. Seeded thresholds, questions and labels: assumption (D07) |
| R-8 | Can a reviewer or Council confirm or override the tier in the desk? | (a) No. The proposal is display-only; disagreement is expressed through send-back feedback. _Smallest; matches "proposal, not a governance decision"; the Council stays outside (PRD non-goal)._ (b) An AI/COE "risk assessment" action recording an agreed or different tier with a reason, version-scoped and append-only. _Useful; adds a policy row, a table and UI; it is a product-scope question for the review leads._ (c) Council confirmation recorded in the desk. _Contradicts the PRD non-goals._ | **(a)**. (b) goes on the candidate backlog for the team | Ruling |
| R-9 | Tier vocabulary and labels | (a) Codes `high`, `medium`, `low` (the W0-04 CHECK and the source spec's "High") plus `unknown`; display labels come from the rubric body (`tierLabels`, th and en). (b) Tier codes defined by the rubric. _Every consumer (CHECK, Council rule, queue) becomes dynamic._ | **(a)**. `RiskTier` in `shared/src/schemas/cases.ts` becomes `'high' \| 'medium' \| 'low' \| 'unknown'`. The labels are D07's | Codes: ruling. Labels: assumption (D07) |
| R-10 | What does `case.risk_tier` hold? | (a) The latest submitted version's proposal tier, including `unknown`; NULL when that proposal is `unavailable` or no version has one. Written by the submit transaction under `rai.workflow_write`. _The source spec says the proposal "writes it to `risk_tier`"._ (b) Leave it NULL and read only the proposal table. _Diverges from the source spec's field._ | **(a)**. The CHECK gains `unknown` (migration, section 5) | Ruling |
| R-11 | How does the proposal reach QC ("a QC input")? | (a) Not at all in W5. (b) A metadata rule `RISK-TIER-UNKNOWN` (submit trigger, pack scope, owner AI/COE, severity medium) fires when the version's proposal is `unknown` or `unavailable`: a soft finding that AI/COE confirms or waives before Ready. _Missing evidence cannot pass Ready unnoticed; soft everywhere (L7)._ (c) A rule per tier. _Invents QC semantics D09 owns._ | **(b)**. The rule list and severity stay provisional until D09 | Mechanism: ruling. Rule outcome: assumption (D09) |
| R-12 | Where are the reference cases? | (a) In the fixture set (`fixtures/src/data/`). _Changes the fixture-set hash and version; conflicts with W4b and W7 fixture work._ (b) In `fixtures/src/risk/reference-cases.ts`, outside `data/`, used by unit, integration and browser tests; the loaded drafts keep empty answers. _No fixture-set bump; a draft with no answers is itself the all-Unknown case._ | **(b)**. The cases are **agent-team synthetic**, never "approved reference cases" (D07) | Ruling |
| R-13 | Free text in answers? | (a) None: answers are option values only; no comment field. _No PII can enter scoring, the audit or logs through answers._ (b) An optional comment. _A PII channel with no retention decision (D08)._ | **(a)** | Ruling |
| R-14 | How is the proposal read? | (a) Its own endpoint, `GET …/versions/{versionId}/risk-proposal`, authorized like the qc-runs read. _`SubmittedVersion` and the in-memory substitute stay unchanged._ (b) A field on `SubmittedVersion`. _Touches every version test and the substitute store._ | **(a)** | Ruling |
| R-15 | Does W5 wait for W4b? | (a) Yes, strictly serial. _Honours the "W4" entry literally; W5 waits hours to days for work it does not use._ (b) W5 runs in parallel with W4b. It depends only on W4a (merged; its exit record awaits Ta's review), and it shares files with W4b only at the points listed in section 9. _A visible deviation from the entry condition "W4 … approved"._ | **(b)**. The W5-00 register row and BUILD_PLAN status line state this deviation in words (section 12) | Ruling |
| R-16 | How does the in-memory substitute (`test:browser:substitute`) meet the two new reads? | (a) The substitute gains nothing; its router already answers an unknown route with `routeNotFound` (404), as it does today for `qc-runs` (W4-12's QC log shows its error state there and the substitute journeys pass). _Smallest, but the questionnaire is never visible in the substitute demo._ (b) The substitute gains both reads: `GET /api/configuration/risk-rubric/current` returns the server's `CONFIGURATION_SEED.risk_rubric` body, and `GET …/risk-proposal` returns `{ proposal: null }` for a submitted version (the substitute never scores) and 404 for a draft. _Two small routes; the questionnaire and its preview work in the substitute; no console 404s._ (c) The substitute scores at submit. _Duplicates W5-05 in a second store; drift risk._ | **(b)**, plus a defensive rule in the web code: a 404 on either read renders "not configured" / "no risk proposal recorded" and never blocks save, submit or any existing control, so an older substitute or database cannot break an existing journey | Ruling |
| R-17 | How does `QcRunRequest` gain the proposal (W5-10)? | (a) Required `riskProposal: { status, tier } \| null`, set by the orchestrator for every run (`null` for upload and approve-attempt runs and for versions without a proposal). _Same pattern as W4-02's `rules`; the compiler finds every builder; each builder needs one line._ (b) Optional `riskProposal?`. _No builder changes, but a missed builder silently means "no proposal"._ | **(a)**. W5-10 updates every builder the typecheck names (listed in its row). `runKey` (W0-07 3.7) is unchanged: a version's submit proposal is fixed at submit, so it adds no input identity | Ruling |

## 2. Configuration keys and fail-closed rules

**No new environment key.** W5 has no runtime switch: the engine is always bound, and whether it has something to score is decided by configuration data. `QC_MODE` and the identity modes are unchanged.

| Situation | Behaviour (fail-closed) |
|---|---|
| No `risk_rubric` revision in force at submit (a database seeded before W5-02, or a version frozen before W5) | Proposal row `status = 'unavailable'`, `unavailable_reason = 'not_configured'`, `case.risk_tier = NULL`. The submit succeeds. The UI says "no risk proposal: no rubric was in force". Never a Low |
| The frozen rubric body fails `RiskRubricBodySchema` or `riskRubricBodyProblems` on read (it was validated on publish, so this indicates corruption) | `unavailable`, `rubric_invalid` |
| The engine throws | `unavailable`, `engine_error`; the error goes to `deps.errors.internal`; the submit still commits |
| A stored answer names a question or option not in the frozen rubric (the rubric changed between answering and submit) | That question is Unknown (`not_in_rubric`); the others score normally |
| A draft save carries an answer when no rubric is in force | 422 `error.risk.not_configured` at `body.riskAnswers` |
| A draft save carries an unknown question ID or option value | 422 `validation.not_in_configured_list` at `body.riskAnswers.<questionId>` |
| A rubric body with a provenance other than `synthetic_placeholder`, a question count other than 7, a question with more than 5 options, a reserved option value `unknown`, duplicate IDs, or `tierRules` not ordered high then medium | Refused on publish (`ConfigurationBodyInvalid`, `configuration/store.ts` `validateConfigurationBody`) |
| Anyone writes `riskTier` through `PATCH /api/cases/{id}` | 422 `error.invalid_input.projected_field` (existing, W1-02); the DB trigger `rai_case_projection_gate` is the third layer |

## 3. Rubric body and engine (W5-01, W5-02)

```ts
// shared/src/schemas/cases.ts — registered in CONFIGURATION_BODY_SCHEMAS as risk_rubric (W5-02)
type Bilingual = { th: string; en: string };            // D12: Admin-owned text carries both languages in the body
type RiskLevel = 'low' | 'medium' | 'high';
type RiskRubricBody = {
  label: string;                                         // e.g. 'synthetic-placeholder.1'; never the recorded revision (the row id is)
  provenance: 'synthetic_placeholder';                   // R-2: the only value W5 accepts
  questions: Array<{                                     // exactly 7 (R3 "seven-question"); order is display order
    questionId: string;                                  // ^RQ[1-9]$ , unique
    text: Bilingual;
    help?: Bilingual;
    evidenceSlot?: SlotNumber;                           // R-5: counts only when this slot is attached on the version
    options: Array<{                                     // 2..5; 'unknown' is reserved and always offered by the UI
      value: string;                                     // ^[a-z][a-z0-9_]{0,39}$
      label: Bilingual;
      level: RiskLevel;
      escalatesTo?: 'medium' | 'high';                   // e.g. personal data → at least high
    }>;
  }>;
  tierRules: Array<{                                     // first match wins; all 'high' rules before 'medium'
    tier: 'high' | 'medium';
    anyOf: Array<{ allOf: Array<{ level: 'high' | 'medium'; atLeast: number }> }>; // exact per-level counts
  }>;
  defaultTier: 'low';
  tierLabels: Record<'high' | 'medium' | 'low' | 'unknown', Bilingual>;
};
```

**Engine** (`shared/src/risk/`, no Node or DOM imports, so the server and the web preview run the same code):
- `score.ts` `tierOf(rubric, levels)` evaluates the rule list for one fully known answer set.
- `score.ts` `scoreRisk(rubric, answers, slotStates): RiskScore` resolves each question:
  - Answered: the option's level and escalation.
  - Unknown, with a reason: `unanswered`, `explicit_unknown`, `evidence_not_attached` or `not_in_rubric`.
- It then enumerates the options of the Unknown questions to get `lowest` and `highest` (R-6), applying the maximum `escalatesTo` in each enumeration.
- It returns `{ tier, bounds, counts, matchedRule, escalation, unknownCount, questions[] }`. `tier` is the determinate tier, or `unknown` when the bounds differ.
- `ENGINE_VERSION = 'risk-engine/1'`. Any change to scoring semantics bumps it in the same PR.
- `inputs.ts` `canonicalInputs` and `inputsHash`: SHA-256 over the canonical JSON of the question IDs, answer values and evidence slot states. It excludes attribution and any text, so a reproduction can be checked.

**Placeholder seed** (`configuration/seed.ts`, kind `risk_rubric`, revision 1, label `synthetic-placeholder.1`):
- Seven invented questions. Their text is prefixed "[SYNTHETIC PLACEHOLDER]" in both languages. Topics: people affected, automation of decisions, personal data (option `yes` → `escalatesTo: 'medium'`), external exposure, vendor or model provenance, reversibility, monitoring.
- Three options each: low, medium and high.
- `evidenceSlot: 1` on every question.
- `tierRules`: High when there are ≥3 high answers; Medium when there is ≥1 high or ≥2 medium; otherwise Low.
- These thresholds are deliberately **not** the operating-model §7 summary (which reads as ≥2 high → High and personal data → High). The difference is visible on purpose, so the seed cannot be mistaken for that summary coded ahead of D07. The §7 shape appears only in the labelled expressiveness unit test (W5-01).
- `tierLabels`: plain High, Medium, Low and Unknown with Thai equivalents.
- The file header states that every value is a placeholder for D07 (AI/COE) and is not derived from the approved questionnaire.

## 4. Where it runs (W5-04, W5-05)

- **Draft answers:**
  - `pack/service.ts` `validateValues` checks `request.riskAnswers` against the rubric in force at `now` (`revisionsInForce` plus `readRevisionById`).
  - `pack/repository.ts` gains `updateDraftRiskAnswers(tx, versionId, merged)`. Each answer is stored as `{ value, answeredBy, answeredRole, answeredAt }`; `null` removes it.
  - `draft.saved` adds `risk_answers` to `changed_fields` and `risk_answers: [{ question_id, value }]` to `targetRef`. Values are enumerations, never text.
  - `workflow/repository.ts` `ensureSuccessorDraft` copies `risk_answers` from the parent, as it copies slots. Attribution stays with the original answerer until someone changes the answer.
- **Submit:**
  - In `versions/service.ts` `submitDraft` `apply`, after `freezeDraft`, the new `risk/propose.ts` `proposeAtSubmit(tx, { version, frozen, slotRows, now, correlationId })` runs:
    - reads the `risk_rubric` revision from `frozen.byKind.risk_rubric`;
    - scores it inside a try/catch;
    - inserts the `risk_proposal` row (`risk/repository.ts` `insertRiskProposal`).
  - It returns the tier for the case.
  - `versions/repository.ts` `closeDraftOnCase` gains `riskTier` in its patch; the transaction already runs under `rai.workflow_write`. Its header comment ("`risk_tier` is untouched") and the `cases/repository.ts` comment ("null throughout slice 1") are corrected in the same PR.
  - Audit `risk.proposed` follows `version.submitted` or `version.resubmitted` with the same correlation ID, before the `lane.opened` rows. `'risk.proposed'` is added to `AUDIT_ACTIONS` in `server/src/audit/store.ts` (workflow group, commented "W5-05; W0-06 9.4 amended"); without it `auditStore.append` refuses the action. `audit/store.test.ts` adds it to the names it asserts.
  - `openLanesOnSubmit` is untouched; a test proves three `lane.opened` rows for a High proposal.
- **The Ready predicate is untouched.** `workflow/ready.ts` and `authz/policy.ts` import nothing from `risk/`, and a module-graph unit test in W5-05 proves it.

## 5. Schema and migration (W5-03; forward-only, `server/drizzle/`)

One migration: `00NN_w5_03_risk.sql`, where `NN` is the next free number at merge (today `0010`; section 9). The Drizzle schema changes land in the same PR: `db/schema/pack-version.ts`, `db/schema/case.ts`, the new `db/schema/risk-proposal.ts` and `db/schema/index.ts`, plus `meta/_journal.json` and the snapshot.

```sql
-- rollback expectation: restore-required; one column, one CHECK replaced, one new table with its trigger and grant (W0-04 class; see section 9)
ALTER TABLE "pack_version" ADD COLUMN "risk_answers" jsonb NOT NULL DEFAULT '{}'::jsonb;
-- ADD COLUMN with a constant default fires no UPDATE trigger; rai_pack_version_frozen compares %ROWTYPE, so the new
-- column is frozen at submit with no trigger change. The default stays (fixture loader, successor insert).
ALTER TABLE "case" DROP CONSTRAINT "case_risk_tier_check";
ALTER TABLE "case" ADD CONSTRAINT "case_risk_tier_check"
  CHECK ("risk_tier" IS NULL OR "risk_tier" IN ('high', 'medium', 'low', 'unknown'));
CREATE TABLE "risk_proposal" (
  "id" uuid PRIMARY KEY,
  "case_id" uuid NOT NULL REFERENCES "case"("id"),
  "version_id" uuid NOT NULL REFERENCES "pack_version"("id"),
  "trigger" text NOT NULL CHECK ("trigger" IN ('submit', 'recheck')),          -- W5 writes 'submit'; 'recheck' is W6's
  "status" text NOT NULL CHECK ("status" IN ('proposed', 'unavailable')),
  "unavailable_reason" text CHECK ("unavailable_reason" IN ('not_configured', 'rubric_invalid', 'engine_error')),
  "tier" text CHECK ("tier" IN ('high', 'medium', 'low', 'unknown')),
  "lowest_tier" text CHECK ("lowest_tier" IN ('high', 'medium', 'low')),
  "highest_tier" text CHECK ("highest_tier" IN ('high', 'medium', 'low')),
  "rubric_revision_id" uuid REFERENCES "configuration_revision"("id"),         -- NULL only when not_configured
  "rubric_label" text,
  "engine_version" text NOT NULL,
  "inputs_hash" text,
  "explanation" jsonb,                                                         -- RiskScore minus attribution text; ids and enums only
  "correlation_id" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "risk_proposal_status_consistency_check" CHECK (
    ("status" = 'proposed' AND "tier" IS NOT NULL AND "rubric_revision_id" IS NOT NULL AND "unavailable_reason" IS NULL)
    OR ("status" = 'unavailable' AND "tier" IS NULL AND "unavailable_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "risk_proposal_one_submit_per_version_key" ON "risk_proposal" ("version_id") WHERE "trigger" = 'submit';
CREATE INDEX "risk_proposal_case_id_idx" ON "risk_proposal" ("case_id");
-- function rai_risk_proposal_append_only() and trigger risk_proposal_append_only BEFORE UPDATE OR DELETE
-- (as rai_qc_run_append_only / qc_run_append_only, 0006), then:
GRANT SELECT, INSERT ON "risk_proposal" TO rai_app;
```

Tests in `tests/integration/w5-03-risk-migration.test.ts`:
- updating `risk_answers` on a submitted version raises `rai.frozen_version`;
- an UPDATE or DELETE on `risk_proposal` raises;
- writing `risk_tier = 'unknown'` outside `rai.workflow_write` raises `rai.projection_write_forbidden`;
- the second submit proposal on a version violates the unique index.

Existing tests changed on purpose in the same PR (they assert the exact schema with `deepEqual`, so the new objects would fail them otherwise):
- `tests/integration/w1-00-migrations.test.ts`: the table list gains `'risk_proposal', // W5-03`; the trigger list gains `'risk_proposal.risk_proposal_append_only', // W5-03`; the `rai_app` grant list gains `'risk_proposal:INSERT', // W5-03: append-only` and `'risk_proposal:SELECT'` (alphabetical position, between `registry_counter` and `session`). `rai_operator` gains nothing. `pack_version:UPDATE` already covers the new column, so no grant changes there.
- `tests/support/db.ts` `BUSINESS_TABLES` gains `'risk_proposal', // W5-03` before `'qc_finding'`. Not strictly required (the TRUNCATE is `CASCADE`), but it keeps the list the explicit inventory of business tables.
- `server/src/db/schema/case.ts`: the `case_risk_tier_check` expression gains `'unknown'`, so the Drizzle snapshot matches the SQL.

The W0-04 spec rows are amended in the same PR: `risk_tier` values `high`, `medium`, `low`, `unknown` or NULL (writer text is completed by W5-05, section 12); `pack_version.risk_answers`; the new `risk_proposal` entity.

## 6. API shapes and authorization (W0-02 section 7 amendments)

| Change | Shape | Authorization |
|---|---|---|
| `PackDraft` (7.5) | `+ riskAnswers: Record<RiskQuestionId, { value: string; answeredBy: SubjectId; answeredByName?: string; answeredRole: Role; answeredAt: string }>` (`value` is an option value or `'unknown'`) | As the draft read |
| `PackDraftUpdateRequest` (7.5) | `+ riskAnswers?: Record<RiskQuestionId, string \| null>` (`additionalProperties: false`, ≤ 20 keys) | `case.edit_draft` (owner, BU SPOC); reviewers and Admin never write |
| `GET /api/configuration/risk-rubric/current` (new) | `200 { revisionId, label, provenance, publishedAt, body: RiskRubricBody }`; `404 not_found` (`risk_rubric`) when none is in force | `config.read_effective` (every role; the body holds no addresses) |
| `GET /api/cases/{caseId}/versions/{versionId}/risk-proposal` (new, `risk/routes.ts`) | `200 { proposal: RiskProposalView \| null }` (`null` for a version submitted before W5); 404 for a draft, malformed, unknown or other-case version | `version.view` on the case, then the qc-runs 404 rule (`findings/routes.ts` pattern); scoped per W3-F8 |
| `CaseView.riskTier` (7.3) | `RiskTier \| null`, where `RiskTier = 'high' \| 'medium' \| 'low' \| 'unknown'` (the W0-02 placeholder is replaced, R-9) | Unchanged; still a projected field, never writable |
| `QueueItem` (W3-01), `CaseSummary` | `+ riskTier: RiskTier \| null` (W5-09) | Unchanged scope |

```ts
interface RiskProposalView {
  proposalId: string; versionId: string; trigger: 'submit' | 'recheck';
  status: 'proposed' | 'unavailable';
  unavailableReason: 'not_configured' | 'rubric_invalid' | 'engine_error' | null;
  tier: RiskTier | null;
  bounds: { lowest: 'high' | 'medium' | 'low'; highest: 'high' | 'medium' | 'low' } | null;
  councilConfirmation: 'required' | 'possible' | 'not_indicated'; // required: tier high; possible: unknown with highest high
  rubric: { revisionId: string; label: string; provenance: 'synthetic_placeholder';
            questions: RiskRubricBody['questions']; tierLabels: RiskRubricBody['tierLabels'] } | null; // the frozen revision, not today's
  engineVersion: string; inputsHash: string | null; createdAt: string;
  explanation: {
    questions: Array<{ questionId: string; status: 'answered' | 'unknown';
      unknownReason?: 'unanswered' | 'explicit_unknown' | 'evidence_not_attached' | 'not_in_rubric';
      value?: string; level?: RiskLevel; escalatesTo?: 'medium' | 'high';
      answeredBy?: SubjectId; answeredByName?: string; answeredRole?: Role; answeredAt?: string;
      evidence?: { slot: SlotNumber; state: SlotStateName } }>;
    counts: Record<RiskLevel, number>; matchedRule: { tier: 'high' | 'medium'; index: number } | 'default' | null;
    escalation: { questionId: string; to: 'medium' | 'high' } | null; unknownCount: number;
  } | null;
}
```

No new policy row: the table in `authz/policy.ts` stays as it is. A unit test asserts that no `ACTIONS` entry mentions risk and that no row lets any role write it.

## 7. UI (W5-07, W5-08, W5-09)

**Placeholder banner.** A shared component, `web/src/components/placeholder-rubric-banner.tsx`, with `role="note"`. It is shown wherever rubric text or a tier appears while `provenance = 'synthetic_placeholder'`: "Synthetic placeholder questionnaire: not the approved AI/COE instrument (D07 open). Tiers shown are for demonstration."

**Missing routes and the substitute (R-16).** Both reads are optional to the rest of the screen. A 404 from `GET /api/configuration/risk-rubric/current` hides the questionnaire behind a one-line "risk questionnaire not configured" note; a 404 from the proposal read shows "no risk proposal recorded for this version". Neither state is an error banner, and neither disables save, submit, upload, approve or send-back. The in-memory substitute gains both reads (W5-07 adds the rubric read, returning `CONFIGURATION_SEED.risk_rubric`; W5-08 adds the proposal read, returning `{ proposal: null }`), so `test:browser:substitute` journeys keep passing unchanged and show the questionnaire. A unit test on each view model covers the 404 path.

**Pack editor** (`screens/case/risk-questionnaire.tsx`, mounted by `pack-editor.tsx`):
- Seven `fieldset`/`legend` radio groups. Each offers the rubric options plus "Unknown / not yet known" and a "clear" button.
- The evidence hint names the cited slot and its current state.
- Answers save through the existing save-draft request.
- A live preview uses `scoreRisk` and is labelled "Preview: the proposal is recorded when you submit".
- Keyboard: native radio behaviour. No colour-only meaning.

**Version view** (`screens/case/risk-proposal.tsx`, mounted in `case-screen.tsx` above `PackFrozen`):
- Heading "Risk proposal (desk proposal, not a governance decision)".
- The tier badge, with the tier's text label always visible.
- For `unknown`: "Unknown: N questions lack an answer or evidence; the tier could be {lowest}–{highest}".
- For `required`: a Council notice "High: requires RAI Council confirmation. The desk does not record Council decisions. All three lanes remain active."
- For `possible`: the same notice as "may require".
- An explanation table (question, answer, level, escalation, answered by and at, evidence slot and state), then the rubric label and revision ID, the engine version and the banner.
- `unavailable` renders its reason and is never styled as Low.

**Elsewhere:**
- **Reviewer workspace** (`reviewer-workspace.tsx`): a compact tier line and the Council notice above the decision controls, the same place W4-12 put unavailable QC.
- **Case overview** (`case-overview.tsx`): a "Proposed risk tier" fact with the placeholder marker.
- **Queue and case list** (`screens/queue/queue-screen.tsx`, `screens/cases/case-list-screen.tsx`): a tier chip on each card. No tier filter in W5; the tier filter and the dashboard's tier counts are W6's (W6-14 and W6-16 in the [W6 plan](implementation-plan-w6.md); consolidated 2026-09-27).

**Locale keys** (th and en, `shared/src/locales/{th,en}.json` plus `keys.ts`) are under `risk.*`:
- `risk.heading`, `risk.not_governance`;
- `risk.tier.{high,medium,low,unknown}` (fallbacks; the rubric's `tierLabels` win);
- `risk.unknown.range`;
- `risk.council.required`, `risk.council.possible`;
- `risk.unavailable.{not_configured,rubric_invalid,engine_error}`;
- `risk.unknown_reason.{unanswered,explicit_unknown,evidence_not_attached,not_in_rubric}`;
- `risk.answer.unknown`, `risk.answer.clear`;
- `risk.preview.label`, `risk.placeholder.banner`;
- `risk.evidence.hint`, `risk.explanation.*` column headers;
- `error.risk.not_configured`;
- `qc.finding.risk_tier_unknown` and the rule label key for `RISK-TIER-UNKNOWN` (W5-10).

Dates render in Asia/Bangkok. The bar is W4-12's: keyboard-only operation, axe zero critical at 1440, 834 and 390, and th and en both exercised.

## 8. Logs, audit and QC input

- **Log events** (the `observability/log.ts` `EVENT_CATALOGUE` and the W0-10 catalogue, amended in W5-05):
  - `risk.proposal.recorded` (info): `proposalId`, `caseId`, `versionId`, `status`, `tier`, `rubricRevision`, `engineVersion`, `unknownCount`, `durationMs`.
  - `risk.proposal.unavailable` (error): `proposalId`, `caseId`, `versionId`, `reason`, `rubricRevision?`.
  - Neither carries an answer value, question text or name.
- **Audit:**
  - `risk.proposed`, in the submit transaction: `targetRef { proposal_id, status, tier, lowest_tier, highest_tier, unknown_count, rubric_revision_id, rubric_label, engine_version, inputs_hash }`.
  - `draft.saved` gains its `risk_answers` refs (section 4).
- **QC input (W5-10):**
  - `QcRunRequest` (`shared/src/qc/types.ts`, amending W0-07 3.3) gains the **required** field `riskProposal: { status, tier } | null` (R-17), loaded by `qc/orchestrator.ts` for submit runs and `null` on upload and approve-attempt runs. `runKey` is unchanged.
  - Under `QC_MODE=content` (W4b decision 27) `RISK-TIER-UNKNOWN` runs in the metadata part (the W4a deterministic runner), which receives the same request; the content part ignores it.
  - Every builder of a `QcRunRequest` literal sets it (one line each). Builders W4b adds before W5-10 merges (`server/src/qc/request.ts`, the content runner's unit tests, `tests/evaluation/`) are in the same list; a W4b builder written after W5-10 sets it itself (W4b plan section 15.2). Today these are: `server/src/qc/orchestrator.ts`, `server/src/qc/deterministic/request-builder.test-helper.ts`, `server/src/qc/select.test.ts`, `server/src/qc/deterministic/{runner,rules}.test.ts`, `fixtures/src/substitutes/qc/test-support.ts`, `tests/support/fixtures/{late-submit-scenario,submit-binding-scenario}.ts`, `tests/browser/support/journey-runner.ts`, `tests/performance/launcher.test.ts` and the integration tests that build requests (`w2-05-owning-lane`, `w2-05-dispositions`, `w4-02-rule-catalogue`, `w4-03-deterministic-runner`, `w4-04-upload-trigger`, `w4-11a-run-identity`). Files that only import the type are untouched. `npm run typecheck` is the authority for the final list.
  - New rule `qc/deterministic/rules/risk-tier-unknown.ts`: pack scope, owning lane AI/COE, fires on `unknown` or `unavailable`, never on `null` (versions before W5).
  - The seed's `qc_rules` body adds it with `engine: 'metadata'`, `triggers: ['submit']`, `severity: 'medium'`, and its label moves from `w4a.1` to `w5.1`.
  - W0-07 3.5 gains the row. The scripted substitute ignores `rules`, so CI journeys under `QC_MODE=substitute` are unaffected.

## 9. Tickets, order and parallelism

One ticket per branch `codex/<ticket-id>-<topic>` and per PR. Each PR merges only after two independent reviewer verdicts on its exact head and green CI on that head. Each keeps the whole suite green.

| Order | ID | Outcome | Done when | Owner type | Lane | Depends on | Main paths | Migr. |
|---|---|---|---|---|---|---|---|---|
| 0 | W5-00 | This plan; the "W5 kickoff rulings (agent team, delegated)" register row; a D07 brief for AI/COE listing exactly what their instrument must supply (questions, options, levels, rules, labels, evidence ties, reference cases) | Plan merged; the register row cites Ta's 2026-09-27 delegation and states both gate deviations in words: "D07 open and not satisfied (synthetic placeholder only)" and "W4 entry partly met: W4a merged, its exit record awaiting Ta's review; W4b runs in parallel (R-15)"; the BUILD_PLAN W5 status line says the same | Lead (HRR) | docs | W4a exit | `docs/engineering/implementation-plan-w5.md`, `docs/product/decisions.md`, `BUILD_PLAN.md`, `docs/delivery/later-packages-outline.md` | no |
| 1 | W5-01 | Rubric schema and pure engine | `RiskRubricBodySchema`, `riskRubricBodyProblems`, `scoreRisk`, `tierOf`, `inputsHash` with unit tests: each rule boundary below/at/above, bounds enumeration, escalation, every unknown reason, §7-shape expressiveness (labelled), no Node/DOM imports | HRR | A | W5-00 | `shared/src/risk/{score,inputs,types}.ts` (+ tests), `shared/src/schemas/cases.ts` (schema only, not yet registered) | no |
| 1 ∥ | W5-03 | Migration and Drizzle schema | Holds the `MIGRATION-SLOT` claim while in review; header class `restore-required`; section 5 tests pass; `w1-00-migrations.test.ts` table, trigger and `rai_app` grant lists updated as section 5 states; `tests/support/db.ts` `BUSINESS_TABLES` lists `risk_proposal`; W0-04 amended | Agent-eligible | A | W5-00 | `server/drizzle/00NN_w5_03_risk.sql`, `meta/*`, `db/schema/{pack-version,case,risk-proposal,index}.ts`, `tests/integration/w1-00-migrations.test.ts`, `tests/integration/w5-03-risk-migration.test.ts`, `tests/support/db.ts`, `docs/engineering/persistence-and-artifact-store.md` | **yes** |
| 2 | W5-02 | Register the kind, seed the placeholder, rubric read endpoint | `validateConfigurationBody` accepts `risk_rubric`; seed revision 1 `synthetic-placeholder.1`; `seed.test.ts` (the "no body schema" assertion for `risk_rubric`) and `w1-00-configuration.test.ts` updated; `w1-05-submit` still passes (the freeze records `risk_rubric` in `frozen_configuration`; `configuration_revision_id` stays the `qc_rules` ID); endpoint 200/404 tests | Agent-eligible | A | W5-01 | `shared/src/schemas/cases.ts`, `configuration/{store,seed}.ts`, `cases/routes.ts` (the config route) | no |
| 3 | W5-04 | Draft answers | Save, clear and validation (422 paths) integration tests; attribution; audit refs; successor copy (`w2-03-successor-draft` extended); substitute store typed with `riskAnswers: {}` | Agent-eligible (contract: W0-02 7.5) | A | W5-02, W5-03 | `shared/src/schemas/pack.ts`, `pack/{service,repository}.ts`, `workflow/repository.ts`, `fixtures/src/substitutes/api/store.ts` | no |
| 4 | W5-05 | Proposal at submit | Integration (`w5-05-risk-submit.test.ts`): none, partial and all answers; `evidence_not_attached`; not_configured (rubric absent); injected engine error still commits; `case.risk_tier` on submit and resubmit; High opens three lanes; a Low-tier case with no approvals is not Ready; module-graph test; log lines and audit; `RiskTier` widened with `unknown`. **Intended changes to existing tests, each named in the PR:** (1) `w1-05-submit.test.ts` 497-512: `risk_tier` leaves the "untouched by submit" `PROJECTIONS` check; the test is renamed "…the three lane projections stay pending, readiness not_ready; risk tier is the recorded proposal" and asserts `risk_tier = 'unknown'` and `view.riskTier = 'unknown'` (no answers under the placeholder); (2) `w1-05-submit.test.ts` 974-981: the allow-list gains `'risk.proposed'`; (3) `w2-01-lanes.test.ts` 299-317: the raw `UPDATE … risk_tier = 'high'` precondition is replaced by saving three high answers through the draft (slot 1 attached), then asserting the proposal and `case.risk_tier` are `high` and three `lane.opened` rows exist; (4) `audit/store.test.ts` names `risk.proposed`. Any other failing assertion is a regression, not a contract change. W0-06 4.3 and 9.2 and the W0-04 `risk_tier` writer amended | HRR | A | W5-04 | `server/src/risk/{propose,repository}.ts`, `versions/{service,repository}.ts`, `cases/repository.ts` (comment), `audit/store.ts` (+ test), `shared/src/schemas/cases.ts`, `observability/log.ts`, `tests/integration/{w1-05-submit,w2-01-lanes}.test.ts`, W0-06, W0-04 and W0-10 docs | no |
| 5 | W5-06 | Proposal read endpoint | 200, null, 403 and 404 matrix as for qc-runs; the frozen rubric is returned even after a newer rubric revision is published | Agent-eligible | A | W5-05 | `server/src/risk/routes.ts`, `app.ts` (register), `shared/src/schemas/risk.ts` | no |
| 5 ∥ | W5-07 | Questionnaire UI in the pack editor | Unit tests for the view model, including the 404 "not configured" path; browser `w5-07-risk-questionnaire.spec.ts` (answer, clear, preview, banner; th/en; axe; keyboard); the substitute serves the rubric read (R-16) and every existing `test:browser:substitute` journey still passes | Agent-eligible | B | W5-04 | `web/src/screens/case/risk-questionnaire.tsx`, `pack-editor.tsx`, `web/src/api/client.ts`, `components/placeholder-rubric-banner.tsx`, `fixtures/src/substitutes/api/routes-*.ts`, locales | no |
| 6 | W5-08 | Proposal display: version, reviewer, overview | Browser `w5-08-risk-panel.spec.ts`: High shows the Council notice while all three reviewer workspaces stay active; Unknown shows its range; unavailable is not Low; th/en; axe at three widths; the 404 path renders "no risk proposal recorded"; the substitute serves the proposal read as `{ proposal: null }` (R-16) | Agent-eligible | B | W5-06, W5-07 | `web/src/screens/case/{risk-proposal,case-screen,reviewer-workspace,case-overview}.tsx`, `fixtures/src/substitutes/api/routes-versions.ts`, locales | no |
| 6 ∥ | W5-09 | Tier on queue and case list | `QueueItem`/`CaseSummary.riskTier`; `queue/repository.ts` select; card chip; `w3-01-queue` still scoped | Agent-eligible | B (small A read) | W5-05 | `shared/src/schemas/{queue,cases}.ts`, `queue/repository.ts`, `cases/repository.ts`, `screens/queue/*`, `screens/cases/*`, locales | no |
| 7 | W5-10 | `RISK-TIER-UNKNOWN` QC input | Rule fixtures (proposed/unknown/unavailable/null); orchestrator passes the required `riskProposal` (R-17) and every `QcRunRequest` builder listed in section 8 sets it; typecheck green; seed label `w5.1`; `w4-02`/`w4-03` label assertions and `w4a-int-deterministic-server` expectations updated; W0-07 3.3/3.5 | HRR | A | W5-05; after any in-flight W4b ticket touching `qc/orchestrator.ts` or the `qc_rules` seed | `shared/src/qc/types.ts`, `qc/orchestrator.ts`, `qc/deterministic/rules/*`, `configuration/seed.ts`, `shared/src/qc/rule-registry.ts` (if W6-03 merged), the builder files in section 8 (including W4b's), locales | no |
| 8 | W5-11 | Reference and A03 evidence | `fixtures/src/risk/reference-cases.ts` (≥2 synthetic reference cases, plus boundary, PII-escalation, all-unknown, evidence-missing and not-in-rubric cases with expected tiers); `tests/integration/w5-11-risk-reference.test.ts` over HTTP on the real server; browser `w5-int-risk-journey.spec.ts` (owner answers → submit → three reviewers see the proposal → send-back → v2 answers differ → v1 proposal unchanged) | Agent-eligible | C | W5-08, W5-10 | `fixtures/src/risk/*`, `tests/integration/`, `tests/browser/`, `TESTING.md` | no |
| 9 | W5-EXIT | Exit record | Section 11 evidence listed with identities; A03 marked partial pending D07 | Lead | docs | all | `changes/<date>-w5-exit/` | no |

**Parallelism inside W5.**
- W5-01 runs alongside W5-03.
- W5-06 runs alongside W5-07.
- W5-08 runs alongside W5-09.
- Everything else is serial on the A lane, because the tickets share `versions/service.ts`, `pack/service.ts` and the shared schemas.

**Parallelism with other packages** (R-15). W5 lanes A and B can run next to W4b and W6 when these shared-file rules are followed:

| Shared file | Conflict | Rule |
|---|---|---|
| Migration numbering, `server/drizzle/meta/_journal.json`, snapshots and `tests/integration/w1-00-migrations.test.ts` | W4b, W6 and W7 add migrations | A number is taken at merge, not at branch. Only **one migration PR across all packages** is in review at a time, under the `MIGRATION-SLOT` claim on `docs/board/lane-lead-integration.md`, released at merge. The second PR rebases, renames its SQL file to the next number and regenerates `meta/` with `npm run migrate:generate`; `w1-00-migrations.test.ts` lists are merged as a union. It never edits a merged migration. W5 has exactly one migration (W5-03), so it takes the slot early. **Rollback class (W7-03, consolidated):** the W5-03 header reads `-- rollback expectation: restore-required;` (not "forward repair only"): once a submit writes `risk_tier = 'unknown'`, an older binary cannot serialize that value, so rolling back past W5-03 means restoring a backup. If W7-03 has merged, W5-03 also adds its `MIGRATION_CLASSES` entry |
| `shared/src/locales/{th,en}.json`, `keys.ts` | Every UI ticket in every package | Add keys in alphabetical blocks under a package prefix (`risk.*`). Rebase and resolve by union; the locale parity test catches drops |
| `configuration/seed.ts` and `shared/src/schemas/cases.ts` (`CONFIGURATION_BODY_SCHEMAS`, `ConfigurationBodies`) | W4b (content-rule params in W4-06a-d, label in W4-13c), W6-02 (`desk_controls`, `UNSEEDED_KINDS`, seed type) | W5-02 adds the kind (if W6-02 merged first, `risk_rubric` is a seeded kind, so `ConfigurationSeed` requires it and `seed.test.ts`'s by-kind list gains it). W5-10 changes the `qc_rules` body: it merges only when no W4b ticket touching the seed is open, or rebases after it. **Label rule (consolidated with the W4b plan section 3.3):** the label names the last ticket that changed the seeded body; whichever of W5-10 and W4-13c merges second keeps the other's rules, sets its own label (`w5.1` or `w4b.1`) and updates the label assertions |
| `shared/src/qc/rule-registry.ts` (W6-03) | W6 publish validation | `RISK-TIER-UNKNOWN` must be in `IMPLEMENTED_RULES` (`metadata`, `['submit']`); whichever of W5-10 and W6-03 merges second adds it (W6 plan section 11.2) |
| `qc/orchestrator.ts`, `shared/src/qc/types.ts` | W4b (extraction, content runner, dedup) | Only W5-10 touches them; it is scheduled last on the A lane |
| `configuration/store.ts` `validateConfigurationBody` | W6 publish API | W5-02 adds one `if (kind === 'risk_rubric')` branch like `qc_rules`; W6 builds on it |
| `queue/repository.ts`, queue schemas | W6 dashboard and drill-down (W6-13, W6-14, W6-16) | W5-09 adds one column only. Dashboard aggregates and the `riskTier` queue filter are W6's (consolidated 2026-09-27: the desk dashboard is a W6 ticket group under Ta's delegation); W6-14 adds its filters beside W5-09's column |

## 10. Commands

Every ticket runs the gate from a clean worktree with its own Postgres (`POSTGRES_PORT=<port> docker compose -p <project> up -d --wait`; `rai-web/.env` from `.env.example` with the ports rewritten), and the PR states each result:

```bash
cd rai-web
npm ci
npm run lint && npm run typecheck
npm run test:unit
npm run test:integration
npm run build && npm run check:substitute-absent
npm run test:browser:server
npm run test:browser:substitute
cd .. && node scripts/check-links.mjs && git diff --check
```

- W5-03 also runs `npm run reset` to prove the migration applies on a fresh database with the fixtures loaded.
- `check:substitute-absent` must still pass: `fixtures/src/risk/` is test data and never imported by `server/src`.
- No new npm script is added.

## 11. Test-layer map and exit evidence

| Layer | W5 adds |
|---|---|
| Unit | <ul><li>Engine: every `tierRules` boundary below/at/above; escalation (PII) overriding counts; bounds enumeration; each unknown reason; all seven unknown; determinate-despite-unknown; `inputsHash` stability; §7-shape expressiveness (labelled).</li><li>Schema problems: count ≠ 7, >5 options, reserved `unknown`, duplicate IDs, misordered rules, non-placeholder provenance.</li><li>Module graph: `shared/src/risk` is DOM/Node-free; `workflow/` and `authz/` import no risk module.</li><li>No policy row for risk.</li><li>Web view models.</li></ul> |
| Integration (real Postgres) | <ul><li>Migration guards.</li><li>Draft answers: validation, attribution, audit, successor copy.</li><li>Submit proposal: each status; `case.risk_tier`; High keeps three lanes; tier never affects Ready; resubmit writes a new proposal and v1's stays readable and unchanged (A07).</li><li>The endpoint's 403/404 matrix.</li><li>Logs carry no answer values or names (PII).</li><li>`RISK-TIER-UNKNOWN` findings under the deterministic runner.</li></ul> |
| Real server | `w5-11-risk-reference.test.ts` spawns `server/src/main.ts` like `w4a-int-deterministic-server.test.ts`, with `QC_MODE=deterministic` |
| Browser (evidence config) | `w5-07`, `w5-08` and the `w5-int-risk-journey` on the real server; th and en; 1440, 834 and 390; axe; keyboard. The real-server browser suite pins `QC_MODE=substitute` (`tests/browser/support/real-server-lifecycle.ts`, `tests/support/process.ts`), so these specs prove the proposal and its display but **not** `RISK-TIER-UNKNOWN`; that finding's evidence comes only from the `w5-11` real-server test under `QC_MODE=deterministic` and the W5-10 integration tests |

**W5 exit** records:
- the rubric revision ID and label (`synthetic-placeholder.1`), `ENGINE_VERSION` and the identity of the reference-case file (git blob hash);
- each reference case's expected and actual tier, bounds and matched rule;
- the command results;
- a statement that the placeholder is not the D07 instrument and that A03's "approved reference cases" and "reviewer acceptance" are **not met** until AI/COE records D07.

A03 is therefore **partial**: the mechanism is proven, the content pending. Ta reviews the exit record.

## 12. What this plan changes in other documents

Each amendment is dated and lands in the named ticket's PR:
- `docs/product/decisions.md`: recorded by the consolidated planning change [2026-09-27-w4b-w7-plans](../../changes/2026-09-27-w4b-w7-plans/intent.md) as the rows "Ta's delegation (2026-09-27)" (the gate entry) and "W5 delegated rulings (provisional)" (R-1 to R-17, with the D07 and D09 working assumptions labelled as such), in place of the "W5 kickoff rulings (agent team, delegated)" row first planned here. D07 stays in Open decisions, with a pointer to the D07 brief.
- `BUILD_PLAN.md` W5 status line (W5-00): "in progress under Ta's delegation of 2026-09-27. Entry deviations, both deliberate: D07 open and not satisfied (a labelled synthetic placeholder rubric stands in); W4 entry partly met (W4a merged, exit record awaiting Ta's review; W4b in parallel)". The exit status goes in with W5-EXIT.
- `docs/delivery/later-packages-outline.md` W5 row: link to this plan (W5-00).
- W0-04 (`persistence-and-artifact-store.md`): the `risk_tier` row (line 126) becomes "`high`, `medium`, `low`, `unknown` or NULL" (W5-03) and its writer text becomes "written only inside the submit transaction by the W5 risk proposal (`unknown` when evidence is missing; NULL when the proposal is `unavailable` or the version predates W5); never editable by owner or SPOC" (W5-05); `pack_version.risk_answers` and the `risk_proposal` entity (W5-03).
- W0-06 (`workflow-transition-and-error-contract.md`), amended in W5-05:
  - 4.3: the sentence "The proposed risk tier is written to `risk_tier` …" moves from the "After commit" row to the in-transaction steps: after the freeze, the transaction records the `risk_proposal` row, writes `case.risk_tier` and appends `risk.proposed`; still a QC input, never a routing switch. The resubmit section (4.9) inherits it.
  - 9.2: the closing note is changed to say the tier is written by the submit transaction (not by pack QC after commit), and that `pack_version.risk_answers` is one of the columns the freeze covers through the existing whole-row comparison.
  - 9.4: the audit action list gains `risk.proposed`.
- W0-02 (`implementation-plan-w1-w3.md`):
  - 7.3: `RiskTier` placeholder replaced and `riskTier` on `CaseSummary` (W5-05, W5-09).
  - 7.5: `riskAnswers` (W5-04).
  - Section 7: the two new endpoints (W5-02, W5-06).
- W0-07 (`qc-boundary-and-mail-sink.md`) 3.3 (`riskProposal`) and 3.5 (`RISK-TIER-UNKNOWN`) (W5-10).
- W0-10 (`observability-contract.md`): the two `risk.proposal.*` events (W5-05).
- `docs/acceptance.md` A03: a note that the synthetic mechanism evidence exists and approved-content evidence waits for D07 (W5-EXIT).
- `docs/evaluation/plan.md` "Risk proposal": the reference-case file location and that it is agent-team synthetic (W5-11).
- `TESTING.md`: a W5 paragraph (W5-11).
- The candidate backlog in `later-packages-outline.md`: the R-8 option (b) reviewer tier assessment and a queue tier filter (W5-00).

## 13. Plan review

Round 1 (two reviewer agents). Each blocker, and how this revision resolves it; every code fact was re-checked against `rai-web` on 2026-09-27.

| # | Blocker | Resolution |
|---|---|---|
| 1a | Seeding the placeholder makes every fixture submit write `risk_tier = 'unknown'`, breaking `w1-05-submit.test.ts` 497-512 ("risk tier null", `risk_tier` in `PROJECTIONS`) and `w2-01-lanes.test.ts` 299-317 (raw `risk_tier = 'high'` expected to survive submit) | Section 0 now names the contract change. The W5-05 row lists both tests as **intended** changes with their new assertions: `w1-05` asserts `unknown`; `w2-01` reaches `high` through three saved high answers instead of a raw UPDATE that submit would overwrite. Any other failing assertion is to be treated as a regression |
| 1b | `risk.proposed` breaks the `w1-05` allow-list (974-981) and is not in `AUDIT_ACTIONS` | Section 4 adds it to `AUDIT_ACTIONS` in `server/src/audit/store.ts` (the store refuses unknown actions) and to `audit/store.test.ts`; the W5-05 row names the allow-list change; W0-06 9.4 gains the action (section 12) |
| 1c | R-4 contradicts W0-06 4.3 "After commit" and the 9.2 note; W0-04 `risk_tier` row lacks `unknown` and the in-transaction writer | R-4 now states the move on purpose; section 12 lists the exact W0-06 4.3, 9.2 and 9.4 amendments and both halves of the W0-04 row amendment (values in W5-03, writer in W5-05); the W5-05 Done-when requires them |
| 2 | W5-03 named `w3-07a-migration-contract.test.ts`, which has no grant assertions; `w1-00-migrations.test.ts` asserts tables, triggers and grants with `deepEqual` | Section 5 and the W5-03 row now name `w1-00-migrations.test.ts` with the exact entries to add (table, `risk_proposal.risk_proposal_append_only`, `risk_proposal:INSERT` and `:SELECT`), plus `tests/support/db.ts` `BUSINESS_TABLES`; the trigger and function names are fixed in the SQL sketch |

Notes taken:
- **Gate honesty:** the W5-00 register row and the BUILD_PLAN status line state both deviations in words (D07 open and not satisfied; W4 entry partly met with W4b in parallel), R-1 and R-15 updated.
- **Placeholder thresholds:** changed to be visibly different from the §7 summary (≥3 high for High, ≥2 medium for Medium, personal data escalates only to Medium); the §7 shape lives only in the labelled expressiveness test.
- **Section 0 wording:** now says exactly that an `unknown` or `unavailable` proposal adds a dispositionable soft finding and that no tier value blocks, grants or routes by itself.
- **Substitute gate:** new ruling R-16; the substitute gains both reads, and the web code treats a 404 on either as "not configured" / "no proposal recorded" without disabling any existing control.
- **Test mode:** section 11 says the real-server browser suite pins `QC_MODE=substitute`, so `RISK-TIER-UNKNOWN` evidence comes from `w5-11` and the W5-10 integration tests only.
- **`QcRunRequest` field:** new ruling R-17 makes `riskProposal` required (the W4-02 `rules` pattern) and lists every builder W5-10 updates; `runKey` unchanged.

Round 2 (two reviewer agents): PASS and PASS.

Cross-plan consolidation (2026-09-27, the W4b, W5, W6 and W7 plans read together; no reviewer blocker, recorded here because it changes this plan):

- **Dashboard ownership.** The tier filter and dashboard aggregates are W6's (W6-13 to W6-16), not W7's (sections 7 and 9). W6-19 writes the reserved `risk_proposal.trigger = 'recheck'`. This is a provisional agent-team choice under Ta's delegation of 2026-09-27.
- **Migration rule.** One migration PR across all packages under `MIGRATION-SLOT`; `w1-00-migrations.test.ts` is serialized by it; the W5-03 header uses the W0-04 class `restore-required`, and W5-03 adds its `MIGRATION_CLASSES` entry if W7-03 has merged (sections 5 and 9).
- **`qc_rules` seed label.** The label names the last ticket that changed the seeded body; whichever of W5-10 and W4-13c merges second sets its label and updates the assertions (section 9; W4b plan section 3.3).
- **Registry.** `RISK-TIER-UNKNOWN` enters W6-03's `IMPLEMENTED_RULES` (section 9).
- **Two run parts.** Under `QC_MODE=content`, `RISK-TIER-UNKNOWN` runs in the metadata part; W4b's request builders are in W5-10's list (section 8).
- **Seed type.** If W6-02 merged first, `risk_rubric` becomes a required seeded kind in `ConfigurationSeed` and joins `seed.test.ts`'s by-kind list (section 9).
- **Register rows.** Recorded by the consolidated planning change as "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)" (section 12).
