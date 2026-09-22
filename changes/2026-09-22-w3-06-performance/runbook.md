# Manual execution after parent authorization only

Preparation has not touched a database or measured latency. Parent must first identify the final built W3-INT commit, authorize execution, allocate unused loopback server/DB ports and a dedicated Compose project/database named `rai_perf_<suffix>`. Start the actual built server in test/fixture mode with the approved INT synthetic QC override described below and the configured synthetic mail sink. Keep normal workers enabled. Do not run against the held retry environment or a shared test database.

The harness does not migrate, reset, truncate, load fixtures, ANALYZE or start a process. Parent separately prepares an empty isolated DB with the canonical fixture loader and all final migrations, using the correct migration/admin credentials for that head. Every destructive helper requires its own reviewed guard. This module's guard checks the three supplied role URLs against explicit host/port/database/role values before HTTP; it cannot attest which database an already running HTTP process uses. Parent must verify the actual server launch environment uses those exact URLs. Do not reuse the general integration reset helper without this check.

From `rai-web`, prepare ignored `.local/performance-config.json` (mode 0600) with `baseUrl`, `target: {host: "127.0.0.1", port, database}`, `urls: {app, owner, operator}`, the full 40-character `finalHead`, and `authorization: "parent-authorized-final-head"`. Use explicit PostgreSQL URLs with rai_app/rai_owner/rai_operator credentials, no URL query parameters. No port is allocated by this document. Record machine/CPU/RAM, OS, Node and PostgreSQL versions, Docker resource limits, pool size, final server/harness commits, log destination, and startup configuration without passwords.

## Required QC override and startup evidence

The default substitute maps only seeded fixture IDs; a newly API-created case receives unavailable QC. It cannot seed the 150 new Ready cases. Before running either command below, require all of the following:

- Merged final W3-INT provides a separately reviewed and explicitly approved, guarded test-only override for the single configured qcRunner. Record the implementing commit, approved scenario and actual launch configuration; do not invent an environment flag or silently fall back to the default substitute.
- The explicit scenario returns synthetic completed/no-findings results for the new performance-case IDs. It supplies the same configured runner instance to both run and probe, preserving ordinary QC persistence, correlation and lane decisions. It introduces no external provider or approval shortcut.
- Assert the launched process is the recorded final build, NODE_ENV=test, fixture identity mode, and bound to the allocated loopback address/port. Verify the startup configuration uses the exact guarded app/owner/operator URLs and dedicated rai_perf_<suffix> database; the harness's URL check alone cannot prove which DB an existing server uses. Record sanitized evidence without credentials.
- Require evidence that INT's override guard rejects use outside its approved test/fixture/isolated boundary. Readiness/probe success alone does not prove the new-ID scenario. Before the full seed, prove a newly created synthetic ID returns completed QC with a runId and zero findings through the actual API in the separately authorized scratch workflow.

If any prerequisite is missing, stop before seeding. Never skip override approval, weaken queue-seed.ts's QC assertion, bypass findings, fake Ready, disable triggers, or skip any of the three reviewer approvals. INT owns implementing and testing this seam; this harness does not add a runner or an override switch. Neither this correction nor the example commands authorize execution.

After these prerequisites and parent execution authorization, invoke the existing tsx runtime manually; these commands are examples, not an execution record:

```sh
node --import tsx --conditions=rai-source --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { seed } from './tests/performance/queue-seed.ts';
const config = JSON.parse(await readFile('.local/performance-config.json', 'utf8'));
await seed(config, '.local/performance-manifest.json');
JS
```

Seeding requires exactly the five canonical draft IDs and adds 995 cases through real APIs. It reserves the output file with exclusive creation; failure leaves an INCOMPLETE marker and may leave partial server writes. It never retries/reseeds/resets silently. Diagnose and obtain a separately authorized isolated reset before a fresh attempt. The canonical fixture hash and the expanded manifest hash are distinct evidence.

On the final authorized run, first prove a small workflow smoke in a separately reset scratch DB if needed; then seed the clean target. No claim is made yet that the 995-case API sequence has run. Setup cost is outside the benchmark: approximately 995 creates, 850 saves/submits, 200 send-backs and 450 QC/approval pairs, plus reads. The approved override must explicitly supply the completed/no-findings scenario for newly created IDs; the default substitute instead returns unavailable. This is a lane/SLA-heavy queue dataset, not a dense-QC or artifact workload. The first/last page mix is determined by actual updatedAt/id ordering and is retained in the manifest.

Wait for setup notifications to settle; document pending jobs, run ANALYZE on the isolated dataset if authorized, then leave the dataset unchanged. Do not run other suites/load generators concurrently. A server restart does not make this a cold-DB run. Login and warmup are excluded; cold-start timings, UI rendering and 10-user concurrency are separate protocols.

Select actor/query pairs explicitly; recommended minimum: all-cases DPO pageSize 100, CM SPOC Thai search, each owner's default page, Admin last page and literal search. Add the other searchBy/exact filters and beyond-last-page controls as separate selections. One 30-warmup/200-sample baseline per selection; repeat only to diagnose noise or a miss, retaining the first result. Zero-result controls never dilute populated-query percentiles.

```sh
node --import tsx --conditions=rai-source --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { measure } from './tests/performance/queue-measure.ts';
const config = JSON.parse(await readFile('.local/performance-config.json', 'utf8'));
const manifest = JSON.parse(await readFile('.local/performance-manifest.json', 'utf8'));
const selections = [{ actor: 'fx-user-dpo', query: { pageSize: 100 } }];
await measure(config, manifest, selections, '.local/performance-samples.jsonl',
  () => readFile('.local/performance-server.jsonl', 'utf8'));
JS
```

Supply the actual flushed JSON request log, without pretty formatting. Omit the final callback only for explicitly HTTP-only evidence: output then says server duration was not requested. A requested join requires exactly one successful `/api/queue` completion for every sample; missing/duplicate/nonfinite duration fails, preserving raw HTTP records. Capture the thrown error with the run record. Transport/HTTP/schema/content failures are recorded and prevent a successful-only percentile. No latency threshold exits with a CI failure; the 300 ms target remains advisory. HTTP wall includes request transport and complete body consumption, excludes JSON parsing/assertions; server duration follows the final W3-07 hook boundary. Record that boundary alongside the evidence, not as an assumed handler-only measurement.

Pure preparation checks only: `node --import tsx --conditions=rai-source --test tests/performance/*.test.ts`, `npx tsc -b tests/performance`, `npx eslint tests/performance`, `npx prettier --check tests/performance`. No npm scripts, CI or production modules changed. Full W3-INT UI journey, keyboard evidence and M3 acceptance remain parent/Lead work. Workload and concurrency targets await Ta/operator confirmation; misses require an owned finding, not an invented acceptance gate.

## Approved additional profiles (implementation only; execution still gated)

`profiles.ts` exports the paired preflight, transport and journal. `surface-measure.ts` exports `measureSurfaces(SurfacePlan)`; `page-measure.ts` exports `measurePages(PagePlan)`. No import performs network or DB work. Both configurations must use distinct `rai_perf_*` names on this task's future loopback container port **54370**, distinct HTTP origins and the same final build SHA. Do not create/start that container until final INT execution authorization. The parent records `evidence: {startupVerified: true, responseFinishVerified: true, qcScenarioApproved, machine}` after inspecting actual launch bindings and proving a held QC runner does not delay the submit response. These are attestations, not remote DB-discovery checks. Keep normal workers enabled; no competing suites, load generators or readiness pollers.

Keep the exact-1,000-case queue manifest unchanged. Read-only JSON profiles use its server. Case-page profiles use the mutation server because reviewer page loading can invoke lane QC; queue-page timing alone uses the queue server. On the mutation database, separately prepare **45 distinct editable drafts** using real create/save APIs and the approved new-ID QC scenario; record `{caseId, versionId: draftId, revision: draftRevision}` after saving. Supply their owner as `mutationActor` and a synthetic case owned by that actor as `uploadCaseId`. No test SQL or status writes. Each measured submit rechecks its draft identity/revision outside timing, uses a fresh idempotency key and requires 201 with the matching submitted version. The first five drafts are warmup; every other draft is measured once. Partial state is not automatically reset or replayed. Page resources (including a selected historical version, open editor and reviewer-visible version) must also be prepared through real APIs and recorded separately.

Selected JSON inventory is **session, case, draft, submitted version, version history and operator report**, not all routes. Each entry in `reads` has a unique filesystem-safe `name`, an inventory `kind`, an `actor`, UUID `ids` required by that route, and nonempty `expected` stable top-level response fields. Validate meaningful identity/state fields, not only an empty object; choose stable fields for operator/session responses. Dynamic timestamps/counters are not equality oracles. Record exact selections in the execution plan. The API response assertions are selected-field checks, not exhaustive DTO schema validation.

Profiles run one baseline, sequentially: JSON/pages/cached readiness **30 warmup + 200 measured**; submit/upload/download/uncached readiness **5 + 40**. No automatic repeats. Upload builds a unique exact **26,214,400-byte** synthetic PDF outside timing, checks returned size/hash, and downloads those same 45 artifacts with full length/hash validation. It stores about 1.125 GiB of new blob content plus metadata, before filesystem overhead. No pack attachment or 150 MiB pack claim. Blob/OS caches are warm or uncontrolled, not deliberately cold. Uncached readiness waits 5.1 seconds after a priming response, outside timing, and requires changed checkedAt; cached requests require unchanged checkedAt. A cache classification failure fails the baseline rather than silently dropping the sample.

Each page selection has `kind` (exactly one of queue/overview/editor/reviewer/history), fixture `actor`, UUID `ids`, and nonempty `visible`/`absent` arrays of final-INT selectors. Inspect these selectors against the final UI: require loaded data, expected selected-version content and absence of loading/error states. History is the selected frozen version with version navigation, not an invented standalone history route. The built-in loaded markers cover queue count, case header, pack section, reviewer controls and version navigation. Browser measurements use normal document navigation, Thai locale, Chromium at 1440×900 and its normal cache behavior, followed by two animation frames. This measures document/SPA startup plus data/render, not only a client-side route transition. Reviewer timings can include its QC loading; they do not redefine the submit boundary. Other widths remain correctness evidence, not measured latency.

HTTP wall is fetch start through full body consumption; JSON parsing, binary hashing and validation follow that timestamp. Server duration must join exactly one correlation/route/status-matched `request.completed` event: final API `reply.elapsedTime` freezes at response finish, before background delivery hooks. Retain the final-head proof that submit QC also does not hold the response. Never subtract job time. Page wall ends after declared ready controls/data plus paint opportunities; it is not a single-request server duration. HTTP log joins are mandatory in these added profiles; supply flushed JSON logs. All attempted measured failures remain in raw JSONL and prevent a successful-only percentile; missing/duplicate log joins record an error and fail. Files are exclusive-created. Threshold misses remain advisory results, not CI failures.

Create ignored mode-0600 `.local/performance-plan.json` with the two RunConfigs, evidence, outputPrefix, reads/mutation resources/pages above. Keep passwords out of output records. Runtime versions, machine resources, browser version, selected actor/resources and fixture hashes must accompany the run record. After authorization, from `rai-web`:

```sh
node --import tsx --conditions=rai-source --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { measureSurfaces } from './tests/performance/surface-measure.ts';
import { measurePages } from './tests/performance/page-measure.ts';
const config = JSON.parse(await readFile('.local/performance-plan.json', 'utf8'));
const plan = { ...config, readLog: (target) => readFile(`.local/performance-${target}-server.jsonl`, 'utf8') };
await measureSurfaces(plan);
await measurePages(plan);
JS
```

Unmeasured: other JSON routes, mobile/tablet latency, cold-cache performance, ten-user concurrency, dense findings, five-version cases, 150 MiB packs, 3,000 artifacts/50 GiB storage, degraded readiness and external services. This is neither all-budget coverage nor M3 acceptance. Workload confirmation remains with Ta/operator. The old queue-only command remains a separate run and its optional server-log mode does not weaken the mandatory joins above.
