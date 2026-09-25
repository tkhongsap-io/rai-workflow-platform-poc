# Review

Documentation only. No decision is made or recorded; W4 stays not authorized. PR #171.

## Files

- `docs/delivery/w4-decision-briefs.md` (new): D08 and D09 briefs, D07 and D10 notes, related questions for Ta, draft W4 gate entry, appendix of rules already fixed.
- `docs/delivery/w4-work-breakdown.md` (new): draft W4 tickets, the W4a/W4b option, traceability.
- `docs/delivery/README.md`: two "Read in this order" entries; the path-at-a-glance W4 line split from W5-W8, still "not authorized".
- `docs/delivery/later-packages-outline.md`: one sentence in the W4 row linking both documents.
- `docs/board/lane-decisions-and-docs.md`: CLAIM and one entry, appended.
- This change folder.

Unchanged by design: BUILD_PLAN.md, docs/product/decisions.md, docs/product/source-spec.md.

## Reviewer verdicts

Two independent reviewers read head `12338f7` (the coordinator's commit citing the "W3 deferred rulings" row, on top of the first draft). Both: **PASS, conditional on PR #170 merging first**, because the briefs cite that register row, which #170 records. Both left non-blocking findings; the revision below addresses all of them in one commit.

## Revision after review

| #   | Finding                                   | Change                                                                                                                                                                                                                                                |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Owners must be able to act                | D08 and D09 each open with a "What we need from you" table (who, which questions, by which gate) and a plain-language summary; the "already fixed" tables moved to an appendix                                                                        |
| 2   | Options without trade-offs or not genuine | Every option has a one-line trade-off. D08 Q6(a)/(c) removed: the real-data part is now a scope statement (answered at W7), not a question. D09 Q3(c) removed: missing precision or denominator is already an A08 finding                             |
| 3   | D08 choices delegated to ADR-0006         | Provider and hosting stay with the D08 owners; ADR-0006 records the engine within what D08 permits. The recommendation states that it means outbound calls and an API key during W4. New D08 Q6: who holds the key during W4 on localhost, before D10 |
| 4   | "Never a QC output" miscited              | Now cited to W0-07 3.1; source-spec L7 cited only for "QC is soft"                                                                                                                                                                                    |
| 5   | "Slice 1 parses nothing"                  | Now "slice 1 reads only file headers" and "parses no document contents"                                                                                                                                                                               |
| 6   | Option B contradictions                   | W4-11 split: W4-11a (runner, rule revision; no decision) in W4a, W4-11b (model-call fields; D08) in W4b. The W4a exit is the W4-03/W4-04 fixture tests; the harness and frozen set stay in W4b, whose exit re-runs the deterministic rules            |
| 7   | "Consumed by" lists                       | Regenerated from the ticket table's Decisions column                                                                                                                                                                                                  |
| 8   | W4-04 and W4-02                           | W4-04 cites the "W3 deferred rulings" row item 2 and tests it. D11 moved to W4-03 only. W4-00 must state which rules revision an upload run on a draft reads; W4-02 follows it                                                                        |
| 9   | W4-09 "classic ML" attribution            | Classic-ML cases attributed to A08 and the evaluation plan's opening section, not its fixture list                                                                                                                                                    |
| 10  | W4a labels before D09                     | Marked provisional until D09; W4-09 confirms or replaces them; the draft gate entry says so                                                                                                                                                           |
| 11  | Ruling item 3                             | Added as related question 3 (ruled: substitute kept, revisit at W4 kickoff); W4-00 carries the revisit                                                                                                                                                |
| 12  | Minor                                     | README entry 8 says "not authorized"; plan.md step 6 names PR #171; the board entry's Evidence is the PR link                                                                                                                                         |

## Checks run (repository root, 2026-09-26, on the revision)

| Command                                                                                                       | Result                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-links.mjs`                                                                                | 292 Markdown files, 858 relative links checked, 0 broken                                                        |
| `node scripts/check-frozen-source.mjs`                                                                        | source-spec.md sha256 `92c4f712…b354` matches docs/sources.md row 1                                             |
| `git diff --check`                                                                                            | clean                                                                                                           |
| `cd rai-web && npx prettier@3.9.8 --check ../docs/delivery/w4-*.md ../changes/2026-09-26-w4-gate-briefs/*.md` | All matched files use Prettier code style (after `--write` on these files only; `npx` fetched the pinned 3.9.8) |

## Open for the owners

Everything in the briefs' "Open questions" lists, related questions 1 and 5-7, and the names of the AI/COE lead and the IT/Security owner.
