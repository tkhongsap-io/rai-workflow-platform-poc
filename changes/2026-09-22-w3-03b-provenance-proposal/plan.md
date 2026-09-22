# W3-03b provenance contract proposal

Status: resumed proposal only, for parent review before shared-code implementation. Prepared from main `a26edc0` in `/tmp/rai-w3-digest-provenance`, branch `codex/w3-03b-provenance-plan`. Contract authority: W0-07, W0-10, W3-05 breach query and W3-07a prerequisite `aabee4c`. No consumer, shared code, migration, root log or running test environment is changed.

## Outcome and boundary

Allow a committed SLA digest notification to reach the existing synthetic memory/file sinks with real persisted operator-job provenance, without fabricating a business audit ID or weakening ordinary event validation. Land a separately reviewed shared mail/sink contract before the digest consumer. W3-07a owns migration 0007 and job/link schema; W3-04 owns dispatch attempts/retries. This proposal does not reserve a migration or implement a second dispatcher.

## Proposed shared shape

Keep `CommittedEvent` unchanged, including mandatory `auditEventId`. Narrow the ordinary arm accepted by `DeliveryRequest.event` to its three case-event kinds. Add a distinct digest event arm with `kind: sla_breach_digest`, null caseId/versionId/versionNumber/lane, required digestDay, committedAt and correlationId, and required `provenance: DigestJobProvenance` imported from the W3-07a schema. The provenance fields are kind=sla_digest_job, jobRunId, digestDay, correlationId. Digest must not carry auditEventId; ordinary events must not carry job provenance. This keeps case callers unchanged while replacing the old digest-as-business-event representation at the delivery boundary.

Require a valid calendar day and matching event/provenance day and correlation. Preserve existing day/recipient dedup identity, recipient configuration basis, synthetic-only addresses, safe links, rendering limits and attempt range. Do not put jobRunId into the dedup key: a second job on the same day must not bypass dedup. Sink validation proves shape and consistency, not SQL authorization. A syntactically plausible audit/job UUID alone cannot prove persisted authority.

## Daily producer policy confirmed by parent

Derive digestDay once from the persisted run startedAt in Asia/Bangkok; a run crossing midnight retains its starting day. Recipients come only from configured operator_recipients, never role membership or a fabricated human actor. Empty breach query completes the persisted run with breachCount=0 and no notification/link/mail. Nonempty runs enqueue at most one digest per configured address/day, with each run exposing only its own links. Persist start/completion/failure as operator-job evidence, never business audit events. Only existing memory/file sinks deliver; external transport is excluded.

## Concrete proposed type boundary

```ts
type CaseMailEvent = CommittedEvent & {
  kind: 'lane_opened' | 'sent_back' | 'ready_for_launch';
  provenance?: never;
};
interface CommittedDigestEvent {
  kind: 'sla_breach_digest';
  caseId: null;
  versionId: null;
  versionNumber: null;
  lane: null;
  digestDay: string;
  committedAt: string;
  correlationId: string;
  provenance: DigestJobProvenance;
  auditEventId?: never;
}
type MailDeliveryEvent = CaseMailEvent | CommittedDigestEvent;
// DeliveryRequest.event: MailDeliveryEvent; buildDedupKey accepts this union.
```

This is a proposal, not an edit to shared types. Existing case composers may need their return event locally narrowed after excluding digest; typecheck will identify those minimal compatibility edits. Preserve CommittedEvent itself and its required audit field. Import the final 07a provenance schema/type rather than duplicate it. Gate implementation on its positive validation of a canonical real day (for example 2026-09-22), not merely successful TypeScript compilation; any schema-pattern correction belongs to the 07a owner.

## File-level implementation sequence (after parent accepts proposal)

1. Reconcile against the completed/merged 07a spec and schema, then rebase this isolated branch onto the coordinated main prerequisite. Update W0-07's documented delivery boundary and the owning implementation-plan section. No edits to 07a migration/schema.
2. Shared contract PR: `rai-web/shared/src/mail/types.ts` introduces the event union and imports the existing provenance type; update affected shared mail helper signatures only where necessary. `rai-web/fixtures/src/substitutes/mail-sink/validate.ts` enforces both arms. Update existing sink support and memory/file tests together, including digest fixtures formerly using fake business audit IDs. Do not loosen ordinary event checks. Keep dedup, file persistence and concurrency behavior intact.
3. Contract validation: typecheck all callers; focused shared mail, memory/file, concurrency and no-external-mail tests; invalid/missing audit and cross-variant provenance tests; malformed/mismatched job IDs/day/correlation; positive digest, same-day duplicate and next-day send. Server-side tests, not sinks, must reject well-shaped IDs absent from SQL. Run relevant build/substitute checks. Record exact evidence before parent independent review and prerequisite PR.
4. Only after prerequisite approval/merge, separate consumer plan/code under `server/src/notifications/` and its tests: create persisted running job before query; use W3-05 breaches; render configured synthetic recipients; atomically insert outbox plus linkage, with 07a day/recipient constraint authoritative. Roll back a racing duplicate's outbox transaction, and do not absorb non-duplicate failures. Duplicate-only runs complete with no notification IDs. Record safe query/render/enqueue failures with the original correlation. Do not send until commit.
5. Dispatcher integration loads digest provenance by joining notification ID to its immutable link and persisted run; verifies day/recipient/correlation and digest row shape before composition. Retry the same row with original provenance. Reuse W3-04's single dispatcher and secure link/render primitives; never route digest through the case-only loader or add a second runner. committedAt comes from persisted enqueue data, never a fabricated audit or delivery-time timestamp.

## Integration fixture obligation

After 07a merges, 03a's “digest rows remain untouched” integration fixture must create a valid running job and digest outbox/link in one transaction. Preserve the exclusion assertion; never disable or weaken the deferred orphan-digest constraint. Parent coordinates this small compatibility edit after the currently running 03a full suite. No change is made to that worktree here.

## Acceptance and remaining gates

The shared contract is complete only after ordinary-case regressions remain green and both existing sinks accept the new valid digest variant while rejecting cross-variant or inconsistent provenance. Consumer acceptance additionally requires real isolated-DB evidence for absent/mismatched runs, orphan refusal at commit, concurrent same-day dedup without orphan rows, next-day delivery, own-run notification IDs and retry provenance retention. Database tests must use a separately allocated project/port; 54363 belongs to the parent's current full run, and 54351/54362 are busy.

Parent reviews this proposal first and coordinates prerequisite merges. No shared-code implementation is authorized by this document alone. Empty-breach behavior and daily identity are fixed above. The consumer plan will name the local daily invocation mechanism and deterministic clock seam before implementation; it will not introduce an external scheduler or transport. No push, PR or merge by this agent.

Base handoff: the proposal checkout remains main a26edc0. 07a aabee4c is the committed contract reference; its worktree now has merge head 44dc9c4. Rebase onto the eventual reviewed 07a head supplied by the parent before implementation, rather than copying in-progress schema or migration files. No edits to the 03a full-suite worktree.

## Accepted implementation base

Parent accepted this proposal and authorized the shared contract on `d931cea`; the isolated branch was rebased there with the plan and Lane B entry preserved. Implementation includes a small `shared/src/mail/provenance.ts` schema adapter so fixture sinks continue importing only shared code and permitted Node built-ins. File text headers also distinguish job provenance from ordinary audit provenance. No 07a schema/migration changes. Consumer remains gated on independent contract review and parent coordination with W3-04. Port 54367 is reserved for future consumer tests; no database is used for this prerequisite.
