# Prototype test runs

Design session: https://claude.ai/cowork/cse_01NS3VpYm1i4rasdCkSxmHXh?artifact=08b0fc22-a4d5-4490-b992-2e90e4e5f1d1

Status: three design iterations completed. Core journey browser-tested; iteration 3 responsive/copy regressions retested. Ready for design review, not production acceptance. Results below distinguish observations from generator reports. Synthetic UI behavior cannot prove backend security or production readiness.

## Planned checks

- Owner/BU case scope; reviewer lane actions; Admin no implicit approval.
- New case validation; nine slots; N/A reason; sample evidence preview.
- Submit with QC findings opens three lanes; notification links target case.
- Artifact-specific send-back creates one successor; original version read-only.
- Resubmit resets lanes according to provisional full re-review policy.
- Three approvals with open defects remain awaiting disposition; reason required; final readiness qualified.
- Version-specific QC and explicit unavailable state.
- Admin publishes revised configuration; historical version unchanged.
- Reset deterministic; filters/no-match; keyboard/dialog handling.
- Desktop, tablet and mobile layout checks; inspect clipping and readability.

## Iterations

1. Initial detailed prompt submitted; artifact generation active. No test pass claimed yet.

## Observed browser pass 1

Artifact: https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz . Private Only you. Main artboard rendered and visually inspected at Fit in the browser: clean red/neutral hierarchy, case card, readable structure when scaled; exact responsive checks pending.

Observed successful interactions: open seeded draft with nine slots; run checks raised three findings; Submit anyway opened three parallel lanes; AI/COE role could act only own lane; empty send-back rejected with artifact/feedback errors; selecting BRD and 89-character correction text created one v2 draft; v1 snapshot opened read-only; audit retained the send-back feedback. These are frontend observations, not security proofs.

Generation-side report (not independently rerun locally): 78 handler-harness assertions passed, plus syntax/placeholder checks and contrast changes. Claude explicitly did not visually test its own result. Muted/link text darkened to #5B6878/#00639F; True reference blue remains #007AD0.

## Iteration 2 requested after browser findings

1. BU SPOC wrongly read-only in role matrix; restore own-BU create/edit/submit/resubmit.
2. Restricted queue leaks global count and out-of-scope filter options; scope counts, options and notifications.
3. Model version and checklist template version confused; separate fields and prove threshold selection by checklist, not model.
4. Historical snapshot labels current-at-submission lanes as final version decisions; append-only later decisions must remain visible alongside immutable document snapshot.
5. v2 draft incorrectly labelled submitted under old config; clarify draft vs prior submission.
6. Static responsive comps need labels; test actual main artifact at real layout widths, not scaled rendering.
7. Unrequested digest/opt-out and character minima must not become agreed requirements.

Corrections submitted in the same Claude Design session; subsequent evidence is recorded below.

## Observed browser pass 2

- Owner queue: 1 scoped case, no other-BU filter options. BU SPOC successfully submitted the pack; immutable v1 snapshot attributes submission to the SPOC.
- AI/COE send-back specifying BRD created v2 draft. Historical v1 shows Sent back and exact feedback, other lanes have no decision recorded. Draft/current configuration is separated from prior submitted configuration.
- Owner replaced BRD with the clean synthetic sample, resubmitted v2; findings decreased from three to two. All three lanes reopened.
- Each reviewer could act only on their lane; other-lane disposition and decision controls disabled.
- Three lane approvals with two open findings did not yield Ready. Empty waiver reason rejected (20-character minimum explicitly a demo assumption). IT waiver left one open; DPO waiver completed v2. Ready includes the Council/ITSM boundary notice.
- Admin has no lane/disposition authority. Published simulated revision 4 / pack template 1.5. Existing submitted v2 still explicitly uses revision 3 / pack template 1.4.
- Actual live app width switch exercised at 390 and 834, not static comp. Phone case heading compressed into a narrow column; tablet document filename compressed to one-character lines. Failed visual checks; correction requested.
- Approval QC dialog incorrectly says Nothing flagged when existing privacy/security flags appear above it. Correction requested: count all current flags, distinguish new and already-recorded.
- Admin role-mapping copy still describes SPOC as read/coordinate despite corrected handlers. Correction requested.

Generator reported 152 harness checks passing after iteration 2. Those are generator-reported checks, not independent browser evidence, and did not catch the responsive defects above.

## Iteration 3 requested

Targeted responsive layout repair (single-column narrow case header, stacked document rows at tablet width), accurate QC summary, and consistent SPOC role copy. Preserve state rules and update handoff. Affected regressions completed below.

## Additional observed checks during iteration 3

- Empty new-case form rejects missing name and missing known source ID. Choosing Unknown creates a nine-slot draft. Non-vendor DPA/SOW default N/A with reasons.
- Created model version 2.0 with checklist template v1.0: QC explicitly selects v1.0 Sheet3 thresholds independently of model version. Scenario 3 shows checklist v2.0 cannot inherit those thresholds and extraction accuracy is not hallucination rate.
- Scenario 4 submission explicitly says checks did not run, no clean pass; submitting records one unavailable finding in each of three lanes.
- High-risk evidence panel is read-only on submitted version, labels scenarios synthetic, requires Council tier confirmation and does not bypass three lanes.
- Notification preview opens the correct RAI-2026-0163 Retail Store Assistant case; no real message sent.

## Final browser pass 3

- 390px live case header now readable: stacked identity/status, one-column metadata, provenance below. No compressed side-by-side identity column. Case tabs deliberately scroll horizontally.
- 390px document rows now readable with filename/reason and actions below; inspected SOW, BRD and architecture after scrolling.
- 390px submission-QC dialog fits device frame; scrollable results and visible bottom actions. Submitted successfully at phone width.
- 834px case header uses sensible two-column metadata; risk-screening filename reads horizontally in a stacked document block. Parallel lane cards stack legibly, with authorized actions preserved.
- DPO approval with existing findings now says `2 check(s) flagged — 0 new, 2 already recorded`, and explains the lane's remaining open finding. Approval succeeds without pretending the case is clean.
- Admin mapping explicitly lists BU SPOC create/edit/save/submit/correct/resubmit, no lane decision/disposition.
- Reset returns to owner queue, one scoped seeded v1 draft, zero findings. Final 1440px queue visually inspected. Artifact renamed `True RAI Review Desk — Interactive Design` and left open.

Generator reported 218 assertions after iteration 3. This remains generator-reported, not independently executed. Independent evidence here is the actual UI walkthrough and visual inspection above. The full send-back-to-Ready chain was tested in iteration 2; after iteration 3 we repeated affected layout/QC/approval/reset paths, not every earlier path.

## Export and limits

HTML ZIP export selected through Claude Design; its download prompt completed and UI displayed `Saved Review desk · interactive · previews at 1440 834 390-html.zip.` (376.3 kB). A filesystem path was not exposed/found in usual download locations, so portable/offline execution is not verified. Use the private artifact link as the tested deliverable; no public access granted.

No unresolved defect remains from the observed regression list. This does not establish zero bugs. Full keyboard/screen-reader audit, all viewport/state combinations, real uploads/auth/persistence/notifications and offline export runtime were not tested. Static reference boards are not interactive evidence. True brand approval and production/operator acceptance remain external gates.
