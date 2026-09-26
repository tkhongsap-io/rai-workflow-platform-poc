# Review: the lane-opened mail counts that lane's defects, recorded so far (W3-F3, #165)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 11 (Ta, 2026-09-26). Synthetic data only.

## Change

- `server/src/notifications/service.ts` (`loadCommittedCaseRequest`): the count filters `qc_finding.owning_lane` by the mail's lane and counts every finding of that lane, of either kind, dispositioned or not. The template parameter is renamed `defectCount` → `findingCount` (compose, sink support, tests, W0-02).
- Locale labels: "Findings recorded so far" / "ข้อค้นพบที่บันทึกไว้จนถึงขณะนี้".
- W0-06 4.11 and W0-07 section 4 say what the count is and when it is taken.

## The ticket's stated choices

- "At send time" is when the worker composes the attempt it delivers. At outbox insert a fresh version has no findings, and the body is recomposed per attempt (W0-07 section 4), so no column is written and dedup and retries are unchanged.
- A dispositioned finding still counts: the label says "recorded", and on a freshly opened lane nothing is dispositioned yet.
- A QC-unavailable finding counts: the ruling says "findings", and it is a finding of the lane (W0-07 3.6), so an outage never reads as 0 (W0-07 1: never a clean pass). Whether the mail should also name the outage is not in ruling 11.

## Commands and results

Worktree `/tmp/rai-f3`, Postgres `rai-f3` on 55373, one suite at a time (its browser suites ran after the other worktree's had finished).

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: the new `w3-03a` test before the change | failed: the DPO mail counted 3 (the whole version) instead of 2; after review round 1, failed again on the renamed parameter before the rename |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 590/590 |
| `npm run test:integration` | 335/335, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` | 196 passed (8.3m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Reviewer verdicts

| Round | Head | Correctness | Contract |
|---|---|---|---|
| 1 | `c88a86d` | PASS; notes: submit QC is still bound in the test (harmless: the case has no script, so it completes clean with no finding), and the label check looked at one locale only | BLOCKING: ruling 11 says "findings", and excluding QC-unavailable findings let an outage read as 0, against W0-07 1 |

Round-1 changes: the count includes QC-unavailable findings, the parameter is `findingCount`, both labels say "findings"; the test expects 2/1/1, explains why submit QC cannot add a finding, and checks the label in each recipient's language.
