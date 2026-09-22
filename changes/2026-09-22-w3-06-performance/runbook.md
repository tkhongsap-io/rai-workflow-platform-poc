# Manual execution after parent authorization only

Preparation has not touched a database or measured latency. Parent must first identify the final built W3-INT commit, authorize execution, allocate unused loopback server/DB ports and a dedicated Compose project/database named `rai_perf_<suffix>`. Start the actual built server in test/fixture mode with the configured synthetic QC and mail sink. Keep normal workers enabled. Do not run against the held retry environment or a shared test database.

The harness does not migrate, reset, truncate, load fixtures, ANALYZE or start a process. Parent separately prepares an empty isolated DB with the canonical fixture loader and all final migrations, using the correct migration/admin credentials for that head. Every destructive helper requires its own reviewed guard. This module's guard checks the three supplied role URLs against explicit host/port/database/role values before HTTP; it cannot attest which database an already running HTTP process uses. Parent must verify the actual server launch environment uses those exact URLs. Do not reuse the general integration reset helper without this check.

From `rai-web`, prepare ignored `.local/performance-config.json` (mode 0600) with `baseUrl`, `target: {host: "127.0.0.1", port, database}`, `urls: {app, owner, operator}`, the full 40-character `finalHead`, and `authorization: "parent-authorized-final-head"`. Use explicit PostgreSQL URLs with rai_app/rai_owner/rai_operator credentials, no URL query parameters. No port is allocated by this document. Record machine/CPU/RAM, OS, Node and PostgreSQL versions, Docker resource limits, pool size, final server/harness commits, log destination, and startup configuration without passwords.

After authorization, invoke the existing tsx runtime manually; these commands are examples, not an execution record:

```sh
node --import tsx --conditions=rai-source --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { seed } from './tests/performance/queue-seed.ts';
const config = JSON.parse(await readFile('.local/performance-config.json', 'utf8'));
await seed(config, '.local/performance-manifest.json');
JS
```

Seeding requires exactly the five canonical draft IDs and adds 995 cases through real APIs. It reserves the output file with exclusive creation; failure leaves an INCOMPLETE marker and may leave partial server writes. It never retries/reseeds/resets silently. Diagnose and obtain a separately authorized isolated reset before a fresh attempt. The canonical fixture hash and the expanded manifest hash are distinct evidence.

On the final authorized run, first prove a small workflow smoke in a separately reset scratch DB if needed; then seed the clean target. No claim is made yet that the 995-case API sequence has run. Setup cost is outside the benchmark: approximately 995 creates, 850 saves/submits, 200 send-backs and 450 QC/approval pairs, plus reads. The default substitute has no finding scripts for newly created IDs. This is a lane/SLA-heavy queue dataset, not a dense-QC or artifact workload. The first/last page mix is determined by actual updatedAt/id ordering and is retained in the manifest.

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
