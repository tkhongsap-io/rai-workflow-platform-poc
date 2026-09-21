# Build board — Lead / integration

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W0-01 merged
- What: ADR-0003 stack and deployment boundary (D04): Fastify API serving React SPA, Postgres, Drizzle, openid-client; scored against seven criteria. PR #57.
- Why: Ticket W0-01 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/57

## 2026-09-21 (time not recorded) — W0-02 merged
- What: File-level implementation plan for W1-W3: layout, commands, pinned deps, env list, CI checks, W1 interface shapes, test-layer map, UI quality bar, language rule; architecture paths and TESTING commands filled. PR #65.
- Why: Ticket W0-02 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/65

## 2026-09-21 (time not recorded) — W0-04 merged
- What: Persistence and artifact-store spec: entities, immutability, transactions, audit log, schema evolution, retention options for D08. PR #61.
- Why: Ticket W0-04 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/61

## 2026-09-21 (time not recorded) — W0-06 merged
- What: Workflow transition and error contract: states, events, lane-mapping constant, D05 rules, owning-lane assignment, seven error types with HTTP codes. PR #63.
- Why: Ticket W0-06 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/63

## 2026-09-21 (time not recorded) — W0-10 merged
- What: Observability contract for the desk runtime: correlation IDs, redaction, readiness, error capture, operator view. PR #59.
- Why: Ticket W0-10 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/59

## 2026-09-21 (time not recorded) — W0-03 merged
- What: Identity adapter spec: modes local-google/network/production with fail-closed start-up table S1-S18, session, fixture provider with dual-role identity, test obligations. PR #62.
- Why: Ticket W0-03 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/62

## 2026-09-21 (time not recorded) — W0-08 merged
- What: Upload safety policy and synthetic fixture strategy: allowed types, limits, sniffing rules, filename rule, hostile test rows, four fixture cases and users. PR #64.
- Why: Ticket W0-08 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/64
