// W6-06 (W6 plan sections 1.2 Q16/Q18, 2.1 and 9): the simple-kind form model is a pure function of a body. A draft
// may be half-finished, so the form reads any body leniently, writes back over the base (keeping unknown keys) and
// never refuses anything itself: the server lists what publishing would refuse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyOf, formOf, isSimpleKind, problemTarget, SIMPLE_KINDS } from './simple-kinds.js';

test('the simple kinds are the five with a form; the others are not', () => {
  assert.deepEqual([...SIMPLE_KINDS].sort(), [
    'calendar',
    'checklist_templates',
    'operator_recipients',
    'sla',
    'use_case_groups',
  ]);
  for (const kind of SIMPLE_KINDS) assert.equal(isSimpleKind(kind), true);
  for (const kind of [
    'qc_rules',
    'risk_rubric',
    'group_role_mapping',
    'desk_controls',
    'lane_mapping',
    'toString',
  ])
    assert.equal(isSimpleKind(kind), false);
});

test('SLA: numbers read as text, a whole number writes back as a number, anything else stays text', () => {
  const form = formOf('sla', { dpo: 3, ai_coe: '7', it_security: null });
  assert.deepEqual(form, { kind: 'sla', values: { dpo: '3', ai_coe: '7', it_security: '' } });
  assert.deepEqual(formOf('sla', undefined), {
    kind: 'sla',
    values: { dpo: '', ai_coe: '', it_security: '' },
  });
  const edited = { kind: 'sla' as const, values: { dpo: ' 4 ', ai_coe: '5', it_security: 'five' } };
  assert.deepEqual(bodyOf(edited, { dpo: 3, ai_coe: 5, it_security: 5, extra: true }), {
    dpo: 4,
    ai_coe: 5,
    it_security: 'five',
    extra: true,
  });
  assert.deepEqual(bodyOf({ kind: 'sla', values: { dpo: '0', ai_coe: '-1', it_security: '' } }, undefined), {
    dpo: 0,
    ai_coe: -1,
    it_security: '',
  });
});

test('lists: string entries read, trimmed and empty rows dropped on write, other keys of the base kept', () => {
  assert.deepEqual(formOf('use_case_groups', { groups: ['a', 3, 'b'] }), {
    kind: 'use_case_groups',
    items: ['a', 'b'],
  });
  assert.deepEqual(formOf('checklist_templates', { versions: 'v1' }), {
    kind: 'checklist_templates',
    items: [],
  });
  assert.deepEqual(formOf('operator_recipients', undefined), { kind: 'operator_recipients', items: [] });
  assert.deepEqual(
    bodyOf({ kind: 'use_case_groups', items: [' a ', '', '  ', 'b'] }, { groups: ['x'], note: 1 }),
    { groups: ['a', 'b'], note: 1 },
  );
  assert.deepEqual(bodyOf({ kind: 'checklist_templates', items: ['v1.0 Sheet3', 'v3.0'] }, undefined), {
    versions: ['v1.0 Sheet3', 'v3.0'],
  });
  assert.deepEqual(bodyOf({ kind: 'operator_recipients', items: ['a@b.example'] }, {}), {
    addresses: ['a@b.example'],
  });
});

test('calendar: holidays read and written as dates, the time zone is always Asia/Bangkok', () => {
  assert.deepEqual(formOf('calendar', { timezone: 'UTC', holidays: ['2026-12-31', 5] }), {
    kind: 'calendar',
    items: ['2026-12-31'],
  });
  assert.deepEqual(
    bodyOf({ kind: 'calendar', items: ['2026-12-31', ''] }, { timezone: 'UTC', holidays: [] }),
    {
      timezone: 'Asia/Bangkok',
      holidays: ['2026-12-31'],
    },
  );
});

test('a round trip of a valid body is the same body', () => {
  const bodies = {
    sla: { dpo: 3, ai_coe: 5, it_security: 5 },
    calendar: { timezone: 'Asia/Bangkok', holidays: ['2026-01-01'] },
    use_case_groups: { groups: ['customer-analytics'] },
    operator_recipients: { addresses: ['operator-digest@rai-desk.example'] },
    checklist_templates: { versions: ['v1.0 Sheet3', 'v2.0'] },
  } as const;
  for (const [kind, body] of Object.entries(bodies)) {
    assert.deepEqual(bodyOf(formOf(kind as keyof typeof bodies, body), body), body, kind);
  }
});

test('a problem pointer names an SLA lane, a list row, or the whole form', () => {
  assert.deepEqual(problemTarget('sla', '/dpo'), { lane: 'dpo' });
  assert.deepEqual(problemTarget('sla', '/it_security'), { lane: 'it_security' });
  assert.deepEqual(problemTarget('sla', '/unknown'), { whole: true });
  assert.deepEqual(problemTarget('use_case_groups', '/groups/2'), { index: 2 });
  assert.deepEqual(problemTarget('operator_recipients', '/addresses/0'), { index: 0 });
  assert.deepEqual(problemTarget('checklist_templates', '/versions/1'), { index: 1 });
  assert.deepEqual(problemTarget('calendar', '/holidays/3'), { index: 3 });
  assert.deepEqual(problemTarget('calendar', '/holidays'), { whole: true });
  assert.deepEqual(problemTarget('use_case_groups', '/'), { whole: true });
  assert.deepEqual(problemTarget('use_case_groups', '/groups/x'), { whole: true });
});
