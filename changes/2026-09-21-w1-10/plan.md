# Plan: W1-10 — QC test substitute per W0-07

2026-09-21. Ticket W1-10 (issue #25), branch `codex/w1-10-qc-substitute`, worktree `/Users/tkhongsap/github/rai-wt/W1-10`. Lane C, owner type Agent-eligible. Written before code, per AGENTS.md.

## Intent

Build the slice-1 QC substitute exactly as [W0-07 section 3.9](../../docs/engineering/qc-boundary-and-mail-sink.md#39-test-substitute-w1-10) specifies: `ScriptedQcRunner` behind the shared `QcRunner` port, scripted synthetic typed findings keyed by fixture case, an explicit `unavailable` result on demand, a simulated timeout in both modes, and tests that prove it has no write path to workflow state. **Substitute only.** QC is not implemented; W4 replaces this runner behind the same port under ADR-0006 (D08, D09), and nothing here labels QC as done.

## Scope (files)

- `rai-web/fixtures/src/substitutes/qc/` (Lane C, this ticket's module): `index.ts`, `scripted-runner.ts` (`ScriptedQcRunner` + `ScriptedQcRunnerControl`), `scripts.ts` (bundled script table, validated at construction), `scripts/*.json` (one file per W0-08 fixture case that has findings), `version.ts`, colocated `*.test.ts`.
- `rai-web/fixtures/src/index.ts`: re-export the substitute.
- `rai-web/shared/src/qc/validate.ts` (+ test): the "shared validator" W0-07 3.4 step 4 and 3.9 name (TypeBox schema for `QcFinding`/`QcRunResult`, `validateQcFinding(finding, request)` returning the violation name). Additive contract file in Lane A's package; W2-05's orchestrator consumes it. Flagged in the PR.
- ~~`rai-web/shared/src/constants.ts`: `owningLaneForSlot(slot, mapping)`~~ and ~~`rai-web/shared/src/locales/{th,en}.json`: `qc.finding.*` keys~~ — **moved out after review round 1** (2026-09-22): both are W1-00 rows (W0-07 3.3; W0-02 section 10 rules 1 and 8) and landed as the contract PR #74 (`codex/w1-00-qc-shared-contract`, `changes/2026-09-22-w1-00-qc-shared-contract/`). This branch is rebased on it and consumes them from `@rai/shared`; the substitute is unchanged.
- `changes/2026-09-21-w1-10/{plan,review}.md`.

Not touched: `docs/product/source-spec.md` (frozen), `docs/product/decisions.md`, `docs/board/*`, DEVLOG, CHANGELOG (merge step), `rai-web/server/src/**` (Lane A; the orchestrator and runner binding are W2-05), `server/src/config.ts` (W1-00 owns the loader; the production+substitute refusal it lacks is reported, not added here), `package.json` scripts, `.github/`, `demo/`, root `tests/`.

## Design decisions inside the spec

- Scripts are static JSON imports bundled with the module (spec: "ship inside the substitute's package directory and are read relative to the module; no configuration key names them"). No `node:fs` at all, so the structural test's allow-list is `@rai/shared` only.
- A script entry is keyed by `(fixtureCaseId, trigger, lane?)`. Its findings are full `QcFinding` values except that `ruleRevision` is the placeholder `@request` (rewritten to `request.qcRulesRevision`), `provenance` is stamped by the runner, and artifact references carry the W0-08 fixture document id plus slot: the runner resolves `artifactId`/`contentHash` from the request artifact in that slot, because artifact row ids are UUIDs minted by the loader. A script that names a slot the request does not carry as `attached` is a script bug and throws (`QcScriptError`); the server binding may choose `onScriptMismatch: 'unavailable'` instead.
- The request's fixture case is resolved by `fixtureCaseIdOf(version)`, default: `version.caseId` when it starts with `fx-case-`. W2-05 passes a resolver from the loaded fixture set.
- W0-06 7.4 posture: scripts contain only `artifact`/`slot` findings on single-lane slots with `owningLane === owningLaneForSlot(slot, mapping)`; the constructor throws on anything else. `unavailable` results carry no lane. The reserved rows of W0-07 3.5 are not scripted.
- Config: `QC_MODE` has one value (`substitute`); any other value (for example `none`) is refused by W1-00's loader and the test here asserts that. The production-identity refusal W0-07 3.9 asks of the loader is not in `config.ts`; this ticket reports the gap rather than editing Lane A's file.

## Tests first (Done when → test; all `node:test`, unit layer, no Postgres)

| Clause / W0-07 3.9 row | Test |
|---|---|
| Returns scripted findings for a version ref | `scripted-runner.test.ts`: `completed`, findings deep-equal the script after the rewrites, each scope resolves to a request slot/artifact; unscripted version → `completed`, zero findings |
| Returns `unavailable` on demand | `simulateError('runner_error')` and `('artifact_unreadable')` on `upload`, `submit`, `approve_attempt`; no lane field; `detail` carries no filename/email/document text |
| Simulates a timeout | `'immediate'` → `unavailable:timeout` < 50 ms; `'hang'` resolves only after the signal aborts; a caller with a 100 ms timer observes `timeout` |
| No write path to workflow state (structural) | `no-write-path.test.ts`: walk the module graph from `index.ts`; only `@rai/shared/*` and relative files; nothing under `rai-web/server`, no `drizzle-orm`, `pg`, `fastify`, `node:fs`, `node:net`, `node:http`, no `process.env` |
| No write path (behavioural) | deep-frozen request unchanged; a store spy is never called; `artifacts[i].read` never invoked for a `submit` script |
| Schema conformance | every scripted finding passes `validateQcFinding`; `excerpt` or a bad `excerptHash` fails |
| Owning lane follows W0-06 7.1 only | every scripted finding is on a single-lane slot with the mapped lane; a script with slot 5/9/pack/run/`QC-UNAVAILABLE` throws at construction |
| Health answer reaches readiness | `health()` drives `probe()` (the W0-10 5.5 `qc` probe shape); `computeReadiness` is not in the tree yet (W3-07), so the probe answer is asserted here and the composed report there |
| Fail closed on configuration | `parseConfig` with `QC_MODE` unset / `none` / `scripted` / `model` → `invalid:QC_MODE` or `missing:QC_MODE`; `identity.runner === 'substitute-scripted'` |

Then: `npm run lint`, `npm run typecheck`, `npm test` (integration on Postgres port 54330), `npm run build && npm run check:substitute-absent`, `node --test tests/*.test.mjs` at the root.
