// W5-01 (W5 plan sections 2 and 3): what a `risk_rubric` body may contain. Structural limits are the schema's
// (`RiskRubricBodySchema`); the checks a schema cannot express are `riskRubricBodyProblems`'. The body is not yet a
// registered configuration kind (W5-02 registers it); publishing runs both, as it does for `qc_rules`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import {
  CONFIGURATION_BODY_SCHEMAS,
  RiskRubricBodySchema,
  riskRubricBodyProblems,
} from '../schemas/cases.js';
import { testRubric } from './test-rubric.test-helper.js';

/** Every reason a body would be refused on publish: 'schema' when the schema fails, else the problem strings. */
function refusals(body: unknown): string[] {
  if (!Value.Check(RiskRubricBodySchema, body)) return ['schema'];
  return riskRubricBodyProblems(body);
}

test('the synthetic test rubric is a valid body with no problems', () => {
  assert.deepEqual(refusals(testRubric()), []);
});

test('W5-01 defines the schema only: risk_rubric is not yet a registered configuration kind (W5-02)', () => {
  assert.equal(Object.hasOwn(CONFIGURATION_BODY_SCHEMAS, 'risk_rubric'), false);
});

test('provenance other than synthetic_placeholder is refused (R-2: nothing in W5 can call a rubric approved)', () => {
  for (const provenance of ['d07_recorded', 'approved', '', undefined]) {
    const body: Record<string, unknown> = { ...testRubric(), provenance };
    if (provenance === undefined) delete body.provenance;
    assert.deepEqual(refusals(body), ['schema'], String(provenance));
  }
});

test('a question count other than seven is refused', () => {
  const six = testRubric();
  six.questions.pop();
  assert.deepEqual(refusals(six), ['schema']);
  const eight = testRubric();
  eight.questions.push({ ...eight.questions[0]!, questionId: 'RQ8' });
  assert.deepEqual(refusals(eight), ['schema']);
});

test('a question with fewer than two or more than five options is refused; five is accepted', () => {
  const five = testRubric();
  const q = five.questions[0]!;
  q.options.push(
    { value: 'very_high', label: { th: 'ก', en: 'a' }, level: 'high' },
    { value: 'extreme', label: { th: 'ข', en: 'b' }, level: 'high' },
  );
  assert.equal(q.options.length, 5);
  assert.deepEqual(refusals(five), []);
  const six = structuredClone(five);
  six.questions[0]!.options.push({ value: 'beyond', label: { th: 'ค', en: 'c' }, level: 'high' });
  assert.deepEqual(refusals(six), ['schema']);
  const one = testRubric();
  one.questions[0]!.options.splice(1);
  assert.deepEqual(refusals(one), ['schema']);
});

test('the option value unknown is reserved (the UI always offers Unknown itself)', () => {
  const body = testRubric();
  body.questions[1]!.options[0]!.value = 'unknown';
  assert.deepEqual(refusals(body), ['/questions/RQ2/options/unknown the option value unknown is reserved']);
});

test('duplicate question IDs and duplicate option values are refused', () => {
  const dupQuestion = testRubric();
  dupQuestion.questions[6]!.questionId = 'RQ1';
  assert.deepEqual(refusals(dupQuestion), ['/questions/RQ1 is listed twice']);
  const dupOption = testRubric();
  dupOption.questions[2]!.options[1]!.value = 'no';
  assert.deepEqual(refusals(dupOption), ['/questions/RQ3/options/no is listed twice']);
});

test('tierRules must list every high rule before any medium rule', () => {
  const body = testRubric();
  body.tierRules.reverse();
  assert.deepEqual(refusals(body), ['/tierRules/1 a high rule follows a medium rule']);
  const onlyMedium = testRubric();
  onlyMedium.tierRules.splice(0, 1);
  assert.deepEqual(refusals(onlyMedium), []);
});

test('the schema refuses malformed identifiers, levels, slots, counts and unknown keys', () => {
  const cases: Array<[string, (b: ReturnType<typeof testRubric>) => void]> = [
    ['questionId pattern', (b) => (b.questions[0]!.questionId = 'Q1')],
    ['questionId RQ0', (b) => (b.questions[0]!.questionId = 'RQ0')],
    ['option value pattern', (b) => (b.questions[0]!.options[0]!.value = 'Low')],
    ['option value too long', (b) => (b.questions[0]!.options[0]!.value = `a${'b'.repeat(40)}`)],
    ['level', (b) => ((b.questions[0]!.options[0] as { level: string }).level = 'extreme')],
    [
      'escalatesTo low',
      (b) => ((b.questions[0]!.options[0] as { escalatesTo?: string }).escalatesTo = 'low'),
    ],
    ['evidenceSlot 10', (b) => ((b.questions[0] as { evidenceSlot?: number }).evidenceSlot = 10)],
    ['empty text', (b) => (b.questions[0]!.text.en = '')],
    ['missing th', (b) => delete (b.questions[0]!.text as { th?: string }).th],
    ['rule tier low', (b) => ((b.tierRules[0] as { tier: string }).tier = 'low')],
    ['condition level low', (b) => ((b.tierRules[0]!.anyOf[0]!.allOf[0] as { level: string }).level = 'low')],
    ['atLeast 0', (b) => (b.tierRules[0]!.anyOf[0]!.allOf[0]!.atLeast = 0)],
    ['atLeast 8', (b) => (b.tierRules[0]!.anyOf[0]!.allOf[0]!.atLeast = 8)],
    ['empty anyOf', (b) => (b.tierRules[0]!.anyOf = [])],
    ['empty allOf', (b) => (b.tierRules[0]!.anyOf[0]!.allOf = [])],
    ['defaultTier', (b) => ((b as { defaultTier: string }).defaultTier = 'medium')],
    ['missing unknown label', (b) => delete (b.tierLabels as { unknown?: unknown }).unknown],
    ['empty label', (b) => (b.label = '')],
    ['unknown top-level key', (b) => ((b as Record<string, unknown>).approvedBy = 'someone')],
    ['unknown option key', (b) => ((b.questions[0]!.options[0] as Record<string, unknown>).comment = 'x')],
    ['unknown question key', (b) => ((b.questions[0] as Record<string, unknown>).weight = 2)],
  ];
  for (const [name, mutate] of cases) {
    const body = testRubric();
    mutate(body);
    assert.deepEqual(refusals(body), ['schema'], name);
  }
});

test('riskRubricBodyProblems reports every problem, not only the first', () => {
  const body = testRubric();
  body.questions[6]!.questionId = 'RQ1';
  body.questions[0]!.options[2]!.value = 'unknown';
  body.tierRules.reverse();
  assert.equal(refusals(body).length, 3);
});
