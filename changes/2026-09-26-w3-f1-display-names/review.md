# Review: W3-F1 display names, part 1 (contract and server)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 8 (Ta, 2026-09-26). Synthetic data only.

## Change

- `@rai/shared`: optional `ownerDisplayName` on `CaseView`/`CaseSummary`, `submittedByDisplayName` on `VersionSummary`/`SubmittedVersion`, `decidedByDisplayName` on `LaneDecision`. Subject IDs unchanged.
- Server: one subject directory in `composeAppDeps`, shared by the case and version routes; `readNames` resolves each subject at most once per read. The owner's name is the `business_owner` column; the submit 201 and every version read resolve the submitter through the same directory; decision reads name the decider. The 201 response schema lists the field right after `submittedBy`, so key order is fixed for replay.
- Docs: W0-02 section 7 shapes and a display-only note; W0-05's W0-09 resolution row gets a dated extension note.

## Design note found by the tests

The first version took the 201's name from the acting principal while reads used the directory. A W1 suite that wires a directory for the case routes but not for the version routes showed the 201 and a later read differing. The 201 now resolves through the same directory (the actor is only the directory's fallback, and no directory means no name), so A07 byte identity holds whatever the wiring.

## Commands and results

Worktree `/tmp/rai-names`, Postgres `rai-names` on 55372, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node --test tests/integration/w3-f1-display-names.test.ts` before the change | 3 tests, 0 pass (fields absent) |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 582/582 |
| `npm run test:integration` | 332/332, 0 skipped (after updating the two exact-shape expectations in `w1-05-submit` and `w2-02-lane-decision`, each with a citation) |
| `npm run build && npm run check:substitute-absent` | 595 files, 0 markers |
| `npm run test:browser:server` | 193 passed (7.5m); the UI still shows IDs until part 2 |
| `npm run test:browser:substitute` | 48 passed |
| root `node --test tests/*.test.mjs`, `scripts/*.test.mjs` | 22/22, 18/18 |
| `check-links`, `check-frozen-source`, `git diff --check` | 0 broken; hash matches; clean |

## Reviewer verdicts

On the PR.
