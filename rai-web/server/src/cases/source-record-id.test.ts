// A02 unit half (W0-02 8.2): SourceRecordId parsing. Unknown round-trips as the literal; a known value keeps its
// exact text; only the two 7.3 prefixes are accepted; nothing here calls anything (no register client exists).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_RECORD_PREFIX_KEY,
  UNKNOWN_SOURCE_RECORD,
  fromStoredSourceRecordId,
  toStoredSourceRecordId,
  validateSourceRecordId,
} from './source-record-id.js';

test('Unknown is stored as the literal Unknown and read back as { kind: unknown }', () => {
  assert.equal(toStoredSourceRecordId({ kind: 'unknown' }), UNKNOWN_SOURCE_RECORD);
  assert.deepEqual(fromStoredSourceRecordId('Unknown'), { kind: 'unknown' });
});

test('a known TPM-/VRO- value is stored and read back unchanged, byte for byte', () => {
  for (const value of ['TPM-2026-0042', 'VRO-7', 'TPM-ก-1']) {
    assert.equal(validateSourceRecordId({ kind: 'known', value }), undefined);
    assert.equal(toStoredSourceRecordId({ kind: 'known', value }), value);
    assert.deepEqual(fromStoredSourceRecordId(value), { kind: 'known', value });
  }
});

test('a known value without the TPM-/VRO- prefix, a bare prefix, padding or an overlong value is a field error at sourceRecordId.value', () => {
  for (const value of [
    'AIR-FX-2291',
    'tpm-1',
    'TPM-',
    ' TPM-1',
    'TPM-1 ',
    'Unknown',
    `TPM-${'x'.repeat(100)}`,
  ]) {
    assert.deepEqual(validateSourceRecordId({ kind: 'known', value }), {
      path: 'sourceRecordId.value',
      messageKey: SOURCE_RECORD_PREFIX_KEY,
    });
    assert.throws(() => toStoredSourceRecordId({ kind: 'known', value }), RangeError);
  }
});

test('a stored value that happens not to be Unknown is always read back as known (fixture AIR-FX-… rows included)', () => {
  assert.deepEqual(fromStoredSourceRecordId('AIR-FX-2291'), { kind: 'known', value: 'AIR-FX-2291' });
});
