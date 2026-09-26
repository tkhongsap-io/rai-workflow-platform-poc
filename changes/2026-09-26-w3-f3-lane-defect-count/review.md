# Review: the lane-opened mail counts that lane's defects, recorded so far (W3-F3, #165)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 11 (Ta, 2026-09-26). Synthetic data only.

## Change

- `server/src/notifications/service.ts` (`loadCommittedCaseRequest`): the `defectCount` query also filters `qc_finding.owning_lane` by the mail's lane. It still counts `kind = 'defect'` only, and does not filter by disposition.
- Locale labels: "Defects recorded so far" / "ข้อบกพร่องที่บันทึกไว้จนถึงขณะนี้".
- W0-06 4.11 and W0-07 section 4 say what the count is and when it is taken.

## The ticket's stated choices

- "At send time" is when the worker composes the attempt it delivers. At outbox insert a fresh version has no findings, and the body is recomposed per attempt (W0-07 section 4), so no column is written and dedup and retries are unchanged.
- A dispositioned defect still counts: the label says "recorded", and on a freshly opened lane nothing is dispositioned yet.
- A QC-unavailable finding does not count: it is a failed check, not a defect, and it is its own finding (W0-07 3.6). The "so far" label keeps a 0 from reading as a clean pass. Whether the mail should also say "QC unavailable" is not in ruling 11.

## Commands and results

Worktree `/tmp/rai-f3`, Postgres `rai-f3` on 55373, one suite at a time (its browser suites ran after the other worktree's had finished).

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: the new `w3-03a` test before the change | failed: the DPO mail counted 3 (the whole version) instead of 2 |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 590/590 |
| `npm run test:integration` | 335/335, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` | 196 passed (8.3m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Reviewer verdicts

On the PR.
