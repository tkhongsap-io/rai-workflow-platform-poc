# W1-11 main promotion review

## Result and provenance

Local dependency promotion for W3 only, based on main `8c501f3`. PR [#68](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/68) reports base `codex/w1-00-mail-dedup` and merge commit `4eea86748b0b5b0e6801ce6059785026fd92f73d`. All 11 promoted sink files are byte-identical to that merge commit (checked with `git show` against worktree bytes). No historical review is reused as current test evidence.

The fixture index retains every current export and adds the original `export * from './substitutes/mail-sink/index.js'`. Current shared mail types and `buildDedupKey` already exist on main and are not changed. The current config accepts only the two sink modes; case and version deep links agree with the current SPA routes. No manifest, lockfile, migration, other ticket code, root changelog or devlog change.

## Current validation

Node 24.21.0; locked install in this worktree. Synthetic fixture identity: `slice1-synthetic@1 7c80ccd43663`.

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

## Isolation and dependency handoff

Integration uses only Compose project `rai-w3-mail-promotion`, its own `pgdata` volume, and loopback port `54331`. The worktree .env uses `54331` for both application and migration URLs; there are no inherited database environment overrides. Parent database `54320` and other Compose projects are untouched. The owned container, network and volume were removed with `docker compose -p rai-w3-mail-promotion down -v` after testing.

No missing shared-interface dependency was found. Parent must promote/review this commit before consumers depend on it on main. `MemoryMailSink` and `FileMailSink` are available through `@rai/fixtures` or the package's `substitutes/mail-sink/index` subpath. They expose health and forced-failure controls; those controls are not HTTP endpoints or new environment keys.

W3-03/W3-04 still own sink selection, notification composition, transactional outbox and retries. Their integration tests must prove authorized recipients, sign-in/scope on followed links, rollback suppression, concurrency/dedup and failure not undoing decisions. The sink trusts the caller's committed-event metadata; it does not query the audit database. Queue routes are still a W3 consumer contract: the promoted defensive validator permits `/queue` and `/queue/<segment>`, while digests require a case link for each breach entry. No queue implementation is added here. The W0-07 daily digest database mapping and retry policy remain consumer-owned open items. Substitute unit success is not real-mail or W3 exit acceptance.

Self-review only. Independent review and publication remain with the parent. No external mail, push, PR or merge performed.
