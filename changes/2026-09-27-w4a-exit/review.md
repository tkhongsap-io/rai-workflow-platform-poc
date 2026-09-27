# W4a engineering exit (W4a-EXIT, #190)

This records the W4a exit evidence of the [W4a plan](../../docs/engineering/implementation-plan-w4a.md) section 10 and the section 8 gate, run from a clean checkout of `main`. It is an engineering exit, not Ta's acceptance: **Ta's package review is pending**. It authorizes nothing beyond the "W4a gate entry" (Ta, 2026-09-26); W4b, W5-W8, real data, networked access and production release stay gated. Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md).

**Rule outcomes and fixture labels in W4a are provisional until D09 is recorded.** D09 confirms or replaces them.

## Change summary

- New `changes/2026-09-27-w4a-exit/` (this record).
- Current-status text: BUILD_PLAN section "Status against this plan — 2026-09-27 (W4a engineering exit)"; the W4 work breakdown status line; the delivery README W4 lines; the README status line; a board entry on `lane-lead-integration.md`; DEVLOG and CHANGELOG.
- No application code, test, manifest, migration, CI or configuration change. Plan section 12 assigns no document amendment to this ticket.

## What W4a delivered

Six tickets on the W4-00a plan, each through a reviewed PR with two independent reviewer verdicts on its exact head and green CI on that head (12/12 checks) before merge:

| Order | Ticket                     | Issue | PR                                                                         | Merged as | Head reviewed | Review rounds                                                                                                                                                       |
| ----- | -------------------------- | ----- | -------------------------------------------------------------------------- | --------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | W4-00a file-level plan     | —     | [#183](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/183) | `af12076` | `1d12087`     | 3: round 1 contract BLOCK, engineering BLOCK (`f9271e3`); round 2 contract PASS, engineering BLOCK (`ac2ae6c`); round 3 contract PASS, engineering PASS (`1d12087`) |
| 1     | W4-11a run identity        | #184  | [#192](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/192) | `d8a8291` | `2e65609`     | 1: contract PASS, correctness PASS                                                                                                                                  |
| 2     | W4-02 rule catalogue       | #185  | [#193](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/193) | `09a8afb` | `c394b29`     | 1: contract PASS, correctness PASS                                                                                                                                  |
| 3     | W4-03 deterministic runner | #186  | [#194](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/194) | `5a8f00f` | `e24a8d0`     | 2: round 1 contract BLOCK (real-server test moved out of the ticket), correctness PASS (`29259e7`); round 2 contract PASS, correctness PASS (`e24a8d0`)             |
| 4     | W4-13 runner selection     | #187  | [#195](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/195) | `0dce56e` | `24c28bf`     | 1: contract PASS, correctness PASS                                                                                                                                  |
| 5     | W4-04 upload trigger       | #188  | [#196](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/196) | `202715d` | `5146b4f`     | 1: correctness PASS, contract PASS                                                                                                                                  |
| 6     | W4-12 QC log and UI        | #189  | [#197](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/197) | `da3d815` | `cc5e1e2`     | 1: contract PASS, correctness PASS                                                                                                                                  |

The verdicts are the PR comments headed "Contract review", "Correctness review" and "Engineering review". The per-ticket `review.md` verdict tables were written before review and still read "pending"; the PR comments are the record. CI on the PR heads: runs [36290306458](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36290306458) (#192), [36292487387](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36292487387) (#193), [36295494451](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36295494451) (#194), [36297786793](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36297786793) (#195), [36300128145](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36300128145) (#196), [36303457258](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36303457258) (#197), each 12/12 success. Main CI on `202715d` ([36301078462](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36301078462)) passed; main CI on `da3d815` ([36304654780](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/36304654780)) passed 12/12. The local run below is the exit evidence.

In one paragraph: a version records the `qc_rules` catalogue revision (`w4a.1`) in force; the `deterministic` runner reads only structured pack data (slot states and reasons, stage, vendor flag, model type, template version) and runs `PACK-SLOT-MISSING`, `PACK-STAGE-MISMATCH` and `PACK-NA-VENDOR-DOC`; `QC_MODE=deterministic` binds it in every environment and `substitute` is refused outside local modes; a changed attach on a draft fires an upload run (slot 5 outage owned by AI/COE, slot 9 no run); every run records runner, version, rule revision and rules evaluated; the version view shows a QC log, and every unavailable run shows before a lane's decision controls.

## Identities

| Identity      | Value                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source        | `origin/main` `da3d815` (W4-12 merge), worktree `/tmp/rai-w4a-exit` on `codex/w4a-exit-record`; the branch adds only this record, the CLAIM and status text                                                                                                                                                                                                                                                            |
| Rule revision | `configuration_revision` kind `qc_rules`, revision 1, label **`w4a.1`**; body sha256 `3ee34d2286d481a061950f2a0e813e16c14f71465966250b21d2eb74baecf8c6` (Postgres `jsonb` text); templates `v1.0 Sheet3` (7 rules) and `v2.0` (6). The revision **ID** is a fresh UUID at every seed load (each suite resets its database), so the ID beside each output below is the one read from that run's database right after it |
| Runner        | `deterministic` `0.0.0` (`@rai/server` package version; `server/src/server-version.ts`). Where a run binds the scripted substitute, that is `substitute-scripted` `0.0.0`; the W4-04 fixture tests also bind a synthetic `upload-probe` `1.0.0` in their probe cases                                                                                                                                                   |
| Fixture set   | `fixture set slice1-synthetic@1 7c80ccd43663` (printed by every describe below)                                                                                                                                                                                                                                                                                                                                        |
| Environment   | Node v24.21.0, npm 11.19.0, Postgres 16.15 (`POSTGRES_PORT=55380 docker compose -p rai-w4a up -d --wait` after `down -v`), Playwright 1.63.0; `rai-web/.env` from `.env.example` with ports 55380/8797/8798/8799/5185 and `OBS_MIGRATION_ADMIN_URL`; `QC_MODE=deterministic` (the `.env.example` default)                                                                                                              |

## Exit evidence (plan section 10)

Run separately after the gate, one at a time, on the same database, from `rai-web/` after `set -a; . ./.env; set +a`. Logs under `/tmp/rai-w4a-exit-logs/` (outside the repo).

| Exit item                               | Command                                                                                                                                                                                      | Output                                                                                                                                                    | Rule revision / runner / fixture set                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W4-03 fixture tests                     | `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w4-03-deterministic-runner.test.ts`                         | `✔ W4-03 deterministic runner — fixture set slice1-synthetic@1 7c80ccd43663`; tests 6, pass 6, fail 0, skipped 0                                          | `qc_rules` `01a0e13c-1008-7bd4-b5b6-ff7724532313` rev 1 `w4a.1`; runner `deterministic` `0.0.0`; `slice1-synthetic@1 7c80ccd43663`                                                                                             |
| W4-04 fixture tests                     | same runner, `tests/integration/w4-04-upload-trigger.test.ts`                                                                                                                                | `✔ W4-04 upload trigger — fixture set slice1-synthetic@1 7c80ccd43663`; tests 10, pass 10, fail 0, skipped 0                                              | `qc_rules` `01a0e174-46a8-7f90-bb0b-2bc8cd5dd151` rev 1 `w4a.1`; runners `deterministic` `0.0.0` and the probe `upload-probe` `1.0.0`; `slice1-synthetic@1 7c80ccd43663`                                                       |
| Real-server test                        | `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w4a-int-deterministic-server.test.ts` (plan section 8)      | `✔ W4a real server, QC_MODE=deterministic — fixture set slice1-synthetic@1 7c80ccd43663`; tests 6, pass 6, fail 0, skipped 0                              | `qc_rules` `01a0e1ef-8d73-75e7-91c0-1e9e7d8d854b` rev 1 `w4a.1`; runner `deterministic` `0.0.0` (runs: submit 4 × 3 rules, approve attempt 3 × 1 rule, upload 1 × 0 rules, all `completed`); `slice1-synthetic@1 7c80ccd43663` |
| W4-12 journeys on the real server       | `NODE_ENV=test RAI_IDENTITY_MODE=fixture npx playwright test -c tests/browser/playwright.config.ts w4-12-qc-log.spec.ts`                                                                     | `6 passed (18.3s)`: 2 tests × 1440/834/390, describe `W4-12 QC log and unavailable runs on the real server (fixture set slice1-synthetic@1 7c80ccd43663)` | `qc_rules` `01a0e1ef-d479-7ff5-b293-d9602cf883fb` rev 1 `w4a.1`; runner `substitute-scripted` `0.0.0` (the evidence configuration pins `QC_MODE=substitute`, plan section 7); `slice1-synthetic@1 7c80ccd43663`                |
| Readiness under `QC_MODE=deterministic` | `NODE_ENV=test RAI_IDENTITY_MODE=fixture QC_MODE=deterministic node --import tsx --conditions=rai-source server/src/main.ts` (rest from `.env`), then `curl -s http://127.0.0.1:8797/readyz` | HTTP 200, `"qc":{"kind":"deterministic","status":"ok"}`                                                                                                   | runner `deterministic` `0.0.0` bound by `start.ts`; database of the previous row (`qc_rules` `01a0e1ef-d479-…-d9602cf883fb`, `w4a.1`); `schemaVersion` `10`                                                                    |
| `check:substitute-absent`               | `npm run check:substitute-absent` (after `npm run build`)                                                                                                                                    | `check-substitute-absent: scanned 675 files, 0 with the marker`                                                                                           | built `server/dist`, `web/dist`, `shared/dist` of `da3d815`                                                                                                                                                                    |

The full readiness body:

```text
{"status":"ready","checkedAt":"2026-09-27T08:17:22.236Z","identity":{"mode":"fixture","loopbackBind":true,"status":"ok"},"store":{"db":"ok","migrations":"current","blob":"ok"},"mailSink":{"kind":"file","status":"ok"},"qc":{"kind":"deterministic","status":"ok"},"build":{"commit":"dev","schemaVersion":"10"}}
```

The test lines of the three integration files:

```text
▶ W4-03 deterministic runner — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ submit: PACK-SLOT-MISSING on a single-lane slot, owned by its lane; three rules evaluated; the run names the runner
  ✔ submit: PACK-STAGE-MISMATCH is one AI/COE pack finding (slot 8 attached at idea; a lane-gated slot not yet at pre_launch)
  ✔ submit: PACK-NA-VENDOR-DOC on a vendor case with slot 4 N/A is a DPO finding the DPO may waive and AI/COE may not
  ✔ two lanes on slot 5: submit raises none; the DPO and IT/Security approve attempts each raise one, owned and dispositionable only by that lane
  ✔ completed submit and approve-attempt runs replay: no second run row and no second finding
  ✔ a version with no qc_rules revision: the runner itself answers not_configured, recorded as the lane outage and retried
ℹ tests 6  pass 6  fail 0  skipped 0

▶ W4-04 upload trigger — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ one run per changed attach: lane NULL, slot recorded, the save correlation, the probe named; none on an unchanged save
  ✔ two attaches in one save run separately (the in-flight key is the runKey, not the version)
  ✔ slot 9 fires no run and writes no qc_run row (register row "D05 refinement (upload slot 5 and 9)")
  ✔ the save-draft response never waits for QC; the drain waits for the run before the app closes
  ✔ outages: the slot lane owns the finding, slot 5 is AI/COE; reused per version and owning lane
  ✔ a run that completes after submit appends to the submitted, still open version
  ✔ A08: an upload outage carried into the submitted version gates Ready until its owning lane dispositions it
  ✔ after Ready the run is late: nothing written, one qc.run.late line and a late-result row
  ✔ a version closed by a send-back takes no upload evidence: version_closed, nothing written anywhere
  ✔ with the deterministic runner a completed upload run evaluates 0 rules and stores no finding
ℹ tests 10  pass 10  fail 0  skipped 0

▶ W4a real server, QC_MODE=deterministic — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ readiness reports the deterministic runner as the bound QC kind
  ✔ submit: PACK-SLOT-MISSING on slot 7 for IT/Security; the run names the runner and its version and counts three rules
  ✔ submit: PACK-STAGE-MISMATCH for AI/COE when slot 8 is attached at idea
  ✔ submit: PACK-NA-VENDOR-DOC for the DPO on a vendor case with slot 4 N/A
  ✔ upload: an attach over HTTP fires one upload run on the draft, lane NULL, slot set, 0 rules evaluated, no finding
  ✔ qc-runs over HTTP (W4-12): the upload run carried from the draft, the submit run and an approve attempt, each naming the runner, its version, the revision and its label
ℹ tests 6  pass 6  fail 0  skipped 0
```

Durations are omitted; the `ℹ` lines are joined on one line here. The W4-03 run row left in the database after its last case names a revision that is not the `qc_rules` one: that case freezes a version without a `qc_rules` revision on purpose (`not_configured`).

## Section 8 gate

Clean checkout (`git worktree add … origin/main` at `da3d815`, `git status` clean apart from the ignored `.env` and `node_modules`), fresh database, `npm ci` exit 0. One suite at a time from `rai-web/` after `set -a; . ./.env; set +a` (`QC_MODE=deterministic` in `.env`; the integration harness, the real-server browser lifecycle and CI pin their own `QC_MODE`). Started 14:58:41, finished 15:15:52 (local time).

| Command                                            | Result                                                                                                                           | Rule revision / runner / fixture set                                                                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                     | exit 0: `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible`                     | —                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                                | exit 0 (`tsc -b . tests/performance`)                                                                                            | —                                                                                                                                                                                                                                                                       |
| `npm run test:unit`                                | tests 648, pass 648, fail 0, cancelled 0, skipped 0                                                                              | seed `w4a.1` body in code (`configuration/seed.ts`); `deterministic` `0.0.0` and `substitute-scripted` `0.0.0` under unit test                                                                                                                                          |
| `npm run test:integration`                         | tests 374, pass 374, fail 0, cancelled 0, skipped 0                                                                              | `qc_rules` rev 1 `w4a.1` reseeded per suite (fresh ID each load); runners as bound per file (`deterministic` `0.0.0` in the W4a files and the real-server test; `substitute-scripted` `0.0.0` elsewhere); describes print `fixture set slice1-synthetic@1 7c80ccd43663` |
| `npm run build && npm run check:substitute-absent` | exit 0; `check-substitute-absent: scanned 675 files, 0 with the marker`                                                          | —                                                                                                                                                                                                                                                                       |
| `npm run test:browser:server`                      | `202 passed (10.2m)`; no failed, flaky or skipped                                                                                | `qc_rules` rev 1 `w4a.1`; `substitute-scripted` `0.0.0` (evidence configuration); `fixture set slice1-synthetic@1 7c80ccd43663`                                                                                                                                         |
| `npm run test:browser:substitute`                  | `48 passed (32.4s)`                                                                                                              | in-memory API substitute, no catalogue (`rules: null`, plan section 11); not real-server evidence                                                                                                                                                                       |
| `node scripts/check-links.mjs` (root)              | first run on the gate: 3 broken, all links to this `review.md` before it was written; final run on the committed tree: see below | —                                                                                                                                                                                                                                                                       |
| `git diff --check` (root)                          | exit 0                                                                                                                           | —                                                                                                                                                                                                                                                                       |

The counts match W4-12's own gate (648 unit, 374 integration, 202 real-server browser, 48 substitute browser).

Final checks on the committed record tree:

| Command                                       | Result                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `node scripts/check-links.mjs` (root)         | `check-links: 361 Markdown files, 978 relative links checked, 0 broken` |
| `git diff --check` (root)                     | exit 0                                                                  |
| `node --test tests/*.test.mjs` (root)         | tests 22, pass 22, fail 0, skipped 0                                    |
| `node scripts/check-frozen-source.mjs` (root) | sha256 `92c4f712…b354` matches                                          |
| `node --test scripts/*.test.mjs` (root)       | tests 18, pass 18, fail 0, skipped 0                                    |

## Deviations (this ticket)

- **Readiness start uses the fixture identity mode.** `.env.example` sets `RAI_IDENTITY_MODE=local-google`, whose start refuses without a real Google client (`{"event":"process.refused","reason":"secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID"}`), and that credential stays in Ta's custody. The server was started from source with `NODE_ENV=test RAI_IDENTITY_MODE=fixture` over the same `.env` and `QC_MODE=deterministic`, the way the real-server test harness starts it. `QC_MODE` binding does not depend on the identity mode for `deterministic`.
- **The W4-12 journeys run under `QC_MODE=substitute`.** Plan section 7 puts the UI proof on the real server under the evidence configuration, whose scripted findings carry evidence locators; the runner beside that output is `substitute-scripted`. The deterministic runner's findings, runs and the qc-runs endpoint over HTTP are proven by the real-server test.
- **Rule revision ID per run.** The plan asks for "the rule revision (ID and label)". The ID is minted at every seed load, so there is no single ID for the package. The record gives, per output, the ID read from that run's database, plus the stable identity (revision 1, label `w4a.1`, body hash).
- **Runner version `0.0.0`.** The deterministic runner's version is the `@rai/server` package version, which W4a did not bump. With the source commit `da3d815` it identifies the code; a version scheme for runners is not a W4a decision.
- **Per-ticket verdict tables.** Each ticket's `review.md` still shows "pending" verdicts; the PR comments hold the verdicts (table above). Those dated records are not rewritten here.

## Deviations recorded by the tickets

From each ticket's `review.md`, in short; the linked records hold the reasoning.

- **W4-11a** ([review](../2026-09-27-w4-11a-run-identity/review.md)): an unbound run records runner version `unbound`; `qcKindOf` reports `substitute` for every runner not named `deterministic` (new `qc/kind.ts`); five other integration setups with raw `qc_run` inserts supply `runner_version`; the operator report's `unavailableQc` rows now require `runner` and `runnerVersion` (typed test reports updated); the distinguishability test swaps a frozen revision as `rai_owner` with the freeze trigger disabled in one transaction; W0-07 section 10 still lists the fields as proposed.
- **W4-02** ([review](../2026-09-27-w4-02-rule-catalogue/review.md)): `request.rules` is `SelectedRule[] | null` (`null` = no `qc_rules` revision; `[]` = zero rules selected); an unknown template or an invalid stored catalogue is recorded as `runner_error` before the runner is called; a draft with no `qc_rules` revision in force reads as no rules; `model_type` routing is a rule-ID table in `select.ts`; `PACK-NA-VENDOR-DOC` severity `medium`; the `PACK-STAGE-MISMATCH` params shape; `seed.test.ts` and `w1-05-submit.test.ts` expectations changed by the plan.
- **W4-03** ([review](../2026-09-27-w4-03-deterministic-runner/review.md)): `QC_MODE=deterministic` first introduced for the test environment only (issue #186 route), widened by W4-13; the real-server test read `qc_run` rows until W4-12 added the endpoint; one `rules.test.ts`; stage-mismatch evidence per offending slot; fail-closed `runner_error` where the plan is silent; approve-attempt scope of `PACK-SLOT-MISSING` is multi-lane slots including the run's lane (slot 5); rule label keys for all seven catalogued IDs and `QC-UNAVAILABLE`; `finishedAt` equals `startedAt`.
- **W4-13** ([review](../2026-09-27-w4-13-runner-selection/review.md)): `config.test.ts` and `static.test.ts` expectations changed by the plan; the evidence Playwright configuration has no `webServer`, so the `QC_MODE=substitute` pin lives in `real-server-lifecycle.ts` and `tests/support/process.ts`; CI already pinned `substitute`; with no runner bound readiness reports the configured mode; the integration harness readiness follows the injected runner.
- **W4-04** ([review](../2026-09-27-w4-04-upload-trigger/review.md)): no upload run when no runner is bound (the submit outage already gates Ready); `constants.test.ts` and the two substitute script tests changed by the register row and the plan; the harness closes apps through the drain; the run reads the slot as it is when the run starts, not the event's `artifactId`; the `qc.run_recorded` audit `target_ref` of an upload run carries `slot`.
- **W4-12** ([review](../2026-09-27-w4-12-qc-log-ui/review.md)): `evidence` optional in the shared schema (the substitute is not extended); `section` and `cell` locator fields are served, hashes and excerpts never; a draft's runs are readable by those who may read the draft's findings (unchanged W0-05 rule); a reviewer workspace fails closed when the qc-runs read fails (on the substitute it 404s); a pre-0009 run reads "not recorded"; `w2-int-journey.spec.ts` now expects `no_rules` where the scripted runner evaluated 0 rules; the QC log is not a live region; the browser spec seeds one synthetic upload outage row; the RED record for the browser layer.

## Deferred reviewer notes

Non-blocking notes from the PR reviews that no later W4a ticket closed. None blocks the exit; the ones marked **Ta** ask for Ta's eye.

- **Ta — no upload run when no runner is bound** (#196, both reviewers): an unbound upload leaves no trace; the submit run's `not_configured` outage still gates Ready (A08).
- **Ta — locator text is served** (#197, both reviewers): `section.heading` and `cell.sheet`/`cell` are served by the reads (the UI shows only slot and kind). W4a runners produce none; W4b's extraction would. The smaller alternative is to serve `{ kind }` and numeric positions only.
- **W0-06 section 7.2 is stale** (#196 contract N1): it still says the slot-5/9 upload outage is defined in W4 and shows the old `unavailableOwningLane` signature. No ticket was assigned a W0-06 amendment (plan section 12 gap); a dated note belongs in a documentation PR.
- **W4 work breakdown W4-13 row** (#195 contract N3): the row says the substitute "stays test-only"; plan section 2, which wins and which the code follows, allows it in development under the `fixture` and `local-google` identity modes.
- **W0-02 section 5 and W0-07 section 6 original rows** still say `QC_MODE` has one value; the dated amendments beneath them supersede that (#195 contract N2).
- **Upload `runKey` for a detached slot** (#196 correctness N1): two runs on different slots whose slots were detached before the run starts share one `runKey`; harmless (nothing left to check), exactness fix is to add the slot to the key.
- **Drain budget** (#196 correctness N3): `QC_TIMEOUT_MS` equals `SHUTDOWN_DRAIN_MS` (10 s), as for submit runs.
- **Runner identity not validated at bind** (#192 both reviewers): a runner name or version outside the desk-health label pattern would fail the whole operator report closed.
- **`server-version.ts` reads `server/package.json` at load** (#194 correctness): packaging must keep it next to `src/` and `dist/`; now imported in every mode by `start.ts`.
- **Selection detail not persisted** (#193 correctness N2): `unknown_template_version` / `invalid_rule_catalogue` are not stored or logged, so an operator cannot tell a selection failure from a runner crash.
- **Two lanes' slot-5 findings share one `findingKey`** (#194): safe without a unique index; W4b dedup must key on the owning lane (W0-07 3.4 step 6 amendment).
- **`laneRunEmptyStatus` fallback** (#197 both reviewers): a pre-0009 lane run with `rulesEvaluated` NULL reads "no defects" in the workspace while the QC log reads "not recorded"; unreachable for fresh runs.
- **Reload re-runs lane QC** (#197 correctness N1): each reload after a failed qc-runs read records another approve-attempt run; on the substitute every reload does.
- **`evidence` optional** (#197 contract N1): make it required when the substitute is revisited at the W4b kickoff.
- **Unused exports** `QC_UNAVAILABLE_REASONS` / `QcUnavailableReasonName` in `shared/src/schemas/review.ts` (#197 contract N3).
- **Small record wording**: W4-02 `plan.md` names the schema test at the wrong path (#193); W4-03 `spec.md` cites "plan-review notes on the ticket" (#194 contract round 2 N1).

## Known limitations

- **Labels provisional until D09.** Every W4a rule outcome, severity and fixture label is provisional; D09 confirms or replaces them. W4a settles no part of D09.
- **No content rules, extraction or model.** W4a reads only structured pack data. The `ACC-*` rules are catalogued but engine `content`: the deterministic runner neither runs nor counts them. Extraction, the evaluation harness, the frozen set and ADR-0006 are W4b's, which is not authorized.
- **Upload runs evaluate 0 rules.** No W4a rule has the `upload` trigger, so an upload run completes with 0 rules evaluated and no finding; the UI shows it as "not a clean pass", never "no findings".
- **Dedup deferred to W4b** (W0-07 3.4 step 6).
- **The in-memory API substitute is kept** through W4a unchanged (plan section 11; "W4a kickoff rulings"), serving `w3-07b-operator.rehearsal.substitute.spec.ts`; it has no catalogue and no qc-runs route. Revisit at the W4b kickoff.
- **The UI proof runs under the scripted substitute** (evidence configuration), and CI keeps `QC_MODE=substitute` because the W2/W3 journeys assert scripted `ACC-*` findings only W4b will produce.
- **Synthetic, localhost only.** No real data, networked access, external mail or production identity. Nothing deploys before D10.

## What Ta reviews

1. The exit evidence above: the two fixture test files, the real-server test, the W4-12 journeys, readiness `deterministic`, `check:substitute-absent`, and the section 8 gate, each with its rule revision, runner and fixture set.
2. That the W4a rule outcomes (the three `PACK-*` rules, their severities and owning lanes) are acceptable as a provisional starting set until D09.
3. The two items marked **Ta** under "Deferred reviewer notes": no upload run when no runner is bound, and serving locator heading/cell text.
4. The deviations the tickets recorded, especially the changed test expectations (W4-02, W4-11a, W4-13, W4-04, W4-12), each justified by the plan or the register.
5. Whether to accept W4a. Acceptance, and anything about W4b (D08, D09, owners, its gate entry), are Ta's decisions; this record makes none.

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes                                                                                                                                             |
| ----- | ---- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| -     | -    | -        | pending | Two independent reviewer verdicts on the PR head and green CI on that head (D03 ticket flow). Ta's package review of W4a is separate and pending. |
