# Review workflow contract

Status: source rules plus explicitly proposed implementation semantics. Nothing is implemented.

## Source rules

One review case has nine document slots and three parallel review lanes. Owner/BU SPOC can submit despite QC defects. Each upload runs artifact QC; submission runs pack QC; an approval attempt runs lane QC and surfaces findings. An authorized reviewer may approve or send back with artifact-specific feedback despite findings. Findings never become implicit approvals.

Slots: attached, not yet, N/A with reason, missing. DPA and SOW default to N/A for non-vendor cases; retain a visible reason. Other supporting docs have no lane gate. Current lane mapping is AI/COE 1+5 (pending confirmation), DPO 2+3+4+5, IT/Security 5+6+7+8. All lanes open regardless of proposed risk tier.

Completion rule: three approvals for the current submitted version AND zero undispositioned defects → Ready for launch. Fixed, waived with reason and N/A with reason count as dispositions, not removal of history. This final transition is gated even though submit and lane decisions are soft-QC actions. Council/ITSM authority stays outside.

## Proposed state and concurrency semantics (Ta/operator to confirm before slice 1)

| Event | Proposed result | Invariant |
|---|---|---|
| Create | Draft v1 | Unique desk-local identity |
| Submit | Immutable submitted v1; three lanes pending | Freeze artifact references, template and rules revisions |
| Approve lane | Append decision scoped to case/version/lane | Check actor permission and expected version |
| Send back | Preserve version N; open editable N+1 draft | Feedback names artifact and deficiency |
| Resubmit N+1 | Freeze N+1; reopen all lanes | Never silently reuse N approvals |
| Three approvals, open defects | Await disposition | No Ready for launch transition |
| Three approvals, all defects dispositioned | Ready for launch | Atomic final recheck |

Concurrent send-backs must reuse one successor draft; stale review actions must be rejected with refresh guidance, without modifying the closed version. Repeated submissions or decisions use idempotency keys. Old versions remain readable to authorized users. Whether unaffected lanes may carry approval forward is an open decision; proposed default is full re-review.

## Failure behavior (proposed)

QC failure creates an explicit QC-unavailable finding rather than a clean result; submission still succeeds. Reviewer sees the unavailable check before deciding. No silent cloud fallback. File safety/authorization failures may reject an upload; the promise of soft QC does not grant access or accept unsafe bytes.

Notifications follow committed state changes. Mail failure does not undo a valid human decision: record failed delivery, bounded retries and operator visibility. No automatic SLA escalation in v1; the operator receives breach reporting with case links. Proposed breach-email deduplication and retry limits must be agreed before implementation.

## SLA

DPO: proposed 3 working days; other lanes: proposed 5. Display/report only. CCXO source says 3 days; working-day interpretation comes from Ta's v1 spec. Calendar, holidays, clock start/pause/resubmission and timezone rules await confirmation. Do not imply a measured or organizationally approved SLA.
