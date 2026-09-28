// W4-06a (W4b plan section 3.1): a claim is cited by the sha256 of its NFC-normalised UTF-8 text, never by the text,
// and its claim key is the first 16 hex characters of that hash (decision 30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLAIM_KEY_PATTERN } from '@rai/shared/qc/types';
import { claimKeyOf, excerptHashOf } from './excerpt.js';

test('excerptHashOf hashes the NFC form, so composed and decomposed text cite the same claim', () => {
  const composed = 'café: yes';
  const decomposed = 'café: yes';
  assert.equal(excerptHashOf(composed), excerptHashOf(decomposed));
  assert.equal(
    excerptHashOf(composed),
    createHash('sha256').update(Buffer.from(composed, 'utf8')).digest('hex'),
  );
  assert.match(excerptHashOf('คำตอบ: ใช่'), /^[0-9a-f]{64}$/);
  assert.notEqual(excerptHashOf('answer: yes'), excerptHashOf('answer: no'));
});

test('claimKeyOf is the first 16 hex characters of the excerpt hash and fits the claim-key pattern', () => {
  const hash = excerptHashOf('answer: yes; metric: accuracy');
  assert.equal(claimKeyOf(hash), hash.slice(0, 16));
  assert.match(claimKeyOf(hash), new RegExp(CLAIM_KEY_PATTERN));
});
