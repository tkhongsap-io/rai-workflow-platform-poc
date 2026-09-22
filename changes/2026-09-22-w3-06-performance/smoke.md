# Authorized functional smoke checkpoint

Scope: lead amendment permits setup and functional proof only while INT's test-only browser repair proceeds. No timing profile, baseline, benchmark, browser suite, external mail or performance/M3 acceptance. Tested build `b7e938635ab58c2b2c84cd516ae27336965bd365` is fd183a6 plus only the recorded authorization; production code remains immutable INT `6d0a21b89de075559278ec4a76f9a58e88ff5dc5`. No tracked code was changed during the smoke.

## Isolation and result

Verified unused loopback54370 and HTTP60870 (also60871, reserved only as an unstarted companion configuration). Confirmed no existing rai-w3-performance Compose containers or volume before creation. Created owned project `rai-w3-performance`, generated DB `rai_perf_smoke_4ebe3dcb8bf4`, owner rai_owner, ordinary app/operator roles; all three URLs guarded against that exact endpoint/name/role. Applied8 migrations and canonical5-case fixtures without reset. The companion `rai_perf_smoke_unused_4ebe3dcb8bf4` was never created or launched; this does not consume a future measurement dataset.

Actual launcher handshake passed its read-only three-role current_database/current_user checks, final build/fixture hash, fixture identity, readiness and file-sink assertions. One real API-created case was enrolled against exact synthetic metadata, submitted, and polled to clean committed QC plus sent lane notices. Three ordinary reviewer QC/approval pairs reached Ready. Read-only DB assertions found6 cases total,4 completed QC records using the enrolled synthetic engine, and5 sent notices for the new case. File sink produced10 files (five JSON plus five text); no external mail. Clean child close passed. Server log excludes configured role URLs, every canonical fixture display name/email, the synthetic case name and credential headers. Raw application logs include normal duration fields but were not used to calculate any latency result.

Own app stopped; Compose stop exited successfully; socket bind checks confirmed54370 and60870 released. Container retained stopped (`Exited (0)`), owned volume and private evidence retained for inspection; no existing database was reset/dropped. Resource root: `/private/tmp/rai-perf-mutation-smoke-7ab14dd079fe`.

## Failures retained and corrected setup

First shell attempt had no npm. A direct TypeScript build succeeded, but Vite under the app-bundled Node failed loading its native binding because of the macOS signing boundary. Existing standard Node24.21.0 under the user's nvm installation ran the normal npm build successfully; no dependency or manifest change.

Initial launcher attempt emitted performance_guard_failed before app startup: setup used the parent shell's macOS TMPDIR, while the launcher's deliberately restricted child environment resolves tmpdir to /tmp. Verified the actual restricted child environment's directory, moved only the owned smoke resource tree to canonical `/private/tmp`, updated the private launch configuration, and retried with a separate log. Both failed-attempt logs remain. No tracked code repair or assertion weakening; the runbook must use the child environment's canonical temp directory.

## Exact commands and retained evidence

Commands ran in `/tmp/rai-w3-performance/rai-web` unless noted. The setup/driver scripts below are retained mode0600 in ignored `.local`; they are an execution record, not production code or safe automatic rerun/reset commands. Setup imports real guardLaunch, runMigrations and loadFixtures, verifies the Compose label/loopback binding and generated-name nonexistence, then creates only the generated DB. Driver uses actual startPerformanceServer, enrollment, real HTTP actions, settlement and finally stop. It emits only sanitized proof, never response bodies, cookies or URLs. Do not rerun against the partially/fully populated smoke DB.

```sh
# Repository root, after explicit socket-bind checks for 54370/60870/60871:
POSTGRES_PORT=54370 docker compose -p rai-w3-performance up -d --wait
# rai-web; successful normal build after the recorded environment failure:
PATH=/Users/tkhongsap/.nvm/versions/node/v24.21.0/bin:$PATH npm run build > .local/performance-smoke-build.log 2>&1
node --import tsx --conditions=rai-source .local/performance-smoke-setup.ts > .local/performance-smoke-setup.log 2>&1
# Initial attempt used performance-smoke-server.jsonl; after the owned-path correction:
PATH=/Users/tkhongsap/.nvm/versions/node/v24.21.0/bin:$PATH node --import tsx --conditions=rai-source .local/performance-smoke-run.ts > .local/performance-smoke-run-retry.log 2>&1
POSTGRES_PORT=54370 docker compose -p rai-w3-performance stop
```

Private artifacts under `rai-web/.local/` (SHA-256):

- `performance-smoke-setup.ts`: e058632a494a57ae36f0f6ce1c2cbcb700eb7df233d195edb02b59a5e8d24887
- `performance-smoke-run.ts`: a4c848d695e315ae4c141b329580073200ee7486e1ed69403a927bef690187de
- `performance-smoke-proof.json`: d8010959e2e2966625c2d82c081b8baaf93162bc6d4361cd441e78c3145cc981
- `performance-smoke-server-retry.jsonl`: 12f73d964029d027f7009e19ac4f3a27fc36c3211e3b39574861ae6dd7ba92ca

Config, initial/retry/build/setup logs remain alongside these. No credentials or case/mail content are copied into this packet. This proves one functional clean path, not995-case seed feasibility, successor runtime behavior, restart recovery or any performance budget. Final measurement remains held for merged INT, parent authorization, idle local tests and actual-main build identity.
