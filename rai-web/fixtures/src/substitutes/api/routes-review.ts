// W2-10: W0-02 section 7.7 shapes on the in-memory substitute — lane approve / send-back (W2-02), lane QC run
// and disposition append (W2-05). Ready (W2-06) is evaluated inside approve and disposition only; no POST /ready.
// Authorization for lane routes goes through authorizeRequest (target:lane); disposition authorizes finding.* after
// body.kind → action mapping. History remains the existing version read (immutable). Synthetic fixtures only.

import { authorize, type Action } from '@rai/server/authz/policy';
import { LANE_MAPPINGS_BY_VERSION, LANES, slotsForLane, type Lane } from '@rai/shared/constants';
import { ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type {
  AuthorizedArtifactRef,
  QcFinding,
  QcRunRequest,
  SlotState as QcSlotState,
} from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import {
  ApproveLaneRequestSchema,
  DispositionRequestSchema,
  LaneQcRunRequestSchema,
  SendBackLaneRequestSchema,
  VersionFindingsResponseSchema,
  type ApproveLaneRequest,
  type DispositionKind,
  type DispositionRequest,
  type DispositionResponse,
  type LaneDecisionResponse,
  type LaneQcRunRequest,
  type LaneQcRunResponse,
  type SendBackLaneRequest,
  type StoredFindingSummary,
  type VersionFindingsResponse,
} from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { RouteContext, RouteDefinition } from './handler.js';
import { authorizedCase } from './routes-cases.js';
import type { StoredCase, StoredFinding, StoredLaneDecision, StoredQcRun } from './store.js';
import { UNBOUND_ENGINE_ID } from './store.js';
import { assertValid, json, parseJsonBody, UUID_PATTERN } from './support.js';
import {
  actorOf,
  applyReadyIfHeld,
  assertLanePending,
  assertSubmittedCurrent,
  ensureSuccessorDraft,
  replayFor,
  requestDigest,
  requireIdempotencyKey,
  requireNamedArtifactFeedback,
  requireQcRunId,
  requireReasonForDisposition,
  staleVersion,
  storeReplay,
  writeLaneProjection,
} from './workflow.js';

const KIND_TO_ACTION: Record<DispositionKind, Action> = {
  fixed_proposed: 'finding.propose_fixed',
  fixed: 'finding.mark_fixed',
  fixed_confirmed: 'finding.confirm_fixed',
  waived: 'finding.waive',
  not_applicable: 'finding.mark_na',
};

const LANE_SET: ReadonlySet<string> = new Set(LANES);

function parseLane(raw: string | undefined): Lane {
  if (raw === undefined || !LANE_SET.has(raw)) throw new ForbiddenError();
  return raw as Lane;
}

function decisionResponse(
  decision: StoredLaneDecision,
  successorDraftVersionId: string | null,
  caseRevision: number,
  ready: boolean,
): LaneDecisionResponse {
  return {
    decisionId: decision.decisionId,
    versionId: decision.versionId,
    lane: decision.lane,
    decision: decision.decision,
    decidedAt: decision.decidedAt,
    successorDraftVersionId,
    caseRevision,
    ready,
  };
}

/** Keep only defect findings that pass the boundary checks for this lane's run (W0-06 section 7 as recorded). */
function storeableFindings(
  findings: readonly QcFinding[],
  mappingVersion: string,
  context: {
    trigger: 'approve_attempt';
    lane: Lane;
    qcRulesRevision: string;
    checklistTemplateVersion: string;
  },
): QcFinding[] {
  const mapping = LANE_MAPPINGS_BY_VERSION[mappingVersion];
  if (mapping === undefined) return [];
  const out: QcFinding[] = [];
  for (const finding of findings) {
    if (validateQcFinding(finding, context) !== null) continue;
    if (checkOwningLane(finding, mapping, context.lane) !== null) continue;
    out.push(finding);
  }
  return out;
}

function buildLaneQcRequest(
  ctx: RouteContext,
  stored: StoredCase,
  version: SubmittedVersion,
  lane: Lane,
): QcRunRequest {
  const mapping =
    LANE_MAPPINGS_BY_VERSION[version.laneMappingVersion] ?? LANE_MAPPINGS_BY_VERSION['lane-mapping/v1']!;
  const laneSlots = slotsForLane(lane, mapping);
  const slots: QcSlotState[] = laneSlots.map((slot) => {
    const frozen = version.slots[slot];
    if (frozen.state === 'attached') {
      return {
        slot,
        disposition: 'attached',
        reason: null,
        artifactId: frozen.artifact.artifactId,
      };
    }
    if (frozen.state === 'not_applicable') {
      return {
        slot,
        disposition: 'not_applicable',
        reason:
          frozen.reason.kind === 'default_non_vendor'
            ? 'slot.na.reason.non_vendor_default'
            : frozen.reason.text,
        artifactId: null,
      };
    }
    return {
      slot,
      disposition: frozen.state,
      reason: null,
      artifactId: null,
    };
  });
  const artifacts: AuthorizedArtifactRef[] = [];
  for (const s of slots) {
    if (s.disposition !== 'attached' || s.artifactId === null) continue;
    const storedArt = ctx.store.artifacts.get(s.artifactId);
    if (storedArt === undefined) continue;
    const ref = storedArt.ref;
    artifacts.push({
      artifactId: ref.artifactId,
      slot: s.slot,
      contentHash: ref.sha256,
      mediaType: ref.mediaType,
      filename: ref.filename,
      byteLength: ref.sizeBytes,
      read: () => Promise.resolve(new ReadableStream<Uint8Array>()),
    });
  }
  return {
    correlationId: ctx.correlationId,
    runKey: `approve_attempt:${version.versionId}:${lane}:${version.configurationRevisionId}`,
    trigger: 'approve_attempt',
    lane,
    version: {
      caseId: stored.caseId,
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      isDraft: false,
    },
    checklistTemplateVersion: version.checklistTemplateVersion,
    qcRulesRevision: version.configurationRevisionId,
    laneMappingVersion: version.laneMappingVersion,
    stageContext: version.stageContext,
    modelType: stored.fields.modelType,
    vendorInvolved: stored.fields.vendorInvolved,
    slots,
    artifacts,
    deadlineMs: Date.now() + 10_000,
  };
}

async function runLaneQc(
  ctx: RouteContext,
  stored: StoredCase,
  version: SubmittedVersion,
  lane: Lane,
): Promise<LaneQcRunResponse> {
  const key = ctx.store.qcRunKey(version.versionId, lane);
  const prior = ctx.store.qcRuns.get(key);
  // Completed runs replay (W0-07 3.7). Unavailable replays only when unbound and still unbound
  // (real orchestrator); runner_error / timeout fall through and re-run.
  if (prior !== undefined && prior.status === 'completed') {
    return { runId: prior.runId, status: 'completed', findings: prior.findings.map((f) => ({ ...f })) };
  }
  if (
    prior !== undefined &&
    prior.status === 'unavailable' &&
    prior.engineId === UNBOUND_ENGINE_ID &&
    ctx.store.qcRunner === null
  ) {
    return {
      runId: prior.runId,
      status: 'unavailable',
      reason: 'not_configured',
      findings: [],
    };
  }

  const request = buildLaneQcRequest(ctx, stored, version, lane);
  const runId = uuidv7(ctx.options.now().getTime());

  if (ctx.store.qcRunner === null) {
    const row: StoredQcRun = {
      runId,
      versionId: version.versionId,
      lane,
      status: 'unavailable',
      engineId: UNBOUND_ENGINE_ID,
      reason: 'not_configured',
      findings: [],
    };
    ctx.store.qcRuns.set(key, row);
    return { runId, status: 'unavailable', reason: 'not_configured', findings: [] };
  }

  const runner = ctx.store.qcRunner;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.options.qcTimeoutMs);
  let result: Awaited<ReturnType<typeof runner.run>>;
  try {
    result = await runner.run(request, controller.signal);
  } catch {
    clearTimeout(timer);
    const row: StoredQcRun = {
      runId,
      versionId: version.versionId,
      lane,
      status: 'unavailable',
      engineId: runner.identity.runner,
      reason: 'timeout',
      findings: [],
    };
    ctx.store.qcRuns.set(key, row);
    return { runId, status: 'unavailable', reason: 'timeout', findings: [] };
  } finally {
    clearTimeout(timer);
  }

  if (result.status === 'unavailable') {
    const row: StoredQcRun = {
      runId,
      versionId: version.versionId,
      lane,
      status: 'unavailable',
      engineId: runner.identity.runner,
      reason: result.reason,
      findings: [],
    };
    ctx.store.qcRuns.set(key, row);
    return { runId, status: 'unavailable', reason: result.reason, findings: [] };
  }

  const kept = storeableFindings(result.findings, version.laneMappingVersion, {
    trigger: 'approve_attempt',
    lane,
    qcRulesRevision: version.configurationRevisionId,
    checklistTemplateVersion: version.checklistTemplateVersion,
  });
  const summaries: StoredFindingSummary[] = [];
  for (const finding of kept) {
    const findingId = uuidv7(ctx.options.now().getTime());
    const slot =
      finding.scope.kind === 'slot' || finding.scope.kind === 'artifact' ? finding.scope.slot : null;
    const summary: StoredFindingSummary = {
      findingId,
      ruleId: finding.ruleId,
      slot,
      severity: finding.severity,
      owningLane: finding.owningLane,
      messageKey: finding.message.key,
      messageParams: { ...finding.message.params },
    };
    const storedFinding: StoredFinding = {
      ...summary,
      versionId: version.versionId,
      caseId: stored.caseId,
      runId,
    };
    // Finding object is inserted once and never rewritten (dispositions append separately).
    ctx.store.findings.set(findingId, Object.freeze(storedFinding));
    summaries.push(summary);
  }
  const row: StoredQcRun = {
    runId,
    versionId: version.versionId,
    lane,
    status: 'completed',
    engineId: runner.identity.runner,
    findings: summaries,
  };
  ctx.store.qcRuns.set(key, row);
  return { runId, status: 'completed', findings: summaries.map((f) => ({ ...f })) };
}

function authorizeFinding(
  ctx: RouteContext,
  action: Action,
  stored: StoredCase,
  owningLane: Lane,
): { role: string } {
  if (ctx.principal === undefined) throw new UnauthenticatedError();
  const actor = actorOf(ctx.principal);
  const decision = authorize(actor, action, {
    kind: 'finding',
    facts: {
      caseId: stored.caseId,
      ownerSubjectId: stored.fields.businessOwner,
      businessUnitId: stored.fields.businessUnitId,
    },
    owningLane,
  });
  if (!decision.allow) {
    ctx.emitter.log('authz.denied', {
      action,
      targetType: 'finding',
      targetId: stored.caseId,
      actorSubjectId: actor.subjectId,
      actorRole: actor.roles.map((r) => r.role).join(','),
      reason: decision.reason,
    });
    throw new ForbiddenError();
  }
  return { role: decision.via.role };
}

export function reviewRoutes(): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/cases/:caseId/versions/:versionId/lanes/:lane/approve',
      auth: { kind: 'action', action: 'lane.approve', target: 'lane' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        if (ctx.principal === undefined || ctx.authz === undefined) throw new NotFoundError('case');
        const lane = parseLane(ctx.params.lane);
        const key = requireIdempotencyKey(ctx);
        const body = parseJsonBody(ctx.request);
        assertValid(ApproveLaneRequestSchema, body);
        const request = body as ApproveLaneRequest;
        const qcRunId = requireQcRunId(request.qcRunId);
        if (request.expectedVersion.versionId !== ctx.params.versionId) {
          throw new InvalidInputError([
            { path: 'body.expectedVersion.versionId', messageKey: 'validation.required' },
          ]);
        }
        const digest = requestDigest('lane.approve', ctx.path, ctx.request.body);
        const replay = replayFor(ctx, key, digest, stored.caseId);
        if (replay !== undefined) return replay;

        const version = assertSubmittedCurrent(stored, request.expectedVersion.versionId, {
          requireNoSuccessor: true,
        });
        assertLanePending(ctx, version.versionId, lane, stored);

        const now = ctx.options.now();
        const nowIso = now.toISOString();
        const decision: StoredLaneDecision = {
          decisionId: uuidv7(now.getTime()),
          versionId: version.versionId,
          lane,
          decision: 'approve',
          actorSubjectId: ctx.principal.subjectId,
          actorRole: ctx.authz.decision.via.role,
          feedback: null,
          observedQcRunId: qcRunId,
          decidedAt: nowIso,
        };
        ctx.store.decisions.set(ctx.store.decisionKey(version.versionId, lane), decision);
        writeLaneProjection(stored, lane, 'approved', nowIso);
        const ready = applyReadyIfHeld(ctx, stored, version.versionId, nowIso);
        const response = json(
          201,
          ctx.correlationId,
          decisionResponse(decision, null, stored.caseRevision, ready),
        );
        storeReplay(ctx, key, digest, response);
        return response;
      },
    },
    {
      method: 'POST',
      path: '/api/cases/:caseId/versions/:versionId/lanes/:lane/send-back',
      auth: { kind: 'action', action: 'lane.send_back', target: 'lane' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        if (ctx.principal === undefined || ctx.authz === undefined) throw new NotFoundError('case');
        const lane = parseLane(ctx.params.lane);
        const key = requireIdempotencyKey(ctx);
        const body = parseJsonBody(ctx.request);
        assertValid(SendBackLaneRequestSchema, body);
        const request = body as SendBackLaneRequest;
        const feedback = requireNamedArtifactFeedback(request.feedback);
        if (request.expectedVersion.versionId !== ctx.params.versionId) {
          throw new InvalidInputError([
            { path: 'body.expectedVersion.versionId', messageKey: 'validation.required' },
          ]);
        }
        const digest = requestDigest('lane.send_back', ctx.path, ctx.request.body);
        const replay = replayFor(ctx, key, digest, stored.caseId);
        if (replay !== undefined) return replay;

        const version = assertSubmittedCurrent(stored, request.expectedVersion.versionId, {
          requireNoSuccessor: false,
        });
        // Snapshot version N before any draft work so a later read proves immutability.
        const frozenBefore = structuredClone(version);
        assertLanePending(ctx, version.versionId, lane, stored);

        const now = ctx.options.now();
        const nowIso = now.toISOString();
        const decision: StoredLaneDecision = {
          decisionId: uuidv7(now.getTime()),
          versionId: version.versionId,
          lane,
          decision: 'send_back',
          actorSubjectId: ctx.principal.subjectId,
          actorRole: ctx.authz.decision.via.role,
          feedback,
          observedQcRunId: null,
          decidedAt: nowIso,
        };
        ctx.store.decisions.set(ctx.store.decisionKey(version.versionId, lane), decision);
        const successor = ensureSuccessorDraft(stored, version, ctx.principal.subjectId, nowIso);
        writeLaneProjection(stored, lane, 'sent_back', nowIso);
        // Version N must stay byte-identical to the pre-send-back snapshot.
        const still = stored.versions.find((v) => v.versionId === version.versionId);
        if (still === undefined || JSON.stringify(still) !== JSON.stringify(frozenBefore))
          throw new Error('send-back mutated version N');

        const response = json(
          201,
          ctx.correlationId,
          decisionResponse(decision, successor.draftId, stored.caseRevision, false),
        );
        storeReplay(ctx, key, digest, response);
        return response;
      },
    },
    {
      method: 'GET',
      path: '/api/cases/:caseId/versions/:versionId/findings',
      auth: { kind: 'action', action: 'version.view', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        const versionId = ctx.params.versionId ?? '';
        if (!UUID_PATTERN.test(versionId)) throw new NotFoundError('version');
        const version = stored.versions.find((v) => v.versionId === versionId);
        if (version === undefined) throw new NotFoundError('version');
        const findings: VersionFindingsResponse['findings'] = [];
        for (const finding of ctx.store.findings.values()) {
          if (finding.caseId !== stored.caseId || finding.versionId !== versionId) continue;
          const latest = (ctx.store.dispositions.get(finding.findingId) ?? []).at(-1);
          findings.push({
            findingId: finding.findingId,
            ruleId: finding.ruleId,
            slot: finding.slot,
            severity: finding.severity,
            owningLane: finding.owningLane,
            messageKey: finding.messageKey,
            latestDisposition: latest?.kind ?? null,
            ...(finding.messageParams === undefined ? {} : { messageParams: finding.messageParams }),
          });
        }
        assertValid(VersionFindingsResponseSchema, { findings });
        return json(200, ctx.correlationId, { findings } satisfies VersionFindingsResponse);
      },
    },
    {
      method: 'POST',
      path: '/api/cases/:caseId/versions/:versionId/lanes/:lane/qc-run',
      auth: { kind: 'action', action: 'lane.approve', target: 'lane' },
      handler: async (ctx) => {
        const stored = authorizedCase(ctx);
        const lane = parseLane(ctx.params.lane);
        const body = parseJsonBody(ctx.request);
        assertValid(LaneQcRunRequestSchema, body);
        const request = body as LaneQcRunRequest;
        if (request.expectedVersion.versionId !== ctx.params.versionId) throw new NotFoundError('version');
        const version = assertSubmittedCurrent(stored, request.expectedVersion.versionId, {
          requireNoSuccessor: false,
        });
        // qc-run allows an open successor (reviewers may still inspect N); Ready still closes it.
        const result = await runLaneQc(ctx, stored, version, lane);
        return json(200, ctx.correlationId, result);
      },
    },
    {
      method: 'POST',
      path: '/api/cases/:caseId/findings/:findingId/dispositions',
      auth: { kind: 'session' },
      handler: (ctx) => {
        if (ctx.principal === undefined) throw new UnauthenticatedError();
        const stored = ctx.store.cases.get(ctx.params.caseId ?? '');
        const key = requireIdempotencyKey(ctx);
        const body = parseJsonBody(ctx.request);
        assertValid(DispositionRequestSchema, body);
        const request = body as DispositionRequest;
        const action = KIND_TO_ACTION[request.kind];

        if (stored === undefined) {
          const probe = authorize(actorOf(ctx.principal), action, { kind: 'unresolved' });
          if (!probe.allow) throw new ForbiddenError();
          throw new NotFoundError('case');
        }

        if (!UUID_PATTERN.test(ctx.params.findingId ?? '')) throw new NotFoundError('finding');
        const finding = ctx.store.findings.get(ctx.params.findingId ?? '');
        if (finding === undefined || finding.caseId !== stored.caseId) {
          // No owning lane for an unknown finding (issue #35): 404 when any lane would allow, as the server does.
          const facts = {
            caseId: stored.caseId,
            ownerSubjectId: stored.fields.businessOwner,
            businessUnitId: stored.fields.businessUnitId,
          };
          const actor = actorOf(ctx.principal);
          const probes = LANES.map((owningLane) =>
            authorize(actor, action, { kind: 'finding', facts, owningLane }),
          );
          const probe = probes.find((p) => p.allow) ?? probes[0]!;
          if (!probe.allow) {
            ctx.emitter.log('authz.denied', {
              action,
              targetType: 'finding',
              targetId: stored.caseId,
              actorSubjectId: ctx.principal.subjectId,
              actorRole: ctx.principal.roles.map((r) => r.role).join(','),
              reason: probe.reason,
            });
            throw new ForbiddenError();
          }
          throw new NotFoundError('finding');
        }

        const authz = authorizeFinding(ctx, action, stored, finding.owningLane);
        // Reason after authorize: an unauthorized waived/N/A with no reason is 403, not 422.
        const reason = requireReasonForDisposition(request.kind, request.reason);
        const digest = requestDigest('finding.disposition', ctx.path, ctx.request.body);
        const replay = replayFor(ctx, key, digest, stored.caseId);
        if (replay !== undefined) return replay;

        const current = stored.versions.find((v) => v.isLatest);
        if (current !== undefined && stored.readyAtByVersionId.has(current.versionId))
          throw staleVersion(stored, 'version_closed');
        if (current === undefined || finding.versionId !== current.versionId)
          throw staleVersion(stored, 'version_superseded');
        if (request.expectedVersion.versionId !== finding.versionId)
          throw staleVersion(stored, 'version_superseded');

        if (request.kind === 'fixed_confirmed') {
          const latest = (ctx.store.dispositions.get(finding.findingId) ?? []).at(-1);
          if (latest?.kind !== 'fixed_proposed') {
            throw new InvalidInputError([
              { path: 'body.kind', messageKey: 'error.invalid_input.fixed_confirmed_without_proposal' },
            ]);
          }
        }

        // Snapshot the finding before append so a second disposition never rewrites it.
        const findingBefore = structuredClone(finding);
        const now = ctx.options.now();
        const nowIso = now.toISOString();
        const dispositionId = uuidv7(now.getTime());
        const list = ctx.store.dispositions.get(finding.findingId) ?? [];
        list.push({
          dispositionId,
          findingId: finding.findingId,
          kind: request.kind,
          reason,
          actorSubjectId: ctx.principal.subjectId,
          actorRole: authz.role,
          recordedAt: nowIso,
        });
        ctx.store.dispositions.set(finding.findingId, list);
        const still = ctx.store.findings.get(finding.findingId);
        if (still === undefined || JSON.stringify(still) !== JSON.stringify(findingBefore))
          throw new Error('disposition rewrote the finding object');

        const ready = applyReadyIfHeld(ctx, stored, finding.versionId, nowIso);
        const responseBody: DispositionResponse = {
          dispositionId,
          findingId: finding.findingId,
          kind: request.kind,
          recordedAt: nowIso,
          caseRevision: stored.caseRevision,
          ready,
        };
        const response = json(201, ctx.correlationId, responseBody);
        storeReplay(ctx, key, digest, response);
        return response;
      },
    },
  ];
}
