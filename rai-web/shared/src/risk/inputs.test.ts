// W5-01 (W5 plan section 3): the canonical scoring inputs and their SHA-256, so a proposal's reproduction can be
// checked. The digest is computed by the engine's own pure SHA-256 (no node:crypto, no Web Crypto, so the browser
// preview and the server hash alike); node:crypto appears here only as the test's independent reference.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalInputs, inputsHash, sha256Hex } from './inputs.js';
import { EVIDENCE_ATTACHED, testRubric } from './test-rubric.test-helper.js';

const reference = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

test('sha256Hex matches the FIPS 180-4 vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('sha256Hex agrees with node:crypto across block boundaries and non-ASCII text', () => {
  const samples = ['a', 'ความเสี่ยง', '😀 risk', '\u0000', 'é'.repeat(40)];
  for (let n = 50; n <= 130; n += 1) samples.push('x'.repeat(n));
  for (const s of samples) assert.equal(sha256Hex(s), reference(s), JSON.stringify(s).slice(0, 20));
});

test('canonicalInputs: question IDs ascending with value, evidence slot and slot state; nothing else', () => {
  const rubric = testRubric();
  rubric.questions.reverse(); // display order must not matter
  delete rubric.questions[0]!.evidenceSlot; // RQ7 has no evidence slot
  const text = canonicalInputs(
    rubric,
    { RQ2: 'high', RQ1: 'unknown', RQ9: 'high' },
    { 1: 'attached', 4: 'missing' },
  );
  assert.equal(
    text,
    JSON.stringify({
      questions: [
        ['RQ1', 'unknown', 1, 'attached'],
        ['RQ2', 'high', 1, 'attached'],
        ['RQ3', null, 1, 'attached'],
        ['RQ4', null, 1, 'attached'],
        ['RQ5', null, 1, 'attached'],
        ['RQ6', null, 1, 'attached'],
        ['RQ7', null, null, null],
      ],
    }),
  );
});

test('inputsHash is the SHA-256 of canonicalInputs, stable under key order', () => {
  const rubric = testRubric();
  const a = inputsHash(rubric, { RQ1: 'high', RQ3: 'yes' }, { 1: 'attached', 2: 'not_yet' });
  const b = inputsHash(rubric, { RQ3: 'yes', RQ1: 'high' }, { 2: 'not_yet', 1: 'attached' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, reference(canonicalInputs(rubric, { RQ1: 'high', RQ3: 'yes' }, EVIDENCE_ATTACHED)));
});

test('inputsHash changes with any answer value, evidence slot or evidence state, and ignores unrelated slots', () => {
  const rubric = testRubric();
  const base = inputsHash(rubric, { RQ1: 'high' }, EVIDENCE_ATTACHED);
  assert.notEqual(inputsHash(rubric, { RQ1: 'medium' }, EVIDENCE_ATTACHED), base);
  assert.notEqual(inputsHash(rubric, { RQ1: 'unknown' }, EVIDENCE_ATTACHED), base);
  assert.notEqual(inputsHash(rubric, {}, EVIDENCE_ATTACHED), base);
  assert.notEqual(inputsHash(rubric, { RQ1: 'high' }, { 1: 'not_yet' }), base);
  const moved = testRubric();
  moved.questions[0]!.evidenceSlot = 2;
  assert.notEqual(inputsHash(moved, { RQ1: 'high' }, { 1: 'attached', 2: 'attached' }), base);
  assert.equal(
    inputsHash(rubric, { RQ1: 'high' }, { 1: 'attached', 5: 'missing' }),
    base,
    'slot 5 is cited by no question',
  );
  assert.equal(inputsHash(rubric, { RQ1: 'high', RQ9: 'x' }, EVIDENCE_ATTACHED), base, 'no such question');
});

test('attribution and text never enter the hash: only option values are inputs', () => {
  const rubric = testRubric();
  const relabelled = testRubric();
  relabelled.questions[0]!.text = { th: 'อื่น', en: 'Other wording' };
  relabelled.label = 'another-label';
  assert.equal(
    inputsHash(relabelled, { RQ1: 'high' }, EVIDENCE_ATTACHED),
    inputsHash(rubric, { RQ1: 'high' }, EVIDENCE_ATTACHED),
  );
});
