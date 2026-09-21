import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalManifest, manifestHash, type ManifestSlot } from './manifest.js';

const attached: ManifestSlot = {
  slot: 1,
  state: 'attached',
  reason: null,
  artifact: { sha256: 'a'.repeat(64), filename: 'brd.pdf', mediaType: 'application/pdf', sizeBytes: 1234 },
};
const na: ManifestSlot = {
  slot: 3,
  state: 'not_applicable',
  reason: 'slot.na.reason.non_vendor_default',
  artifact: null,
};
const missing: ManifestSlot = { slot: 2, state: 'missing', reason: null, artifact: null };

describe('W1-05 manifest hash (W0-04 pack_version.manifest_hash)', () => {
  it('is a lowercase hex SHA-256 and does not depend on the order the rows arrive in', () => {
    const a = manifestHash([attached, na, missing]);
    const b = manifestHash([missing, attached, na]);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, b);
  });

  it('does not depend on key order or extra keys of the input objects', () => {
    const shuffled = {
      artifact: {
        sizeBytes: 1234,
        mediaType: 'application/pdf',
        filename: 'brd.pdf',
        sha256: 'a'.repeat(64),
      },
      reason: null,
      state: 'attached',
      slot: 1,
      extra: 'ignored',
    } as ManifestSlot;
    assert.equal(manifestHash([shuffled, na, missing]), manifestHash([attached, na, missing]));
  });

  it('changes when any covered value changes: state, reason, hash, filename, media type, size', () => {
    const base = manifestHash([attached, na, missing]);
    const variants: ManifestSlot[][] = [
      [{ ...attached, state: 'not_yet', artifact: null }, na, missing],
      [attached, { ...na, reason: 'typed reason' }, missing],
      [{ ...attached, artifact: { ...attached.artifact!, sha256: 'b'.repeat(64) } }, na, missing],
      [{ ...attached, artifact: { ...attached.artifact!, filename: 'brd-v2.pdf' } }, na, missing],
      [{ ...attached, artifact: { ...attached.artifact!, mediaType: 'image/png' } }, na, missing],
      [{ ...attached, artifact: { ...attached.artifact!, sizeBytes: 1235 } }, na, missing],
      [attached, na, { ...missing, slot: 4 }],
    ];
    for (const v of variants) assert.notEqual(manifestHash(v), base);
  });

  it('emits slots ascending with a fixed key order and no whitespace', () => {
    const text = canonicalManifest([na, missing, attached]);
    assert.equal(
      text,
      '{"version":1,"slots":[' +
        '{"slot":1,"state":"attached","reason":null,"artifact":{"sha256":"' +
        'a'.repeat(64) +
        '","filename":"brd.pdf","mediaType":"application/pdf","sizeBytes":1234}},' +
        '{"slot":2,"state":"missing","reason":null,"artifact":null},' +
        '{"slot":3,"state":"not_applicable","reason":"slot.na.reason.non_vendor_default","artifact":null}]}',
    );
  });
});
