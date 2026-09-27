# Specification

Source: W4a plan section 3 (the plan wins over issue #185), with the plan-review notes on the ticket.

Done when:

1. **Catalogue body** (`shared/src/schemas/cases.ts`, replacing `QcRulesBodySchema { rulesRevision }`): `{ label, templates: Record<checklistTemplateVersion, { rules: QcRuleEntry[] }> }`, each entry `{ ruleId (QC_RULE_ID_PATTERN), engine: 'metadata' | 'content', triggers: non-empty unique subset of upload / submit / approve_attempt, severity: high | medium | low, params? }`. Unknown keys are refused. Validation on write also refuses a rule ID listed twice in one template, and checks `params` per rule ID: `PACK-STAGE-MISMATCH` requires `{ attachedForbiddenAt, notYetForbiddenAt }` (stage → slots 1..9); a rule with no registered params schema carries no `params`.
2. **Seed** (`configuration/seed.ts`): `qc_rules` revision 1, label `w4a.1`, published with the other seed kinds.
   - `v1.0 Sheet3`: metadata rules `PACK-SLOT-MISSING` (submit, approve_attempt), `PACK-STAGE-MISMATCH` (submit; params `attachedForbiddenAt: { idea: [8] }`, `notYetForbiddenAt: { pre_launch: [1..8] }`), `PACK-NA-VENDOR-DOC` (submit); content rules `ACC-METRIC-CITED` (approve_attempt, upload), `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3`, `ACC-CLASSIC-ML-METRIC` (approve_attempt).
   - `v2.0`: the same without `ACC-BAND-V1-SHEET3`.
   - Severities follow W0-07 3.5 (high for `ACC-BAND-V1-SHEET3` and `ACC-EXTRACTION-NOT-HALLUCINATION`, medium otherwise); provisional until D09.
3. **Selection** (`server/src/qc/select.ts`): `selectRules(body, templateVersion, trigger, modelType)` returns the template's rules whose triggers include `trigger`, in catalogue order, without `triggers`.
   - An unknown template version throws `RuleSelectionError('unknown_template_version')`; the orchestrator records the run as `unavailable:runner_error`, never a clean pass, without calling the runner.
   - `model_type` routing: `ACC-CLASSIC-ML-METRIC` only for `classic_ml`; `ACC-METRIC-CITED`, `ACC-EXTRACTION-NOT-HALLUCINATION` and `ACC-BAND-V1-SHEET3` never for `classic_ml`.
   - `v2.0` never selects `ACC-BAND-V1-SHEET3`.
4. **Request** (`shared/src/qc/types.ts`, W0-07 3.3 amended): `QcRunRequest.rules: SelectedRule[] | null`. `null` means no `qc_rules` revision applies; `[]` means the catalogue selects nothing for this trigger (a real, zero-rule run).
5. **Revision in force** (`server/src/qc/rules-revision.ts`): the rule context of a version at an instant.
   - A submitted version reads its own frozen revision (`frozen_configuration.qc_rules`, else `configuration_revision_id`), never the current one.
   - A draft (the W4-04 upload case) reads the revision the freeze would record at that instant (published strictly before it).
   - The revision row is loaded by ID; only a row of kind `qc_rules` yields a catalogue. A version frozen before W4-02 (its ID names another kind) or an ID with no row yields `rules: null`. The recorded `rule_revision` stays the ID.
6. **Orchestrator**: builds `request.rules` from the rule context; an approve attempt on a version with no `qc_rules` revision whose runner answers `unavailable:not_configured` records that outage and is retried (the runner is called again), not replayed.
7. **Freeze consequence**: a new submit records the `qc_rules` revision as `configuration_revision_id`. `w1-05-submit.test.ts` and `configuration/seed.test.ts` updated; W0-02 7.3 and 7.6 and W0-07 3.3 get dated amendments.
8. The scripted substitute ignores `rules`. Full plan section 8 gate green.
