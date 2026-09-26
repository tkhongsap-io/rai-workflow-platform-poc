# Review: W3-F2 BU-SPOC lane reviewer mail and page note (#164)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 10 (Ta, 2026-09-26). Synthetic data only.

## Change

- `server/src/versions/open-lanes.ts`: `laneReviewerSpocUnits(identities)` (each lane reviewer's address to the business units where it holds `bu_spoc`) and `laneOpenRecipientsForCase(all, spocUnits, businessUnitId)`. `submitDraft` filters the recipients with the case's `business_unit_id`; `composeAppDeps` wires the map. The email-only `LaneOpenRecipients` type is unchanged.
- `web/src/screens/case/view-model.ts`: `laneExclusionNote`; the case page shows it on the latest version (`data-lane-excluded="bu_spoc"`, `role="note"`), naming the lanes and the business unit; `review.excluded.bu_spoc` in both catalogues. Derived from the session's own grants and `CaseView.businessUnitId`: no read shape changes, and the API still answers 403.
- Docs: W0-05 3.3 table and prose, section 8 row and T28; W0-06 4.11. Corrections to #170's records: the register row now points at W0-06 4.3(f) and 4.11 (not "section 5"), and the W3-F3 table row and issue #165 at 4.11.
- The owner case is not ruled and is unchanged: an owner who is also a lane reviewer still gets the mail, and the page shows no note for it.

## Commands and results

Worktree `/tmp/rai-names`, Postgres `rai-names` on 55372, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `open-lanes.test.ts` and `view-model.test.ts` before the change | failed on the missing exports |
| RED: `tests/integration/w3-f2-spoc-reviewer-mail.test.ts` before the change | 1 of 2 failed: the HR case mailed `dpo.spoc.hr@rai-desk.example`; the CM control passed |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 590/590 |
| `npm run test:integration` | 334/334, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` | 196 passed (8.2m), including the new note test at three widths with axe in th and en |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Reviewer verdicts

On the PR.
