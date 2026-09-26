// The W0-06 4.3 submit and 4.6 resubmit events (W0-04 "Submit" / "Resubmit" rows; W2-01 adds (d)-(f) to the same
// transaction) and the three W0-02 7.6 reads. Resubmit is submit of a draft whose `parent_version_id` is set —
// same POST /draft/submit route (case.submit). Authentication, authorization and the case's existence in the
// actor's scope ran in the W1-01 middleware (W0-06 section 4 steps 1-3); the header and the body shape ran in the
// route (step 4, first half). What runs here, in `withWorkflowTransaction` under the case row lock (W0-06 9.1):
//   step 4 (store)  — the nine slot rows of the open draft each carry a disposition and every N/A a reason;
//   step 5          — replay: the same (actor, key, digest) → the stored 201 body, nothing written;
//   step 6          — ExpectedVersion (W0-06 5.2 submit row): `version_closed` on a Ready case, `version_
//                     superseded` when the named version is not the open draft (already submitted, or no draft),
//                     `revision_changed` when the revision differs from `case.row_version`;
//   step 7          — freeze the draft row in place (submitted_by/role/at, configuration_revision_id and
//                     frozen_configuration for every kind in force under the W1-00 activation rule, lane_mapping_
//                     version = CURRENT_LANE_MAPPING.version with its content, manifest_hash, submit_correlation_id),
//                     close the draft on the case (current_version_id, draft_version_id NULL, desk_status in_review,
//                     three lane projections pending, row_version + 1; resubmit also ai_readiness_status =
//                     not_ready), audit `version.submitted` (v1) or `version.resubmitted` (N+1) then
//                     `lane.opened` × 3 and lane_open notification rows for each fixture holder of each lane
//                     (W2-01 (d)+(f); no SLA columns), store the key with the 201 body (idempotency action
//                     `case.resubmit` when the locked draft had a parent), commit. A failure while opening any
//                     lane rolls everything back. The route schedules pack QC only after this promise resolves
//                     with a fresh commit; the response never waits.

import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import { InvalidInputError, NotFoundError } from '@rai/shared/errors';
import type { ConfigurationKind } from '@rai/shared/schemas/cases';
import type {
  ExpectedVersion,
  SubmitRequest,
  SubmittedVersion,
  VersionListResponse,
} from '@rai/shared/schemas/versions';
import type { AuditRefValue } from '../audit/store.js';
import { requestDigest } from '../cases/idempotency.js';
import { readCaseRow, readVersionRow, type CaseRow, type PackVersionRow } from '../cases/repository.js';
import { revisionInForce } from '../configuration/activation.js';
import type { Db, Executor, Tx } from '../db/client.js';
import { configurationRevision } from '../db/schema/configuration-revision.js';
import { caseRef, keyRef, staleAt } from '../workflow/refs.js';
import { listLaneDecisions } from '../workflow/repository.js';
import {
  frozenSlotsOf,
  laneMappingContent,
  resolveFrozenConfiguration,
  submitSlotErrors,
  submittedVersionView,
  versionSummaryOf,
  type RevisionInForce,
} from './freeze.js';
import { readNames, type SubjectDirectory } from '../cases/subject-directory.js';
import { withDeciderName, withSubmitterName } from './display-names.js';
import { manifestHash } from './manifest.js';
import {
  openLanesOnSubmit,
  laneOpenRecipientsForCase,
  EMPTY_LANE_OPEN_RECIPIENTS,
  type LaneOpenRecipients,
  type LaneReviewerSpocUnits,
} from './open-lanes.js';
import {
  closeDraftOnCase,
  freezeDraft,
  listSubmittedVersions,
  readSlotsWithArtifacts,
  readSubmittedVersion,
} from './repository.js';
import { withWorkflowTransaction, type ActionContext, type WorkflowResult } from './transaction.js';

export interface VersionServiceDeps {
  db: Db;
  now?: () => Date;
  /** W3-F1: names for display on reads; absent means reads carry subject IDs only. */
  subjects?: SubjectDirectory;
  /** Slice-1: fixture reviewers who hold each lane (from identity data). Empty until W8 AD resolution otherwise. */
  laneOpenRecipients?: LaneOpenRecipients;
  /** W3-F2: lane reviewers' BU-SPOC grants; a reviewer who is SPOC of the case's BU gets no lane-opened mail. */
  laneReviewerSpocUnits?: LaneReviewerSpocUnits;
}

export const SUBMIT_ACTION = 'case.submit' as const;
/** Stored on `idempotency_key.action` when the locked draft had a parent (W0-06 4.6 / W2-04). Digest stays `case.submit`. */
export const RESUBMIT_ACTION = 'case.resubmit' as const;

/** Step 6 (W0-06 5.2 submit row) for the named draft: the open draft, not Ready, revision matches. */
async function assertExpectedDraft(tx: Tx, row: CaseRow, expected: ExpectedVersion): Promise<PackVersionRow> {
  const current = row.currentVersionId === null ? undefined : await readVersionRow(tx, row.currentVersionId);
  if (current?.readyAt != null)
    throw staleAt('version_closed', 'error.stale_version.guidance.ready', current, row);
  const draft = row.draftVersionId === null ? undefined : await readVersionRow(tx, row.draftVersionId);
  if (draft === undefined || draft.id !== expected.versionId) {
    const shown = draft ?? current;
    if (shown === undefined) throw new NotFoundError('version'); // no draft and no version: cannot happen after create
    throw staleAt('version_superseded', 'error.stale_version.guidance.version_superseded', shown, row);
  }
  if (row.rowVersion !== expected.revision) {
    throw staleAt('revision_changed', 'error.stale_version.guidance.revision_changed', draft, row);
  }
  return draft;
}

/** Every configuration kind's revision in force at `at` under the W1-00 activation rule (one read, all kinds). */
export async function revisionsInForce(exec: Executor, at: Date): Promise<RevisionInForce[]> {
  const rows = await exec
    .select({
      id: configurationRevision.id,
      kind: configurationRevision.kind,
      publishedAt: configurationRevision.publishedAt,
      activationRule: configurationRevision.activationRule,
    })
    .from(configurationRevision);
  const byKind = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const out: RevisionInForce[] = [];
  for (const [kind, candidates] of byKind) {
    const best = revisionInForce(
      candidates.map((c) => ({ ...c, activationRule: c.activationRule as 'after_publish' })),
      at,
    );
    if (best !== undefined)
      out.push({ kind: kind as ConfigurationKind, id: best.id, publishedAt: best.publishedAt });
  }
  return out;
}

/** The submit / resubmit transaction (W0-06 4.3 / 4.6). Returns the 201 body, replayed or fresh. */
export async function submitDraft(
  deps: VersionServiceDeps,
  ctx: ActionContext,
  caseId: string,
  request: SubmitRequest,
  idempotencyKey: string,
): Promise<WorkflowResult<SubmittedVersion>> {
  const now = (deps.now ?? (() => new Date()))();
  // W3-F1: resolved before the transaction opens, so the lookup never takes a second pool connection while the
  // case lock is held. The same directory as the reads; the actor is only its fallback; no directory, no name.
  const submitterName = (await deps.subjects?.resolve(ctx.actor.subjectId, ctx.actor))?.displayName;
  // Digest always uses case.submit so a replay after the draft is closed still matches (W2-04: do not derive
  // the digest from post-commit state). The stored action may be case.resubmit via storeAction.
  return withWorkflowTransaction<SubmittedVersion>(
    deps.db,
    caseId,
    {
      ...ctx,
      action: SUBMIT_ACTION,
      idempotencyKey,
      requestDigest: requestDigest(SUBMIT_ACTION, request),
      now,
    },
    {
      // Step 4 (store): the slot precondition over the open draft; without a draft, steps 5 and 6 answer.
      async validate(tx, caseRow) {
        if (caseRow.draftVersionId === null) return;
        const { rows } = await readSlotsWithArtifacts(tx, caseRow.draftVersionId);
        const errors = submitSlotErrors(rows);
        if (errors.length > 0) throw new InvalidInputError(errors);
      },
      async apply({ tx, caseRow: before, audit }) {
        const draft = await assertExpectedDraft(tx, before, request.expectedVersion);
        const isResubmit = draft.parentVersionId !== null;
        // Step 7: resolve what the version freezes, then the two writes.
        const frozen = resolveFrozenConfiguration(await revisionsInForce(tx, now));
        const slots = await readSlotsWithArtifacts(tx, draft.id);
        const version = await freezeDraft(tx, draft.id, {
          submittedBy: ctx.actor.subjectId,
          submittedRole: ctx.role,
          submittedAt: now,
          configurationRevisionId: frozen.configurationRevisionId,
          frozenConfiguration: frozen.byKind,
          laneMappingVersion: CURRENT_LANE_MAPPING.version,
          laneMapping: laneMappingContent(CURRENT_LANE_MAPPING),
          manifestHash: manifestHash(slots.manifest),
          submitCorrelationId: ctx.correlationId,
        });
        const after = await closeDraftOnCase(tx, before, version.id, now, {
          resetAiReadiness: isResubmit,
        });
        // A version just frozen has no decisions yet.
        const body = withSubmitterName(
          submittedVersionView(version, frozenSlotsOf(slots.rows, slots.artifacts), true, []),
          submitterName,
        );
        const slotRefs: AuditRefValue[] = slots.rows.map((r) => {
          const ref: Record<string, AuditRefValue> = { slot: r.slot, state: r.state };
          if (r.artifactId !== null) {
            ref.artifact_id = r.artifactId;
            const art = slots.artifacts.get(r.artifactId);
            if (art !== undefined) ref.content_hash = art.sha256;
          }
          return ref;
        });
        const idempotencyKeyReference = keyRef(idempotencyKey);
        // W0-06 4.6: version.resubmitted payload equals version.submitted plus parent_version_id (already present).
        await audit({
          action: isResubmit ? 'version.resubmitted' : 'version.submitted',
          targetCaseId: before.id,
          targetVersionId: version.id,
          targetRef: {
            idempotency_key: idempotencyKeyReference,
            version_number: version.versionNumber,
            parent_version_id: version.parentVersionId,
            submitted_role: ctx.role,
            stage_context: version.stageContext,
            configuration_revision_id: frozen.configurationRevisionId,
            frozen_configuration: frozen.byKind as Record<string, string>,
            lane_mapping_version: CURRENT_LANE_MAPPING.version,
            manifest_hash: version.manifestHash,
            slots: slotRefs,
          },
          beforeRef: caseRef(before),
          afterRef: caseRef(after),
          occurredAt: now,
        });
        // W2-01 (d)+(f): three lane.opened audits then lane_open notification rows; same correlation id.
        await openLanesOnSubmit({
          tx,
          audit,
          caseId: before.id,
          versionId: version.id,
          laneMappingVersion: CURRENT_LANE_MAPPING.version,
          correlationId: ctx.correlationId,
          idempotencyKeyRef: idempotencyKeyReference,
          occurredAt: now,
          recipients: laneOpenRecipientsForCase(
            deps.laneOpenRecipients ?? EMPTY_LANE_OPEN_RECIPIENTS,
            deps.laneReviewerSpocUnits,
            before.businessUnitId,
          ),
        });
        return {
          status: 201,
          body,
          ...(isResubmit ? { storeAction: RESUBMIT_ACTION } : {}),
        };
      },
    },
  );
}

/** `GET /api/cases/{caseId}/versions`: ascending by versionNumber; empty while never submitted. */
export async function listVersions(
  exec: Executor,
  caseId: string,
  subjects?: SubjectDirectory,
): Promise<VersionListResponse> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) throw new NotFoundError('case');
  const rows = await listSubmittedVersions(exec, caseId);
  const names = readNames(subjects);
  return {
    items: await Promise.all(
      rows.map(async (v) => {
        const summary = versionSummaryOf(v, v.id === row.currentVersionId);
        return withSubmitterName(summary, await names(summary.submittedBy));
      }),
    ),
  };
}

/**
 * The 7.6 read of one submitted version (`pick` names it from the case row), in one read-only snapshot so its
 * slots, `isLatest` and decisions describe the same instant. 404 `version` also when the id belongs to another case.
 */
async function readView(
  db: Db,
  caseId: string,
  pick: (caseRow: CaseRow) => string | null,
  subjects?: SubjectDirectory,
): Promise<SubmittedVersion> {
  const view = await db.transaction(
    async (tx) => {
      const row = await readCaseRow(tx, caseId);
      if (row === undefined) throw new NotFoundError('case');
      const versionId = pick(row);
      const version = versionId === null ? undefined : await readSubmittedVersion(tx, caseId, versionId);
      if (version === undefined) throw new NotFoundError('version');
      const slots = await readSlotsWithArtifacts(tx, version.id);
      return submittedVersionView(
        version,
        frozenSlotsOf(slots.rows, slots.artifacts),
        version.id === row.currentVersionId,
        await listLaneDecisions(tx, version.id),
      );
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  // W3-F1: names after the snapshot closes, so no second pool connection is taken while it is open.
  const names = readNames(subjects);
  const decisions = await Promise.all(
    view.decisions.map(async (d) => withDeciderName(d, await names(d.decidedBy))),
  );
  return withSubmitterName({ ...view, decisions }, await names(view.submittedBy));
}

/** `GET /api/cases/{caseId}/versions/{versionId}`. */
export const readVersion = (db: Db, caseId: string, versionId: string, subjects?: SubjectDirectory) =>
  readView(db, caseId, () => versionId, subjects);

/** `GET /api/cases/{caseId}/versions/latest`: 404 `version` when never submitted. */
export const latestVersion = (db: Db, caseId: string, subjects?: SubjectDirectory) =>
  readView(db, caseId, (row) => row.currentVersionId, subjects);
