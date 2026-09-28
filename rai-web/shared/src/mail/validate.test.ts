// W7-07 (W7 plan section 5.3): the W0-07 section 4.3 delivery validator moved from the fixtures to @rai/shared so the
// server's in-product file drop uses the same checks as the fixture sinks. The full 4.8 rows stay in
// fixtures/src/substitutes/mail-sink/mail-sink.test.ts (through the re-export, pinned by
// fixtures/src/substitutes/mail-sink/file-drop-parity.test.ts); this file pins the shared module on its own.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_BODY_BYTES, MAX_SUBJECT_BYTES, isSyntheticAddress } from './validate.js';

test('W7-07: the W0-07 section 4.3 size limits are unchanged by the move', () => {
  assert.equal(MAX_SUBJECT_BYTES, 998);
  assert.equal(MAX_BODY_BYTES, 65_536);
});

test('W7-07: the synthetic-address rule (W0-07 section 4.6) stays in force', () => {
  assert.equal(isSyntheticAddress('reviewer@rai-desk.example'), true);
  assert.equal(isSyntheticAddress('reviewer@desk.test'), true);
  assert.equal(isSyntheticAddress('reviewer@example.com'), true);
  assert.equal(isSyntheticAddress('reviewer@company.co.th'), false);
  assert.equal(isSyntheticAddress('not-an-address'), false);
});
