# Spec: publish validation on the Admin paths and the implemented-rule registry (W6-03, #223)

Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 2.4 and row W6-03 (the plan wins over issue #223).

## Registry (`rai-web/shared/src/qc/rule-registry.ts`)

- `IMPLEMENTED_RULES: Readonly<Record<string, ImplementedRule>>`, `ImplementedRule = { engine: QcRuleEngine; triggers: readonly QcTrigger[]; templates?: readonly string[] }`. Static, in shared (shared cannot import server code).
- Metadata entries: exactly the keys of `METADATA_RULES` (`server/src/qc/deterministic/rules/index.ts`), each with that rule's `triggers`. A server unit test (`server/src/qc/rule-registry.test.ts`) asserts both, so the two cannot drift.
- Content entries: the four catalogued `ACC-*` rules as `engine: 'content'` with the triggers the W4a catalogue gives them, until W4b replaces them. `ACC-BAND-V1-SHEET3` has `templates: ['v1.0 Sheet3']` (L12).
- `PACK-CONTRADICTION` (W4-06d) and `RISK-TIER-UNKNOWN` (W5-10) are not on `main` when this branch is cut, so they are not listed; whichever PR merges second adds them.

## Validator (`rai-web/server/src/configuration/validate.ts`)

`publishProblems(kind, body, inForce, mailMode): string[]`, pure (no I/O, no clock). Empty means publishable.

1. **Schema first.** `validateConfigurationBody` (schema, `qcRulesBodyProblems`, the W5-02 `risk_rubric` branch); a failure returns its problems and stops (the cross-kind checks need a valid body). An unknown kind or a kind with no registered schema is a problem, as today.
2. **`qc_rules`**, for every template `t` and rule entry `i`, at path `/templates/<t>/rules/<i>`:
   - rule ID not in `IMPLEMENTED_RULES` → `rule_not_implemented`;
   - engine differs from the registry's → `rule_engine_mismatch`;
   - a trigger not in the registry's triggers → `rule_trigger_not_implemented`;
   - the registry restricts the rule to templates that do not include `t` → `rule_template_isolated` (`v2.0` may not list `ACC-BAND-V1-SHEET3`).
   - every version of the `checklist_templates` revision in force needs a `templates` entry → otherwise `/templates catalogue_missing_template`. No `checklist_templates` in force: nothing to cover.
3. **`checklist_templates`**: every version needs a `templates` entry in the `qc_rules` revision in force → otherwise `/versions/<i> template_not_in_catalogue` (also when no `qc_rules` is in force: fail closed). The order to add a template is therefore `qc_rules` first, then `checklist_templates`.
4. **`operator_recipients`**, while `mailMode` is a sink (`sink-file`, `sink-memory`; every mode the configuration admits today): every address must be a synthetic address the digest accepts (`notifications/compose.ts` `syntheticAddress`) whose domain ends in `.example` or `.test` → otherwise `/addresses/<i> recipient_not_synthetic`.
5. Other kinds: schema only.

Each cross-kind problem string reads `<JSON pointer> <code>: <detail>`, where `<code>` is one of the exported `PUBLISH_PROBLEM_CODES` (W6-04 maps it to a `validation.configuration.<code>` locale key and the pointer to `fields`). Schema problems keep today's `<pointer> <message>` form. Pointer segments are escaped (`~0`, `~1`).

## Store (`rai-web/server/src/configuration/store.ts`)

- `publishDraft` and `restoreRevision` read the latest published `checklist_templates` and `qc_rules` bodies (the "current" revision of W6-02's optimistic checks) under the kind lock, call `publishProblems`, and throw `ConfigurationBodyInvalid(kind, problems)` when it returns any; nothing is written and the draft is kept.
- Publishing or restoring `qc_rules` or `checklist_templates` also takes one shared advisory "coverage" lock after the kind lock, so two concurrent Admin publishes of the two kinds are serialized and the second reads the first's committed revision (read committed); neither can leave a version uncovered.
- Both inputs gain optional `mailMode?: MailMode`; absent means a sink (fail closed: the synthetic-address rule applies). W6-04 passes `config.mail.mode`.
- `publishRevision` and `validateConfigurationBody` behave exactly as before. `validateConfigurationBody` and `ConfigurationBodyInvalid` move to `validate.ts` to avoid an import cycle and are re-exported from `store.ts` unchanged, so every existing import still works.

## Unchanged and green

The seed (`applyConfigurationSeed`), `fixtures:load`, `tests/integration/w4-02-rule-catalogue.test.ts` (partial catalogue) and `tests/integration/w3-03b-digest.test.ts` (real recipient) still publish through `publishRevision`. The seeded `qc_rules` and `checklist_templates` pass `publishProblems` against each other.
