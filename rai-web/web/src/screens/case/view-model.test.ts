/// <reference types="node" />
// W1-06 view-model unit tests (W0-02 section 8.1: web unit tests cover view models and formatting only).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type { SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import {
  SLOT_NUMBERS,
  SLOT_STATE_ORDER,
  applySlotChange,
  formatBytes,
  formatDateTime,
  laneKey,
  mergedSlots,
  nextActionKey,
  pendingCount,
  presentError,
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
  statusKey,
  submissionLine,
  versionPath,
  signInPath,
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
    assert.ok(isLocaleKey(statusKey(status)), status);
    assert.ok(isLocaleKey(nextActionKey(status)), status);
  }
  for (const stage of ['idea', 'pre_build', 'pre_launch']) assert.ok(isLocaleKey(stageKey(stage)), stage);
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

test('dates render in Asia/Bangkok with the Gregorian year in Thai and English (D06, section 10.5)', () => {
  const th = formatDateTime('th', '2026-09-21T03:00:00Z'); // 10:00 in Bangkok
  const en = formatDateTime('en', '2026-09-21T03:00:00Z');
  assert.match(th, /2026/, th); // not 2569 (Buddhist era)
  assert.match(th, /10:00/, th);
  assert.match(en, /2026/, en);
  assert.match(en, /10:00/, en);
  assert.equal(formatDateTime('en', 'not-a-date'), 'not-a-date');
});

test('file sizes use Intl unit formatting', () => {
  assert.match(formatBytes('en', 512), /512/);
  assert.match(formatBytes('en', 20 * 1024), /20/);
  assert.match(formatBytes('en', 3 * 1024 * 1024 + 200_000), /3\.2/);
  assert.match(formatBytes('th', 3 * 1024 * 1024), /3/);
});

test('an envelope is presented as keys: stale_version carries guidance and the refresh path; invalid_input its fields', () => {
  const stale = presentError({
    messageKey: 'error.stale_version',
    correlationId: 'c-1',
    fields: [],
    stale: {
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: { versionId: 'd', versionNumber: 1, revision: 3, state: 'draft', ready: false },
      refreshPath: '/cases/x',
    },
  });
  assert.equal(stale.guidanceKey, 'error.stale_version.guidance.revision_changed');
  assert.equal(stale.refreshPath, '/cases/x');
  assert.equal(stale.correlationId, 'c-1');
  const invalid = presentError({
    messageKey: 'error.invalid_input',
    correlationId: null,
    fields: [{ path: 'body.slots[4].reason', messageKey: 'validation.reason_required' }],
    stale: undefined,
  });
  assert.equal(invalid.guidanceKey, null);
  assert.equal(invalid.fields.length, 1);
  assert.equal(slotOfFieldPath(invalid.fields[0]!.path), 4);
  assert.equal(slotOfFieldPath('body.checklistTemplateVersion'), null);
  assert.equal(slotOfFieldPath('slots[0].reason'), null);
});

test('paths encode their identifiers', () => {
  assert.equal(versionPath('c 1', 'v/2'), '/cases/c%201/versions/v%2F2');
  assert.equal(signInPath('/cases/c1'), '/sign-in?returnTo=%2Fcases%2Fc1');
});
