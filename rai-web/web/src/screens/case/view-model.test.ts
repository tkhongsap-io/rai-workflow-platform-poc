// W1-06 view-model unit tests (W0-02 section 8.1: web unit tests cover view models and formatting only). Dates,
// sizes (i18n/format.test.ts), paths (routes.test.ts) and the envelope (api/client.test.ts) are tested where
// they live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type { SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { NEXT_ACTION_KEY } from '../cases/case-list.view-model.js';
import { STATUS_LABEL_KEY } from '../../components/status-badge.js';
import {
  SLOT_NUMBERS,
  SLOT_STATE_ORDER,
  applySlotChange,
  decidableLane,
  expectedVersionOf,
  isSelfExcludedOnCase,
  laneKey,
  laneProjectionStatus,
  mergedSlots,
  modelTypeKey,
  pendingCount,
  qcUnavailableReasonKey,
  reasonDisplay,
  reasonIsValid,
  reviewerLaneOf,
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
    ...overrides,
  };
}

test('W2-07: reviewerLaneOf, self-exclusion and decidableLane mirror the server deny cases', () => {
  assert.equal(reviewerLaneOf([aiCoe]), 'ai_coe');
  assert.equal(reviewerLaneOf([admin]), null);
  assert.equal(reviewerLaneOf([owner, dpo]), 'dpo');
  assert.equal(isSelfExcludedOnCase([dpo, spocCm], 'fixture:fx-user-dpo', baseView()), true);
  assert.equal(isSelfExcludedOnCase([dpo], 'fixture:fx-user-dpo', baseView()), false);
  assert.equal(isSelfExcludedOnCase([aiCoe], 'fixture:fx-user-owner-cm', baseView()), true);
  assert.equal(laneProjectionStatus(baseView(), 'ai_coe'), 'pending');
  assert.equal(laneProjectionStatus(baseView({ raiStatus: 'approved' }), 'ai_coe'), 'approved');

  const version = baseVersion();
  assert.equal(
    decidableLane({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view: baseView(),
      version,
      hasOpenDraft: false,
    }),
    'ai_coe',
  );
  assert.equal(
    decidableLane({
      roles: [admin],
      subjectId: 'fixture:fx-user-admin',
      view: baseView(),
      version,
      hasOpenDraft: false,
    }),
    null,
  );
  assert.equal(
    decidableLane({
      roles: [owner],
      subjectId: 'fixture:fx-user-owner-cm',
      view: baseView(),
      version,
      hasOpenDraft: false,
    }),
    null,
  );
  assert.equal(
    decidableLane({
      roles: [dpo],
      subjectId: 'fixture:fx-user-dpo',
      view: baseView(),
      version,
      hasOpenDraft: false,
    }),
    'dpo',
  );
  assert.equal(
    decidableLane({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view: baseView(),
      version: baseVersion({ isLatest: false }),
      hasOpenDraft: false,
    }),
    null,
  );
  assert.equal(
    decidableLane({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view: baseView(),
      version,
      hasOpenDraft: true,
    }),
    null,
  );
  assert.equal(
    decidableLane({
      roles: [aiCoe],
      subjectId: 'fixture:fx-user-ai-coe',
      view: baseView({ raiStatus: 'approved' }),
      version,
      hasOpenDraft: false,
    }),
    null,
  );
});

test('W2-07: send-back feedback requires a named slot; severity and qc reason keys exist', () => {
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
});
