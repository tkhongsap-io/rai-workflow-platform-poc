# Build board — Lane C: platform and substitutes

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W1-10 merged
- What: QC substitute: scripted findings by version ref, unavailable, timeout, QC_RUNNER=none, provable no write path. PR #69.
- Why: Ticket W1-10 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/69

## 2026-09-21 (time not recorded) — W1-11 merged
- What: Mail-sink substitute: four inputs, delivery status, forced failure, dedup key, provable no external mail path. PR #68.
- Why: Ticket W1-11 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/68

## 2026-09-21 (time not recorded) — W1-12 merged
- What: CI workflow (11 jobs: unit, integration on Postgres, lint, typecheck, build, link check, frozen-source hash, demo suite, browser/Playwright) and local harness scripts; altered-snapshot hash test. PR #70.
- Why: Ticket W1-12 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/70
