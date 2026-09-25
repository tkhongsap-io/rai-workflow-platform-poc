# Review: desk-health owning lane

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Synthetic data only; no decision taken or changed.

## Change

- `server/src/observability/operator.ts`: `readDeskHealth` selects `qc_run.lane` and derives each `unavailableQc` entry's `owningLane` with `unavailableOwningLane` (W0-06 7.2): approve attempt → its lane; submit → AI/COE; upload runs get none. Derived from the run, so a run that reused an earlier open outage finding (and has no finding row) still shows its owner.
- Tests: `w3-07a-operator-probes.test.ts` expects `dpo` on DPO approve-attempt outages (was `undefined`; watched fail first); `w3-int-07-desk-health.spec.ts` expects `ai_coe` on its real submit timeout.
- `docs/engineering/observability-contract.md`: the field comment says how the value is derived.
- No UI change: `desk-health-sections.tsx` already renders the field.

## Commands and results

Worktree `/tmp/rai-dh-lane`, Postgres `rai-dh-lane` on 55371, one suite at a time.

| Command (from `rai-web/`) | Result |
|---|---|
| RED: `node --test … --test-name-pattern="operator SQL preserves" tests/integration/w3-07a-operator-probes.test.ts` before the change | 1 test, 0 pass, 1 fail |
| `npm run lint`, `npx tsc -b` | exit 0 |
| `npm run test:unit` | 582/582 |
| `npm run test:integration` | 329/329, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 595 files, 0 markers |
| `npm run test:browser:server` | 193 passed (7.7m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Reviewer verdicts

Posted on the PR; recorded here after they land.
