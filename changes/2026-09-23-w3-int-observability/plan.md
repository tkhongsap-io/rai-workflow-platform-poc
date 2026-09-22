# Plan recorded before code

Read Heisenberg changes/2026-09-22-w3-int/plan.md matrix and coordinated directly with its owner (thread 01a0c995-c0b9-7340-a594-8f45ced26de6). Ownership acknowledged; no overlapping OBS-03/15 implementation. W0-10 observability-contract.md OBS-03/15 is authoritative.

1. Add tests/support/observability-database.ts: reject non-test/non-fixture use; validate literal loopback and identical host/port/database for all three role URLs and admin URL, rejecting routing overrides before connecting. Generate a random database name, optionally migrate/load fixtures, use private temporary blob/mail directories, and clean up only that generated database/directory.
2. Add tests/integration/w3-int-observability.test.ts: guard regressions; real startup against empty DB; healthy migrated process sign-in/search/Thai upload and complete process log assertions; restart against a kernel-selected closed loopback DB port with the previously issued cookie to prove liveness bypasses session lookup during outage.
3. Reuse existing process.ts, sign-in.ts and log-capture.ts unchanged. Allocate HTTP ports with existing helper. Use only DB54371 / Compose rai-w3-int-observability locally.
4. Install own dependencies, run focused integration tests, typecheck and lint. Inspect diff and resource cleanup. Record exact evidence and limits in review.md; commit only owned paths locally. Parent performs final full INT after dependencies merge.

No application seams or global module changes are planned. The closed-port scenario is explicitly required by OBS-03; it is not a fake readiness response. No full-suite acceptance claim.
