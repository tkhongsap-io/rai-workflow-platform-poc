# Build board — Lane A: workflow and server

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W1-00 merged
- What: First code: rai-web workspaces, docker compose Postgres, Drizzle base migration (case, pack_version, artifact_slot, configuration_revision, append-only audit_event with DB trigger), shared error module, policy module, fixture identity provider, configuration seed, logger; 58 unit + 14 integration tests. PR #67.
- Why: Ticket W1-00 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/67

## 2026-09-21 (time not recorded) — W1-03 merged
- What: Artifact upload/download per 7.4: content-hash blob store behind an interface, sniffing not extension, size limits, unresolved-id rule, Thai filenames, direct URL without session refused; store:verify/cleanup operator commands; 197 unit + 53 integration. PR #78.
- Why: Ticket W1-03 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/78
