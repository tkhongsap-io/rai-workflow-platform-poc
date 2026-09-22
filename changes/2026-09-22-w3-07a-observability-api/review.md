# Review and evidence

Current review candidate includes actual main 848f89e, reviewed retry preparation d96ba24 plus isolated browser harness fix fecffd4 (local e6868f5), and reviewed digest binding 9e17851. Actual retry and producer fault paths are now tested; the chronological checkpoint notes below retain their original evidence boundaries. Pending publication merges are not represented as merged acceptance.

Submit-QC API is available at 1bf72b8; W3-INT owns after-commit binding and restart acceptance. Issue 35 owning-lane decisions remain unresolved. Combined verify:full is running against this assembled tree; independent review remains required before a PR. No push or PR is authorized here.

## Independent module checkpoint — 2026-09-22

Plan committed as 20391e5 on prerequisite head 9980c7e before consumer code. Added independent health/cache, store probes, typed capture/stack sanitizer and bounded operator queries. No app/start/main integration or notification/QC worker edits in this checkpoint.

Verified: full lint and typecheck; 14 observability unit tests (including existing log/started tests); 2 real PostgreSQL query/probe tests on dedicated compose project rai-w3-obs-api, DB54368. Tests cover exact identity refusal vocabulary, non-gating QC outage, timeout/error redaction, cache coalescing, stack inventory filtering, error levels/classification, unknown migration hashes, no blob probe writes, actual rai_app journal access, unknown historical QC reasons, unscheduled queued failure, terminal category derivation, persisted failed-job projection and 100-row bound. Query tests insert synthetic diagnostic records directly: they do not certify notification producers, retries, digest execution or actual HTTP behavior.

Pending: route/startup wiring, actual process and HTTP noPII/correlation acceptance, QC diagnostics/late-result runtime, integrated notification acceptance OBS-07/09/11, W3-INT synthetic submit trigger OBS-10, full combined verify:full. No PR/push. Parent coordinates startup handles after W3-04 merge. Independent modules are a local checkpoint, not completion of issue48 or OBS-01–16.

Full current unit suite also passed: 480 tests, zero failures. This is unit evidence only; full runtime integration remains pending as listed above.

## App/routes and QC checkpoint — in progress

File-level changes: app.ts owns one safe error capture per HTTP failure and request-completed logging; observability/routes.ts registers silent healthz, readiness and the existing operator.view-authorized query. ErrorCapture.internal/notFound provide safe dedicated entry points. findings/routes.ts passes the app's emitter/capture into the existing QC orchestrator. qc/repository.ts stores the bounded unavailable reason; qc/orchestrator.ts assigns an attempted run ID before invocation, preserves it on successful persistence or late refusal, emits completion/unavailability only after commit and suppresses replay events. pack/service.ts replaces the legacy raw-error-name qc_upload_trigger log with safe internal capture, leaving the committed draft response intact. No start.ts/main.ts or notification worker edits yet.

Authoritative audit mapping: AUDIT_ACTIONS in server/src/audit/store.ts defines version.submitted and qc.run_recorded. Existing submit transactions write version.submitted with the real audit_event.id and target_version_id; the test queries that row and joins its correlation_id to the response header/request-completed log. Existing QC persistence writes qc.run_recorded with target_ref.run_id equal to the stored qc_run.id; tests join this exact reference and correlation to the QC response and qc.run.unavailable/error.captured events. An audit event ID is never substituted for a QC run ID. Late refusal has only qc_late_result.qc_run_id (the attempted ID, not a qc_run FK), and no new business audit type/event, QC run or finding.

Focused proof: 18 PostgreSQL/HTTP query, QC and operator tests passed; full lint/typecheck and 483 unit tests passed. Actual HTTP handler tests prove once-only capture, server-minted correlation, sanitized internal stack and canary exclusion. Late-result test holds a synthetic runner, uses the existing owner-role test fixture to set Ready while in flight, and proves 409 plus one durable late diagnostic visible to Admin, zero qc_run/finding writes and unchanged audit count. This is a synthetic race test, not the full three-lane Ready journey or real QC. Submit-trigger QC remains W3-INT. Operator access exercises actual fixture sign-in/session middleware across all fixture identities, including dual-role denial. The newly activated policy row is the separate prerequisite f595405, not a silent consumer policy change.

NoPII coverage currently includes serialized HTTP test logs and after-test assertions in the existing pack-draft, findings/QC and queue suites, covering sign-in and owner-name search. Whole-suite/process/browser coverage is not yet claimed. Current full integration suite is running; final evidence follows separately. OBS-07/09/11 actual notification integration and startup wiring remain pending merged dependencies; no second sink, runner or worker exists.

Additional W0-10 logging changes: static.ts marks successful bundled assets/history responses so app.ts suppresses their request-completed events; API errors remain traced. request-completed records the bounded error category and uses the specified severity (expected 401/404/409/invalid-input at info, forbidden/unsafe-upload at warn, 5xx at error). log.ts removes Pino's default hostname/pid metadata; the existing processId remains. tests/support/process.ts asserts fixture canaries on captured stdout/stderr when a spawned server is stopped through the shared harness. These are logging changes only, not startup dependency wiring.

The pre-static-suppression integration run passed all 211 tests (including migration smoke) on DB54368. Current full verify:full runs after the static/hostname/process-harness changes; do not transfer the earlier count as final-head evidence. Separate prerequisite published by parent as draft PR117 at a5323d0; local equivalent f595405 remains a dependency, not proof of merge. Current main/dependency publication is coordinated by parent.

### OBS evidence boundary at the independent API checkpoint

| Obligations | Evidence / remaining work |
|---|---|
| OBS-01 | Pure readiness tests cover every shared refused identity reason and all gating dependencies; QC outage remains non-gating. |
| OBS-02 | Existing actual-process refusal tests run in the full suite; final structured startup capture/dependency wiring remains reserved for integration after W3-04. |
| OBS-03–05 | Actual HTTP handler returns 503 for a closed DB port and 200 with live migrated Postgres; healthz stays silent/200. Probe enum/timeout/body canary checks pass. Missing-journal/pending migration HTTP scenario still needs its final integration test. |
| OBS-06/08 | Actual submit and lane-QC HTTP requests join response correlation to persisted authoritative audit/QC references and logs. Late Ready refusal is separately proved without new evidence/audit. |
| OBS-07/09/11 | Pending actual merged composer/retry/digest integration. Hand-inserted query fixtures are not producer acceptance. |
| OBS-10 | W3-INT synthetic submit trigger remains explicit; no W4 QC or unavailable-finding owning lane is invented. |
| OBS-12 | Actual session middleware across all fixture identities passes with Admin-only operator.view; separate policy prerequisite PR117 must merge. |
| OBS-13/14 | Actual synchronous HTTP failures and internal canaries pass; QC/mail typed job classification tested separately. Actual terminal mail capture still awaits W3-04 integration. |
| OBS-15 | Per-test checks cover pack-draft, QC/findings and queue logs, plus servers stopped via the common process harness. Whole W1–W3/browser stdout coverage is still incomplete and must be proved before completion. |
| OBS-16 | Existing strict-unknown-field/drop tests pass in the full unit suite. |

No remaining finding-ownership question is resolved by these tests. The Ready race sets Ready through the established owner-role test fixture; it does not replace W2's business-transition acceptance or W3-INT's integrated synthetic trigger tests.

## Verified app/routes/QC checkpoint

Full verify:full exited 0 after all runtime changes in this checkpoint: 484 unit, 211 integration (including migration smoke), 123 real-server browser and 90 substitute browser tests. Lint, typecheck, build and substitute-isolation checks passed. Evidence: /tmp/rai-w3-api-full-checkpoint.log; isolated DB54368, HTTP18788, substitute API18789, web15175. Product source hash unchanged and repository links/diff checks pass. This is the current prerequisite-based tree, not actual-main plus pending notification dependencies; the OBS table above remains the acceptance boundary.

Parent approved the minimal notification seams and direct coordination with Hypatia (03b) and Heisenberg (W3-INT). Hypatia retains digest loader/filter/scheduling wiring and existing beforeStage faults; 07a retains safe terminal/runtime capture and readiness handles. App/start overlaps are additive and require combined-head verification. Current lane-only QC entry must not be used for submit by inventing a lane; a lane-null submit entry needs explicit interface coordination with W3-INT before binding. No new owning-lane assignment is authorized.

### Confucius checkpoint corrections

Addressed both reported defects: the two public health routes bypass cookie session resolution; readiness logs its initial status and subsequent status transitions only. Added HTTP regressions with a throwing session resolver and protected-route control, plus ready/not-ready/recovered repeated polls. Focused HTTP/auth middleware suite: 13 passed. Typecheck and targeted ESLint/Prettier passed. These are focused correction checks; combined full verification and notification integration remain pending. Submit-QC implementation changes are excluded from this correction commit.

### Server-local submit-QC API checkpoint

Added runAndPersistSubmitQc(deps, {caseId, versionId, correlationId}) using the existing orchestrator, runner, unlocked wait and locked persistence recheck. Submit trigger has lane null; same-process concurrent calls coalesce and stored terminal outcomes replay. Historical null unavailable reasons replay as unknown. No trigger binding, invented lane or new runner. Focused database suite: 18 passed, including submit concurrency/replay and post-Ready refusal with durable diagnostics but no QC run, finding or audit. Typecheck and targeted lint passed. W3-INT owns the after-commit trigger and restart acceptance; issue 35 remains open. Independent review remains required.

### Actual retry/runtime preparation checkpoint

The existing dispatcher now receives the app-owned ErrorCapture: an unexpected load/query failure captures safe internal_error, while a committed terminal fourth receipt captures mail_delivery_failed with the notification ID, attempts and bounded retained cause. Existing mail.failed remains a separate domain event. start.ts readiness observes the same configured sink health() and runner probe(); no extra worker, sink or runner. main.ts unexpected startup failure no longer emits raw exception names. Actual retry integration suite: 21 passed, including fourth-failure capture once and Admin operator read view. Runtime shutdown/error suite: 5 passed; actual startup suite: 7 passed, including cookie-bearing probes with refused DB connection and live configured sink/QC probes. Typecheck and targeted lint passed before the final startup-test addition. This is preparation against d96ba24, not merged-dependency acceptance.


### Combined producer fault proof and dependency assembly

Merged actual main 848f89e after digest preparation. Add/add conflicts from the squashed composer preserved the later reviewed retry dispatcher, digest loader and 07a capture/readiness changes; the lane-B board retained both append entries. Cherry-picked only fecffd4 for browser outbox isolation; production code unchanged by that patch.

Actual digest producer query/render/enqueue fault tests now join the persisted operator_job_run correlation to exactly one sla.digest.failed and the operator read model's last run/recent failures. All 20 digest integration tests pass; raw error/address canaries stay absent. The daily producer's unexpected-error callback now uses the same app-owned errors.internal; known persisted stage failures retain their existing domain event. Shared log capture and child-process decoding preserve split UTF-8 characters, with a committed negative Thai-filename regression so byte boundaries cannot evade noPII checks.

Current scope remains API/diagnostics plus authorized minimal existing-runtime seams. No second mail worker, sink, scheduler or QC runner; no real QC or invented owning lane. Root issue acceptance still includes W3-INT submit binding, the explicit pending-migration HTTP scenario and whole-suite/browser noPII coverage beyond the recorded canary captures. Schema version remains truthful unknown when not established; do not promote a guessed migration number. The size exception for the prerequisite contract does not cover this consumer: recommend a cohesive review split between independent observability modules and runtime integration before publication if the parent cannot approve a bounded exception.

### Stable runtime candidate full verification

Runtime code candidate 5383047 passed verify:full: 527 unit, 255 integration, 126 real-server browser and 123 substitute-browser tests; zero failures. Lint, typecheck, build and substitute-isolation checks passed. Evidence: /tmp/rai-w3-api-combined-full.log. Dedicated DB54368 / HTTP18788 / substitute18789 / web15175; reviewed file-sink isolation patch fecffd4 prevents the competing-worker harness race. Repository checks: 200 Markdown files, 725 relative links, zero broken; frozen source hash unchanged; git diff --check passed. Independent runtime review by Parfit is pending; this local full run is not publication CI or completion of the remaining acceptance boundaries above.

Publication split recorded by parent: core PR121 at 4a08ea2 selects 20391e5+4a8f156 onto 52a80ed, without activation; its published worktree is not edited by this worker. Later core fixes remain in runtime. Runtime PR waits for core/03b merged dependencies, actual-main assembly, independent review and its own bounded size assessment. Retry PR120 merged as 5b2e34b while browser CI was still running: no all-CI claim. No auto-merge is permitted; all required checks must complete before any merge. No push or PR from this worker.
