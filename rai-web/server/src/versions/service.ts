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
//                     lane rolls everything back. Pack QC after commit (W0-07 3.4) is not bound in slice 1; the
//                     response never waits.

import { createHash } from 'node:crypto';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import { InvalidInputError, NotFoundError, StaleVersionError } from '@rai/shared/errors';
import type { Principal, Role } from '@rai/shared/schemas/auth';
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
import { staleDetails } from '../cases/service.js';
import { revisionInForce } from '../configuration/activation.js';
import type { Db, Executor, Tx } from '../db/client.js';
import type { NodeEnv } from '../config.js';
import { configurationRevision } from '../db/schema/configuration-revision.js';
import {
  frozenSlotsOf,
  laneMappingContent,
  resolveFrozenConfiguration,
  submitSlotErrors,
  submittedVersionView,
  versionSummaryOf,
  type RevisionInForce,
} from './freeze.js';
import { manifestHash } from './manifest.js';
import { openLanesOnSubmit, EMPTY_LANE_OPEN_RECIPIENTS, type LaneOpenRecipients } from './open-lanes.js';
import {
  closeDraftOnCase,
  freezeDraft,
  listSubmittedVersions,
  readSlotsWithArtifacts,
  readSubmittedVersion,
} from './repository.js';
import { withWorkflowTransaction, type WorkflowResult } from './transaction.js';

export interface VersionServiceDeps {
  db: Db;
  /** From AppConfig (config.ts); used to gate the test-only failure hook. Never read process.env here. */
  nodeEnv: NodeEnv;
  now?: () => Date;
  /** Slice-1: fixture reviewers who hold each lane (from identity data). Empty until W8 AD resolution otherwise. */
  laneOpenRecipients?: LaneOpenRecipients;
  /**
   * Test-only failure injection (W2-01): throws after the first lane_open notification insert inside the
   * submit transaction. Ignored unless `nodeEnv` is `test`; unset in production wiring.
   */
  failAfterFirstLaneOpenNotification?: () => void;
}

/** Who acts, as which role (the policy row that allowed), under which correlation id (W0-10). */
export interface ActionContext {
  actor: Principal;
  role: Role;
  correlationId: string;
}

export const SUBMIT_ACTION = 'case.submit' as const;
/** Stored on `idempotency_key.action` when the locked draft had a parent (W0-06 4.6 / W2-04). Digest stays `case.submit`. */
export const RESUBMIT_ACTION = 'case.resubmit' as const;
const AUDIT_REF = /^[A-Za-z0-9_.:/@-]{1,64}$/;

/** The key as an audit reference: verbatim when it is one (a UUID is), else its SHA-256 (the audit store admits no free text). */
function keyRef(key: string): string {
  return AUDIT_REF.test(key) ? key : createHash('sha256').update(key).digest('hex');
}

function refreshPathFor(caseId: string, version: PackVersionRow): string {
  return version.submittedAt === null ? `/cases/${caseId}` : `/cases/${caseId}/versions/${version.id}`;
}

/** Step 6 (W0-06 5.2 submit row) for the named draft: the open draft, not Ready, revision matches. */
async function assertExpectedDraft(tx: Tx, row: CaseRow, expected: ExpectedVersion): Promise<PackVersionRow> {
  const current = row.currentVersionId === null ? undefined : await readVersionRow(tx, row.currentVersionId);
  if (current?.readyAt != null) {
    throw new StaleVersionError(
      staleDetails(
        'version_closed',
        'error.stale_version.guidance.ready',
        current,
        row.rowVersion,
        refreshPathFor(row.id, current),
      ),
    );
  }
  const draft = row.draftVersionId === null ? undefined : await readVersionRow(tx, row.draftVersionId);
  if (draft === undefined || draft.id !== expected.versionId) {
    const shown = draft ?? current;
    if (shown === undefined) throw new NotFoundError('version'); // no draft and no version: cannot happen after create
    throw new StaleVersionError(
      staleDetails(
        'version_superseded',
        'error.stale_version.guidance.version_superseded',
        shown,
        row.rowVersion,
        refreshPathFor(row.id, shown),
      ),
    );
  }
  if (row.rowVersion !== expected.revision) {
    throw new StaleVersionError(
      staleDetails(
        'revision_changed',
        'error.stale_version.guidance.revision_changed',
        draft,
        row.rowVersion,
        refreshPathFor(row.id, draft),
      ),
    );
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
  // Digest always uses case.submit so a replay after the draft is closed still matches (W2-04: do not derive
  // the digest from post-commit state). The stored action may be case.resubmit via storeAction.
  return withWorkflowTransaction<SubmittedVersion>(
    deps.db,
    caseId,
    {
      actor: ctx.actor,
      role: ctx.role,
      correlationId: ctx.correlationId,
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
        const body = submittedVersionView(version, frozenSlotsOf(slots.rows, slots.artifacts), true);
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
        if (version.laneMappingVersion === null) {
          throw new Error('submit freeze left lane_mapping_version null');
        }
        await openLanesOnSubmit({
          tx,
          audit,
          caseId: before.id,
          versionId: version.id,
          laneMappingVersion: version.laneMappingVersion,
          correlationId: ctx.correlationId,
          idempotencyKeyRef: idempotencyKeyReference,
          occurredAt: now,
          recipients: deps.laneOpenRecipients ?? EMPTY_LANE_OPEN_RECIPIENTS,
          nodeEnv: deps.nodeEnv,
          ...(deps.failAfterFirstLaneOpenNotification === undefined
            ? {}
            : { failAfterFirstLaneOpenNotification: deps.failAfterFirstLaneOpenNotification }),
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

function caseRef(row: CaseRow): Record<string, AuditRefValue> {
  return {
    draft_version_id: row.draftVersionId,
    current_version_id: row.currentVersionId,
    desk_status: row.deskStatus,
    row_version: row.rowVersion,
    privacy_status: row.privacyStatus,
    security_status: row.securityStatus,
    rai_status: row.raiStatus,
    ai_readiness_status: row.aiReadinessStatus,
  };
}

/** `GET /api/cases/{caseId}/versions`: ascending by versionNumber; empty while never submitted. */
export async function listVersions(exec: Executor, caseId: string): Promise<VersionListResponse> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) throw new NotFoundError('case');
  const rows = await listSubmittedVersions(exec, caseId);
  return { items: rows.map((v) => versionSummaryOf(v, v.id === row.currentVersionId)) };
}

async function viewOf(exec: Executor, caseRow: CaseRow, version: PackVersionRow): Promise<SubmittedVersion> {
  const slots = await readSlotsWithArtifacts(exec, version.id);
  return submittedVersionView(
    version,
    frozenSlotsOf(slots.rows, slots.artifacts),
    version.id === caseRow.currentVersionId,
  );
}

/** `GET /api/cases/{caseId}/versions/{versionId}`: 404 `version` also when the id belongs to another case. */
export async function readVersion(
  exec: Executor,
  caseId: string,
  versionId: string,
): Promise<SubmittedVersion> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) throw new NotFoundError('case');
  const version = await readSubmittedVersion(exec, caseId, versionId);
  if (version === undefined) throw new NotFoundError('version');
  return viewOf(exec, row, version);
}

/** `GET /api/cases/{caseId}/versions/latest`: 404 `version` when never submitted. */
export async function latestVersion(exec: Executor, caseId: string): Promise<SubmittedVersion> {
  const row = await readCaseRow(exec, caseId);
  if (row === undefined) throw new NotFoundError('case');
  const version =
    row.currentVersionId === null
      ? undefined
      : await readSubmittedVersion(exec, caseId, row.currentVersionId);
  if (version === undefined) throw new NotFoundError('version');
  return viewOf(exec, row, version);
}
