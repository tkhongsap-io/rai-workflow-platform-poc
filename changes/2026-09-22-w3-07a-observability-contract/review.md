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

Full integration/browser/verify:full was not run for this contract-only change. Runtime OBS tests remain with W3-07a/W3-INT and the actual notification/QC consumers; parent review and its required verification precede publication. The existing pack upload-trigger catch must be routed through safe capture by the runtime ticket. Synthetic submit-trigger timeout and late-QC-after-Ready acceptance remain explicit W3-INT tests.

No new product decision is required for this prerequisite. The existing unresolved owning-lane rule still blocks creating unavailable/pack-level findings, and W4+/real-data/production gates remain unchanged. No lane is invented.
