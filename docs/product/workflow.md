# Review workflow contract

Status: source rules plus implementation semantics decided under D02, D05 and D06 on 2026-09-21. Nothing is implemented yet; W0-W3 are authorized.

## Source rules

One review case has nine document slots and three parallel review lanes. Owner/BU SPOC can submit despite QC defects. Each upload runs artifact QC; submission runs pack QC; an approval attempt runs lane QC and surfaces findings. An authorized reviewer may approve or send back with artifact-specific feedback despite findings. Findings never become implicit approvals.

Slots: attached, not yet, N/A with reason, missing. DPA and SOW default to N/A for non-vendor cases; retain a visible reason. Other supporting docs have no lane gate. Lane mapping is AI/COE 1+5 (D02), DPO 2+3+4+5, IT/Security 5+6+7+8, held as a versioned constant recorded on each submitted version. All lanes open regardless of proposed risk tier.

Completion rule: three approvals for the current submitted version AND zero undispositioned defects → Ready for launch. Fixed, waived with reason and N/A with reason count as dispositions, not removal of history. This final transition is gated even though submit and lane decisions are soft-QC actions. Council/ITSM authority stays outside.

## State and concurrency semantics (decided under D05, 2026-09-21)

| Event | Result | Invariant |
|---|---|---|
| Create | Draft v1 | Unique desk-local identity |
| Submit | Immutable submitted v1; three lanes pending | Freeze artifact references, template and rules revisions |
| Approve lane | Append decision scoped to case/version/lane | Check actor permission and expected version |
| Send back | Preserve version N; open editable N+1 draft | Feedback names artifact and deficiency |
| Resubmit N+1 | Freeze N+1; reopen all lanes | Never silently reuse N approvals |
| Three approvals, open defects | Await disposition | No Ready for launch transition |
| Three approvals, all defects dispositioned | Ready for launch | Atomic final recheck |

Concurrent send-backs must reuse one successor draft; stale review actions must be rejected with refresh guidance, without modifying the closed version. Repeated submissions or decisions use idempotency keys. Old versions remain readable to authorized users. Unaffected lanes do not carry approval forward: every resubmission reopens all three lanes (D05). Waived and N/A dispositions are recorded by the finding's owning lane; the owner may propose "fixed", which the owning lane confirms. No one who is owner or BU SPOC on a case may approve a lane on that case.

## Failure behavior

QC failure creates an explicit QC-unavailable finding rather than a clean result; submission still succeeds. Reviewer sees the unavailable check before deciding. No silent cloud fallback. File safety/authorization failures may reject an upload; the promise of soft QC does not grant access or accept unsafe bytes.

Notifications follow committed state changes. Mail failure does not undo a valid human decision: record failed delivery, bounded retries and operator visibility. No automatic SLA escalation in v1; the operator receives breach reporting with case links. Under D06: one daily breach digest to the Admin-editable `operator_recipients` configuration; delivery failures visible to Admin; three retries with backoff; deduplication by (event, version, lane, recipient).

## SLA

DPO: 3 working days (D01); other lanes: 5, as Admin configuration. Display/report only. CCXO source says 3 days; working-day interpretation comes from Ta's v1 spec. Under D06: Asia/Bangkok timezone, Thai public-holiday list as Admin configuration, clock starts when the lane opens and restarts on each new submitted version. This is the operator's confirmed working rule, not a measured SLA.
