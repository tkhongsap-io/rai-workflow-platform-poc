# File-level plan — awaiting parent scope approval

## Findings and ownership

At b060df1, 17 integration files value-import @rai/server/app. Fourteen supply custom streams; two hard-code error level and omit a stream, and w1-12-harness uses parsed harness defaults without a stream. Existing per-suite audits cover only a subset. Tests rebuild apps and clear local captures; lifecycle accounting must retain independent evidence across those operations.

Confucius confirmed that w3-int-observability.test.ts and tests/support/observability-database.ts remain theirs. Their process tests await server.stop and add actual token/cookie/encoded canaries. Existing process.ts already decodes UTF-8 and audits captured lines at stop; no edits there are proposed. The helper needs all three explicit role URLs on one loopback endpoint. Do not run database suites against a sibling worker's reservation.

## Proposed files

| File | Planned change |
|---|---|
| rai-web/tests/support/observed-app.ts (new) | Same-signature test wrapper around real buildApp, info-level serialized tee, private capture/failure registry, after-test audits and final drain/audit. Keep closed captures guarded against late writes; propagate custom-stream errors without exposing their contents. |
| rai-web/tests/support/log-capture.ts | Reuse existing canaries/UTF-8 decoding. Add only the minimal sticky auditing/tee primitive needed by the wrapper; existing createLogCapture/assertNoLeak contracts and clearing behavior stay compatible. |
| rai-web/tests/support/integration-log-policy.ts (new) | Small TypeScript-AST/import-resolution policy checker for integration entry points and reachable test helpers; raw app construction has one explicit wrapper exception. TypeScript is already a dev dependency; no dependency change. |
| rai-web/tests/support/fixtures/observed-app-scenario.ts (new) | Isolated child node:test scenarios for safe output and intentional immediate/background/post-close leaks. Intentionally failing scenarios are outside the normal *.test.ts discovery pattern and are run only by the control test. |
| rai-web/tests/integration/w3-int-log-coverage.test.ts (new) | Mechanical current-tree guard, bypass controls, exact stream/UTF-8 assertions and subprocess controls proving a leak makes the runner fail. |
| The 17 files below | Replace only the factory value import with the observed wrapper. Preserve type imports, custom streams, assertions, fixture setup and workflow behavior. Adjust teardown only where needed to await already-owned background work; document any such exception. |
| changes/2026-09-23-w3-int-log-coverage/{intent,spec,plan,review}.md | Scope, lifecycle contract, file inventory, actual evidence and residual boundaries. |

The 17 files, all under rai-web/tests/integration/:

- w1-01-fixture-sign-in.test.ts
- w1-02-cases.test.ts
- w1-03-helpers.ts (also covers its upload/storage suite callers)
- w1-04-pack-draft.test.ts
- w1-05-submit.test.ts
- w1-12-harness.test.ts
- w2-01-lanes.test.ts
- w2-02-lane-decision.test.ts
- w2-03-successor-draft.test.ts
- w2-04-resubmit.test.ts
- w2-05-dispositions.test.ts
- w2-06-ready.test.ts
- w2-09-version-findings.test.ts
- w3-01-queue.test.ts
- w3-03a-notifications.test.ts
- w3-03b-digest.test.ts
- w3-05-sla.test.ts

## Validation

1. Positive controls use real Pino serialization through the wrapper. Safe output succeeds; forbidden marker, Thai filename split across single-byte chunks, fixture email/name and a forbidden late background write fail the isolated runner with a generic diagnostic. Include a post-close write and an intentionally caught write error so a swallowed exception cannot hide the failure.
2. Verify exact byte forwarding to supplied streams, retained callback/error behavior, no mutation of caller config, and audit retention after caller clears its own capture. Prove info events are observed even when the caller initially requests error level.
3. Policy fixtures reject direct, aliased, namespace, dynamic and helper-re-export bypasses, and accept wrapper imports and type-only App/AppDeps imports. Scan the real integration graph, including future files; do not exempt Confucius's process file from scanning, only from edits.
4. Run lint/typecheck, the new pure/control tests, then the complete W1-W3 integration suite at info through the wrapper on a coordinated isolated DB. Inspect failures for real leakage versus teardown defects; no suppression/allow-list expansion merely to go green. Existing process-harness tests run unchanged.
5. Parent integrates the test-only patch into INT and runs the final combined suite with Confucius's process tests. Confirm no diffs under server/, shared/, web/, fixtures/, manifests or production settings. Report counts and scope separately from parent acceptance. No PR or push.

Expected scope is a few hundred test-support/control lines plus import-only changes across 17 files. Report actual size after implementation; stop for scope coordination if lifecycle repair requires application changes. Parent approval is required before code, explicitly requested in the task.
