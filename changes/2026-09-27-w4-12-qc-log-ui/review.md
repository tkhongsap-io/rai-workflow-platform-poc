# Review: QC log, evidence and unavailable runs in the UI (W4-12, #189)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4a plan](../../docs/engineering/implementation-plan-w4a.md) section 7 (commands: section 8; amendment: section 12), with the plan-review notes on the ticket. Decisions implemented: register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26). Agent-eligible; the read shapes are contract (W0-02 section 7.7 amendment in this PR). Synthetic data only; no document parsing, model, provider or network call. Rule outcomes stay provisional until D09.

## Change

- **`shared/src/schemas/review.ts`**:
  - `EvidenceLocatorSchema` (the W0-07 3.3 locator kinds) and `FindingEvidenceSchema` `{ slot, artifactId, locator }`.
  - `evidence` on `StoredFindingSummary` and `FindingWithDisposition` (optional at the schema layer; see Deviations).
  - `QcRunSummarySchema` and `VersionQcRunsResponseSchema`.
- **`server/src/qc/repository.ts`**: `evidenceView` maps stored `qc_finding.evidence` to the read shape. It copies the locator's known fields only, drops `content_hash` and `excerpt_hash`, and leaves out an entry whose locator kind is unknown. `storedFindingSummary` uses it, so the findings read carries evidence.
- **`server/src/qc/orchestrator.ts`**: the lane `qc-run` response's summaries (defects and the QC-UNAVAILABLE finding) carry `evidenceView` of exactly what was stored. Nothing else in the orchestrator changes.
- **`server/src/findings/repository.ts`**: `listQcRunsForVersion`, one query:
  - the run rows of the version, joined to the version's case;
  - the `qc_rules` configuration revision whose ID is the run's `rule_revision`, for `label` (`null` when none);
  - a per-run finding count;
  - ordered by `requested_at`, then `id`.
- **`server/src/findings/routes.ts`**: `GET /api/cases/:caseId/versions/:versionId/qc-runs` with the findings read's guard: `version.view` on the case, then 404 for a malformed, unknown or other-case version.
- **`web/src/api/client.ts`**: `listQcRuns`.
- **`web/src/screens/case/view-model.ts`**: `ruleLabelKey`, `evidenceLocatorKey`, `evidenceLocations`, `qcRunOutcome` (`unavailable`, `no_rules`, `findings`, `no_findings`, `not_recorded`), `qcRunOutcomeKey`, `qcTriggerKey`, `unavailableRuns`, `laneRunEmptyStatus`.
- **`web/src/screens/case/qc-log.tsx`** (new): the "QC log" section on the submitted-version view. Each run shows:
  - an outcome badge;
  - its trigger and scope;
  - runner and version;
  - rule revision (label, or the ID when there is no label);
  - rules evaluated (or "not recorded") and findings stored;
  - the requested time.

  Loading, empty and error states (error with reload, the rest of the view stays).
- **`web/src/screens/case/finding-list.tsx`**:
  - A finding row adds its rule (label and ID, or the ID alone for an uncatalogued rule), "Owning lane: …", and its evidence locations (slot or pack level, and locator kind).
  - `QcUnavailableBlock` now lists every unavailable run it is given, each with its scope, reason and run ID, in one `[data-review-qc="unavailable"]` block.
  - `FindingsList` takes `emptyStatus` instead of `laneQcRan`. The new `no_rules` status is a warn badge ("0 rules evaluated: not a clean pass") and a sentence, not "found no defects".
- **`web/src/screens/case/reviewer-workspace.tsx`**:
  - A lane's workspace reads the version's QC runs after its lane run, beside the findings.
  - It shows every unavailable run on the version, from any trigger, above the findings and the decision controls. It adds the lane's own unavailable run should it not be in the list yet.
  - It uses `laneRunEmptyStatus` for an empty list.
  - It tells the case screen after a lane run, so the QC log reads again.
  - The owner/BU-SPOC proposal panel does not read runs; it has no decision controls.
- **`web/src/screens/case/case-screen.tsx`**: renders `QcLog` after the frozen pack on every submitted version; `onQcRunRecorded` (stable) bumps its refresh key. **`case.css`**: styles for the log, the list and the no-rules state.
- **Locales** (`th.json`, `en.json`): `qc_log.*` (heading, intro, empty, error, list label, outcomes, triggers, scopes, runner, revision, rules, findings, requested time); `review.evidence.*`; `review.findings.rule`, `rule_unlabelled`, `owning_lane`, `no_rules`; `review.qc.unavailable_runs_label`. The W4-03 `qc.rule.*` keys give the rule labels.
- **Docs**: the dated W0-02 section 7.7 amendment (`docs/engineering/implementation-plan-w1-w3.md`) for the evidence field and the qc-runs read.
- **Tests**:
  - `tests/integration/w4-12-qc-runs.test.ts` (new, 5 tests; fixture app with the W1-10 scripted substitute):
    - the three-run order and every field (submit 0 rules, AI/COE 2 rules and 2 findings, DPO `runner_error` with 1 finding; label `w4a.1`), and no write;
    - a pre-0009 row (`unrecorded`, null count) under a revision that is not `qc_rules` (null label);
    - evidence on both finding shapes (section and page locators; `absent` for the outage), with the scripted excerpt hash and any `excerpt`/`content_hash` field absent from the body;
    - scope: 7 actors × 5 targets, each status and error code equal to the findings read's, pinned to 401/200/403/403/200/200/200 and 404 ×4;
    - a draft's upload run, listed for the owner, the CM SPOC and a reviewer (as the findings read) and 403 for another owner.
  - `tests/integration/w4a-int-deterministic-server.test.ts` (+1, real server, `QC_MODE=deterministic`): over HTTP, the qc-runs read of `fx-case-vendor` lists the upload run carried from the draft (slot 1, 0 rules), the submit run (3 rules) and a DPO approve attempt (1 rule). Each run names `deterministic`, the server version, the version's revision and `w4a.1`. Another owner gets 403.
  - `web/src/screens/case/view-model.test.ts` (+5) and `web/src/api/client.test.ts` (+1).
  - `tests/browser/w4-12-qc-log.spec.ts` (new, 2 tests × 3 widths, real server, evidence configuration):
    - On `fx-case-na-reasons` (with a seeded upload outage; see Deviations), the DPO sees both outages (the upload run and the AI/COE lane run) in one block before the decision controls, and its own 0-rule run reads "no_rules", not "empty". The QC log lists the four runs as unavailable / no_rules / unavailable / no_rules with the `w4a.1` label. Checked in th and en, with axe and no horizontal scroll. A keyboard-only approve names the DPO run.
    - On `fx-case-vendor`, the AI/COE finding rows show the rule label and ID, "slot 1 (section)" and "slot 1 (page)", and the owning lane, in th and en with axe; the excerpt hash is not in the page.
  - `tests/browser/w2-int-journey.spec.ts`: two expectations changed (see Deviations).

## Deviations

- **`evidence` is optional in the shared schema.** The real server always sends it, and the integration tests assert it on both shapes. The in-memory API substitute validates its findings responses against these schemas, and W4a does not extend it (W4a plan section 11; "W4a kickoff rulings"). A required field would have forced a substitute change. The screens render a missing `evidence` as "no location recorded".
- **What the locator carries.** The read serves the W0-07 3.3 `EvidenceLocator` as stored: a `section` heading and a `cell` sheet and cell are locator fields, so they are served. `excerptHash`, `contentHash` and any excerpt never are; the runner keeps no excerpt (W0-07 3.3). The UI shows only slot and locator kind, as the plan asks. If reviewers read the plan's "no text" as excluding headings too, the smallest change is to serve `{ kind }` plus numeric positions only.
- **A draft's runs and reviewers.** Plan section 7 says the read is "authorized exactly like that version's findings read (W0-05; a draft's runs only for those who may read the draft)". Under W0-05, `case.view` and `version.view` let lane reviewers and Admin read a draft (W1-04 T10). So the findings read already serves a draft's findings to them, and this read does the same (the integration test pins it). Plan section 5's aside "(owner, BU SPOC). Reviewers see them once the version is submitted" describes the screens: the QC log appears only on a submitted version's view. No authorization rule was added or narrowed.
- **The reviewer workspace fails closed.** If the qc-runs read fails, a lane's workspace shows its error notice with reload and no decision controls, because it cannot show the outages the plan requires before a decision. **On the substitute** (not extended), the route does not exist and answers `404 not_found`:
  - a substitute-served lane workspace therefore shows that error and no decision controls;
  - the QC log shows its own error with reload;
  - the owner panel is unaffected.

  No substitute spec reaches those screens: the one remaining spec, the operator rehearsal, only asserts the version URL. `npm run test:browser:substitute` passes 48/48.
- **Pre-0009 runs.** The plan is silent on a completed run whose `rules_evaluated` is NULL. The log reads it as "Rules evaluated were not recorded" (`not_recorded`), never "no findings", because it cannot claim that any rule ran.
- **Existing test expectations changed by the plan.** In `tests/browser/w2-int-journey.spec.ts`, the DPO workspace on `fx-case-nonvendor` (twice) expected `[data-review-qc="empty"]` "This lane's QC run found no defects". The substitute has no DPO script there, so that run evaluated 0 rules; plan section 7 requires such a run to read differently from "no findings". The spec now expects `[data-review-qc="no_rules"]` with `review.findings.no_rules`, and asserts that `empty` is absent. No other existing expectation changed. `FindingsList`'s `laneQcRan` prop became `emptyStatus`, and `QcUnavailableBlock` takes a list of runs; both are internal to the case screen.
- **The QC log is not a live region.** Its loading and empty lines carry no `role="status"`. Existing specs read the submit and decision notices with an unscoped `getByRole('status')`, and a second status on the version view broke them in the first full run: `w1-int-06` and `w1-int-journey` failed on a strict-mode violation. The log is static content read on arrival.
- **A seeded outage in the browser spec.** The evidence configuration binds the substitute, whose bundled scripts have no `upload` entry since W4-04, so no upload run there is ever unavailable. To show an outage from a trigger other than the lane's, the spec inserts one synthetic upload run on the draft before submit: slot 7, `timeout`, lane NULL, 0 rules, with its QC-UNAVAILABLE finding owned by IT/Security. These are the rows W4-04 writes. The integration tests produce real outages through the orchestrator.
- **Test order in the browser layer.** The unit and integration tests were written first and seen failing: route 404, `evidence` undefined, missing exports. The browser spec was written after the components. It was seen failing by restoring the five case-screen files to `main` and rebuilding: both tests fail waiting for `[data-qc-log="ready"]`. Then the files were put back.
- **Orchestrator touched.** `qc/orchestrator.ts` is not among W4-12's main paths (plan section 9). It changes only so that the lane `qc-run` response, a `StoredFindingSummary`, carries the same `evidence` as the findings read.

## Commands and results

Worktree `/tmp/rai-w4-12-qc-log-ui`, Postgres project `rai-w4a` on 55380, `rai-web/.env` from `.env.example` with the ports rewritten (8797/8798/8799/5185), `OBS_MIGRATION_ADMIN_URL` added and `QC_MODE=deterministic` (the default). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w4-12-qc-log-ui-logs/`.

| Command (from `rai-web/` unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture QC_MODE=substitute node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w4-12-qc-runs.test.ts` | 0/5: the qc-runs route answered 404 and `evidence` was `undefined` on both shapes |
| RED: same runner (without `QC_MODE`), `tests/integration/w4a-int-deterministic-server.test.ts` | 5/6: the new qc-runs test got 404 |
| RED: same runner, `web/src/screens/case/view-model.test.ts web/src/api/client.test.ts` | `does not provide an export named 'evidenceLocations'`; `client.listQcRuns is not a function` |
| RED: `npx playwright test -c tests/browser/playwright.config.ts --project=desktop-1440` with the five case-screen files restored to `main` | both W4-12 tests fail: `[data-qc-log="ready"]` not found (every other desktop test passed, 66) |
| First full `npm run test:browser:server` | 194 passed, 8 failed: `w1-int-06` and `w1-int-journey` (strict-mode `getByRole('status')` hit the QC log's status line; fixed by dropping that role) and `w2-int-journey` (the `empty` expectation above; changed as the plan requires) |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css). The first run flagged prettier formatting in five new or changed code files; formatted. |
| `npm run typecheck` | exit 0. The first run flagged `result.run` on the error branch in `reviewer-workspace.tsx`; fixed. |
| `npm run test:unit` | exit 0, 648/648 |
| `npm run test:integration` | exit 0, 374/374 (368 before + 5 in `w4-12-qc-runs.test.ts` + 1 real-server qc-runs test) |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 675 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 202 passed (8.2 min): 196 before + 2 W4-12 tests × 3 widths |
| `npm run test:browser:substitute` | exit 0, 48 passed (31.4 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 357 Markdown files, 962 relative links, 0 broken |
| `git diff --check` (repo root, staged) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). Ta reviews the W4a exit record.
