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
  laneKey,
  mergedSlots,
  modelTypeKey,
  pendingCount,
  reasonDisplay,
  reasonIsValid,
  sameSlotState,
  slotCounts,
  slotHelpKey,
  slotLanes,
  slotNameKey,
  slotOfFieldPath,
  slotStateKey,
  stageKey,
  submissionLine,
} from './view-model.js';

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
