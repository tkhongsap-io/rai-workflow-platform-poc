// Case-flow view-model unit tests (W0-02 section 8.1: web unit tests cover view models and formatting only). Dates,
// sizes (i18n/format.test.ts), paths (routes.test.ts) and the envelope (api/client.test.ts) are tested where
// they live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocaleKey, t } from '@rai/shared/locales/keys';
import type { SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { EVIDENCE_LOCATOR_KINDS, type QcRunSummary } from '@rai/shared/schemas/review';
import { NEXT_ACTION_KEY } from '../cases/case-list.view-model.js';
import { STATUS_LABEL_KEY } from '../../components/status-badge.js';
import {
  SLOT_NUMBERS,
  SLOT_STATE_ORDER,
  applySlotChange,
  dispositionKindKey,
  dispositionKindNeedsReason,
  dispositionKindsForActor,
  dispositionReasonIsValid,
  expectedVersionOf,
  findingMessageParams,
  isCaseWriter,
  isSelfExcludedOnCase,
  laneExclusionNote,
  laneIsDecidable,
  laneKey,
  laneProjectionStatus,
  mergedSlots,
  modelTypeKey,
  pendingCount,
  qcUnavailableReasonKey,
  evidenceLocations,
  evidenceLocatorKey,
  laneRunEmptyStatus,
  qcRunOutcome,
  qcRunOutcomeKey,
  qcTriggerKey,
  ruleLabelKey,
  unavailableRuns,
  reasonDisplay,
  reasonIsValid,
  reviewerFindingsLoadMode,
  reviewerLanesOf,
  reviewerWorkspaceLanes,
  sameSlotState,
  sendBackFeedbackIsValid,
  severityKey,
  slotCounts,
  slotHelpKey,
  slotLanes,
  slotNameKey,
  slotOfFieldPath,
  slotStateKey,
  stageKey,
  submissionLine,
} from './view-model.js';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { DispositionKind, StoredFindingSummary } from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';

const allMissing = (): Record<SlotNumber, SlotState> => {
  const out = {} as Record<SlotNumber, SlotState>;
  for (const slot of SLOT_NUMBERS) out[slot] = { state: 'missing' };
  return out;
};

test('every derived label is a key present in both catalogues (D12, section 10.1)', () => {
  for (const slot of SLOT_NUMBERS) assert.ok(isLocaleKey(slotNameKey(slot)), `slot ${slot}`);
  for (const state of SLOT_STATE_ORDER) {
    assert.ok(isLocaleKey(slotStateKey(state)), state);
    assert.ok(isLocaleKey(slotHelpKey(state)), state);
  }
  for (const lane of ['ai_coe', 'dpo', 'it_security'] as const) assert.ok(isLocaleKey(laneKey(lane)), lane);
  for (const status of [
    'draft',
    'in_review',
    'sent_back',
    'awaiting_disposition',
    'ready_for_launch',
  ] as const) {
    assert.ok(isLocaleKey(STATUS_LABEL_KEY[status]), status);
    assert.ok(isLocaleKey(NEXT_ACTION_KEY[status]), status);
  }
  for (const stage of ['idea', 'pre_build', 'pre_launch']) assert.ok(isLocaleKey(stageKey(stage)), stage);
  for (const modelType of ['classic_ml', 'llm', 'other']) assert.ok(isLocaleKey(modelTypeKey(modelType)));
  assert.ok(isLocaleKey(submissionLine({ currentVersion: null }).key));
  const line = submissionLine({
    currentVersion: { versionId: 'v', versionNumber: 2, submittedBy: 's', submittedAt: 't', isLatest: true },
  });
  assert.ok(isLocaleKey(line.key));
  assert.deepEqual(line.params, { number: 2 });
});

test('slot lanes follow the D02 mapping: slot 5 gates all three lanes, slot 9 none', () => {
  assert.deepEqual(slotLanes(1), ['ai_coe']);
  assert.deepEqual(slotLanes(3), ['dpo']);
  assert.deepEqual(slotLanes(5), ['ai_coe', 'dpo', 'it_security']);
  assert.deepEqual(slotLanes(7), ['it_security']);
  assert.deepEqual(slotLanes(9), []);
});

test('the N/A reason is required: 1..500 characters after trimming (section 7.5)', () => {
  assert.equal(reasonIsValid(''), false);
  assert.equal(reasonIsValid('   '), false);
  assert.equal(reasonIsValid('\n\t'), false);
  assert.equal(reasonIsValid('ไม่มีผู้ให้บริการภายนอก'), true);
  assert.equal(reasonIsValid('x'.repeat(500)), true);
  assert.equal(reasonIsValid('x'.repeat(501)), false);
  assert.equal(reasonIsValid(` ${'x'.repeat(500)} `), true);
});

test('the default non-vendor reason renders from its locale key; a typed reason renders as text', () => {
  assert.deepEqual(reasonDisplay({ kind: 'default_non_vendor' }), {
    kind: 'key',
    key: 'slot.na.reason.non_vendor_default',
  });
  assert.deepEqual(reasonDisplay({ kind: 'text', text: 'MSA covers it' }), {
    kind: 'text',
    text: 'MSA covers it',
  });
});

test('pending slot changes: a change back to the saved state drops the entry; merged view and counts follow', () => {
  const saved = allMissing();
  saved[3] = { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
  let pending = applySlotChange(saved, {}, 7, { state: 'not_yet' });
  assert.deepEqual(pending, { 7: { state: 'not_yet' } });
  pending = applySlotChange(saved, pending, 8, {
    state: 'not_applicable',
    reason: { kind: 'text', text: 'r' },
  });
  assert.equal(pendingCount(pending), 2);
  pending = applySlotChange(saved, pending, 7, { state: 'missing' });
  assert.equal(pendingCount(pending), 1);
  assert.equal(pending[7], undefined);
  const merged = mergedSlots(saved, pending);
  assert.deepEqual(merged[8], { state: 'not_applicable', reason: { kind: 'text', text: 'r' } });
  assert.deepEqual(merged[7], { state: 'missing' });
  assert.deepEqual(slotCounts(merged), { attached: 0, not_yet: 0, missing: 7, not_applicable: 2 });
  // Re-applying the same N/A reason is not a change; a different reason is.
  pending = applySlotChange(saved, pending, 3, {
    state: 'not_applicable',
    reason: { kind: 'default_non_vendor' },
  });
  assert.equal(pending[3], undefined);
  pending = applySlotChange(saved, pending, 3, {
    state: 'not_applicable',
    reason: { kind: 'text', text: 'own' },
  });
  assert.notEqual(pending[3], undefined);
});

test('sameSlotState compares state, artifact and reason', () => {
  assert.equal(sameSlotState({ state: 'missing' }, { state: 'missing' }), true);
  assert.equal(sameSlotState({ state: 'missing' }, { state: 'not_yet' }), false);
  assert.equal(
    sameSlotState({ state: 'attached', artifactId: 'a' }, { state: 'attached', artifactId: 'b' }),
    false,
  );
  assert.equal(
    sameSlotState({ state: 'attached', artifactId: 'a' }, { state: 'attached', artifactId: 'a' }),
    true,
  );
  assert.equal(
    sameSlotState(
      { state: 'not_applicable', reason: { kind: 'text', text: 'a' } },
      { state: 'not_applicable', reason: { kind: 'default_non_vendor' } },
    ),
    false,
  );
});

test('the slot a field path of an invalid_input answer points at', () => {
  assert.equal(slotOfFieldPath('body.slots[4].reason'), 4);
  assert.equal(slotOfFieldPath('body.checklistTemplateVersion'), null);
  assert.equal(slotOfFieldPath('slots[0].reason'), null);
});

const aiCoe: RoleScope = { role: 'ai_coe', scope: { kind: 'all_cases', lane: 'ai_coe' } };
const dpo: RoleScope = { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } };
const itSec: RoleScope = { role: 'it_security', scope: { kind: 'all_cases', lane: 'it_security' } };
const admin: RoleScope = { role: 'admin', scope: { kind: 'all_cases' } };
const owner: RoleScope = { role: 'owner', scope: { kind: 'own_cases' } };
const spocCm: RoleScope = { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } };

function baseView(overrides: Partial<CaseView> = {}): CaseView {
  return {
    caseId: 'c1',
    registryId: 'RAI-2000-0001',
    useCaseName: 'Synthetic',
    businessUnit: 'Consumer',
    businessUnitId: 'CM',
    businessOwner: 'fixture:fx-user-owner-cm',
    technicalOwner: 'fixture:fx-user-owner-cm',
    sourceRecordId: { kind: 'unknown' },
    useCaseGroup: 'Customer',
    vendorInvolved: false,
    modelType: 'classic_ml',
    status: 'in_review',
    privacyStatus: 'pending',
    securityStatus: 'pending',
    raiStatus: 'pending',
    aiReadinessStatus: 'not_ready',
    riskTier: null,
    updatedAt: '2026-09-22T12:00:00Z',
    createdAt: '2026-09-22T11:00:00Z',
    createdBy: 'fixture:fx-user-owner-cm',
    caseRevision: 1,
    draft: null,
    currentVersion: {
      versionId: 'v1',
      versionNumber: 1,
      submittedBy: 'fixture:fx-user-owner-cm',
      submittedAt: '2026-09-22T12:00:00Z',
      isLatest: true,
    },
    ...overrides,
  };
}

function baseVersion(overrides: Partial<SubmittedVersion> = {}): SubmittedVersion {
  return {
    versionId: 'v1',
    caseId: 'c1',
    versionNumber: 1,
    parentVersionId: null,
    submittedBy: 'fixture:fx-user-owner-cm',
    submittedAt: '2026-09-22T12:00:00Z',
    checklistTemplateVersion: 'v1.0 Sheet3',
    stageContext: 'idea',
    configurationRevisionId: 'cfg-1',
    laneMappingVersion: 'lane-mapping/v1',
    slots: Object.fromEntries(
      SLOT_NUMBERS.map((n) => [n, { state: 'missing' }]),
    ) as SubmittedVersion['slots'],
    isLatest: true,
    decisions: [],
    ...overrides,
  };
}

test('reviewer lanes, self-exclusion and the decidable lane mirror the server deny cases', () => {
  assert.deepEqual(reviewerLanesOf([aiCoe]), ['ai_coe']);
  assert.deepEqual(reviewerLanesOf([admin]), []);
  assert.deepEqual(reviewerLanesOf([owner, dpo]), ['dpo']);
  assert.equal(isSelfExcludedOnCase([dpo, spocCm], 'fixture:fx-user-dpo', baseView()), true);
  assert.equal(isSelfExcludedOnCase([dpo], 'fixture:fx-user-dpo', baseView()), false);
  assert.equal(isSelfExcludedOnCase([aiCoe], 'fixture:fx-user-owner-cm', baseView()), true);
  assert.equal(laneProjectionStatus(baseView(), 'ai_coe'), 'pending');
  assert.equal(laneProjectionStatus(baseView({ raiStatus: 'approved' }), 'ai_coe'), 'approved');

  const lanesOf = (roles: RoleScope[], subjectId: string, version = baseVersion()) =>
    reviewerWorkspaceLanes({ roles, subjectId, view: baseView(), version });
  assert.deepEqual(lanesOf([aiCoe], 'fixture:fx-user-ai-coe'), ['ai_coe']);
  assert.deepEqual(lanesOf([admin], 'fixture:fx-user-admin'), []);
  assert.deepEqual(lanesOf([owner], 'fixture:fx-user-owner-cm'), [null]);
  assert.deepEqual(lanesOf([spocCm], 'fixture:fx-user-spoc-cm'), [null]);
  assert.deepEqual(lanesOf([dpo, spocCm], 'fixture:fx-user-dpo'), [null], 'self-excluded reviewer proposes');
  assert.deepEqual(lanesOf([aiCoe], 'fixture:fx-user-ai-coe', baseVersion({ isLatest: false })), []);
  assert.deepEqual(lanesOf([owner], 'fixture:fx-user-owner-cm', baseVersion({ isLatest: false })), []);

  const decidable = (overrides: Partial<CaseView>, hasOpenDraft = false) =>
    laneIsDecidable({ lane: 'ai_coe', view: baseView(overrides), hasOpenDraft });
  assert.equal(decidable({}), true);
  assert.equal(decidable({}, true), false);
  assert.equal(decidable({ raiStatus: 'approved' }), false);
  assert.equal(
    laneIsDecidable({ lane: 'dpo', view: baseView({ raiStatus: 'approved' }), hasOpenDraft: false }),
    true,
  );
});

test('the case writers are its owner and the SPOC of its BU; no reviewer, Admin or other-BU SPOC writes', () => {
  const spocHr: RoleScope = { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } };
  const writes = (roles: RoleScope[], subjectId: string) => isCaseWriter(roles, subjectId, baseView());
  assert.equal(writes([owner], 'fixture:fx-user-owner-cm'), true);
  assert.equal(writes([spocCm], 'fixture:fx-user-spoc-cm'), true);
  assert.equal(writes([owner], 'fixture:fx-user-owner-cm-2'), false, 'another owner');
  assert.equal(
    writes([aiCoe], 'fixture:fx-user-owner-cm'),
    false,
    'the owner subject without an owner grant',
  );
  assert.equal(writes([dpo, spocHr], 'fixture:fx-user-dpo-spoc-hr'), false, 'SPOC of another BU');
  for (const reviewer of [aiCoe, dpo, itSec, admin]) assert.equal(writes([reviewer], 'fixture:x'), false);
});

test('a principal with the dpo and it_security grants reviews and dispositions in both lanes', () => {
  const both: RoleScope[] = [dpo, itSec];
  const subjectId = 'fixture:fx-user-dpo-it';
  assert.deepEqual(reviewerLanesOf(both), ['dpo', 'it_security']);
  assert.deepEqual(
    reviewerWorkspaceLanes({ roles: both, subjectId, view: baseView(), version: baseVersion() }),
    ['dpo', 'it_security'],
  );
  for (const findingOwningLane of ['dpo', 'it_security'] as const) {
    assert.deepEqual(
      dispositionKindsForActor({
        roles: both,
        subjectId,
        view: baseView(),
        findingOwningLane,
        latestKind: null,
      }),
      ['fixed', 'waived', 'not_applicable'],
      findingOwningLane,
    );
  }
  assert.deepEqual(
    dispositionKindsForActor({
      roles: both,
      subjectId,
      view: baseView(),
      findingOwningLane: 'ai_coe',
      latestKind: null,
    }),
    [],
  );
});

test('send-back feedback requires a named slot; severity and qc reason keys exist', () => {
  assert.equal(sendBackFeedbackIsValid([]), false);
  assert.equal(sendBackFeedbackIsValid([{ slot: 5 as const, deficiency: '' }]), false);
  assert.equal(sendBackFeedbackIsValid([{ slot: 5 as const, deficiency: '   ' }]), false);
  assert.equal(sendBackFeedbackIsValid([{ slot: 5 as const, deficiency: 'BRD needs metric' }]), true);
  assert.deepEqual(expectedVersionOf({ versionId: 'v1' }), { versionId: 'v1', revision: 1 });
  for (const severity of ['high', 'medium', 'low', 'info'] as const) {
    assert.ok(isLocaleKey(severityKey(severity)), severity);
  }
  for (const reason of [
    'timeout',
    'runner_error',
    'not_configured',
    'artifact_unreadable',
    undefined,
  ] as const) {
    assert.ok(isLocaleKey(qcUnavailableReasonKey(reason)), String(reason));
  }
  assert.equal(qcUnavailableReasonKey(undefined), 'review.qc.reason.unreported', 'no reason is not a cause');
});

test('findingMessageParams fills {threshold_source} so t() never leaves braces', () => {
  const finding: StoredFindingSummary = {
    findingId: 'f1',
    ruleId: 'ACC-CLASSIC-ML-METRIC',
    slot: 1,
    severity: 'medium',
    owningLane: 'ai_coe',
    messageKey: 'qc.finding.acc_classic_ml_metric',
    messageParams: { threshold_source: 'v1.0 Sheet3' },
  };
  const params = findingMessageParams(finding);
  assert.equal(params.threshold_source, 'v1.0 Sheet3');
  assert.equal(params.slot, 1);
  const text = t('th', 'qc.finding.acc_classic_ml_metric', params);
  assert.equal(text.includes('{'), false, `rendered text still has braces: ${text}`);
  assert.ok(text.includes('v1.0 Sheet3'), text);
  const en = t('en', 'qc.finding.acc_classic_ml_metric', params);
  assert.equal(en.includes('{'), false, en);
  assert.ok(en.includes('v1.0 Sheet3'), en);
});

test('a decided lane keeps its workspace so its findings stay open to disposition', () => {
  assert.deepEqual(
    reviewerWorkspaceLanes({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view: baseView({ raiStatus: 'approved' }),
      version: baseVersion(),
    }),
    ['ai_coe'],
  );
});

test('dispositionKindsForActor: lane kinds, confirm after propose, owner propose-fixed only', () => {
  const view = baseView();
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: null,
    }),
    ['fixed', 'waived', 'not_applicable'],
  );
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: 'fixed_proposed',
    }),
    ['fixed', 'waived', 'not_applicable', 'fixed_confirmed'],
  );
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: 'waived',
    }),
    ['fixed', 'waived', 'not_applicable'],
  );
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [dpo],
      subjectId: 'fixture:fx-user-dpo',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: null,
    }),
    [],
  );
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [admin],
      subjectId: 'fixture:fx-user-admin',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: null,
    }),
    [],
  );
  // Owner with grant + matching subjectId → propose-fixed when findings are visible (GET …/findings).
  assert.equal(isCaseWriter([owner], 'fixture:fx-user-owner-cm', view), true);
  assert.equal(isCaseWriter([aiCoe], 'fixture:fx-user-owner-cm', view), false);
  assert.equal(isCaseWriter([spocCm], 'fixture:fx-user-spoc-cm', view), true);
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [owner],
      subjectId: 'fixture:fx-user-owner-cm',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: null,
    }),
    ['fixed_proposed'],
  );
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [owner],
      subjectId: 'fixture:fx-user-owner-cm',
      view,
      findingOwningLane: 'ai_coe',
      latestKind: 'fixed_proposed',
    }),
    ['fixed_proposed'],
  );
  assert.equal(dispositionKindNeedsReason('waived'), true);
  assert.equal(dispositionKindNeedsReason('not_applicable'), true);
  assert.equal(dispositionKindNeedsReason('fixed'), false);
  assert.equal(dispositionReasonIsValid(''), false);
  assert.equal(dispositionReasonIsValid('   '), false);
  assert.equal(dispositionReasonIsValid('accepted risk'), true);
  for (const kind of [
    'fixed_proposed',
    'fixed',
    'fixed_confirmed',
    'waived',
    'not_applicable',
  ] as DispositionKind[]) {
    assert.ok(isLocaleKey(dispositionKindKey(kind)), kind);
  }
});

test('lane QC runs only while the lane is decidable; otherwise the stored findings load', () => {
  const ready = baseView({ aiReadinessStatus: 'ready' });
  const mode = (lane: 'ai_coe' | 'dpo' | 'it_security' | null, view: CaseView, hasOpenDraft = false) =>
    reviewerFindingsLoadMode({ lane, view, hasOpenDraft });
  for (const lane of ['ai_coe', 'dpo', 'it_security'] as const) {
    assert.equal(mode(lane, baseView()), 'lane_qc', `${lane} pending`);
    assert.equal(mode(lane, ready), 'persisted', `${lane} Ready`);
    // After a send-back the version is closed: qc-run would answer 409.
    assert.equal(mode(lane, baseView(), true), 'persisted', `${lane} open successor draft`);
  }
  assert.equal(mode('ai_coe', baseView({ raiStatus: 'approved' })), 'persisted', 'decided lane');
  assert.equal(mode('ai_coe', baseView({ raiStatus: 'sent_back' })), 'persisted', 'sent-back lane');
  assert.equal(mode('dpo', baseView({ raiStatus: 'approved' })), 'lane_qc', 'another lane decided');
  assert.equal(mode(null, baseView()), 'persisted', 'proposal panel');
  assert.deepEqual(
    reviewerWorkspaceLanes({ roles: [aiCoe], subjectId: 'reviewer', view: ready, version: baseVersion() }),
    ['ai_coe'],
  );
  assert.deepEqual(
    reviewerWorkspaceLanes({
      roles: [aiCoe],
      subjectId: 'reviewer',
      view: ready,
      version: baseVersion({ isLatest: false }),
    }),
    [],
  );
});

test('Ready denies every offered mutation even when lane projections still say pending', () => {
  const view = baseView({ aiReadinessStatus: 'ready' });
  for (const lane of ['ai_coe', 'dpo', 'it_security'] as const) {
    assert.equal(laneIsDecidable({ lane, view, hasOpenDraft: false }), false, lane);
  }
  for (const grant of [aiCoe, dpo, itSec, owner, spocCm, admin]) {
    const subjectId: string = grant === owner ? view.businessOwner : 'reviewer';
    for (const findingOwningLane of ['ai_coe', 'dpo', 'it_security'] as const) {
      assert.deepEqual(
        dispositionKindsForActor({
          roles: [grant],
          subjectId,
          view,
          findingOwningLane,
          latestKind: 'fixed_proposed',
        }),
        [],
      );
    }
  }
  assert.deepEqual(
    dispositionKindsForActor({
      roles: [aiCoe],
      subjectId: 'reviewer',
      view: baseView({ raiStatus: 'approved' }),
      findingOwningLane: 'ai_coe',
      latestKind: 'fixed_proposed',
    }),
    ['fixed', 'waived', 'not_applicable', 'fixed_confirmed'],
  );
});

test('W3-F2: the page explains a missing decision panel only for a BU-SPOC conflict (ruling item 10)', () => {
  // A DPO reviewer who is BU SPOC of this case's BU (CM): the note names the lanes and the BU.
  assert.deepEqual(laneExclusionNote({ roles: [dpo, spocCm], view: baseView() }), {
    lanes: ['dpo'],
    businessUnit: 'CM',
  });
  // A reviewer with no conflict gets no note; so does one whose only conflict is owning the case (not ruled):
  // the helper looks only at BU-SPOC grants.
  assert.equal(laneExclusionNote({ roles: [dpo], view: baseView() }), null);
  assert.equal(laneExclusionNote({ roles: [aiCoe], view: baseView() }), null);
  // A BU SPOC with no lane grant has no decision panel to explain.
  assert.equal(laneExclusionNote({ roles: [spocCm], view: baseView() }), null);
});

// ---- W4-12: QC log, finding evidence and unavailable runs (W4a plan section 7) -------------------------------------

function qcRun(overrides: Partial<QcRunSummary>): QcRunSummary {
  return {
    runId: 'r-1',
    trigger: 'submit',
    lane: null,
    slot: null,
    status: 'completed',
    unavailableReason: null,
    runner: 'deterministic',
    runnerVersion: '0.1.0',
    ruleRevision: 'rev-1',
    rulesLabel: 'w4a.1',
    rulesEvaluated: 3,
    findingCount: 0,
    requestedAt: '2026-09-27T06:00:00.000Z',
    completedAt: '2026-09-27T06:00:01.000Z',
    ...overrides,
  };
}

test('W4-12: a finding rule label comes from its qc.rule.* key; an unknown rule has none', () => {
  assert.equal(ruleLabelKey('PACK-SLOT-MISSING'), 'qc.rule.pack_slot_missing');
  assert.equal(ruleLabelKey('ACC-BAND-V1-SHEET3'), 'qc.rule.acc_band_v1_sheet3');
  assert.equal(ruleLabelKey('QC-UNAVAILABLE'), 'qc.rule.qc_unavailable');
  assert.equal(ruleLabelKey('synthetic'), null);
  assert.equal(ruleLabelKey('NOT-A-CATALOGUED-RULE'), null);
});

test('W4-12: evidence locations are slot and locator kind, one per distinct pair, every kind has a label', () => {
  for (const kind of EVIDENCE_LOCATOR_KINDS) assert.ok(isLocaleKey(evidenceLocatorKey(kind)), kind);
  assert.deepEqual(
    evidenceLocations([
      { slot: 1, artifactId: 'a-1', locator: { kind: 'section', heading: '4. Hallucination and accuracy' } },
      { slot: 1, artifactId: 'a-1', locator: { kind: 'section', heading: 'another heading' } },
      { slot: 1, artifactId: 'a-1', locator: { kind: 'page', page: 3 } },
      { slot: null, artifactId: null, locator: { kind: 'absent' } },
    ]),
    [
      { slot: 1, kind: 'section' },
      { slot: 1, kind: 'page' },
      { slot: null, kind: 'absent' },
    ],
  );
  assert.deepEqual(evidenceLocations(undefined), []);
});

test('W4-12: a run reads unavailable, 0 rules evaluated, findings or no findings; the first two are never a clean pass', () => {
  assert.equal(
    qcRunOutcome(
      qcRun({ status: 'unavailable', unavailableReason: 'timeout', rulesEvaluated: 0, findingCount: 1 }),
    ),
    'unavailable',
  );
  assert.equal(qcRunOutcome(qcRun({ rulesEvaluated: 0, findingCount: 0 })), 'no_rules');
  assert.equal(qcRunOutcome(qcRun({ rulesEvaluated: 3, findingCount: 2 })), 'findings');
  assert.equal(qcRunOutcome(qcRun({ rulesEvaluated: 3, findingCount: 0 })), 'no_findings');
  // A row written before migration 0009 recorded no count: it cannot claim rules were evaluated.
  assert.equal(qcRunOutcome(qcRun({ rulesEvaluated: null, findingCount: 0 })), 'not_recorded');
  for (const outcome of ['unavailable', 'no_rules', 'findings', 'no_findings', 'not_recorded'] as const)
    assert.ok(isLocaleKey(qcRunOutcomeKey(outcome)), outcome);
  for (const trigger of ['upload', 'submit', 'approve_attempt'] as const)
    assert.ok(isLocaleKey(qcTriggerKey(trigger)), trigger);
});

test('W4-12: every unavailable run of the version, from any trigger, in log order', () => {
  const runs = [
    qcRun({ runId: 'u', trigger: 'upload', slot: 2, status: 'unavailable', unavailableReason: 'timeout' }),
    qcRun({ runId: 's', trigger: 'submit' }),
    qcRun({
      runId: 'a',
      trigger: 'approve_attempt',
      lane: 'dpo',
      status: 'unavailable',
      unavailableReason: 'runner_error',
    }),
  ];
  assert.deepEqual(
    unavailableRuns(runs).map((r) => r.runId),
    ['u', 'a'],
  );
});

test("W4-12: the lane result names 0 rules evaluated instead of 'no defects'; without the run's row it stays as before", () => {
  const laneRun = { runId: 'a', status: 'completed' as const, findings: [] };
  const runs = [qcRun({ runId: 'a', trigger: 'approve_attempt', lane: 'ai_coe', rulesEvaluated: 0 })];
  assert.equal(laneRunEmptyStatus(laneRun, runs), 'no_rules');
  assert.equal(
    laneRunEmptyStatus(laneRun, [
      qcRun({ runId: 'a', trigger: 'approve_attempt', lane: 'ai_coe', rulesEvaluated: 2 }),
    ]),
    'empty',
  );
  assert.equal(laneRunEmptyStatus(laneRun, []), 'empty');
  assert.equal(laneRunEmptyStatus(null, runs), 'none_stored');
  for (const status of ['empty', 'no_rules', 'none_stored'] as const)
    assert.ok(isLocaleKey(`review.findings.${status}`), status);
});
