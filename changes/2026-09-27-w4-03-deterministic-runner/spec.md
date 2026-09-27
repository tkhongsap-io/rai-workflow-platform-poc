# Specification

Source: W4a plan section 4 (the plan wins over issue #186), with the plan-review notes on the ticket. W0-07 3.3 and 3.4 (validation and owning lane) apply unchanged.

Done when:

1. **Runner** (`server/src/qc/deterministic/runner.ts`): `createDeterministicQcRunner({ now?, runnerVersion? })` returns a `QcRunner` with `identity = { runner: 'deterministic', runnerVersion }`, the default version being the `@rai/server` package version (`server/src/server-version.ts`). `qcKindOf` already maps it to `deterministic`.
   - `rules: null` → `unavailable:not_configured` (detail `no_qc_rules_revision`).
   - Rules with `engine: 'content'` are selected but not executed and not counted. Each `metadata` rule is executed and its ID listed in `rulesEvaluated`, in request order.
   - A metadata rule ID the runner does not implement, `params` that fail the rule's schema, an unknown `laneMappingVersion` or an approve attempt without a lane → `unavailable:runner_error` with a named detail, never a partial clean pass.
   - Every finding: `findingKey = findingKeyOf(ruleId, scope)`, `ruleRevision = qcRulesRevision`, the request's trigger, the catalogue severity, `measure: null`, evidence locators only (`absent`, no excerpt), a locale key message, and the runner's identity as provenance. Output passes W0-07 3.4 steps 4-5 (`validateQcFinding`, `checkOwningLane`) unchanged.
   - It never calls `artifacts[].read()` and imports no parser, `node:net` or `node:http`.
2. **`PACK-SLOT-MISSING`** (`rules/pack-slot-missing.ts`):
   - submit: one slot finding per `missing` slot that has exactly one lane under the version's mapping (1-4, 6-8 under `lane-mapping/v1`), owned by that lane. Slot 5 and slot 9 raise nothing on submit.
   - approve_attempt: one slot finding per `missing` slot reviewed by several lanes that include the run's lane (slot 5), owned by the run's lane. Single-lane slots are not raised again on approve attempts.
   - message `qc.finding.pack_slot_missing { slot }`; evidence `{ slot, locator: absent }`.
3. **`PACK-STAGE-MISMATCH`** (`rules/pack-stage-mismatch.ts`), submit only: with `params = { attachedForbiddenAt, notYetForbiddenAt }` (stage → slots), one pack finding owned by AI/COE when a slot listed for the version's `stage_context` is `attached` (resp. `not_yet`). Evidence: one entry per offending slot, in slot order, with the artifact reference for an attached slot. Message `qc.finding.pack_stage_mismatch`. Below/at/above fixtures: every stage against each forbidden state.
4. **`PACK-NA-VENDOR-DOC`** (`rules/pack-na-vendor-doc.ts`), submit only: when `vendorInvolved` is true, one slot finding per vendor slot (3 DPA, 4 SOW; `pack/slots.ts` `VENDOR_SLOTS`) that is `not_applicable`, with any reason, owned by the slot's lane (DPO). Message `qc.finding.pack_na_vendor_doc { slot }`.
5. **No slot-9 defect**: no rule raises a finding on slot 9 whatever its state.
6. **Integration (real Postgres, in-process fixture app, runner injected)**: submit findings stored for each rule with the right slot, lane, severity and key; the two-lane slot-5 case (DPO and IT/Security approve attempts on one version with slot 5 missing give two findings, each owned by and dispositionable only by its lane); completed submit and approve-attempt runs replay (no second run, no second finding); a version with no `qc_rules` revision is `unavailable:not_configured` from the runner itself; `qc_run.rules_evaluated` counts executed metadata rules only.
7. **Locales** (th, en): `qc.finding.pack_na_vendor_doc`, and `qc.rule.<rule_id>` labels for every catalogued rule ID and `QC-UNAVAILABLE`.
8. **Docs**: dated W4-03 amendments to W0-07 3.5 (the W4a rows, `PACK-NA-VENDOR-DOC`) and 3.4 step 6 (dedup deferred to W4b; its scope key must include the owning lane for slot 5).
9. **Real-server evidence** (`tests/integration/w4a-int-deterministic-server.test.ts`, plan section 8; added in round 2): spawns `server/src/main.ts` through tsx with `QC_MODE=deterministic`; readiness `qc` is `{ kind: 'deterministic', status: 'ok' }`; over HTTP, the submit findings of each rule are stored and listed by the findings endpoint, the two-lane slot-5 approve attempts raise one finding per lane, and the `qc_run` rows name the runner, its version and `rules_evaluated`. The qc-runs endpoint does not exist yet; W4-12 extends this file with it.
10. **Test-environment binding** (issue #186: "that value may be introduced here via the test env only if W4-13 has not landed"): `config.ts` accepts `QC_MODE=deterministic` only under `NODE_ENV=test` (otherwise `invalid:QC_MODE`, exit 78); `start.ts` binds the deterministic runner for it (probe `ok`) and reports readiness `qc.kind` from the bound runner's identity (`qcKindOf`). The test override and the `substitute` path are unchanged. W4-13 widens the value to every environment.
11. Full plan section 8 gate green.
