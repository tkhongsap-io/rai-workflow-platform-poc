# Review: publish validation on the Admin paths and the implemented-rule registry (W6-03, #223)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 2.4, row W6-03 and sections 11.2 and 18 (the plan wins over issue #223). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)" (Q6: an unimplemented rule ID is refused on publish; Q3: a restore is refused when K's body fails today's cross-kind validation). D07-D10 stay open. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Registry** `rai-web/shared/src/qc/rule-registry.ts`: `IMPLEMENTED_RULES` (frozen), `ImplementedRule = { engine, triggers, templates? }`. Metadata: `PACK-SLOT-MISSING` (`submit`, `approve_attempt`), `PACK-STAGE-MISMATCH` (`submit`), `PACK-NA-VENDOR-DOC` (`submit`). Content (until W4b): `ACC-METRIC-CITED` (`upload`, `approve_attempt`), `ACC-EXTRACTION-NOT-HALLUCINATION`, `ACC-BAND-V1-SHEET3` (`templates: ['v1.0 Sheet3']`), `ACC-CLASSIC-ML-METRIC` (all `approve_attempt`). `PACK-CONTRADICTION` (W4-06d) and `RISK-TIER-UNKNOWN` (W5-10) are not on `main` at a7f2619, so they are not listed; the PR that lands them adds them (plan 11.2).
- **Validator** `rai-web/server/src/configuration/validate.ts`: `publishProblems(kind, body, inForce, mailMode): string[]`, pure. Schema first and alone (`validateConfigurationBody`); then `qc_rules` (unknown rule, engine mismatch, trigger outside the registry's, template isolation, every version of the `checklist_templates` in force covered), `checklist_templates` (every version in the `qc_rules` in force; none in force fails closed), `operator_recipients` (synthetic `.example`/`.test` address that `syntheticAddress` also accepts, while `MAIL_MODE` is a sink). Problems read `<RFC 6901 pointer> <code>: <detail>`; `PUBLISH_PROBLEM_CODES` exported; no problem echoes an address.
- **Store** `rai-web/server/src/configuration/store.ts`: `publishDraft` and `restoreRevision` call `assertPublishable` (latest `checklist_templates` and `qc_rules` bodies → `publishProblems` → `ConfigurationBodyInvalid(kind, problems)`; nothing written, draft kept). Both inputs gain optional `mailMode` (absent = sink). `qc_rules` and `checklist_templates` also take a shared coverage advisory lock after their kind lock. `publishRevision` unchanged; `validateConfigurationBody` and `ConfigurationBodyInvalid` moved to `validate.ts` verbatim and re-exported from `store.ts`.
- **Tests (new)**: `server/src/qc/rule-registry.test.ts` (5: metadata entries equal `METADATA_RULES` keys and triggers; ACC rules content; band isolation only; seeded catalogue registered; frozen, no `QC-UNAVAILABLE`); `server/src/configuration/validate.test.ts` (11: every seed body passes under both sink modes; schema first; unknown rule; engine mismatch; trigger superset refused and subset accepted; v2.0 band isolation; coverage `qc_rules` first incl. nothing in force; coverage `checklist_templates` second incl. no catalogue; non-synthetic recipient under both modes; other kinds schema only and pointer escaping; every code known); `tests/integration/w6-03-publish-validation.test.ts` (6, real Postgres: `publishDraft` refusals keep the draft; add-template order; restore refused then accepted in the right order; Admin real recipient refused for absent/`sink-file`/`sink-memory` while `publishRevision` still accepts it; `publishRevision` still takes templates before `qc_rules` and a partial catalogue; concurrent `qc_rules` and `checklist_templates` publishes serialized).
- **No existing test changed.** `w6-02-configuration-drafts`, `w4-02-rule-catalogue`, `w3-03b-digest`, `w1-00-configuration`, `seed.test.ts` and `qc-rules.test.ts` are unchanged and green.

## TDD evidence

- RED: `node --import tsx --conditions=rai-source --test server/src/qc/rule-registry.test.ts server/src/configuration/validate.test.ts` → `ERR_MODULE_NOT_FOUND` for `validate.js` and `@rai/shared/qc/rule-registry` (modules not yet written).
- RED: `tests/integration/w6-03-publish-validation.test.ts` before the store change → 4 of 5 failed ("expected ConfigurationBodyInvalid, got undefined"); the `publishRevision`-unchanged test passed, as it should.
- RED for the coverage lock: with the lock line removed, the concurrency test failed "B waits on the coverage lock while A is uncommitted"; the line was restored (`grep -c TEMPLATE_COVERAGE_LOCK` = 2).

## Gate (from `rai-web` after `set -a; . ./.env; set +a`, lane DB on 55384, 2026-09-28)

| Command | Result |
|---|---|
| `npm run lint` | exit 0 (eslint, prettier "All matched files use Prettier code style!", check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0; 967 tests, 967 pass, 0 fail |
| `npm run test:integration` | exit 0; 425 tests, 425 pass, 0 fail |
| `npm run build && npm run check:substitute-absent` | exit 0; "scanned 863 files, 0 with the marker" |
| `npm run test:browser:server` | exit 0; 205 passed (8.0m) |
| `npm run test:browser:substitute` | exit 0; 48 passed |
| `node scripts/check-links.mjs` (repo root) | exit 0 after this file was written (the first run reported only the then-missing link to this review) |
| `git diff --check` | exit 0 |

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **`validateConfigurationBody` and `ConfigurationBodyInvalid` moved to `validate.ts`** (verbatim; re-exported from `store.ts`). `validate.ts` needs the schema check first and `store.ts` must call `publishProblems`; keeping them in `store.ts` would make an import cycle. Behaviour and every import path are unchanged, which is what "unchanged" in the W6-03 row protects.
- **Problem string format** `<pointer> <code>: <detail>` with exported `PUBLISH_PROBLEM_CODES`: the plan fixes `string[]` and says W6-04's 422 carries the JSON path and a locale key; a stable code lets W6-04 build `validation.configuration.<code>` without parsing prose. Schema problems keep today's form. Locale keys are W6-04's (added with the route), not added here.
- **`mailMode` is optional on the store inputs, absent = sink**: every mode `config.ts` admits (`sink-file`, `sink-memory`) is a sink, so the default fails closed and W6-02's callers need no change. W6-04 passes `config.mail.mode`.
- **Recipient rule is the plan's `.example`/`.test` suffix and the digest's `syntheticAddress`**: stricter than either alone (`example.com` and `.invalid` pass the digest but are refused here), so the Admin can never publish an address the digest would refuse.
- **"In force" for the cross-kind checks is the latest published revision**, the same "current" W6-02's optimistic checks use.
- **Coverage lock** (not in the plan): without it, a concurrent `qc_rules` and `checklist_templates` publish under read committed could each pass against the other's old revision and leave a version uncovered. One shared advisory lock, taken after the kind lock, serializes only those two kinds; lock order is always kind then coverage, so no deadlock.
- **Registry triggers for the content rules** are the W4a catalogue's (seed), since the rules are not yet implemented; W4b replaces the entries.

## Not in scope

Routes and 422 mapping (W6-04), UI, `group_role_mapping` registration (W6-11), locale keys, log events.
