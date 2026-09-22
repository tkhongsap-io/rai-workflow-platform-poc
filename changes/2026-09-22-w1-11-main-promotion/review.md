# W1-11 main promotion review

## Result and provenance

Local dependency promotion for W3 only, based on main `8c501f3`. PR [#68](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/68) reports base `codex/w1-00-mail-dedup` and merge commit `4eea86748b0b5b0e6801ce6059785026fd92f73d`. The initial promotion preserved all 11 sink files from that merge. Following Carver's concurrency finding, `base.ts` now serializes same-key delivery attempts and `concurrent.test.ts` is new; those files are not byte-identical to PR #68. The other 10 original sink files remain unchanged. No historical review is reused as current test evidence.

The fixture index retains every current export and adds the original `export * from './substitutes/mail-sink/index.js'`. Current shared mail types and `buildDedupKey` already exist on main and are not changed. The current config accepts only the two sink modes; case and version deep links agree with the current SPA routes. No manifest, lockfile, migration, other ticket code, root changelog or devlog change.

## Initial promotion validation (before concurrency fix)

These results apply to initial commit `af64f5b`, not the later concurrency fix. Node 24.21.0; locked install in this worktree. Synthetic fixture identity: `slice1-synthetic@1 7c80ccd43663`.

| Command (rai-web unless stated) | Result |
|---|---|
| `npm ci` | Passed; no dependency change. Existing lock resolves four moderate audit findings; dependency upgrades are outside this promotion. |
| `npm run typecheck` | Passed; rebuilds fixtures/dist in this isolated checkout. |
| `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test 'fixtures/src/substitutes/mail-sink/*.test.ts'` | 46 passed, 0 failed. Covers forced failures, unsafe/non-synthetic requests, duplicate identity, Thai text, restart persistence and absence of mail transports. |
| Root-package source import smoke check | MemoryMailSink, FileMailSink, qcSubstitute and FIXTURE_USERS all exported. |
| `npm run test:unit` | 451 passed, 0 failed. |
| `npm run lint` | ESLint, Prettier and CSS checks passed. |
| `npm run build && npm run check:substitute-absent` | Passed; 471 files scanned, zero substitute markers. |
| `npm run migrate && npm run fixtures:generate && npm run test:integration` | Passed: 7 migrations applied to the fresh isolated database; fixture generation passed; 198 integration tests passed, 0 failed (119.5 seconds). |
| Root: `node --test tests/*.test.mjs` | 22 passed, 0 failed. |
| Root: `node scripts/check-links.mjs` | Passed after review was added: 149 Markdown files, 696 relative links, 0 broken. |
| Root: `node scripts/check-frozen-source.mjs` | Passed; source hash matches sources.md. |
| Root: `node --test scripts/*.test.mjs` | 18 passed, 0 failed. |
| Root: `git diff --check` | Passed; repeated before commit. |
| Browser / `verify:full` | Not run here; parent owns the serialized full/browser validation and independent review. |

Test logs live outside the repository at `/tmp/rai-w3-mail-{npm-ci,typecheck,focused,unit,lint,build,repo,integration}.log`. No test secrets or runtime mail files are committed.

## Carver concurrency correction

Carver found the accepted-key check raced with the awaited record call: simultaneous attempts could both deliver. BaseMailSink now registers a per-key promise queue before yielding, waits for the preceding attempt, then performs the accepted-key check and recording inside that queue. A finally block releases every waiter even on failure and removes only the current tail; unrelated keys do not share a queue. A failed record never marks the key accepted, so a queued retry can succeed.

Four gated regression tests cover both MemoryMailSink and FileMailSink: concurrent successful attempts return delivered/duplicate; a suspended record that throws EIO returns failed followed by a successful queued retry. Each test also proves an unrelated key progresses, only one matching request is sent, and subsequent delivery is duplicate. File tests count the persisted JSON receipts and check the successful attempt number.

Post-fix verification: the focused mail-sink suite passed **50 tests, 0 failures**, including the four new regressions. Focused ESLint and Prettier checks passed for base.ts and concurrent.test.ts; git diff --check passed. Log: `/tmp/rai-w3-mail-concurrency-focused.log`. No database, browser, build or emitting typecheck was run during this correction because the parent owns an active verify:full in this worktree. Broad-suite results above are pre-fix evidence; parent must validate the final commit separately.

Serialization is per sink instance, not a cross-process file lock. W3 dispatcher/database coordination remains responsible for multiple processes. No new dependency or public interface.

## Isolation and dependency handoff

Integration uses only Compose project `rai-w3-mail-promotion`, its own `pgdata` volume, and loopback port `54331`. The worktree .env uses `54331` for both application and migration URLs; there are no inherited database environment overrides. Parent database `54320` and other Compose projects are untouched. The owned container, network and volume were removed with `docker compose -p rai-w3-mail-promotion down -v` after testing.

No missing shared-interface dependency was found. Parent must promote/review this commit before consumers depend on it on main. `MemoryMailSink` and `FileMailSink` are available through `@rai/fixtures` or the package's `substitutes/mail-sink/index` subpath. They expose health and forced-failure controls; those controls are not HTTP endpoints or new environment keys.

W3-03/W3-04 still own sink selection, notification composition, transactional outbox and retries. Their integration tests must prove authorized recipients, sign-in/scope on followed links, rollback suppression, concurrency/dedup and failure not undoing decisions. The sink trusts the caller's committed-event metadata; it does not query the audit database. Queue routes are still a W3 consumer contract: the promoted defensive validator permits `/queue` and `/queue/<segment>`, while digests require a case link for each breach entry. No queue implementation is added here. The W0-07 daily digest database mapping and retry policy remain consumer-owned open items. Substitute unit success is not real-mail or W3 exit acceptance.

Carver's independent review identified the race; re-review at d2f4d47 found no remaining high-confidence findings. Carver independently passed 50 focused tests, a 20-call burst with exactly one delivery, four queued attempts with two failures, and file dedup after restart. Per-instance locking is intentional; dispatcher cross-process coordination remains W3-04. Parent opened draft PR #107 and owns publication and final validation. This agent performed no external mail, push, PR creation or merge.

Parent baseline full verification passed 451 unit, 198 integration, 123 real-server browser and 90 substitute browser tests. Final-fix CI is required before merge; no production acceptance claimed.
