// W1-13: the pieces of the W0-06 contract the case, pack and version routes share — the CaseView/CaseSummary
// projections, the stale-version envelope (W0-06 5.1/5.2/8.2), the idempotency-key rules (5.3), the draft
// defaults (W0-02 7.5) and the projected-field rule (W0-05 section 5). Pure functions over the store.

import { createHash } from 'node:crypto';
import { authorize, type Actor, type CaseScopeFacts } from '@rai/server/authz/policy';
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  StaleVersionError,
  type FieldError,
  type StaleReason,
} from '@rai/shared/errors';
import { LANES, type Lane } from '@rai/shared/constants';
import type { CaseId } from '@rai/shared/ids';
import { uuidv7 } from '@rai/shared/ids';
import type { Principal } from '@rai/shared/schemas/auth';
import type { CaseSummary, CaseView, CaseWritableFields } from '@rai/shared/schemas/cases';
import type { PackDraft, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { SendBackFeedback } from '@rai/shared/schemas/review';
import type { FrozenSlot, SubmittedVersion } from '@rai/shared/schemas/versions';
import type { RouteContext } from './handler.js';
import { baseHeaders } from './support.js';
import type { IdempotencyRecord, StoredCase, SubstituteStore } from './store.js';
import type { SubstituteResponse } from './types.js';
import { asContractStageContext } from './contract-cast.js';

export const SLOT_NUMBERS: readonly SlotNumber[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** The four W0-04 projections plus the other server-written fields W0-02 7.3 lists as rejected on write. */
export const PROJECTED_FIELDS: readonly string[] = Object.freeze([
  'privacyStatus',
  'securityStatus',
  'raiStatus',
  'aiReadinessStatus',
  'riskTier',
  'registryId',
  'status',
]);

export function caseView(stored: StoredCase): CaseView {
  const latest = stored.versions.at(-1);
  return {
    ...structuredClone(stored.fields),
    caseId: stored.caseId,
    registryId: stored.registryId,
    status: stored.status,
    riskTier: stored.riskTier,
    privacyStatus: stored.privacyStatus,
    securityStatus: stored.securityStatus,
    raiStatus: stored.raiStatus,
    aiReadinessStatus: stored.aiReadinessStatus,
    currentVersion:
      latest === undefined
        ? null
        : {
            versionId: latest.versionId,
            versionNumber: latest.versionNumber,
            submittedBy: latest.submittedBy,
            submittedAt: latest.submittedAt,
            isLatest: latest.isLatest,
          },
    draft:
      stored.draft === null
        ? null
        : {
            draftId: stored.draft.draftId,
            versionNumber: stored.draft.versionNumber,
            updatedAt: stored.draft.updatedAt,
          },
    caseRevision: stored.caseRevision,
    createdBy: stored.createdBy,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export function caseSummary(stored: StoredCase): CaseSummary {
  const latest = stored.versions.at(-1);
  return {
    caseId: stored.caseId,
    registryId: stored.registryId,
    useCaseName: stored.fields.useCaseName,
    businessUnitId: stored.fields.businessUnitId,
    businessUnit: stored.fields.businessUnit,
    businessOwner: stored.fields.businessOwner,
    useCaseGroup: stored.fields.useCaseGroup,
    status: stored.status,
    currentVersionNumber: latest === undefined ? null : latest.versionNumber,
    updatedAt: stored.updatedAt,
  };
}

export function actorOf(principal: Principal): Actor {
  return { subjectId: principal.subjectId, roles: principal.roles };
}

/** W0-05 "Query scope": the `caseScopeWhere(actor)` predicate over the actor's grants for `case.view`. */
export function inListScope(actor: Actor, stored: StoredCase): boolean {
  return actor.roles.some((grant) => {
    switch (grant.scope.kind) {
      case 'own_cases':
        return stored.fields.businessOwner === actor.subjectId;
      case 'business_unit':
        return stored.fields.businessUnitId === grant.scope.businessUnit;
      case 'all_cases':
        return true;
    }
  });
}

/** W0-02 7.5 defaults: every slot missing; 3 and 4 N/A `default_non_vendor` while vendorInvolved is false. */
export function defaultSlots(vendorInvolved: boolean): Record<SlotNumber, SlotState> {
  const slots = {} as Record<SlotNumber, SlotState>;
  for (const slot of SLOT_NUMBERS) slots[slot] = { state: 'missing' };
  if (!vendorInvolved) {
    slots[3] = { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
    slots[4] = { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
  }
  return slots;
}

export function newDraft(
  caseId: CaseId,
  fields: Pick<CaseWritableFields, 'vendorInvolved'>,
  templateVersion: string,
  updatedAt: string,
): PackDraft {
  return {
    draftId: uuidv7(),
    caseId,
    versionNumber: 1,
    parentVersionId: null,
    checklistTemplateVersion: templateVersion,
    stageContext: asContractStageContext('idea'),
    slots: defaultSlots(fields.vendorInvolved),
    draftRevision: 1,
    updatedAt,
  };
}

/** W0-02 7.5: when vendorInvolved flips to true, slots 3 and 4 still carrying the default revert to missing. */
export function applyVendorFlip(draft: PackDraft, before: boolean, after: boolean): void {
  if (before || !after) return;
  for (const slot of [3, 4] as const) {
    const state = draft.slots[slot];
    if (state.state === 'not_applicable' && state.reason.kind === 'default_non_vendor')
      draft.slots[slot] = { state: 'missing' };
  }
}

/** W0-05 section 5: a projected field in a body is 422 `error.invalid_input.projected_field` (after the policy decision). */
export function projectedFieldErrors(body: unknown, prefix: string): FieldError[] {
  if (typeof body !== 'object' || body === null) return [];
  return Object.keys(body)
    .filter((key) => PROJECTED_FIELDS.includes(key))
    .map((key) => ({ path: `${prefix}${key}`, messageKey: 'error.invalid_input.projected_field' }));
}

/** W0-02 7.3 value rules on writable fields that the TypeBox shape alone does not carry. */
export function caseFieldValueErrors(
  store: SubstituteStore,
  fields: Partial<CaseWritableFields>,
  prefix: string,
): FieldError[] {
  const out: FieldError[] = [];
  if (fields.useCaseGroup !== undefined && !store.configuration.useCaseGroups.includes(fields.useCaseGroup))
    out.push({ path: `${prefix}useCaseGroup`, messageKey: 'validation.not_in_configured_list' });
  if (fields.businessUnitId !== undefined && !store.businessUnitIds.has(fields.businessUnitId))
    out.push({ path: `${prefix}businessUnitId`, messageKey: 'validation.not_in_configured_list' });
  if (fields.businessOwner !== undefined && !store.subjectExists(fields.businessOwner))
    out.push({ path: `${prefix}businessOwner`, messageKey: 'validation.not_in_configured_list' });
  if (
    fields.sourceRecordId !== undefined &&
    fields.sourceRecordId.kind === 'known' &&
    !/^(TPM|VRO)-/.test(fields.sourceRecordId.value)
  )
    out.push({ path: `${prefix}sourceRecordId.value`, messageKey: 'validation.not_in_configured_list' });
  return out;
}

/** The W0-05 scope step on facts taken from a body (create) or the post-edit facts (edit); a deny is 403 `scope`. */
export function authorizeOnFacts(
  ctx: RouteContext,
  action: 'case.create' | 'case.edit_draft',
  facts: CaseScopeFacts,
  targetId: string | undefined,
): void {
  if (ctx.principal === undefined) throw new ForbiddenError();
  const actor = actorOf(ctx.principal);
  const decision = authorize(actor, action, { kind: 'case', facts });
  if (decision.allow) return;
  ctx.emitter.log('authz.denied', {
    action,
    targetType: 'case',
    targetId,
    actorSubjectId: actor.subjectId,
    actorRole: actor.roles.map((r) => r.role).join(','),
    reason: decision.reason,
  });
  throw new ForbiddenError();
}

/** W0-06 5.1/5.2/8.2: the stale envelope with the current reference of the version the caller may read. */
export function staleVersion(stored: StoredCase, reason: StaleReason): StaleVersionError {
  const latest = stored.versions.at(-1);
  const current =
    stored.draft !== null
      ? {
          versionId: stored.draft.draftId,
          versionNumber: stored.draft.versionNumber,
          revision: stored.draft.draftRevision,
          state: 'draft' as const,
          ready: false,
        }
      : latest !== undefined
        ? {
            versionId: latest.versionId,
            versionNumber: latest.versionNumber,
            revision: stored.caseRevision,
            state: 'submitted' as const,
            ready: stored.aiReadinessStatus === 'ready',
          }
        : {
            versionId: '',
            versionNumber: 0,
            revision: stored.caseRevision,
            state: 'draft' as const,
            ready: false,
          };
  const refreshPath =
    stored.draft !== null || latest === undefined
      ? `/cases/${stored.caseId}`
      : `/cases/${stored.caseId}/versions/${latest.versionId}`;
  return new StaleVersionError({
    reason,
    guidanceKey: `error.stale_version.guidance.${reason}`,
    current,
    refreshPath,
  });
}

/** W0-06 5.3: the header is required on create and submit; missing → 422 on `header.idempotency-key`. */
export function requireIdempotencyKey(ctx: RouteContext): string {
  const key = ctx.request.headers['idempotency-key'];
  if (key === undefined || key.trim() === '')
    throw new InvalidInputError([{ path: 'header.idempotency-key', messageKey: 'validation.required' }]);
  return key.trim();
}

export function requestDigest(action: string, path: string, body: Uint8Array | undefined): string {
  return createHash('sha256')
    .update(`${action}\0${path}\0`)
    .update(body ?? new Uint8Array())
    .digest('hex');
}

/**
 * W0-06 5.3 replay: same actor, key and digest → the stored response unchanged; same key with another digest →
 * 422 `error.invalid_input.idempotency_key_reused`. Returns undefined when the key is new.
 */
export function replayFor(
  ctx: RouteContext,
  key: string,
  digest: string,
  caseId: string | undefined,
): SubstituteResponse | undefined {
  if (ctx.principal === undefined) return undefined;
  const record = ctx.store.idempotency.get(`${ctx.principal.subjectId}\0${key}`);
  if (record === undefined) return undefined;
  if (record.digest !== digest)
    throw new InvalidInputError([
      { path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' },
    ]);
  ctx.emitter.log('workflow.idempotent_replay', {
    caseId,
    idempotencyKeyHash: createHash('sha256').update(key).digest('hex'),
  });
  return {
    status: record.status,
    headers: { ...baseHeaders(ctx.correlationId), 'content-type': 'application/json; charset=utf-8' },
    body: record.body,
  };
}

export function storeReplay(
  ctx: RouteContext,
  key: string,
  digest: string,
  response: SubstituteResponse,
): void {
  if (ctx.principal === undefined || response.body === undefined) return;
  const record: IdempotencyRecord = { digest, status: response.status, body: response.body };
  ctx.store.idempotency.set(`${ctx.principal.subjectId}\0${key}`, record);
}

/** W0-04 / W0-06 4.10: which case projection column a lane writes. */
export function projectionColumnForLane(lane: Lane): 'privacyStatus' | 'securityStatus' | 'raiStatus' {
  switch (lane) {
    case 'dpo':
      return 'privacyStatus';
    case 'it_security':
      return 'securityStatus';
    case 'ai_coe':
      return 'raiStatus';
  }
}

export function writeLaneProjection(
  stored: StoredCase,
  lane: Lane,
  value: 'pending' | 'approved' | 'sent_back',
  nowIso: string,
): void {
  stored[projectionColumnForLane(lane)] = value;
  stored.updatedAt = nowIso;
}

/** Reject approve without a qc_run_id (W0-06 4.4 `lane_qc_not_run`). */
export function requireQcRunId(qcRunId: string | undefined): string {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof qcRunId !== 'string' || qcRunId.trim() === '' || !UUID.test(qcRunId.trim())) {
    throw new InvalidInputError([
      { path: 'body.qcRunId', messageKey: 'error.invalid_input.lane_qc_not_run' },
    ]);
  }
  return qcRunId.trim();
}

/** A09: send-back feedback must name at least one artifact (slot). */
export function requireNamedArtifactFeedback(feedback: SendBackFeedback | undefined): SendBackFeedback {
  if (feedback === undefined || !Array.isArray(feedback.items) || feedback.items.length === 0) {
    throw new InvalidInputError([
      { path: 'body.feedback.items', messageKey: 'error.invalid_input.send_back_artifact_required' },
    ]);
  }
  for (let i = 0; i < feedback.items.length; i += 1) {
    const item = feedback.items[i]!;
    if (item.slot === undefined || item.deficiency === undefined || item.deficiency.trim() === '') {
      throw new InvalidInputError([
        { path: `body.feedback.items[${i}]`, messageKey: 'error.invalid_input.send_back_artifact_required' },
      ]);
    }
  }
  return feedback;
}

function unfreezeSlots(slots: Record<SlotNumber, FrozenSlot>): Record<SlotNumber, SlotState> {
  const out = {} as Record<SlotNumber, SlotState>;
  for (const slot of SLOT_NUMBERS) {
    const state = slots[slot];
    if (state.state === 'attached') out[slot] = { state: 'attached', artifactId: state.artifact.artifactId };
    else out[slot] = structuredClone(state);
  }
  return out;
}

/**
 * D05 / W0-06 4.5: create N+1 once; a second send-back reuses the open draft. Version N is never mutated.
 */
export function ensureSuccessorDraft(
  stored: StoredCase,
  parent: SubmittedVersion,
  createdBy: string,
  nowIso: string,
): { draftId: string; created: boolean } {
  if (stored.draft !== null) return { draftId: stored.draft.draftId, created: false };
  const draft: PackDraft = {
    draftId: uuidv7(),
    caseId: stored.caseId,
    versionNumber: parent.versionNumber + 1,
    parentVersionId: parent.versionId,
    checklistTemplateVersion: parent.checklistTemplateVersion,
    stageContext: parent.stageContext,
    slots: unfreezeSlots(parent.slots),
    draftRevision: 1,
    updatedAt: nowIso,
  };
  stored.draft = draft;
  stored.status = 'sent_back';
  stored.updatedAt = nowIso;
  void createdBy;
  return { draftId: draft.draftId, created: true };
}

/**
 * Current submitted version for decide / qc-run / disposition expected-version checks (W0-06 5.2).
 * `requireNoSuccessor`: approve only — an open successor draft closes the version for further approvals.
 */
export function assertSubmittedCurrent(
  stored: StoredCase,
  expectedVersionId: string,
  opts: { requireNoSuccessor: boolean },
): SubmittedVersion {
  const named = stored.versions.find((v) => v.versionId === expectedVersionId);
  if (named === undefined) throw new NotFoundError('version');

  const current = stored.versions.find((v) => v.isLatest) ?? stored.versions.at(-1);
  if (current === undefined) throw new NotFoundError('version');

  if (stored.readyAtByVersionId.has(current.versionId)) throw staleVersion(stored, 'version_closed');

  if (current.versionId !== named.versionId) throw staleVersion(stored, 'version_superseded');

  if (opts.requireNoSuccessor && stored.draft !== null) throw staleVersion(stored, 'version_closed');

  return named;
}

export function assertLanePending(
  ctx: RouteContext,
  versionId: string,
  lane: Lane,
  stored: StoredCase,
): void {
  if (ctx.store.decisions.has(ctx.store.decisionKey(versionId, lane)))
    throw staleVersion(stored, 'lane_already_decided');
}

/**
 * W2-06 Ready inside approve/disposition: three current-version approvals and no undispositioned finding.
 * `fixed_proposed` alone leaves a finding undispositioned. No POST /ready.
 */
export function applyReadyIfHeld(
  ctx: RouteContext,
  stored: StoredCase,
  versionId: string,
  nowIso: string,
): boolean {
  if (stored.readyAtByVersionId.has(versionId)) return false;
  const current = stored.versions.find((v) => v.isLatest);
  if (current === undefined || current.versionId !== versionId) return false;

  for (const lane of LANES) {
    const decision = ctx.store.decisions.get(ctx.store.decisionKey(versionId, lane));
    if (decision === undefined || decision.decision !== 'approve') return false;
  }

  for (const finding of ctx.store.findings.values()) {
    if (finding.versionId !== versionId) continue;
    const list = ctx.store.dispositions.get(finding.findingId) ?? [];
    const latest = list.at(-1);
    if (latest === undefined || latest.kind === 'fixed_proposed') return false;
  }

  stored.readyAtByVersionId.set(versionId, nowIso);
  stored.aiReadinessStatus = 'ready';
  stored.status = 'ready_for_launch';
  stored.updatedAt = nowIso;
  return true;
}

export function requireReasonForDisposition(kind: string, reason: string | undefined): string | null {
  if (kind === 'waived' || kind === 'not_applicable') {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new InvalidInputError([{ path: 'body.reason', messageKey: 'validation.reason_required' }]);
    }
    return reason.trim();
  }
  return typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null;
}
