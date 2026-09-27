// W4-16 (W4b plan section 9, decision 21): the served evidence locator carries no document text. `evidenceView` serves
// a `section` by its ordinal and a `cell` by its sheet ordinal and A1 reference; a row stored before W4-16 with a
// `heading` or a `sheet` name is served as its kind only, and a malformed ordinal or reference is never served.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { FindingEvidenceSchema } from '@rai/shared/schemas/review';
import { evidenceView } from './repository.js';

const HASH = 'e'.repeat(64);
const stored = (locator: unknown) => [
  { artifact_id: 'a-1', content_hash: HASH, slot: 1, locator, excerpt_hash: HASH },
];
const served = (locator: unknown) => evidenceView(stored(locator))[0]?.locator;

test('ordinal locators are served with their ordinals and nothing else', () => {
  assert.deepEqual(served({ kind: 'section', index: 12 }), { kind: 'section', index: 12 });
  assert.deepEqual(served({ kind: 'cell', sheetIndex: 2, cell: 'B7' }), {
    kind: 'cell',
    sheetIndex: 2,
    cell: 'B7',
  });
  assert.deepEqual(served({ kind: 'cell', sheetIndex: 2 }), { kind: 'cell', sheetIndex: 2 });
  assert.deepEqual(served({ kind: 'cell', cell: 'AA10' }), { kind: 'cell', cell: 'AA10' });
  assert.deepEqual(served({ kind: 'section' }), { kind: 'section' });
  assert.deepEqual(served({ kind: 'cell' }), { kind: 'cell' });
  assert.deepEqual(served({ kind: 'page', page: 3 }), { kind: 'page', page: 3 });
});

test('a legacy row with a heading or a sheet name is served as its kind only', () => {
  assert.deepEqual(served({ kind: 'section', heading: '4. Hallucination and accuracy' }), {
    kind: 'section',
  });
  assert.deepEqual(served({ kind: 'cell', sheet: 'Checklist', cell: 'B7' }), { kind: 'cell' });
  // Even with an ordinal beside it: a row that holds document text serves no field from it.
  assert.deepEqual(served({ kind: 'section', index: 4, heading: 'secret' }), { kind: 'section' });
  assert.deepEqual(served({ kind: 'cell', sheetIndex: 1, sheet: 'Checklist', cell: 'B7' }), { kind: 'cell' });
  const body = JSON.stringify(
    evidenceView([
      ...stored({ kind: 'section', heading: '4. Hallucination and accuracy' }),
      ...stored({ kind: 'cell', sheet: 'Checklist', cell: 'B7' }),
    ]),
  );
  assert.ok(!body.includes('Hallucination') && !body.includes('Checklist'), body);
});

test('a malformed ordinal or a cell outside the A1 pattern is dropped, never served', () => {
  assert.deepEqual(served({ kind: 'section', index: 0 }), { kind: 'section' });
  assert.deepEqual(served({ kind: 'section', index: 1.5 }), { kind: 'section' });
  assert.deepEqual(served({ kind: 'section', index: '4' }), { kind: 'section' });
  assert.deepEqual(served({ kind: 'cell', sheetIndex: -1, cell: 'total revenue' }), { kind: 'cell' });
  assert.deepEqual(served({ kind: 'cell', sheetIndex: 1, cell: 'Checklist!B7' }), {
    kind: 'cell',
    sheetIndex: 1,
  });
});

test('every served locator conforms to the read schema, which has no heading or sheet field', () => {
  for (const locator of [
    { kind: 'section', index: 3 },
    { kind: 'section', heading: 'h' },
    { kind: 'cell', sheetIndex: 2, cell: 'B7' },
    { kind: 'cell', sheet: 's', cell: 'B7' },
  ]) {
    const [entry] = evidenceView(stored(locator));
    assert.ok(entry !== undefined);
    assert.ok(Value.Check(FindingEvidenceSchema, entry), JSON.stringify(entry));
    assert.ok(!('heading' in entry.locator) && !('sheet' in entry.locator), JSON.stringify(entry));
  }
});
