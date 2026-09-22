# Review and evidence

Scope: W3-07a prerequisite contract from main 5fe59ad, isolated `/tmp/rai-w3-observability-contract`, branch `codex/w3-07a-observability-contract`. Parent independently reviews. No consumer code, route, UI, real QC, push, PR or merge. No OBS runtime acceptance claimed.

## Engineering reconciliation

- Shared TypeBox readiness/operator shapes, bounded safe category fields and typed digest-job provenance; W0-10/W0-07/implementation/persistence amendments link the exact successor contract.
- Migration 0007 reserved with parent confirmation; 03a/02 have no migrations, retry 04 has not reserved 0008. Generated with Drizzle, then completed with guards/grants. Existing migrations remain unchanged.
- Durable Bangkok day and UNIQUE(day, recipient) linkage protect digest dedup; SQL FKs and guards enforce actual run/notification provenance. New digest rows require a link at transaction commit. Historical rows are not revalidated. Recipients/domain validation remains owned by the mail contract.
- Historical QC reason NULL stays unknown; append-only late-result records survive without inventing a qc_run or owning lane.
- Ordinary audit provenance and the existing sink are unchanged. Parent relayed job interface to Hypatia; W3-03b requires the separate coordinated mail type/validator/sink regression contract before consuming it.

## Checks actually run — 2026-09-22

Node 24.21.0. Dependencies installed in this worktree with npm ci --ignore-scripts; no dependency or lockfile changes.

- `npm run typecheck`: pass.
- `npm run lint`: pass (ESLint, Prettier, CSS rule).
- `npm run test:unit`: 462 tests, 19 suites, 462 pass, 0 fail/skip.
- `OBS_MIGRATION_ADMIN_URL=<synthetic isolated admin URL on 127.0.0.1:54364> NODE_ENV=test node --import tsx --conditions=rai-source --test tests/integration/w3-07a-migration-contract.test.ts`: 1 pass, 0 fail/skip. Uses a disposable database created/dropped by the test, not other workers' databases. Commands run from rai-web.
- The committed smoke test applies through 0006, inserts historical QC/digest records, applies 0007 once and verifies a no-op rerun. It checks historical NULL preservation, invalid reason rejection, same-day duplicate rejection and next-day acceptance, orphan/wrong-run/day/event/correlation rejection, job finalization, role grants/append-only guards, Ready-only late results, duplicate refusal rejection and persistence after reconnection. It does not claim a complete workflow transition or server restart journey.
- `node scripts/check-links.mjs`: pass (0 broken links).
- `node scripts/check-frozen-source.mjs`: pass (source snapshot unchanged).
- `node --test scripts/*.test.mjs`: 18 pass, 0 fail.
- `git diff --check`: pass.

Initial validation caught widened TypeBox union inference and a nullable test row access; corrected before the final passing runs. No test failure remains hidden.

## Remaining gates

At initial commit aabee4c, full integration/browser/verify:full had not been run; the combined-main verification below supersedes that limitation. Runtime OBS tests remain with W3-07a/W3-INT and the actual notification/QC consumers; parent review and its required verification precede publication. The existing pack upload-trigger catch must be routed through safe capture by the runtime ticket. Synthetic submit-trigger timeout and late-QC-after-Ready acceptance remain explicit W3-INT tests.

No new product decision is required for this prerequisite. The existing unresolved owning-lane rule still blocks creating unavailable/pack-level findings, and W4+/real-data/production gates remain unchanged. No lane is invented.

## Combined main and Carver P2 — 2026-09-22

Merged requested main a26edc0 into this branch as 44dc9c4. The sole conflict was Lane A append history; both claims are preserved. Root logs and implementation amendments merged automatically. Queue service/query behavior and schemas are unchanged from a26edc0 except the existing observability re-export in queue.ts.

Carver reported one P2: a queued first delivery failure can have attempts=1 and lastErrorCode=sink_failure while next_attempt_at is NULL until W3-04 schedules it. Fixed FailureReportSchema to make nextAttemptAt optional; the new schema regression accepts the unscheduled state without inventing a date, accepts a real date and rejects an unknown/fabricated date string. SQL NULL is omitted from the response. No consumer code changed. Parent reported no other Carver findings; re-review of this fix remains with the parent.

The first combined full run caught the pre-existing exact schema inventory expectation, which needed 0007's tables/triggers/grants. Updated that test (including an exact column-level job UPDATE grant assertion) and explicitly reset operational tables in the test harness. The first environment also omitted required synthetic upload-limit values, causing spawned-process tests to refuse startup; supplied the tracked config-test defaults through explicit environment variables, without reading credentials. A second run passed 464 unit and 206 integration tests but was intentionally interrupted during browsers to apply Carver's P2; it is not counted as the final full pass.

Final commands: `npm run build` prepared the clean worktree; after the P2, `node --import tsx --conditions=rai-source --test shared/src/schemas/observability.test.ts tests/integration/w3-07a-migration-contract.test.ts` passed 7/7 (six schema tests and one opt-in migration smoke test), then `npm run verify:full` exited 0 on the final code. All commands used Node 24.21.0 and the complete synthetic test configuration, with DATABASE_URL/DATABASE_MIGRATE_URL/DATABASE_OPERATOR_URL and OBS_MIGRATION_ADMIN_URL on loopback 54364, PLAYWRIGHT_BASE_URL on 38788, SUBSTITUTE_PORT=38789 and SUBSTITUTE_WEB_PORT=35175. Parent's 54366/48788/48789/45175 were not used.

Final full-suite output:

- lint (ESLint/Prettier/CSS): pass; typecheck: pass.
- unit: 465 tests, 465 pass, 0 fail/skip/cancelled.
- integration: 206 tests, 206 pass, 0 fail/skip/cancelled, including the committed migration smoke test.
- build: pass; substitute-exclusion check: pass.
- real-server browser: 123 passed (2.1m).
- substitute browser: 90 passed (1.1m); development regression only, not acceptance evidence.

Full local output: `/tmp/rai-w3-obs-combined-final.log`. Repository link/frozen-source/diff checks also pass. No runtime observability consumers or new OBS end-to-end acceptance are claimed. The bounded types+persistence+proof size exception and the dependent-PR split fallback are recorded in plan.md for parent/Carver approval before publication. No push or PR.

Final shared observability schema SHA-256: `6a14fd9c4381f02dee9e868c752730c67754170c6d135f66a52f9dd5420f5962`.

## Independent review and prerequisite merge reconciliation

Carver re-reviewed `d931cea` after the optional queued-failure timestamp fix and reported no remaining high-confidence findings. Ten independently run schema/migration/inventory/grant tests passed on disposable databases; operational reset and the restricted UPDATE grants were verified. The parent merged main `a2392c9`, retaining both the notification-template and observability amendments. This does not change consumer acceptance boundaries. Final PR CI remains required before merge.
