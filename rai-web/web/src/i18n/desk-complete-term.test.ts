import test from 'node:test';
import assert from 'node:assert/strict';
import th from '@rai/shared/locales/th.json' with { type: 'json' };
import en from '@rai/shared/locales/en.json' with { type: 'json' };

// W3-F5 (register "W3 deferred rulings", status name): desk completion has one Thai term on every surface.
const TERM = 'การตรวจทานในระบบเสร็จสิ้น';
const SURFACES = [
  'status.ready_for_launch', // status badge (case page, My cases, queue)
  'queue.next.review_complete',
  'next_action.ready_for_launch',
  'operator.value.ready_for_launch',
  'review.decided.ready',
  'error.stale_version.guidance.ready',
  'mail.ready_for_launch',
  'mail.ready_for_launch.body',
] as const;

test('every Thai string for desk completion uses the one ruled term', () => {
  const thai = th as Record<string, string>;
  for (const key of SURFACES) assert.ok(thai[key]?.includes(TERM), `${key}: ${thai[key]}`);
  for (const [key, value] of Object.entries(thai)) {
    assert.ok(!value.includes('การตรวจสอบของโต๊ะเสร็จสิ้น'), `${key} keeps the old term`);
    assert.ok(!value.includes('Ready for launch'), `${key} names the state in English`);
  }
});

test('English wording for desk completion is outside the ruling and unchanged', () => {
  const english = en as Record<string, string>;
  assert.equal(english['status.ready_for_launch'], 'Ready for launch');
  assert.equal(english['next_action.ready_for_launch'], 'Desk review complete');
  assert.equal(english['mail.ready_for_launch'], 'Desk review is complete (Ready for launch)');
  assert.equal(english['review.decided.ready'], 'The case is Ready for launch');
});
