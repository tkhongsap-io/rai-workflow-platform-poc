// W5-05 (W5 plan sections 2 and 4): the pure half of the proposal at submit. `proposalOutcome` turns the frozen rubric
// revision, the frozen answer values and the frozen slot states into the `risk_proposal` columns: `proposed`, or
// `unavailable` with `not_configured`, `rubric_invalid` or `engine_error` (never an exception, never a Low).
// `riskAuditRef` is the `risk.proposed` target ref: ids, enums and numbers only. The rubric is the seeded SYNTHETIC
// PLACEHOLDER (D07 open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_VERSION } from '@rai/shared/risk/types';
import { validateAuditRef } from '../audit/store.js';
import { CONFIGURATION_SEED } from '../configuration/seed.js';
import { answerValuesOf, proposalOutcome, riskAuditRef, slotStatesOf, tierForCase } from './propose.js';

const RUBRIC = { id: '0192b6f4-3a2e-7c1d-8f00-1234567890ab', body: CONFIGURATION_SEED.risk_rubric };
const ATTACHED = { 1: 'attached' } as const;
const ALL_LOW = {
  RQ1: 'few',
  RQ2: 'advisory',
  RQ3: 'no',
  RQ4: 'internal',
  RQ5: 'in_house',
  RQ6: 'easy',
  RQ7: 'continuous',
};

test('not_configured: no rubric frozen → unavailable, no rubric id, no hash, no explanation', () => {
  const out = proposalOutcome(undefined, {}, ATTACHED);
  assert.deepEqual(out, {
    status: 'unavailable',
    unavailableReason: 'not_configured',
    tier: null,
    lowestTier: null,
    highestTier: null,
    rubricRevisionId: null,
    rubricLabel: null,
    engineVersion: ENGINE_VERSION,
    inputsHash: null,
    explanation: null,
    unknownCount: null,
  });
  assert.equal(tierForCase(out), null);
});

test('rubric_invalid: a body failing the schema or the extra checks keeps the revision id, never scores', () => {
  const wrongProvenance = proposalOutcome(
    { id: RUBRIC.id, body: { ...RUBRIC.body, provenance: 'd07_recorded' } },
    ALL_LOW,
    ATTACHED,
  );
  assert.equal(wrongProvenance.status, 'unavailable');
  assert.equal(wrongProvenance.unavailableReason, 'rubric_invalid');
  assert.equal(wrongProvenance.rubricRevisionId, RUBRIC.id);
  assert.equal(wrongProvenance.tier, null);
  const duplicate = RUBRIC.body.questions.map((q, i) => (i === 1 ? { ...q, questionId: 'RQ1' } : q));
  const dup = proposalOutcome(
    { id: RUBRIC.id, body: { ...RUBRIC.body, questions: duplicate } },
    {},
    ATTACHED,
  );
  assert.equal(dup.unavailableReason, 'rubric_invalid');
  assert.equal(
    proposalOutcome({ id: RUBRIC.id, body: null }, {}, ATTACHED).unavailableReason,
    'rubric_invalid',
  );
});

test('engine_error: a throwing engine yields unavailable with the rubric kept and the error returned, never thrown', () => {
  const failure = new Error('boom');
  const out = proposalOutcome(RUBRIC, ALL_LOW, ATTACHED, () => {
    throw failure;
  });
  assert.equal(out.status, 'unavailable');
  assert.equal(out.unavailableReason, 'engine_error');
  assert.equal(out.rubricRevisionId, RUBRIC.id);
  assert.equal(out.rubricLabel, 'synthetic-placeholder.1');
  assert.equal(out.engineError, failure);
  assert.equal(tierForCase(out), null);
});

test('proposed: all low with slot 1 attached is Low; the explanation holds ids and enums only', () => {
  const out = proposalOutcome(RUBRIC, ALL_LOW, ATTACHED);
  assert.equal(out.status, 'proposed');
  assert.equal(out.tier, 'low');
  assert.equal(out.lowestTier, 'low');
  assert.equal(out.highestTier, 'low');
  assert.equal(out.unknownCount, 0);
  assert.match(out.inputsHash!, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(out.explanation!).sort(), [
    'counts',
    'escalation',
    'matchedRule',
    'questions',
    'unknownCount',
  ]);
  assert.equal(out.explanation!.matchedRule, 'default');
  assert.doesNotMatch(JSON.stringify(out), /SYNTHETIC PLACEHOLDER|answeredBy/);
  assert.equal(tierForCase(out), 'low');
});

test('proposed: missing evidence is Unknown, never Low', () => {
  const out = proposalOutcome(RUBRIC, ALL_LOW, { 1: 'missing' });
  assert.equal(out.tier, 'unknown');
  assert.equal(out.lowestTier, 'low');
  assert.equal(out.highestTier, 'high');
  assert.equal(out.unknownCount, 7);
  assert.equal(tierForCase(out), 'unknown');
});

test('answerValuesOf drops attribution; slotStatesOf maps slot rows to states', () => {
  assert.deepEqual(
    answerValuesOf({
      RQ1: {
        value: 'few',
        answeredBy: 'subject-1',
        answeredRole: 'owner',
        answeredAt: '2026-09-28T00:00:00Z',
      },
      RQ2: {
        value: 'unknown',
        answeredBy: 'subject-1',
        answeredRole: 'owner',
        answeredAt: '2026-09-28T00:00:00Z',
      },
      bad: 'not an answer',
    }),
    { RQ1: 'few', RQ2: 'unknown' },
  );
  assert.deepEqual(
    slotStatesOf([
      { slot: 1, state: 'attached', reason: null, artifactId: 'a' },
      { slot: 2, state: 'missing', reason: null, artifactId: null },
    ]),
    { 1: 'attached', 2: 'missing' },
  );
});

test('riskAuditRef passes the audit ref rules; a label that is not a ref string is recorded as null', () => {
  const out = proposalOutcome(RUBRIC, ALL_LOW, ATTACHED);
  const ref = riskAuditRef('0192b6f4-3a2e-7c1d-8f00-1234567890ac', out);
  assert.doesNotThrow(() => validateAuditRef(ref, 'targetRef'));
  assert.deepEqual(ref, {
    proposal_id: '0192b6f4-3a2e-7c1d-8f00-1234567890ac',
    status: 'proposed',
    unavailable_reason: null,
    tier: 'low',
    lowest_tier: 'low',
    highest_tier: 'low',
    unknown_count: 0,
    rubric_revision_id: RUBRIC.id,
    rubric_label: 'synthetic-placeholder.1',
    engine_version: ENGINE_VERSION,
    inputs_hash: out.inputsHash,
  });
  const spaced = proposalOutcome(
    { id: RUBRIC.id, body: { ...RUBRIC.body, label: 'a label with spaces' } },
    ALL_LOW,
    ATTACHED,
  );
  assert.equal(spaced.rubricLabel, 'a label with spaces');
  const spacedRef = riskAuditRef('0192b6f4-3a2e-7c1d-8f00-1234567890ad', spaced);
  assert.equal(spacedRef.rubric_label, null);
  assert.doesNotThrow(() => validateAuditRef(spacedRef, 'targetRef'));
});
