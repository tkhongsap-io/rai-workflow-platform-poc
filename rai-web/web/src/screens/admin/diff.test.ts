// W6-05 (W6 plan sections 9 and 13): the structured two-revision diff is a pure function of two bodies, by JSON
// path; the screen renders exactly what it returns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAgainst, diffBodies, formatDiffValue, pointerSegment } from './diff.js';

test('equal bodies have no differences', () => {
  assert.deepEqual(diffBodies({ dpo: 3, ai_coe: 5 }, { ai_coe: 5, dpo: 3 }), []);
  assert.deepEqual(diffBodies({ list: [1, { a: 'x' }] }, { list: [1, { a: 'x' }] }), []);
  assert.deepEqual(diffBodies({}, {}), []);
});

test('changed, added and removed leaves are reported by JSON pointer in sorted key order', () => {
  assert.deepEqual(
    diffBodies({ dpo: 3, it_security: 5, old: true }, { dpo: 4, it_security: 5, added: 'x' }),
    [
      { path: '/added', change: 'added', after: 'x' },
      { path: '/dpo', change: 'changed', before: 3, after: 4 },
      { path: '/old', change: 'removed', before: true },
    ],
  );
});

test('nested objects and arrays recurse; arrays compare by index', () => {
  assert.deepEqual(
    diffBodies(
      { holidays: ['2026-01-01', '2026-04-13'], nested: { a: { b: 1 } } },
      { holidays: ['2026-01-01', '2026-04-14', '2026-12-31'], nested: { a: { b: 2 } } },
    ),
    [
      { path: '/holidays/1', change: 'changed', before: '2026-04-13', after: '2026-04-14' },
      { path: '/holidays/2', change: 'added', after: '2026-12-31' },
      { path: '/nested/a/b', change: 'changed', before: 1, after: 2 },
    ],
  );
  assert.deepEqual(diffBodies({ list: ['a', 'b'] }, { list: ['a'] }), [
    { path: '/list/1', change: 'removed', before: 'b' },
  ]);
});

test('a change of type is one change at that path, never a walk into both sides', () => {
  assert.deepEqual(diffBodies({ v: { a: 1 } }, { v: [1] }), [
    { path: '/v', change: 'changed', before: { a: 1 }, after: [1] },
  ]);
  assert.deepEqual(diffBodies({ v: null }, { v: {} }), [
    { path: '/v', change: 'changed', before: null, after: {} },
  ]);
  assert.deepEqual(diffBodies({ v: '1' }, { v: 1 }), [
    { path: '/v', change: 'changed', before: '1', after: 1 },
  ]);
  // An added or removed container is one entry holding the whole value.
  assert.deepEqual(diffBodies({}, { t: { x: [1] } }), [{ path: '/t', change: 'added', after: { x: [1] } }]);
});

test('pointer segments escape ~ and / (RFC 6901)', () => {
  assert.equal(pointerSegment('a/b~c'), 'a~1b~0c');
  assert.deepEqual(diffBodies({ 'v1.0 Sheet3': 1, 'a/b': 1 }, { 'v1.0 Sheet3': 2, 'a/b': 2 }), [
    { path: '/a~1b', change: 'changed', before: 1, after: 2 },
    { path: '/v1.0 Sheet3', change: 'changed', before: 1, after: 2 },
  ]);
});

test('diff values render as JSON text; an absent side renders as an empty string', () => {
  assert.equal(formatDiffValue('x'), '"x"');
  assert.equal(formatDiffValue(3), '3');
  assert.equal(formatDiffValue({ a: [1] }), '{"a":[1]}');
  assert.equal(formatDiffValue(null), 'null');
  assert.equal(formatDiffValue(undefined), '');
});

test('the default comparison is the revision in force, else the previous revision, else none', () => {
  const items = [
    { revisionId: 'r3', revisionNumber: 3, inForce: true },
    { revisionId: 'r2', revisionNumber: 2, inForce: false },
    { revisionId: 'r1', revisionNumber: 1, inForce: false },
  ];
  assert.equal(defaultAgainst(items, 'r1'), 'r3');
  assert.equal(defaultAgainst(items, 'r3'), 'r2');
  assert.equal(defaultAgainst([items[2]!], 'r1'), undefined);
  // The order of the list does not matter.
  assert.equal(defaultAgainst([...items].reverse(), 'r3'), 'r2');
});
