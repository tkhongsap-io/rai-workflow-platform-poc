// W0-06 section 10, row "Lane mapping exact values and version string" (W1-00, A04): frozen on D02.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_TIMEZONE,
  CURRENT_LANE_MAPPING,
  LANE_MAPPINGS_BY_VERSION,
  LANE_MAPPING_V1,
  LANES,
  SLOTS,
  lanesForSlot,
  PACK_OWNING_LANE,
  owningLaneRule,
  unavailableOwningLane,
  slotsForLane,
} from './constants.js';

test('LANE_MAPPING_V1 equals the D02 sets and version string', () => {
  assert.equal(LANE_MAPPING_V1.version, 'lane-mapping/v1');
  assert.equal(LANE_MAPPING_V1.decision, 'D02');
  assert.deepEqual([...LANE_MAPPING_V1.slotsByLane.ai_coe], [1, 5]);
  assert.deepEqual([...LANE_MAPPING_V1.slotsByLane.dpo], [2, 3, 4, 5]);
  assert.deepEqual([...LANE_MAPPING_V1.slotsByLane.it_security], [5, 6, 7, 8]);
  assert.deepEqual([...LANE_MAPPING_V1.noLaneGate], [9]);
  assert.equal(CURRENT_LANE_MAPPING, LANE_MAPPING_V1);
  assert.equal(LANE_MAPPINGS_BY_VERSION['lane-mapping/v1'], LANE_MAPPING_V1);
  assert.ok(Object.isFrozen(LANE_MAPPING_V1) && Object.isFrozen(LANE_MAPPING_V1.slotsByLane));
});

test('lanesForSlot(5) returns all three lanes; lanesForSlot(9) returns []', () => {
  assert.deepEqual(lanesForSlot(5), ['ai_coe', 'dpo', 'it_security']);
  assert.deepEqual(lanesForSlot(9), []);
  assert.deepEqual(lanesForSlot(1), ['ai_coe']);
  assert.deepEqual(lanesForSlot(3), ['dpo']);
  assert.deepEqual(lanesForSlot(7), ['it_security']);
  assert.deepEqual(slotsForLane('dpo'), [2, 3, 4, 5]);
});

test('timezone, lanes and slots are the D06 and source-spec constants', () => {
  assert.equal(APP_TIMEZONE, 'Asia/Bangkok');
  assert.deepEqual([...LANES], ['ai_coe', 'dpo', 'it_security']);
  assert.deepEqual([...SLOTS], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('owningLaneRule: single-lane slots map (7.1); slot 5 is the raising lane, slot 9 no defects, pack AI/COE (7.3, 2026-09-25)', () => {
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 1 }, LANE_MAPPING_V1), { kind: 'lane', lane: 'ai_coe' });
  for (const slot of [2, 3, 4] as const)
    assert.deepEqual(owningLaneRule({ kind: 'slot', slot }, LANE_MAPPING_V1), { kind: 'lane', lane: 'dpo' });
  for (const slot of [6, 7, 8] as const)
    assert.deepEqual(owningLaneRule({ kind: 'artifact', slot }, LANE_MAPPING_V1), {
      kind: 'lane',
      lane: 'it_security',
    });
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 5 }, LANE_MAPPING_V1), {
    kind: 'raising_lane',
    lanes: ['ai_coe', 'dpo', 'it_security'],
  });
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 9 }, LANE_MAPPING_V1), { kind: 'no_defects' });
  assert.deepEqual(owningLaneRule({ kind: 'pack' }, LANE_MAPPING_V1), { kind: 'lane', lane: PACK_OWNING_LANE });
  assert.equal(PACK_OWNING_LANE, 'ai_coe');
});

test('unavailableOwningLane follows the run (7.3 part 4): approve attempt → its lane; submit → pack owner; upload → the slot lane', () => {
  assert.equal(unavailableOwningLane({ trigger: 'approve_attempt', lane: 'dpo' }, LANE_MAPPING_V1), 'dpo');
  assert.equal(unavailableOwningLane({ trigger: 'submit', lane: null }, LANE_MAPPING_V1), 'ai_coe');
  assert.equal(unavailableOwningLane({ trigger: 'upload', slot: 7 }, LANE_MAPPING_V1), 'it_security');
  // Upload on slot 5 or 9 is defined with upload QC (W4); until then it is a thrown error, never a guess.
  assert.throws(() => unavailableOwningLane({ trigger: 'upload', slot: 5 }, LANE_MAPPING_V1), /upload QC/);
  assert.throws(() => unavailableOwningLane({ trigger: 'upload', slot: 9 }, LANE_MAPPING_V1), /upload QC/);
});
