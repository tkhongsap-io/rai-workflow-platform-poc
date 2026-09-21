// W1-04 pure rules: the four slot facts round-trip through the W0-04 columns; slots 3 and 4 default to N/A with the
// default reason only when vendor_involved is false; the flip rule; a reason-less or blank N/A is reason_required;
// default_non_vendor is accepted only where the server would set it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NON_VENDOR_DEFAULT_REASON_KEY, type SlotState } from '@rai/shared/schemas/pack';
import {
  SLOT_NUMBERS,
  carriesVendorDefault,
  defaultSlotState,
  reasonRequiredErrors,
  slotStateFromColumns,
  slotStateToColumns,
  validateSlotValues,
} from './slots.js';

test('the four states map onto the W0-04 columns and back', () => {
  const states: SlotState[] = [
    { state: 'attached', artifactId: '0199aaaa-0000-7000-8000-000000000001' },
    { state: 'not_yet' },
    { state: 'missing' },
    { state: 'not_applicable', reason: { kind: 'default_non_vendor' } },
    { state: 'not_applicable', reason: { kind: 'text', text: 'ไม่มีข้อมูลส่วนบุคคล (synthetic)' } },
  ];
  for (const state of states) assert.deepEqual(slotStateFromColumns(slotStateToColumns(state)), state);
  assert.deepEqual(slotStateToColumns(states[3]!), {
    state: 'not_applicable',
    reason: NON_VENDOR_DEFAULT_REASON_KEY, // the D12 locale key, so the reason stays visible and translatable
    artifactId: null,
  });
  assert.deepEqual(slotStateToColumns(states[0]!), {
    state: 'attached',
    reason: null,
    artifactId: '0199aaaa-0000-7000-8000-000000000001',
  });
});

test('a row the CHECK constraints would refuse is a programming error, never a silent state', () => {
  assert.throws(() => slotStateFromColumns({ state: 'attached', reason: null, artifactId: null }));
  assert.throws(() => slotStateFromColumns({ state: 'not_applicable', reason: null, artifactId: null }));
});

test('slots 3 and 4 default to N/A with the default reason only when vendor_involved is false; never when true', () => {
  for (const slot of SLOT_NUMBERS) {
    assert.deepEqual(defaultSlotState(slot, true), { state: 'missing' }, `slot ${slot} vendor`);
    assert.deepEqual(
      defaultSlotState(slot, false),
      slot === 3 || slot === 4
        ? { state: 'not_applicable', reason: { kind: 'default_non_vendor' } }
        : { state: 'missing' },
      `slot ${slot} non-vendor`,
    );
  }
});

test('the flip rule reverts only a slot 3/4 that still carries the server default; a typed reason is kept', () => {
  const dflt = { state: 'not_applicable' as const, reason: NON_VENDOR_DEFAULT_REASON_KEY, artifactId: null };
  const typed = { state: 'not_applicable' as const, reason: 'no vendor data (synthetic)', artifactId: null };
  assert.equal(carriesVendorDefault(dflt, 3), true);
  assert.equal(carriesVendorDefault(dflt, 4), true);
  assert.equal(carriesVendorDefault(dflt, 5), false); // never set there by the server
  assert.equal(carriesVendorDefault(typed, 3), false);
  assert.equal(carriesVendorDefault({ state: 'missing', reason: null }, 3), false);
});

test('a missing, null, non-object or blank-text reason on N/A is validation.reason_required at body.slots[n].reason', () => {
  const errors = reasonRequiredErrors({
    expectedVersion: { versionId: 'd', revision: 1 },
    slots: {
      1: { state: 'not_applicable' },
      2: { state: 'not_applicable', reason: null },
      3: { state: 'not_applicable', reason: 'free text at the wrong level' },
      4: { state: 'not_applicable', reason: { kind: 'text', text: '   ' } },
      5: { state: 'not_applicable', reason: { kind: 'text', text: '' } },
      6: { state: 'not_applicable', reason: { kind: 'text', text: 'ok' } },
      7: { state: 'not_applicable', reason: { kind: 'default_non_vendor' } }, // shape-valid; value rule decides
      8: { state: 'missing' },
      9: { state: 'attached', artifactId: 'x' },
    },
  });
  assert.deepEqual(
    errors.map((e) => e.path),
    [
      'body.slots[1].reason',
      'body.slots[2].reason',
      'body.slots[3].reason',
      'body.slots[4].reason',
      'body.slots[5].reason',
    ],
  );
  assert.ok(errors.every((e) => e.messageKey === 'validation.reason_required'));
  assert.deepEqual(reasonRequiredErrors({}), []);
  assert.deepEqual(reasonRequiredErrors({ slots: [] }), []);
  assert.deepEqual(reasonRequiredErrors(null), []);
});

test('default_non_vendor is accepted only on slot 3 or 4 of a non-vendor case; a blank text reason is refused', () => {
  const dflt: SlotState = { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
  assert.deepEqual(validateSlotValues({ 3: dflt, 4: dflt }, false), []);
  assert.deepEqual(
    validateSlotValues({ 3: dflt, 4: dflt }, true).map((e) => e.path),
    ['body.slots[3].reason', 'body.slots[4].reason'],
  );
  assert.deepEqual(
    validateSlotValues({ 5: dflt }, false).map((e) => e.path),
    ['body.slots[5].reason'],
  );
  assert.deepEqual(
    validateSlotValues({ 7: { state: 'not_applicable', reason: { kind: 'text', text: ' \t' } } }, true).map(
      (e) => e.messageKey,
    ),
    ['validation.reason_required'],
  );
  assert.deepEqual(
    validateSlotValues({ 7: { state: 'not_applicable', reason: { kind: 'text', text: 'เหตุผล' } } }, true),
    [],
  );
});
