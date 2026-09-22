# Review and evidence — 2026-09-23

Parent approved the file-level plan; plan committed as 62a8415 before implementation. Base b060df1, isolated /tmp/rai-w3-int-log-coverage on codex/w3-int-log-coverage. Port54373 and compose project rai-w3-int-log-coverage were unused before creating the dedicated synthetic database; Docker confirms 127.0.0.1:54373. All three role URLs and the migration-admin proof URL were explicitly set to that instance. No credentials file was inspected.

## Implemented scope

All 17 inventoried integration factory imports now use tests/support/observed-app.ts. Their existing custom streams, assertions, fixtures and workflow logic are unchanged; mixed imports retain type-only App/AppDeps imports from the application module. The wrapper clones test logger options to info/JSON, preserves the real App interface, and tees serialized bytes into private audit history plus the caller's stream. It neither clears nor ends caller streams. Per-test audits leave reused apps alive; final auditing waits on the existing drain, retains all earlier captures and observes writes after close.

The audit uses StringDecoder and the existing FIXTURE_FORBIDDEN list without exceptions. A sticky failure sets the test process exit status, so callers cannot suppress it by catching a write error, clearing their own capture or emitting after the last audit hook. It emits no captured values in its error. The subprocess controls prove the resulting node:test process exits nonzero; this is not merely a unit assertion that the helper throws. Stream write callbacks/errors are retained; a forwarding error also fails the audit.

The TypeScript-AST guard scans integration entry points and reachable test helpers. It rejects raw app value imports through named aliases, namespaces, dynamic literal import, require, import-equals and helper re-exports; nonliteral module access is rejected. Type-only imports and the single observed wrapper are permitted. This is an accidental-bypass regression policy for the test graph, not a sandbox against arbitrary eval/generated code or proof about unrelated external processes.

## Executed checks

- Focused controls: 13 passed. Safe info-level serialization, unchanged caller options, app reuse across tests, exact asynchronous byte forwarding, non-ending stream ownership, AST bypass controls; deliberate marker, fixture email/name, cleared/rebuilt capture, tracked background, post-close, post-final-audit, caught split-UTF-8 leak and forwarding-error scenarios fail their isolated runner as expected.
- Complete integration suite: 269 passed, 38 suites, zero failures/skips. Includes all W1-W3 integration files present at b060df1 and the 13 new controls; existing process tests run unchanged. The previous 256-test baseline is preserved.
- Lint, typecheck and build passed. Repository links: 207 Markdown files / 725 links / zero broken; frozen product-source hash unchanged; diff whitespace check passed.
- Logs: /tmp/rai-w3-int-log-controls.log, /tmp/rai-w3-int-log-integration.log, /tmp/rai-w3-int-log-lint.log, /tmp/rai-w3-int-log-typecheck.log, /tmp/rai-w3-int-log-build.log. Synthetic execution environment: /tmp/rai-w3-int-log-env.sh.

## Boundaries and handoff

No changes under server/, shared/, web/, fixtures/, manifests/lockfiles, production configuration or tests/support/process.ts. No global stdout patch or new product environment flag. Published API123 worktree remains untouched. Confucius's w3-int-observability.test.ts and observability-database.ts are excluded from writes and are not present in this b060df1 base; parent must combine them and run final INT verification. Their existing process capture remains exit-event based, not newly certified stream-close coverage. Extra actual-token/encoded-query canaries in those scenarios remain their separate evidence.

This proves the planned in-process OBS15 gap is covered for the executed integration graph and detects the tested late-write cases. It does not claim browser-wide or arbitrary process-wide interception, nor completion of W3-INT's remaining business journey. Independent review and parent integration remain pending. Local commits only; no PR or push.
