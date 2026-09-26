# Specification (part 1: contract and server)

Done when:

1. `CaseView` and `CaseSummary` carry optional `ownerDisplayName` (the W0-04 `business_owner` column, the queue's source); `VersionSummary` and `SubmittedVersion` carry optional `submittedByDisplayName`; `LaneDecision` carries optional `decidedByDisplayName`. Every subject ID stays.
2. Submitter and decider names come from the server's subject directory (fixture identities, then stored sign-in principals); the submit 201 resolves through the same directory as the reads, resolved outside any transaction, so in fixture mode the 201, its replay and every read of a version are byte-identical (A07). With a sign-in directory a name can change or drop over time (display only; a W7 follow-up). An unknown subject gets no name field. No directory wired means no names.
3. No new endpoint, no name in any log line, no change to any read's scope (W0-05).
4. W0-02 section 7 shows the fields and the display-only note; W0-05's W0-09 resolution row carries a dated note that it is extended.
5. Tests: `tests/integration/w3-f1-display-names.test.ts` (owner on case read and list; a BU SPOC's submission named on 201, replay, list, case and read, byte-identically; a DPO send-back named on the version read). Exact-shape expectations in `w1-05-submit` and `w2-02-lane-decision` gain the names they now correctly see. Full suite green; two reviewers; CI.
