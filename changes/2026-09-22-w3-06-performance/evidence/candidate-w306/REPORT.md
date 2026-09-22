# W3-06 candidate performance evidence — A01 and B02

Collected originally as candidate evidence; now reconciled to actual merged main `6d60181a9e3ee6f24c39883a4b77c6d12cde1a12`. All 345 recorded product/config inventory entries match exactly, with no product-tree delta. The harness root manifest differs only in the approved test:unit performance glob and explicit performance typecheck target; all other manifest fields are identical. No remeasurement is required by source/config changes. Raw candidate metadata and original measurement heads remain immutable. Owner acceptance remains pending. Synthetic localhost workload, concurrency one; these are selected profiles, not a full journey percentile or proof of all route/capacity budgets.

Seed/A01 head: `0c99d61a61585dca51b333e95886476830419053`. B02 harness head: `9b8a2ea2f5ac2a51774c2e0008752c3b49132faa`. Product/UI baseline: `27ad01b1ba8179f286660959043c0e178fd51b35`. Product Git inventory and built-asset hashes verified unchanged before B02. Original seed manifest remains attributed to A01; it is not rewritten as a new-head seed.

Environment: Apple M5 Max, 128 GiB host RAM, macOS26.6.2, Node24.21.0, Docker29.8.0 aarch64 with18 CPUs/8 GiB assigned, Postgres16.15. Playwright Chromium, desktop1440×900, Thai locale. Node fetch connection reuse and one browser context per page profile; no forced cold-cache reset. Fresh idle snapshots included; only an unrelated idle Vite process remained. Remote CI permitted, other local tests held.

HTTP wall time covers request through full response body. Correlation-joined request.completed durationMs uses Fastify reply.elapsedTime frozen at response finish, not background QC. Submit latency excludes postcommit QC/outbox settling. Browser wall time begins before entry navigation, includes data/readiness checks and two animation frames; B02 waits for canonical final route and rechecks it after readiness. Overview entry redirect is included. Post-attempt QC/outbox settlement and readiness cache-expiry waits are outside latency. No browser/server-duration equivalence is claimed.

Quantiles use nearest rank ceil(p*N) on measured samples. Warmups are retained separately. No failed attempts are removed. Overview A01 stopped during seventh warmup: six preliminary successes, one URL-assertion failure, zero measured samples and no percentiles. It expected entry URL despite canonical redirect; early assertions could pass transiently. Original queue page is historical. B02 allfivepage batch supersedes it as page baseline without erasing history.

A01 completed totals: 2,960 measured +440warmups, zero failures within completed profiles; separately7overviewwarmups including1failure. All3,170 HTTP attempts (2,760measured +410warmups) have exact duration joins. B02:1,000measured +150warmups, zero failures. Combined retained attempts:4,557 =3,960measured +597warmups, including1failedwarmup. Final selected baseline excludes historical A01 queue page:3,760measured +560warmups across retained A01HTTP and B02pages.

## Actual results

All times milliseconds. Targets advisory per docs/engineering/performance-targets.md. No CI gate or owner acceptance inferred. JSON inventory is session, case, draft, version, version-history, operator desk-health only.

| Batch/profile | Warmup | N | Failures | p50 wall | p95 wall | p99 wall | Target p95 | p95 server |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| a01 download | 5 | 40 | 0 | 20.255 | 26.348 | 31.607 | 5000 | 24.763 |
| a01 json-case | 30 | 200 | 0 | 1.416 | 1.884 | 2.606 | 300 | 1.709 |
| a01 json-draft | 30 | 200 | 0 | 1.725 | 2.292 | 2.699 | 300 | 2.079 |
| a01 json-history | 30 | 200 | 0 | 1.542 | 3.016 | 3.965 | 300 | 2.698 |
| a01 json-operator | 30 | 200 | 0 | 2.906 | 3.538 | 3.874 | 300 | 3.331 |
| a01 json-session | 30 | 200 | 0 | 0.549 | 0.878 | 0.982 | 300 | 0.658 |
| a01 json-version | 30 | 200 | 0 | 1.971 | 2.455 | 3.046 | 300 | 2.258 |
| a01 page-overview | 7 | 0 | 1 | not measured | not measured | not measured | 1000 | — |
| a01 page-queue | 30 | 200 | 0 | 140.190 | 142.850 | 143.713 | 1000 | — |
| a01 ready-cached | 30 | 200 | 0 | 0.093 | 0.175 | 0.293 | 100 | 0.049 |
| a01 ready-uncached | 5 | 40 | 0 | 10.624 | 19.045 | 19.370 | 2500 | 17.238 |
| a01 submit | 5 | 40 | 0 | 10.377 | 16.538 | 22.707 | 1000 | 15.938 |
| a01 upload | 5 | 40 | 0 | 50.916 | 59.822 | 62.502 | 10000 | 58.230 |
| a01 {"actor": "fx-user-dpo", "query": {"pageSize": 100}} | 30 | 200 | 0 | 83.501 | 90.295 | 112.863 | 300 | 89.760 |
| a01 {"actor": "fx-user-spoc-cm", "query": {"pageSize": 100, "search": "ทดสอบ"}} | 30 | 200 | 0 | 83.457 | 98.329 | 115.641 | 300 | 97.708 |
| a01 {"actor": "fx-user-owner-cm", "query": {}} | 30 | 200 | 0 | 25.251 | 30.868 | 41.393 | 300 | 30.401 |
| a01 {"actor": "fx-user-owner-cm-2", "query": {}} | 30 | 200 | 0 | 24.148 | 29.285 | 41.170 | 300 | 28.917 |
| a01 {"actor": "fx-user-admin", "query": {"page": 10, "pageSize": 100}} | 30 | 200 | 0 | 71.093 | 89.604 | 97.498 | 300 | 89.164 |
| a01 {"actor": "fx-user-admin", "query": {"pageSize": 100, "search": "%_!\\"}} | 30 | 200 | 0 | 87.554 | 111.643 | 114.133 | 300 | 111.220 |
| b02 page-editor | 30 | 200 | 0 | 58.491 | 75.405 | 75.853 | 1000 | — |
| b02 page-history | 30 | 200 | 0 | 57.305 | 74.295 | 75.242 | 1000 | — |
| b02 page-overview | 30 | 200 | 0 | 58.518 | 75.646 | 76.237 | 1000 | — |
| b02 page-queue | 30 | 200 | 0 | 127.596 | 143.999 | 145.020 | 1000 | — |
| b02 page-reviewer | 30 | 200 | 0 | 74.796 | 91.950 | 94.401 | 1000 | — |

## Workload, exclusions and limits

Exactly1,000queue cases:200draft,500in_review,150sent_back,150Ready. Latest versions:800v1/200v2; current submitted versions:750v1/50v2/200none. Real API creation995+5fixtures; no trigger bypass/fake status. Separate mutation DB has48API-created+5fixturecases. Original45submit and45each25MiBupload/download attempts ran once; B02 did not repeat them. Configured guarded synthetic QC and synthetic file sink, no external mail. Reviewer page uses normal automatic synthetic lane-QC.

Unmeasured: remaining JSON routes, parallel users/10-user load, long-running throughput, worst-case five-version cases,150MiBpacks,3,000artifact/50GiBstorage scale, WAN/mobile/other-browser/cold-cache behavior, real provider/mail latency, production capacity, full-journey percentile. Workload and numeric target acceptance remain pending Ta/operator per performance-targets; meeting these selected local targets does not settle that decision.

Both runs stop owned app processes; owned Compose is stopped and datasets retained. B02 had an initial plain-bind address-in-use observation after shutdown; independent lsof found no listeners and SO_REUSEADDR bind succeeded for54370/60870/60871. Tracked tree clean, A01 sealed hashes unchanged. No reset, reseed, automatic retry or production change.

## Reproduction and privacy

Raw latency JSONL files are byte-identical, including A01 failed warmup. http-duration-joins.jsonl is a whitelist extraction of only matched correlation ID, method/route/status/duration and profile/phase; full application logs are excluded. Diagnostic metadata is a whitelist of paths/selectors outcomes and state IDs, not case bodies. No actual launch configurations, private inputs, cookies, credentials, mail content, artifacts or case-body manifests are included. Only synthetic actor IDs, case/version IDs, loopback paths and placeholder credential templates remain.

Reviewed original driver907 and templates remain byte-identical. They are source evidence, not an autostart CLI. Relative imports require restoration: original-v1/* -> rai-web/.local/performance-review-v1/*; resume-v2/* -> rai-web/.local/performance-page-resume-v2/*. Use original seed/A01 checkout0c for originaldriver and reviewed B02 checkout9b for resume. Do not execute either against retained state without explicit new authorization. Original full driver must not be used to resume B02: it would include mutation profiles. Actual private launch configs stay retained locally and are intentionally not published. Missing them means restoration is not a self-contained ready-to-run environment.

Historical held flags/review notes in unchanged templates are preserved source text, not current authorization. Separate parent instructions authorized each actual run. New execution always requires independent review, explicit GO, fresh idle/socket checks and owned-role/database attestation. SHA256SUMS covers archived bytes; source-hashes records original provenance and omitted sealed source hashes. Parent relayed Confucius independent numerical/artifact audit CLEAN at9b8a2ea: allfiveB02 profiles have30warmups+200ordered samples, no errors/skips, exact p50/p95/p99/max;11B02 and22A01 hashes match. Final selected baseline is3,760samples+560warmups. The A01 failed warmup is retained historical evidence, not part of that baseline. Confucius verified app stop-before-completion ordering and recorded container/socket cleanup, without a concurrent live resource check. This does not establish absence of concurrent load independently or production performance. The subsequently rebased archive/report itself remains subject to final whole-diff review.


## Archive and whole-PR authority

Parent explicitly authorized this exact 37-file archive after measurement. Backup `backup/w3-06-performance-pre-main-9b8a2ea` preserves the measured checkpoint; only the 16 owned performance commits after27ad were replayed onto merged main6d60181. Range-diff reports all16 patches unchanged, no conflicts; no INT history replayed. The lead whole-PR exception in `/tmp/rai-w3-exit-preparation/plan.md` accepts the cohesive W3-06 test-only harness, provenance and evidence rather than treating individual commits as under600 compliance. This worker owns performance packet/archive only; parent owns root exit/status/media. Final whole-diff review and exact-head CI remain publication/merge gates.


## Final archive verification

On the replayed merged-main base: normal unit565passed,0failed,0skipped; normal typecheck/lint passed; root script tests18passed,0failed,0skipped; links235Markdown/737relative/0broken; frozen-source hash unchanged; diff whitespace check passed. No additional database/browser timing or integration rerun was needed for the unchanged product tree. These checks verify the rebased harness/archive, not a new measurement run. Publication/merge and owner acceptance remain separate.
