# Review: W3 deferred rulings

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision: Ta accepted the recommendations as presented in the Claude Code session of 2026-09-26; the register row "W3 deferred rulings" in [decisions.md](../../docs/product/decisions.md) is the record. No code in this change.

## What changed

- `docs/product/decisions.md`: the "W3 deferred rulings" row (items 2, 3, 5-12 of the [hardening review](../2026-09-23-w3-hardening/review.md) section 5, and the walkthrough's status-name question).
- `docs/engineering/qc-boundary-and-mail-sink.md` 3.4 step 6 and the 3.9 test obligation: a version closed by a send-back is refused, not appended to (item 2). This states what `loadOpenSubmittedTarget` already does; no code change.

## Tickets opened (package W3, status ready)

| Issue | Ruling | Lane |
|---|---|---|
| [#163](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/163) W3-F1 display names | 8 | A+B (contract PR, then UI) |
| [#164](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/164) W3-F2 conflicted reviewer mail and page note | 10 | B |
| [#165](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/165) W3-F3 per-lane defect count | 11 | B |
| [#166](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/166) W3-F4 send-back link to the successor draft | 12 | B |
| [#167](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/167) W3-F5 one Thai term for desk completion | status name | B |
| [#168](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/168) W3-F6 delete `scopedCases` | 5 | A |
| [#169](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/169) W3-F7 `BLOB_TMP_MAX_AGE_HOURS` minimum | 7 | A |

No ticket: 3 (substitute kept until W4 kickoff), 6 (unchanged until W7), 9 (not pursued). Item 4 was already a W7-00 precondition, and item 1 (#35) was decided on 2026-09-25.

## Checks

`node scripts/check-links.mjs` 0 broken; `git diff --check` clean. Reviewer verdicts are recorded on the PR.
