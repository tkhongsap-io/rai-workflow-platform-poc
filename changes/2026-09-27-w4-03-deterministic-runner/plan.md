# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED:
   - `server/src/qc/deterministic/rules/pack-slot-missing.test.ts`, `pack-stage-mismatch.test.ts`, `pack-na-vendor-doc.test.ts`: below/at/above fixtures per rule; slot 9 never; owning lanes; the two-lane slot-5 case at unit level.
   - `server/src/qc/deterministic/runner.test.ts`: identity; `rules: null` → `not_configured`; content rules not executed; `rulesEvaluated`; unknown rule, bad params, unknown mapping → `runner_error`; every finding passes `validateQcFinding` and `checkOwningLane`; artifacts whose `read()` throws are never read.
   - `server/src/qc/deterministic/module-graph.test.ts`: the static import graph from `server/src/qc/deterministic/` has no parser, `node:net`, `node:http` (and the other network modules), no blob store module and no dynamic import.
   - `tests/integration/w4-03-deterministic-runner.test.ts`: section 6 of the spec on the fixture cases, slots adjusted on the draft by SQL before submit.
   - Round 2: `server/src/config.test.ts` (`QC_MODE=deterministic` under test only) and `tests/integration/w4a-int-deterministic-server.test.ts` (spec 9), both red on `invalid:QC_MODE` before the binding.
   - As built, the three per-rule test files above are one `server/src/qc/deterministic/rules.test.ts` with the same cases (review.md, deviations).
   - `shared/src/locales/locales.test.ts` is the parity check; the new keys are asserted by the rule tests through `isLocaleKey`.
3. GREEN: `server/src/server-version.ts`; `server/src/qc/deterministic/{runner.ts, rules/*.ts}`; th/en keys. Round 2: `config.ts` (`parseQcMode`) and `start.ts` (bind the runner, readiness kind from its identity).
4. Docs: W0-07 3.5 and 3.4 step 6 dated amendments.
5. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-03-deterministic-runner-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #186").
