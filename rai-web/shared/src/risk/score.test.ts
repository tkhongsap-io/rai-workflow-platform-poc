// W5-01 (W5 plan section 3, R-5 to R-7): the pure scoring engine. Every rubric here is agent-team synthetic; none is
// the W5-02 placeholder seed or the D07 instrument.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RiskRubricBody } from '../schemas/cases.js';
import { ENGINE_VERSION, type RiskAnswerValues, type RiskLevel } from './types.js';
import { scoreRisk, tierOf } from './score.js';
import { EVIDENCE_ATTACHED, QUESTION_IDS, testRubric } from './test-rubric.test-helper.js';

/** Answers for the leading questions in order; RQ3 (the personal-data question) gets its own values. */
function answers(...values: string[]): RiskAnswerValues {
  return Object.fromEntries(values.map((v, i) => [QUESTION_IDS[i]!, v]));
}
const levels = (high: number, medium: number, low: number): RiskLevel[] => [
  ...Array<RiskLevel>(high).fill('high'),
  ...Array<RiskLevel>(medium).fill('medium'),
  ...Array<RiskLevel>(low).fill('low'),
];

test('ENGINE_VERSION names the scoring semantics', () => {
  assert.equal(ENGINE_VERSION, 'risk-engine/1');
});

test('tierOf: the High rule (>= 3 high) below, at and above its boundary', () => {
  const rubric = testRubric();
  assert.deepEqual(tierOf(rubric, levels(2, 0, 5)), {
    tier: 'medium',
    counts: { high: 2, medium: 0, low: 5 },
    matchedRule: { tier: 'medium', index: 1 },
  });
  assert.deepEqual(tierOf(rubric, levels(3, 0, 4)).matchedRule, { tier: 'high', index: 0 });
  assert.equal(tierOf(rubric, levels(3, 0, 4)).tier, 'high');
  assert.equal(tierOf(rubric, levels(4, 0, 3)).tier, 'high');
});

test('tierOf: the Medium rule (>= 1 high or >= 2 medium) below, at and above each boundary', () => {
  const rubric = testRubric();
  assert.deepEqual(tierOf(rubric, levels(0, 0, 7)), {
    tier: 'low',
    counts: { high: 0, medium: 0, low: 7 },
    matchedRule: 'default',
  });
  assert.equal(tierOf(rubric, levels(1, 0, 6)).tier, 'medium');
  assert.equal(tierOf(rubric, levels(2, 0, 5)).tier, 'medium');
  assert.equal(tierOf(rubric, levels(0, 1, 6)).tier, 'low');
  assert.equal(tierOf(rubric, levels(0, 2, 5)).tier, 'medium');
  assert.equal(tierOf(rubric, levels(0, 3, 4)).tier, 'medium');
});

test('tierOf counts each level exactly: high answers never count toward a medium condition', () => {
  const rubric = testRubric();
  rubric.tierRules = [{ tier: 'medium', anyOf: [{ allOf: [{ level: 'medium', atLeast: 2 }] }] }];
  assert.equal(tierOf(rubric, levels(2, 1, 4)).tier, 'low');
  assert.equal(tierOf(rubric, levels(0, 2, 5)).tier, 'medium');
});

test('tierOf: allOf needs every condition, anyOf needs one group, and the first matching rule wins', () => {
  const rubric = testRubric();
  rubric.tierRules = [
    {
      tier: 'high',
      anyOf: [
        {
          allOf: [
            { level: 'high', atLeast: 1 },
            { level: 'medium', atLeast: 2 },
          ],
        },
      ],
    },
    { tier: 'high', anyOf: [{ allOf: [{ level: 'high', atLeast: 4 }] }] },
    { tier: 'medium', anyOf: [{ allOf: [{ level: 'high', atLeast: 1 }] }] },
  ];
  assert.deepEqual(tierOf(rubric, levels(1, 1, 5)).matchedRule, { tier: 'medium', index: 2 });
  assert.deepEqual(tierOf(rubric, levels(1, 2, 4)).matchedRule, { tier: 'high', index: 0 });
  assert.deepEqual(tierOf(rubric, levels(4, 0, 3)).matchedRule, { tier: 'high', index: 1 });
  assert.deepEqual(tierOf(rubric, levels(4, 2, 1)).matchedRule, { tier: 'high', index: 0 });
});

test('scoreRisk: all seven answered and evidenced gives a determinate tier with its explanation', () => {
  const score = scoreRisk(
    testRubric(),
    answers('high', 'high', 'no', 'high', 'low', 'low', 'medium'),
    EVIDENCE_ATTACHED,
  );
  assert.equal(score.engineVersion, 'risk-engine/1');
  assert.equal(score.tier, 'high');
  assert.deepEqual(score.bounds, { lowest: 'high', highest: 'high' });
  assert.deepEqual(score.counts, { high: 3, medium: 1, low: 3 });
  assert.deepEqual(score.matchedRule, { tier: 'high', index: 0 });
  assert.equal(score.escalation, null);
  assert.equal(score.unknownCount, 0);
  assert.deepEqual(score.questions[0], {
    questionId: 'RQ1',
    status: 'answered',
    value: 'high',
    level: 'high',
    evidence: { slot: 1, state: 'attached' },
  });
  assert.deepEqual(
    score.questions.map((q) => q.questionId),
    [...QUESTION_IDS],
  );
});

test('escalation raises the tier over the counts (personal data: at least Medium) and never lowers it', () => {
  const rubric = testRubric();
  const pii = scoreRisk(rubric, answers('low', 'low', 'yes', 'low', 'low', 'low', 'low'), EVIDENCE_ATTACHED);
  assert.equal(pii.tier, 'medium');
  assert.deepEqual(pii.counts, { high: 0, medium: 0, low: 7 });
  assert.equal(pii.matchedRule, 'default');
  assert.deepEqual(pii.escalation, { questionId: 'RQ3', to: 'medium' });
  assert.deepEqual(pii.questions[2], {
    questionId: 'RQ3',
    status: 'answered',
    value: 'yes',
    level: 'low',
    escalatesTo: 'medium',
    evidence: { slot: 1, state: 'attached' },
  });
  const high = scoreRisk(
    rubric,
    answers('high', 'high', 'yes', 'high', 'low', 'low', 'low'),
    EVIDENCE_ATTACHED,
  );
  assert.equal(high.tier, 'high', 'an escalation to medium does not lower a High');
  const noPii = scoreRisk(rubric, answers('low', 'low', 'no', 'low', 'low', 'low', 'low'), EVIDENCE_ATTACHED);
  assert.equal(noPii.tier, 'low');
});

test('the highest escalation wins, and the first question in rubric order on a tie', () => {
  const rubric = testRubric();
  rubric.questions[5]!.options[0]!.escalatesTo = 'high';
  rubric.questions[6]!.options[0]!.escalatesTo = 'high';
  const score = scoreRisk(
    rubric,
    answers('low', 'low', 'yes', 'low', 'low', 'low', 'low'),
    EVIDENCE_ATTACHED,
  );
  assert.equal(score.tier, 'high');
  assert.deepEqual(score.escalation, { questionId: 'RQ6', to: 'high' });
});

test('every unknown reason: unanswered, explicit_unknown, not_in_rubric and evidence_not_attached', () => {
  const rubric = testRubric();
  rubric.questions[4]!.evidenceSlot = 2;
  delete rubric.questions[5]!.evidenceSlot; // RQ6 counts without evidence
  const score = scoreRisk(
    rubric,
    { RQ1: 'unknown', RQ2: 'extreme', RQ3: 'no', RQ5: 'low', RQ6: 'low', RQ7: 'low' },
    { 1: 'attached', 2: 'not_yet' },
  );
  const byId = Object.fromEntries(score.questions.map((q) => [q.questionId, q]));
  assert.deepEqual(byId.RQ1, {
    questionId: 'RQ1',
    status: 'unknown',
    unknownReason: 'explicit_unknown',
    value: 'unknown',
    evidence: { slot: 1, state: 'attached' },
  });
  assert.deepEqual(byId.RQ2, {
    questionId: 'RQ2',
    status: 'unknown',
    unknownReason: 'not_in_rubric',
    value: 'extreme',
    evidence: { slot: 1, state: 'attached' },
  });
  assert.deepEqual(byId.RQ4, {
    questionId: 'RQ4',
    status: 'unknown',
    unknownReason: 'unanswered',
    evidence: { slot: 1, state: 'attached' },
  });
  assert.deepEqual(byId.RQ5, {
    questionId: 'RQ5',
    status: 'unknown',
    unknownReason: 'evidence_not_attached',
    value: 'low',
    level: 'low',
    evidence: { slot: 2, state: 'not_yet' },
  });
  assert.deepEqual(byId.RQ6, { questionId: 'RQ6', status: 'answered', value: 'low', level: 'low' });
  assert.equal(score.unknownCount, 4);
  assert.deepEqual(score.counts, { high: 0, medium: 0, low: 3 }, 'counts cover answered questions only');
});

test('evidence_not_attached for every slot state but attached, including an absent state', () => {
  for (const state of ['not_yet', 'missing', 'not_applicable'] as const) {
    const score = scoreRisk(testRubric(), answers('low'), { 1: state });
    assert.equal(score.questions[0]!.unknownReason, 'evidence_not_attached', state);
  }
  const absent = scoreRisk(testRubric(), answers('low'), {});
  assert.deepEqual(absent.questions[0], {
    questionId: 'RQ1',
    status: 'unknown',
    unknownReason: 'evidence_not_attached',
    value: 'low',
    level: 'low',
    evidence: { slot: 1, state: null },
  });
});

test('an answer to a question the rubric does not have is ignored', () => {
  const rubric = testRubric();
  const all = answers('low', 'low', 'no', 'low', 'low', 'low', 'low');
  const plain = scoreRisk(rubric, all, EVIDENCE_ATTACHED);
  const extra = scoreRisk(rubric, { ...all, RQ9: 'high' }, EVIDENCE_ATTACHED);
  assert.deepEqual(extra, plain);
  assert.equal(extra.tier, 'low');
});

test('missing evidence is never Low: all seven unknown spans Low to High', () => {
  const score = scoreRisk(testRubric(), {}, EVIDENCE_ATTACHED);
  assert.equal(score.tier, 'unknown');
  assert.deepEqual(score.bounds, { lowest: 'low', highest: 'high' });
  assert.equal(score.unknownCount, 7);
  assert.deepEqual(score.counts, { high: 0, medium: 0, low: 0 });
  assert.equal(score.matchedRule, null);
  assert.equal(score.escalation, null);
  assert.ok(score.questions.every((q) => q.status === 'unknown' && q.unknownReason === 'unanswered'));
  const noEvidence = scoreRisk(testRubric(), answers('low', 'low', 'no', 'low', 'low', 'low', 'low'), {});
  assert.equal(noEvidence.tier, 'unknown', 'seven Low answers with slot 1 not attached are not Low');
  assert.deepEqual(noEvidence.bounds, { lowest: 'low', highest: 'high' });
});

test('bounds: one Unknown beside two High answers could be Medium or High', () => {
  const score = scoreRisk(
    testRubric(),
    answers('high', 'high', 'no', 'low', 'low', 'low'),
    EVIDENCE_ATTACHED,
  );
  assert.equal(score.unknownCount, 1);
  assert.equal(score.tier, 'unknown');
  assert.deepEqual(score.bounds, { lowest: 'medium', highest: 'high' });
  assert.equal(score.matchedRule, null, 'the combinations match different rules');
});

test('bounds include an escalation an Unknown question could still produce', () => {
  const rubric = testRubric();
  const all = answers('low', 'low', 'unknown', 'low', 'low', 'low', 'low');
  const score = scoreRisk(rubric, all, EVIDENCE_ATTACHED);
  assert.equal(score.tier, 'unknown');
  assert.deepEqual(score.bounds, { lowest: 'low', highest: 'medium' }, 'RQ3 yes escalates to Medium');
  assert.equal(score.escalation, null, 'escalation reports answered questions only');
});

test('determinate despite Unknown: three High answers are High whatever the other four are', () => {
  const score = scoreRisk(testRubric(), answers('high', 'high', 'unknown', 'high'), EVIDENCE_ATTACHED);
  assert.equal(score.unknownCount, 4);
  assert.equal(score.tier, 'high');
  assert.deepEqual(score.bounds, { lowest: 'high', highest: 'high' });
  assert.deepEqual(score.matchedRule, { tier: 'high', index: 0 }, 'every combination matches rule 0');
});

test('determinate despite Unknown with a Medium floor and a Medium ceiling', () => {
  const rubric = testRubric();
  rubric.tierRules = [{ tier: 'medium', anyOf: [{ allOf: [{ level: 'high', atLeast: 1 }] }] }];
  const score = scoreRisk(rubric, answers('high', 'unknown'), EVIDENCE_ATTACHED);
  assert.equal(score.tier, 'medium');
  assert.deepEqual(score.bounds, { lowest: 'medium', highest: 'medium' });
  assert.deepEqual(score.matchedRule, { tier: 'medium', index: 0 });
});

test('the operating-model section 7 summary shape is expressible (EXPRESSIVENESS ONLY, NOT THE APPROVED RUBRIC)', () => {
  // Labelled on purpose (W5 plan R-7): this proves the engine can express ">= 2 high answers -> High" and
  // "personal data -> High". It is not the D07 instrument, is not seeded and must never be copied into configuration.
  const rubric = testRubric();
  rubric.label = 'expressiveness-only.not-the-approved-rubric';
  rubric.questions[2]!.options[2]!.escalatesTo = 'high';
  rubric.tierRules = [
    { tier: 'high', anyOf: [{ allOf: [{ level: 'high', atLeast: 2 }] }] },
    {
      tier: 'medium',
      anyOf: [{ allOf: [{ level: 'high', atLeast: 1 }] }, { allOf: [{ level: 'medium', atLeast: 1 }] }],
    },
  ];
  const score = (...v: string[]) => scoreRisk(rubric, answers(...v), EVIDENCE_ATTACHED).tier;
  assert.equal(score('high', 'high', 'no', 'low', 'low', 'low', 'low'), 'high');
  assert.equal(score('high', 'low', 'no', 'low', 'low', 'low', 'low'), 'medium');
  assert.equal(score('low', 'low', 'yes', 'low', 'low', 'low', 'low'), 'high', 'personal data -> High');
  assert.equal(score('low', 'low', 'no', 'low', 'low', 'low', 'low'), 'low');
});

test('scoreRisk is pure: it does not mutate its inputs and repeats exactly', () => {
  const rubric = testRubric();
  const input = answers('high', 'unknown', 'yes', 'medium');
  const slots = { 1: 'attached' as const };
  const before = structuredClone({ rubric, input, slots });
  const first = scoreRisk(rubric, input, slots);
  assert.deepEqual({ rubric, input, slots }, before);
  assert.deepEqual(scoreRisk(rubric, input, slots), first);
});

test('all seven Unknown with five options each is scored well under 100 ms', () => {
  const rubric = testRubric();
  for (const q of rubric.questions)
    q.options = (['low', 'medium', 'high', 'high', 'medium'] as const).map((level, i) => ({
      value: `o${i}`,
      label: { th: `ต${i}`, en: `o${i}` },
      level,
      ...(i === 3 ? { escalatesTo: 'high' as const } : {}),
    }));
  const started = performance.now();
  const score = scoreRisk(rubric, {}, EVIDENCE_ATTACHED);
  const elapsed = performance.now() - started;
  assert.deepEqual(score.bounds, { lowest: 'low', highest: 'high' });
  assert.ok(elapsed < 100, `${elapsed} ms`);
});

// ---- exactness: bounds equal brute-force enumeration on generated synthetic rubrics ---------------------------------

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const RANK = { low: 0, medium: 1, high: 2 } as const;
const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

function generatedRubric(rand: () => number): RiskRubricBody {
  const rubric = testRubric();
  for (const q of rubric.questions) {
    const n = 2 + Math.floor(rand() * 4);
    q.options = Array.from({ length: n }, (_, i) => {
      const escalation = rand() < 0.15 ? pick(rand, ['medium', 'high'] as const) : undefined;
      return {
        value: `o${i}`,
        label: { th: `ต${i}`, en: `o${i}` },
        level: pick(rand, ['low', 'medium', 'high'] as const),
        ...(escalation === undefined ? {} : { escalatesTo: escalation }),
      };
    });
  }
  const rule = (tier: 'high' | 'medium') => ({
    tier,
    anyOf: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
      allOf: Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({
        level: pick(rand, ['high', 'medium'] as const),
        atLeast: 1 + Math.floor(rand() * 4),
      })),
    })),
  });
  rubric.tierRules = [
    ...Array.from({ length: Math.floor(rand() * 3) }, () => rule('high')),
    ...Array.from({ length: Math.floor(rand() * 3) }, () => rule('medium')),
  ];
  return rubric;
}

/** Naive reference: every combination of every Unknown question's options, one at a time. */
function bruteForce(rubric: RiskRubricBody, known: Map<string, string>) {
  const tiers = new Set<'low' | 'medium' | 'high'>();
  const walk = (i: number, chosen: Array<{ level: RiskLevel; escalatesTo?: 'medium' | 'high' }>) => {
    if (i === rubric.questions.length) {
      const base = tierOf(
        rubric,
        chosen.map((o) => o.level),
      ).tier;
      const top = chosen.reduce(
        (t, o) => (o.escalatesTo && RANK[o.escalatesTo] > RANK[t] ? o.escalatesTo : t),
        base,
      );
      tiers.add(top);
      return;
    }
    const q = rubric.questions[i]!;
    const value = known.get(q.questionId);
    const options = value === undefined ? q.options : q.options.filter((o) => o.value === value);
    for (const o of options) walk(i + 1, [...chosen, o]);
  };
  walk(0, []);
  const sorted = [...tiers].sort((a, b) => RANK[a] - RANK[b]);
  return { lowest: sorted[0]!, highest: sorted.at(-1)! };
}

test('bounds are exact: they equal brute-force enumeration on 300 generated synthetic rubrics', () => {
  const rand = prng(20260927);
  for (let n = 0; n < 300; n += 1) {
    const rubric = generatedRubric(rand);
    const known = new Map<string, string>();
    const input: Record<string, string> = {};
    for (const q of rubric.questions) {
      const r = rand();
      if (r < 0.45) {
        const value = pick(rand, q.options).value;
        known.set(q.questionId, value);
        input[q.questionId] = value;
      } else if (r < 0.6) input[q.questionId] = 'unknown';
    }
    const score = scoreRisk(rubric, input, EVIDENCE_ATTACHED);
    const expected = bruteForce(rubric, known);
    assert.deepEqual(score.bounds, expected, `rubric ${n}`);
    assert.equal(
      score.tier,
      expected.lowest === expected.highest ? expected.lowest : 'unknown',
      `rubric ${n}`,
    );
  }
});
