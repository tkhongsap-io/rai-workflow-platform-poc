# Plan

1. RED: the three test files above (unit, view model, integration) fail on the missing exports and on the HR case's recipients.
2. Server: `laneReviewerSpocUnits(identities)` and `laneOpenRecipientsForCase(all, spocUnits, businessUnitId)` in `versions/open-lanes.ts`; `submitDraft` passes `before.businessUnitId`; `composeAppDeps` wires the map. The email-only `LaneOpenRecipients` type is unchanged, so hand-built maps in tests keep working.
3. Web: `laneExclusionNote` in the case view model; the note on the case page; `review.excluded.bu_spoc` in both catalogues.
4. Browser test; spec text; register and table pointer corrections; records; full suite serially on Postgres 55372; PR; two reviewers; CI; merge.
