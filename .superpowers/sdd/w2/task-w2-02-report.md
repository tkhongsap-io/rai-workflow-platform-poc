# W2-02 report — lane decision

**Status:** DONE  
**Branch:** `codex/w2-02-lane-decision` (from `main` at `a46c333`)  
**Issue:** #32  
**Date:** 2026-09-22

## What landed

1. **D05 policy rows** in `server/src/authz/policy.ts`: `lane.approve` / `lane.send_back` (own_lane + excludeOwnerOrSpoc), `case.resubmit`, `finding.propose_fixed`, and owning-lane disposition actions (for W2-05). Unit tests cover T34 owner and dual-role SPOC branches.
2. **W2 shapes** in `shared/src/schemas/review.ts` and implementation-plan §7.7: approve / send-back request and `LaneDecisionResponse`.
3. **Migration 0005** `lane_decision` (append-only trigger, SELECT/INSERT for rai_app).
4. **Decide API:** `POST …/lanes/{lane}/approve` and `…/send-back` with expected-version, Idempotency-Key, qc_run_id gate (`lane_qc_not_run`), send-back feedback naming a slot, successor draft on first send-back, owner `send_back` notification, audits `lane.approved` / `lane.sent_back` (+ `draft.successor_created`). Ready not evaluated (W2-06).

## Tests

Postgres: existing `rai-w2-01-postgres-1` on `127.0.0.1:54351` (from prior ticket; `.env` unchanged).  
`npm run migrate` → `migrate: applied 1 migration(s), 5 already applied`.

### Commands

```sh
cd rai-web
npm run lint
# → pass (eslint + prettier --check + check-css)

NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 \
  server/src/authz/policy.test.ts \
  shared/src/locales/locales.test.ts \
  tests/integration/w2-02-lane-decision.test.ts \
  tests/integration/w1-00-migrations.test.ts \
  tests/integration/w1-00-audit.test.ts \
  tests/integration/w2-01-lanes.test.ts
```

### Output summary

```
ℹ tests 32
ℹ suites 2
ℹ pass 32
ℹ fail 0
ℹ duration_ms 8570.150875
```

- Policy unit: 11 pass  
- Locales: 3 pass  
- W1-00 audit: 4 pass  
- W1-00 migrations: 3 pass  
- W2-01 regression: 4 pass  
- W2-02: 7 pass (own-lane approve + audit; wrong-lane/Admin 403; stale revision + missing qcRunId; idempotency replay; send-back feedback + successor draft; D05 dual-role HR forbid / CM allow; AI/COE + IT/Sec own lanes)

## Concerns

1. **qc_run_id:** Accepts a test-supplied UUID without a `qc_run` table or model call (per ruling). FK deferred until QC persistence lands.
2. **Ready:** Not evaluated inside approve (W2-06 owns the predicate).
3. **Concurrent send-backs:** First send-back creates the draft; reuse path exists; W2-03 proves two concurrent send-backs share one draft.
4. **Out of scope (intentional):** findings UI, mail delivery, disposition API, GitHub issue close, push/PR.
