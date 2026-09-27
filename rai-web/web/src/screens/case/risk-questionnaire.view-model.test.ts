// W5-07 (W5 plan section 7): the questionnaire's view model. The rubric read is optional to the screen (R-16): a 404
// is "not configured", any other failure "unavailable", and neither is an error banner. The preview runs the shared
// engine over the saved answers merged with the pending ones and the editor's current slot states.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { testRubric } from '@rai/shared/risk/test-rubric.test-helper';
import type { RiskRubricView } from '@rai/shared/schemas/cases';
import type { PackDraft, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { ApiError } from '../../api/client.js';
import {
  RISK_TIER_KEY,
  applyRiskAnswerChange,
  councilNoticeOf,
  effectiveRiskAnswers,
  previewRiskScore,
  riskAnswerChoices,
  riskPendingCount,
  riskQuestionOfFieldPath,
  riskTierLabel,
  rubricStateFromError,
  rubricStateFromValue,
} from './risk-questionnaire.view-model.js';

const BODY = testRubric(); // agent-team synthetic (W5-01 test support), not the seed and not D07
const VIEW: RiskRubricView = {
  revisionId: '00000000-0000-4000-8000-000000000001',
  label: BODY.label,
  provenance: BODY.provenance,
  publishedAt: '2026-09-27T00:00:00.000Z',
  body: BODY,
};

const ATTRIBUTION = {
  answeredBy: 'fixture:fx-user-owner-cm',
  answeredRole: 'owner' as const,
  answeredAt: '2026-09-27T03:00:00.000Z',
};
const SAVED: PackDraft['riskAnswers'] = {
  RQ1: { value: 'public', ...ATTRIBUTION },
  RQ2: { value: 'unknown', ...ATTRIBUTION },
};

function slotsWith(slot1: SlotState): Record<SlotNumber, SlotState> {
  const notYet: SlotState = { state: 'not_yet' };
  return { 1: slot1, 2: notYet, 3: notYet, 4: notYet, 5: notYet, 6: notYet, 7: notYet, 8: notYet, 9: notYet };
}
const ATTACHED = slotsWith({ state: 'attached', artifactId: 'a-1' });

test('the rubric read: a view is ready, a null (404) is "not configured", never an error', () => {
  assert.deepEqual(rubricStateFromValue(VIEW), { kind: 'ready', rubric: VIEW });
  assert.deepEqual(rubricStateFromValue(null), { kind: 'not_configured' });
});

test('the rubric read: a 404 ApiError is "not configured"; any other failure is "unavailable"', () => {
  const notFound = new ApiError(404, 'not_found', 'error.not_found', 'c', undefined);
  assert.deepEqual(rubricStateFromError(notFound), { kind: 'not_configured' });
  const internal = new ApiError(500, 'internal_error', 'error.internal_error', 'c', undefined);
  assert.deepEqual(rubricStateFromError(internal), { kind: 'unavailable' });
  assert.deepEqual(rubricStateFromError(new Error('network')), { kind: 'unavailable' });
});

test('a change equal to the saved value is not pending; a different value or a clear is', () => {
  let pending = applyRiskAnswerChange(SAVED, {}, 'RQ3', 'yes');
  assert.deepEqual(pending, { RQ3: 'yes' });
  pending = applyRiskAnswerChange(SAVED, pending, 'RQ1', 'few');
  assert.deepEqual(pending, { RQ3: 'yes', RQ1: 'few' });
  pending = applyRiskAnswerChange(SAVED, pending, 'RQ1', 'public'); // back to the saved value
  assert.deepEqual(pending, { RQ3: 'yes' });
  pending = applyRiskAnswerChange(SAVED, pending, 'RQ2', null); // clear a saved answer
  assert.deepEqual(pending, { RQ3: 'yes', RQ2: null });
  pending = applyRiskAnswerChange(SAVED, pending, 'RQ3', null); // clear an unsaved one: nothing to send
  assert.deepEqual(pending, { RQ2: null });
  assert.equal(riskPendingCount(pending), 1);
  assert.equal(riskPendingCount(undefined), 0);
});

test('effective answers merge the saved values with the pending ones; null removes', () => {
  assert.deepEqual(effectiveRiskAnswers(SAVED, undefined), { RQ1: 'public', RQ2: 'unknown' });
  assert.deepEqual(effectiveRiskAnswers(SAVED, { RQ1: 'few', RQ2: null, RQ3: 'no' }), {
    RQ1: 'few',
    RQ3: 'no',
  });
  assert.deepEqual(SAVED.RQ1?.value, 'public', 'the saved answers are not mutated');
});

test('the preview scores with the shared engine: no answers is Unknown over the whole range', () => {
  const score = previewRiskScore(BODY, {}, ATTACHED);
  assert.equal(score.tier, 'unknown');
  assert.deepEqual(score.bounds, { lowest: 'low', highest: 'high' });
  assert.equal(score.unknownCount, 7);
});

test('the preview: three high answers with slot 1 attached settle High even with four questions open', () => {
  const answers = { RQ1: 'high', RQ2: 'high', RQ4: 'high' };
  const score = previewRiskScore(BODY, answers, ATTACHED);
  assert.equal(score.tier, 'high');
  assert.equal(score.unknownCount, 4);
  assert.equal(councilNoticeOf(score), 'required');
});

test('the preview reads the current slot states: slot 1 not attached makes every answer Unknown, never Low', () => {
  const answers = Object.fromEntries(BODY.questions.map((q) => [q.questionId, q.options[0]!.value]));
  assert.equal(previewRiskScore(BODY, answers, ATTACHED).tier, 'low');
  const missing = previewRiskScore(BODY, answers, slotsWith({ state: 'missing' }));
  assert.equal(missing.tier, 'unknown');
  assert.equal(
    missing.questions.every((q) => q.unknownReason === 'evidence_not_attached'),
    true,
  );
  assert.equal(councilNoticeOf(missing), 'possible');
});

test('the Council notice: required for High, possible when Unknown could be High, none otherwise', () => {
  const low = previewRiskScore(
    BODY,
    Object.fromEntries(BODY.questions.map((q) => [q.questionId, q.options[0]!.value])),
    ATTACHED,
  );
  assert.equal(councilNoticeOf(low), null);
  const medium = previewRiskScore(BODY, { RQ1: 'high' }, ATTACHED);
  assert.equal(medium.tier, 'unknown');
  assert.equal(councilNoticeOf(medium), 'possible');
});

test('tier labels come from the rubric in the screen locale; the risk.tier keys are the fallback', () => {
  assert.equal(
    riskTierLabel(BODY, 'high', 'en', (key) => key),
    'High',
  );
  assert.equal(
    riskTierLabel(BODY, 'unknown', 'th', (key) => key),
    'ไม่ทราบ',
  );
  assert.equal(
    riskTierLabel(undefined, 'medium', 'en', (key) => key),
    'risk.tier.medium',
  );
  for (const key of Object.values(RISK_TIER_KEY)) assert.equal(isLocaleKey(key), true, key);
});

test('each question offers its options in rubric order, then Unknown', () => {
  const choices = riskAnswerChoices(BODY.questions[0]!);
  assert.deepEqual(
    choices.map((c) => c.value),
    ['low', 'medium', 'high', 'unknown'],
  );
  assert.equal(choices[3]!.label, null, 'Unknown is labelled from the locale, not the rubric');
});

test('a field error path names its question; other paths name none', () => {
  assert.equal(riskQuestionOfFieldPath('body.riskAnswers.RQ3'), 'RQ3');
  assert.equal(riskQuestionOfFieldPath('body.riskAnswers'), null);
  assert.equal(riskQuestionOfFieldPath('body.slots[1].reason'), null);
});
