# Performance targets (W0-09)

Status: **targets, not measurements.** Recorded at the W0 exit review on 2026-09-21 (ticket W0-09, issue #14; [exit review](../../changes/2026-09-21-w0-exit/review.md)) as the BUILD_PLAN W0 clause "expected local workload and measurable performance budgets" asks. The values below remain proposed targets. W3-06 now records bounded synthetic measurements for selected surfaces in the [W3 engineering exit](../../changes/2026-09-23-w3-exit/review.md); unmeasured surfaces and workload confirmation remain explicit. W7 adds the operator rehearsal. A target that a measurement misses is a finding for the lead, not a gate failure, until Ta records otherwise at a package exit. The workload numbers in section 1 are a ticket-flow proposal sized from the source spec's scale (one review desk for one company's AI use cases); no instruction from Ta fixes them, and neither Ta nor the operator (Nakhun, D01) has confirmed them. They are pending Ta's and the operator's confirmation at exit-record review (the W0 contract's W0-09 line: "agree the expected local workload with Ta and the operator"; [exit review](../../changes/2026-09-21-w0-exit/review.md) section 10); W7-00 records the operator's confirmation if it has not been recorded by then.

Owners of the mechanisms these numbers bound: [W0-02](implementation-plan-w1-w3.md) (routes, commands), [W0-04](persistence-and-artifact-store.md) (locks, blob store), [W0-06](workflow-transition-and-error-contract.md) (transaction order), [W0-07](qc-boundary-and-mail-sink.md) (QC timeout, mail retry), [W0-08](upload-safety-and-fixtures.md) (upload limits), [W0-10](observability-contract.md) (probes, `durationMs`).

## 1. Expected local workload

| Quantity | Target | Basis |
|---|---|---|
| New cases | ≤ 50 per month | Ticket-flow proposal, pending Ta's and the operator's confirmation at exit-record review; one desk for one company |
| Versions per case | ≤ 5 (one submission plus send-back cycles) | Workflow contract; D05 full re-review |
| Pack size | ≤ 9 files per version, ≤ 25 MiB per file (26,214,400 bytes), ≤ 150 MiB per version (157,286,400 bytes) | W0-08 section 3, presented for Ta's acceptance in the W0 exit record (pending) |
| Documents stored | ≤ 3,000 artifact rows and ≤ 50 GiB of blobs in the first year | 50 cases × 5 versions × 9 files, with dedup by content hash (W0-04) reducing the blob count |
| Signed-in users | ≤ 40 accounts, ≤ 10 concurrent | Six roles across a few business units; fixture set has 8 |
| Reviewer actions | ≤ 30 lane decisions and ≤ 100 dispositions per week | Three lanes × cases in review |
| Notifications | ≤ 300 per month plus one daily SLA digest | Three lane-open mails per submission, one send-back or Ready mail per decision (D06) |
| QC runs | ≤ 1,000 per month (per upload, per submit, per approve attempt) | W0-07 triggers; substitute in slice 1 |

Slice 1 runs on one developer machine or one small VM against one Postgres; nothing here needs more.

## 2. Latency targets on localhost

W3-06 records per-surface synthetic p95 measurements using the W0-10 `request.completed` duration field and browser timings, with environment and sample counts. These are selected sequential profiles, not an end-to-end journey percentile or a concurrency-capacity test. W7-00 adds the operator rehearsal.

| Surface | Target (p95) | Notes |
|---|---|---|
| Page (SPA screen ready, data loaded) | < 1 s | Queue, case overview, pack editor, reviewer workspace, history; Thai default locale |
| API request (JSON) | < 300 ms | Every W0-02 section 7 route except upload, download and submit |
| Submit (`POST /api/cases/{caseId}/draft/submit`) | < 1 s | One transaction: freeze, three lanes, three outbox rows (W0-06 4.3); QC runs after commit and is not counted |
| Upload (25 MiB file) | < 10 s end to end | Streaming hash and sniff (W0-08); bounded by disk, not CPU |
| Download (25 MiB file) | < 5 s | Streamed from the blob store with `Content-Length` |
| Queue search (W3-01) | < 300 ms at 1,000 cases | Scoped `WHERE` (`caseScopeWhere`, W0-05), indexed status and BU columns |
| Readiness (`GET /readyz`) | < 100 ms cached, < 2.5 s uncached | 2,000 ms probe ceiling, 5 s cache (W0-10 5.5) |

## 3. Time budgets carried from the specs

These are the numbers the W0 specs asked W0-09 to record (W0-06 section 11, W0-08 section 3, W0-07 section 6, W0-10 5.5). They are configuration defaults or module constants, not measurements.

| Budget | Value | Where enforced | Spec |
|---|---|---|---|
| Case row lock wait | 5 s (`SET LOCAL lock_timeout = '5s'`); a timeout answers `internal_error` and the client may retry with the same idempotency key | `withWorkflowTransaction` (W1-00) | W0-04 "Transactions and idempotency", W0-06 9.1 |
| API request timeout | 30 s (Fastify `requestTimeout`) for every route except upload | `server/src/app.ts` (W1-00) | W0-06 9.1 ("Fastify request timeout budget") |
| Upload request body time | 120 s per upload request | `POST /api/cases/{caseId}/artifacts` route config (W1-03) | W0-08 section 3 |
| In-flight uploads per session | 2 (a third concurrent upload from one session is queued by the SPA, not refused by the server) | Lane B upload client (W1-06); not a server policy | W0-08 section 3 |
| QC orchestrator deadline | 10,000 ms (`deadlineMs`; tests pass 100 ms); expiry is `unavailable:timeout` | `server/src/qc/` orchestrator option, module constant | W0-07 3.4 step 1, section 6 |
| Mail retry backoff | 1 s, 5 s, 25 s between attempts 1-4 (D06: one send plus three retries) | W3-04 dispatcher, module constant | W0-07 4.5 |
| Readiness probe ceiling | 2,000 ms per probe, in parallel; report cached 5 s | `server/src/observability/health.ts` (W3-07) | W0-10 5.5 |
| Graceful shutdown | 10 s for in-flight transactions after `SIGTERM`; then every remaining socket is destroyed (a socket that never sent a byte, such as a browser's speculative pre-connect, is not swept by Node's `server.close()` and would otherwise hold the process open) and a 15 s hard deadline exits 1 | `server/src/shutdown.ts` `SHUTDOWN_DRAIN_MS` and `server/src/main.ts` (W1-00; bounded at W1-INT) | W0-04 "Restart proof" |
| Session lifetime | 12 h absolute, 120 min idle (`RAI_SESSION_ABSOLUTE_HOURS`, `RAI_SESSION_IDLE_MINUTES`) | Identity adapter (W1-01) | W0-03 6.3 (a security default, listed here because it bounds a session, not performance) |
| Idempotency record retention | 72 h (`IDEMPOTENCY_TTL_HOURS`) | `db:cleanup` | W0-04 |

W0-07 section 10 proposes environment keys for the QC deadline and the mail backoff (`QC_TIMEOUT_MS`, `MAIL_RETRY_BACKOFF_MS`); they stay module constants until the lead adds the keys to W0-02 section 5.

## 4. How the targets are used

- **Not a CI gate in slice 1.** No W1-W3 check fails on a latency number; CI proves correctness (W0-02 section 6). Timing evidence is recorded by hand in the exit reviews of W3 (W3-06) and W7 (W7-00) from the `request.completed` lines and Playwright's trace timings, with the fixture set identity beside it.
- **A miss is a finding.** If a measured p95 exceeds a target, the exit review records it as a limitation with an owner; Ta decides whether it blocks the package.
- **Real-data numbers are D08's.** Upload limits and retention for real packs are revisited at D08; the workload above is the synthetic slice-1 envelope.
- **Production capacity is D10's.** Host sizing, backup windows and any load beyond one VM are W8 under D10; this document does not size the True host.
