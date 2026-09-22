# Plan before implementation

## Ownership and gates

Created `/tmp/rai-w3-int-operator`, branch `codex/w3-int-operator`, from local main `e37fb4f` for planning only. Parent will supply the merged final base; do not infer that current main includes the required API/UI/runtime. No test code until the stable harness commit and interface arrive from Heisenberg (thread `01a0c995-c0b9-7340-a594-8f45ced26de6`).

Parent limits writes to the one browser spec and this own change packet. Consequently no shared board, root log, helper, startup, application, schema, locale, package or CI edits. Parent/Heisenberg records the shared board claim. The prerequisite UI and API reviews are not this sidecar's execution evidence.

## Harness reconciliation

Heisenberg reports a proposed `startJourneyServer(env, requestedPort?)` returning baseUrl, port, pid, bindCase(caseId), stop(). It uses a guarded test-owned child process and built startup; it is not yet a committed dependency for this sidecar. The current bindCase capability supplies an existing synthetic script, not the timeout/mail-failure controls needed here.

Requested minimal capabilities: configure existing sink permanent failure after ordinary setup mail settles; select bounded timeout on the same configured runner for a target submit; read captured structured child logs; identify target persisted rows via actual report and optional read-only SQL. Await exact committed names, control scope and cleanup guarantees. Do not invent endpoints or copy uncommitted implementation.

Heisenberg subsequently supplied stable checkpoint `8d0f2b5`. Inspected its committed journey-server.ts directly: startup/bindCase/stop match the handoff; captured child output is currently internal to the helper and failure controls are absent. This is sufficient to plan reuse, not to implement the worker-failure scenario. Parent still chooses the integration base; no cherry-pick performed.

## Owned file and sequence

1. After parent base/harness handoff, inspect exact exports and merged submit/observability/UI wiring. Reconcile this plan before coding if contracts differ.
2. Add only `rai-web/tests/browser/w3-int-07-desk-health.spec.ts`. Reuse `withIsolatedFixtureDatabase` and the committed shared launcher, retaining generated-database guards and canonical fixture loading. Stop the child before database cleanup, including assertion failures.
3. Establish synthetic cases and real authenticated workflow transitions. Use harness fault controls to create the OBS-09 terminal outbox row and OBS-10 timeout row through their workers. Poll observable completion with bounded expectations; never change SQL state or fabricate reports.
4. Corroborate target IDs/correlations and attempt counts using real report/log evidence; optional SQL is read-only. Render the same records as Admin, exactly once per target, then exercise Refresh/correlation selection and actual owner/anonymous denial.
5. Run the focused spec through existing real-server Playwright discovery at all three widths. Any test setup API calls are setup evidence; claim keyboard-only behavior only for actions actually performed with keys. No request/response interception.
6. Record actual base/harness/test SHAs, fixture identity, commands, counts, failures and artifact paths in review.md. Parent coordinates final suite, independent review and integration; no publication from this branch.

## Resources and verification

Proposed exclusive DB port 54372 and browser port 58849 had no listening process at planning time. This is an availability observation, not an allocated Docker service or proof against future conflicts. Parent confirms allocation; recheck before execution. No use of another agent's DB, including 54369. No service, database, dependency installation or browser run in this planning step.

Before implementation execution, use owned dependencies and ignored local configuration with all role/admin URLs on the allocated endpoint; the shared isolated helper creates and cleans its generated database. Respect the harness's actual port behavior rather than modifying it. Run focused lint/typecheck and the three-width browser spec, then relevant documentation checks. Keep the sidecar reviewable; raise a scope/size change before adding a second implementation file.

## Implementation checkpoint

Parent authorized implementation on committed helper `967eb33b089790cb5663646f9eb070c722ae457b`, then authorized actual merged UI `a0d4287e78117ef7d7e3d3c7587c7634cbc25b72`. Own branch fast-forwarded to helper and locally merged that actual main without conflicts. Only the spec and own packet are authored changes for handoff. Installed owned ignored dependencies with `npm ci --ignore-scripts` using Node 24.

Committed controls now include setSubmitTimeout, setMailFailure and capturedLines. Use real retry time, not advanceRetry. Heisenberg is correcting submit-only fault scoping and startup log capture; final browser proof waits for that fixed committed helper. Drafting and static checks may proceed. Parent allocated DB54372/browser58849; execution uses only those resources.

## Runtime dependency correction

Heisenberg supplied corrected helper `1e6ccc344071c7ac294b4b84c68870e939be589b` with unchanged public methods and trigger-plus-version timeout scope. Merged that commit and its committed OBS15 prerequisites without conflicts into local dependency head `5d043bc2e11f02a800d4ffb56ae1efd2d23b9429`; no shared file authored here. Actual UI main remains an ancestor. Parent's runtime wait is satisfied by the supplied corrected helper.

Run the focused real Playwright spec with Node24 and `.env.example` loaded as nonsecret defaults, shell overrides for test/fixture mode, all three role URLs on localhost54372 and PLAYWRIGHT_BASE_URL=http://127.0.0.1:58849. The first command without defaults refused startup on missing TRUST_PROXY before browser execution; no application change was needed. Base database migrated on the owned Docker project (eight migrations); scenario helper owns its generated per-test database and sink directories.
