# W3 synthetic engineering exit

This records completed synthetic engineering evidence and its delivery gates. It is not owner/operator acceptance and does not authorize W4–W8. Final PR review and CI outcomes belong to the W3-06 delivery PR; merge requires all checks to pass on the exact reviewed head.

## Final delivery reconciliation — 2026-09-23

PR [#124](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/124) merged as `6d60181a9e3ee6f24c39883a4b77c6d12cde1a12`; its [actual-main CI](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/35777702205) subsequently passed all 12 checks. PR [#125](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/125) merged as `e62b669ab2aa36a3e4343a095b5bedcd9e159c19`, after independent performance/archive and documentation reviews and successful reviewed-head CI. The final main tree matches reviewed head `18903a151b0995baa0775771973bb9bccfec0144`.

[Final actual-main CI 35781574925](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/35781574925) passed all 12 checks: 565 unit, 293 integration, 174 real-server browser, 171 separate UI rehearsal and 40 repository tests, with no reported failures or skips. The [delivery verification comment](https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/125#issuecomment-5784166620) records final delivery evidence.

All nine W3 engineering issues are closed. Epic #54 remains open for Ta’s package review; #35/#53, manual Google sign-in and workload/target confirmation remain pending. No W4 authorization or production acceptance is implied. The sections below retain preparation-time source attribution, failures and merge-process exceptions; their prospective CI/review statements are superseded by this final delivery record.

## Outcome and evidence boundary

W3 integrates the scoped queue, frozen working-day SLA, committed ordinary notifications, daily configured-recipient digest, bounded retries, safe operator diagnostics and one same-case keyboard journey through upload, submission, process restart, protected mail links, send-back, v2, disposition and three approvals to Ready. The API and PostgreSQL are real local services; identity, QC outputs and mail delivery use explicit synthetic fixture/file adapters. Ready means desk completion only.

Ta’s package review, workload/target confirmation and later unaided operator rehearsal remain separate. Manual Google loopback sign-in remains pending. Issue #35 and epic #53 remain open for ambiguous finding ownership; full A09 is not claimed. Real QC, risk proposals, full Admin configuration and production identity/release remain later packages.

The [delivery PR ledger](pr-ledger.md) lists the separately reviewed implementation and contract PRs.

## Source and verification

Frozen source SHA256: `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`. Fixture: `slice1-synthetic@1`, manifest `7c80ccd43663`.

| Evidence | Executed source and result |
|---|---|
| Integration assembly | PR124 merged as 6d60181a9e3ee6f24c39883a4b77c6d12cde1a12 after independent review and all 12 CI checks (run 35774724158) succeeded on exact dbada474; actual-main CI 35777702205 was still running when this evidence record was prepared; its final outcome is recorded in the delivery PR |
| Unit/type/lint/build/absence | 538 unit passes at 27ad01b; performance consumer 560 normal unit passes at 0c99d61 included 22 harness tests; page-resume correction 9b8a2ea passed 27 harness tests independently; typecheck/build passed. Exact final delivery checks 565 unit passed at f70440b after replay onto merged main 6d60181; typecheck and lint passed. Final root/document checks are recorded below. |
| Integration | 293 passed, zero failures/skips, from missing generated outputs at 3e9228; migration opt-in enabled; clean bootstrap and busy-child reset proof included |
| Real browser | Carver independently passed 174 across 1440/834/390 at 27ad01b, zero skips/retries; both Ready paths and the strengthened full keyboard journey |
| UI rehearsal | 171 passed at 27ad01b; separate API-substitute harness, not real-server acceptance |
| Repository | 40 passed, Markdown links/frozen source/whitespace passed; final exit-document checks are recorded below. |
| Performance | HTTP profiles at 0c99d61; corrected complete five-page batch at 9b8a2ea; both use runtime/UI 27ad01b. 3,760 measured samples + 560 warmups in the selected baseline; independent numerical audits clean. All 345 product/config inventory entries match merged main 6d60181; only the two authorized test-script changes differ. See the archived report and source reconciliation. |

Tests from different revisions are explicitly attributed. Document/test-only successors do not become fictitious full-suite reruns; final CI validates the delivered head. No aggregate count sums overlapping runs.

## Commands and output

Added 2026-09-23 by hardening batch H16 so the exit counts can be reproduced from the repository. Every command below ran from a clean detached checkout of the recorded W3 exit commit `e62b669ab2aa36a3e4343a095b5bedcd9e159c19` (PR #125, the head of [final actual-main CI 35781574925](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/35781574925)), not from later hardened main. Each exited 0. Fixture set: `slice1-synthetic@1 7c80ccd43663`.

| Item | Value |
|---|---|
| Checkout | `git worktree add --detach <dir> e62b669ab2aa36a3e4343a095b5bedcd9e159c19`; `git status` clean apart from the ignored `.env` and `node_modules` |
| Node / npm | v24.21.0 / 11.19.0 |
| Postgres | 16.15, `POSTGRES_PORT=54356 docker compose -p rai-h16 up -d --wait`; `rai-web/.env` is `.env.example` with the port set to 54356 |
| Integration environment | as in CI: `OBS_MIGRATION_ADMIN_URL=postgres://postgres:postgres-local@127.0.0.1:54356/rai`, `DATABASE_OPERATOR_URL=postgres://rai_operator:rai_operator@127.0.0.1:54356/rai` |
| Browser environment | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8856 SUBSTITUTE_PORT=8857 SUBSTITUTE_WEB_PORT=5256` |

### Final suite

From `rai-web/` unless noted:

| Command | Result |
|---|---|
| `npm ci` then `npm run migrate` | applied 8 migrations |
| `npm run lint` | passed (ESLint, Prettier, check-css) |
| `npm run typecheck` | passed (`tsc -b . tests/performance`) |
| `npm run test:unit` | tests 565, pass 565, fail 0, skipped 0 |
| `npm run test:integration` | tests 293, pass 293, fail 0, skipped 0 (migration opt-in enabled) |
| `npm run build && npm run check:substitute-absent` | scanned 575 files, 0 with the marker |
| `npm run test:browser` | real server 174 passed; UI rehearsal 171 passed; 0 failed, 0 skipped, 0 flaky |
| `node --test tests/*.test.mjs` (root) | tests 22, pass 22, fail 0, skipped 0 |
| `node --test scripts/*.test.mjs` (root) | tests 18, pass 18, fail 0, skipped 0 |
| `node scripts/check-links.mjs` (root) | 242 Markdown files, 756 relative links, 0 broken |
| `node scripts/check-frozen-source.mjs` (root) | sha256 `92c4f712…b354` matches |

These match the CI counts above (565 unit, 293 integration, 174 real browser, 171 UI rehearsal, 40 repository tests). The real-browser describes print `fixture set slice1-synthetic@1 7c80ccd43663`.

### W3-04 retry tests

```text
$ NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/notifications/retry.test.ts
✔ four failed results: 0/1/6/31 seconds; no fifth attempt
✔ backoff starts at failure completion; serialized deadlines survive reconstruction
✔ delivery or duplicate on any attempt is terminal and clears retry/error state
✔ all failed receipt codes follow the same budget; cause remains available
✔ eligibility fails closed for terminal/exhausted/invalid rows and unscheduled retries
✔ reducer refuses invalid attempts/times; policy constants cannot be changed
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ skipped 0

$ NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w3-03a-notifications.test.ts
✔ W3-03a committed lane opens: contents, locale, auth, idempotency — fixture set slice1-synthetic@1 7c80ccd43663
…
✔ W3-04 four failed results persist deadlines and leave Ready decisions unchanged
✔ W3-04 adopts legacy deadline once; reconnect preserves it and successful retry stops
✔ W3-04 independent workers skip a held row while another notification progresses
✔ W3-04 accepted file then DB rollback: fresh sink deduplicates replay; no precommit success log
✔ W3-04 selects at most 25 due rows per scan and leaves future retries alone
…
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ skipped 0
```

The five `W3-04` integration tests share the W3-03a notification harness and fixture load, so the file runs whole. Durations and the 16 other passing test lines are omitted (`…`).

### W3-05 working-day tests

```text
$ NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test shared/src/sla/working-days.test.ts
▶ working-day SLA
  ✔ reads the Bangkok calendar date, seven hours ahead of UTC
  ✔ skips the weekend after a Thursday open (DPO 3 → the following Tuesday)
  ✔ skips a holiday block that sits on the next working days
  ✔ does not count the open date itself when that date is a working day
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ skipped 0

$ NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w3-05-sla.test.ts
▶ W3-05 working-day SLA — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ freezes the due date across a later SLA revision, a holiday, and a resubmit
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
```

## Acceptance map

See [acceptance evidence](acceptance.md) for requirement-by-requirement proof and remaining boundaries. A03/A08/full A10 remain future work. Operator diagnostics concern the desk process, not monitoring of a submitted AI use case.

## Performance dataset and methodology

The guarded test-only harness prepares cases through authenticated APIs, never direct workflow-state SQL. Separate databases protect the exact queue population from measured mutations. Seeded queue: 1,000 cases (200 draft, 500 in review, 150 sent back, 150 Ready), including 50 submitted successors; 1,300 completed QC runs and 3,750 sent synthetic notifications. A separate 48-case mutation dataset supplies distinct submissions and other page/file resources. Counts were checked before timing; setup time is not latency evidence.

One sequential synthetic baseline, selected surfaces only. Reads/pages/cache hits use 30 warmups + 200 measured samples. Submit, 25 MiB transfer and uncached readiness use 5 + 40. HTTP wall ends after the body is received; correlated request.completed gives server response duration. QC/outbox settlement, preparation and explicit readiness expiry waits are outside measured HTTP time. Page readiness is defined by data-loaded controls and rendering. Preserve all failure samples; advisory target misses are findings, not silently filtered results.

| Surface | N per profile | p95 wall time | Advisory target |
|---|---:|---:|---:|
| Queue API, six scoped/search profiles at 1,000 cases | 200 | 29.285–111.643 ms | <300 ms |
| Selected JSON reads, six routes | 200 | 0.878–3.538 ms | <300 ms |
| Submit | 40 | 16.538 ms | <1,000 ms |
| Upload 25 MiB | 40 | 59.822 ms | <10,000 ms |
| Download 25 MiB | 40 | 26.348 ms | <5,000 ms |
| Readiness cached / uncached | 200 / 40 | 0.175 / 19.045 ms | <100 / 2,500 ms |
| Five pages including overview redirect | 200 | 74.295–143.999 ms | <1,000 ms |

The [full performance report](../2026-09-22-w3-06-performance/evidence/candidate-w306/REPORT.md) includes raw journals, per-profile quantiles, environment, source hashes and preserved failures. Measurements used Apple M5 Max/128 GiB, macOS 26.6.2, Node 24.21.0, Docker 18 CPUs/8 GiB, Postgres 16.15 and desktop Chromium 1440×900 in Thai, concurrency one.

Not measured: every JSON route, concurrent users, mobile/tablet latency, cold-cache capacity, dense findings/five-version histories, full 150 MiB packs or 50 GiB storage. This baseline does not size production infrastructure or validate real QC quality. Ta/operator confirmation of proposed volumes and targets is pending.

The first A01 page attempt failed during overview warmup because the harness expected the entry route after the app correctly redirected to a submitted version. Its seven warmup attempts and zero measured samples are retained; no overview percentile was computed. The corrected page harness 9b8a2ea was independently reviewed and all 27 pure checks passed. A separate untimed five-route diagnostic passed with all 59 HTTP requests successful and queue/case/version state preserved. B02 completed all five profiles (150 warmups +1,000 samples), zero failures. Its independently recomputed quantiles and 11 sealed hashes matched; 22 sealed A01 artifacts remained unchanged. The selected baseline retains 2,760 HTTP samples from A01 plus 1,000 page samples from B02, with 560 warmups. The original 200 queue-page samples and failed overview warmup remain historical rather than being erased or blended into the final page baseline.

## Recording

[Supplementary keyboard walkthrough](media/w3-keyboard-journey.webm), with [recording provenance](media/README.md). Original desktop clip source 27ad01b, SHA256 `9bffe2e1e3371d592cfb796fdd875d6899837e77a82d9a10f4be85f8ea7ea80a`, 9.36 seconds, VP8, 800x500, 25 fps. Unmodified automated test-speed supplementary walkthrough, not a narrated demo. Sampled frames include owner read-only completed evidence and the final Ready queue; identity/loading transitions are retained. Functional assertions, not screenshots alone, establish the result.

The older d8 clip exposed the real Ready false-error defect despite 168 passing browser tests. That inspection and original hash are not retained in the repository. The repaired clip and 174-test run supersede it; no silent substitution or every-frame visual certification is claimed.

## Findings fixed and verification history

- Integrated tests now stop/drain owned workers before fixture reset. Log capture waits through child close and checks late UTF-8 output. Forced shutdown still verifies bounded escalation and cleanup.
- Notification assertions observe exact committed delivery state across automatic/manual workers. A held-sink regression proves the earlier assertion race without retrying delivery or weakening counts/content.
- Completed cases use persisted read-only findings; final disposition refreshes authoritative Ready state. Tests cover both completion paths, navigation/reload, correct lane/owner presentation, unchanged evidence and genuine server denials.
- CI run 35773325746 on a71 failed browser bootstrap and one integration test because generated builds were absent. The repaired bootstrap has Node-only pre-build guards, a clean owned-workspace build/import proof and an explicit build prerequisite for the real busy-child test. Fresh local integration 293 passed; final CI result is recorded above.
- Prior failed and deliberately terminated runs are retained in the W3-INT review. Passing subsequent checks do not rewrite their outcomes.

## Merge-process exception

PR120 merged while browser CI was still pending because the auto-merge command merged immediately. Subsequent PR CI 35754465119, main CI 35755484370 and actual-main full verification (511 unit, 227 integration, 126 real browser, 123 UI rehearsal; zero skips) passed. This is a disclosed exception, not a claim that every merge preceded all CI. Later merges use an exact-reviewed-head, all-checks-success preflight. Cancelled/replaced main runs for PR115/113/118/123 are not called successes; their available local/PR proofs remain separately attributed in the delivery ledger.

## Review and next boundary

The performance code, measurement drivers and numerical journals received separate independent reviews, with fixes re-reviewed. Final whole-PR review covers the archive and current-state documents before merge; the delivery PR records reviewers, exact head and required CI results. This preparation record does not predeclare that future result. Preserve per-ticket PRs and the reviewed W3-INT cross-lane exception. The W3-06 [whole-PR exception](plan.md#whole-pr-review-exception-approved-before-publication) is confined to the guarded performance test module, two existing verification scripts and exit documentation/media; no runtime dependency or product rule is added.

Next owner action: review the synthetic engineering exit, confirm or revise workload/latency expectations and resolve the open ownership policy. A separate explicit W4 entry decision is required before real QC implementation. Operator rehearsal and production release remain W7/W8 gates.

## Final preparation checks

At performance checkpoint `f70440bd7186efdf5ede40fe4eb6e56fb332c47c`, normal unit verification passed 565 tests with zero skips, and typecheck/lint passed. After adding this exit packet and scoped current-state documentation, root tests passed 40/40 with zero skips, the link checker checked 242 Markdown files/756 relative links with zero broken, the frozen-source SHA matched and `git diff --check` passed. No production code or runtime configuration changed in this exit-document step. The final CI pipeline, not a relabeled historical run, verifies the delivered head.
