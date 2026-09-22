import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPattern, NEXT_ACTION } from './repository.js';

test('literal search escaping, Unicode NFC and whitespace', () => {
  assert.equal(searchPattern('  '), undefined);
  assert.equal(searchPattern(' cafe\u0301 '), '%café%');
  assert.equal(searchPattern('ชื่อทดสอบ'), '%ชื่อทดสอบ%');
  assert.equal(searchPattern('50%_\\!'), '%50!%!_!\\!!%');
});

test('every derived status has its contracted case-level cue', () => {
  assert.deepEqual(NEXT_ACTION, {
    draft: 'prepare_pack',
    sent_back: 'correct_pack',
    in_review: 'review_lanes',
    awaiting_disposition: 'resolve_findings',
    ready_for_launch: 'review_complete',
  });
});
