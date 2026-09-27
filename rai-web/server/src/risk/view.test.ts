// W5-06 (W5 plan section 6): the pure builder of `RiskProposalView` from a stored `risk_proposal` row, the frozen
// rubric revision it names and the frozen version's answers. Synthetic placeholder rubric only (D07 open).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { ENGINE_VERSION } from '@rai/shared/risk/types';
import { RiskProposalViewSchema } from '@rai/shared/schemas/risk';
import { CONFIGURATION_SEED } from '../configuration/seed.js';
import { councilConfirmationOf, riskProposalView, type RiskProposalViewInput } from './view.js';

const RUBRIC = CONFIGURATION_SEED.risk_rubric;
const CREATED = new Date('2026-09-28T03:00:00Z');
const OWNER = 'fixture:owner-a';

function row(over: Partial<RiskProposalViewInput['row']> = {}): RiskProposalViewInput['row'] {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    caseId: '01900000-0000-7000-8000-0000000000c1',
    versionId: '01900000-0000-7000-8000-0000000000a1',
    trigger: 'submit',
    status: 'proposed',
    unavailableReason: null,
    tier: 'high',
    lowestTier: 'high',
    highestTier: 'high',
    rubricRevisionId: '01900000-0000-7000-8000-0000000000r1',
    rubricLabel: RUBRIC.label,
    engineVersion: ENGINE_VERSION,
    inputsHash: 'a'.repeat(64),
    explanation: {
      questions: [
        {
          questionId: 'RQ1',
          status: 'answered',
          value: 'public',
          level: 'high',
          evidence: { slot: 1, state: 'attached' },
        },
        {
          questionId: 'RQ2',
          status: 'unknown',
          unknownReason: 'unanswered',
          evidence: { slot: 1, state: 'attached' },
        },
        { questionId: 'RQ3', status: 'unknown', unknownReason: 'explicit_unknown', value: 'unknown' },
      ],
      counts: { low: 0, medium: 0, high: 1 },
      matchedRule: { tier: 'high', index: 0 },
      escalation: null,
      unknownCount: 2,
    },
    correlationId: 'corr',
    createdAt: CREATED,
    ...over,
  };
}

const answers = {
  RQ1: { value: 'public', answeredBy: OWNER, answeredRole: 'owner', answeredAt: '2026-09-28T02:59:00.000Z' },
  RQ3: {
    value: 'unknown',
    answeredBy: 'fixture:spoc',
    answeredRole: 'bu_spoc',
    answeredAt: '2026-09-28T02:58:00.000Z',
  },
};

describe('W5-06 riskProposalView', () => {
  it('councilConfirmation: required for high, possible for unknown reaching high, otherwise not indicated', () => {
    assert.equal(councilConfirmationOf('high', 'high'), 'required');
    assert.equal(councilConfirmationOf('unknown', 'high'), 'possible');
    assert.equal(councilConfirmationOf('unknown', 'medium'), 'not_indicated');
    assert.equal(councilConfirmationOf('medium', 'medium'), 'not_indicated');
    assert.equal(councilConfirmationOf('low', 'low'), 'not_indicated');
    assert.equal(councilConfirmationOf(null, null), 'not_indicated');
  });

  it('a proposed row: bounds, the frozen rubric, attribution merged from the frozen answers, names when resolved', () => {
    const view = riskProposalView({
      row: row(),
      rubric: { id: '01900000-0000-7000-8000-0000000000r1', body: RUBRIC },
      riskAnswers: answers,
      names: new Map([[OWNER, 'Owner A (synthetic)']]),
    });
    assert.ok(
      Value.Check(RiskProposalViewSchema, view),
      JSON.stringify([...Value.Errors(RiskProposalViewSchema, view)]),
    );
    assert.deepEqual(view.bounds, { lowest: 'high', highest: 'high' });
    assert.equal(view.councilConfirmation, 'required');
    assert.equal(view.createdAt, CREATED.toISOString());
    assert.deepEqual(view.rubric, {
      revisionId: '01900000-0000-7000-8000-0000000000r1',
      label: RUBRIC.label,
      provenance: 'synthetic_placeholder',
      questions: RUBRIC.questions,
      tierLabels: RUBRIC.tierLabels,
    });
    assert.deepEqual(view.explanation!.questions, [
      {
        questionId: 'RQ1',
        status: 'answered',
        value: 'public',
        level: 'high',
        evidence: { slot: 1, state: 'attached' },
        answeredBy: OWNER,
        answeredByName: 'Owner A (synthetic)',
        answeredRole: 'owner',
        answeredAt: '2026-09-28T02:59:00.000Z',
      },
      {
        questionId: 'RQ2',
        status: 'unknown',
        unknownReason: 'unanswered',
        evidence: { slot: 1, state: 'attached' },
      },
      {
        questionId: 'RQ3',
        status: 'unknown',
        unknownReason: 'explicit_unknown',
        value: 'unknown',
        answeredBy: 'fixture:spoc',
        answeredRole: 'bu_spoc',
        answeredAt: '2026-09-28T02:58:00.000Z',
      },
    ]);
    assert.deepEqual(view.explanation!.counts, { low: 0, medium: 0, high: 1 });
    assert.equal(view.explanation!.unknownCount, 2);
  });

  it('an unavailable row: no tier, bounds, rubric or explanation, and never Low', () => {
    const view = riskProposalView({
      row: row({
        status: 'unavailable',
        unavailableReason: 'not_configured',
        tier: null,
        lowestTier: null,
        highestTier: null,
        rubricRevisionId: null,
        rubricLabel: null,
        inputsHash: null,
        explanation: null,
      }),
      rubric: undefined,
      riskAnswers: answers,
      names: new Map(),
    });
    assert.ok(Value.Check(RiskProposalViewSchema, view));
    assert.equal(view.tier, null);
    assert.equal(view.bounds, null);
    assert.equal(view.rubric, null);
    assert.equal(view.explanation, null);
    assert.equal(view.councilConfirmation, 'not_indicated');
    assert.equal(view.unavailableReason, 'not_configured');
  });

  it('a frozen rubric body that fails the schema is served as rubric null (rubric_invalid), never a guessed rubric', () => {
    const view = riskProposalView({
      row: row({
        status: 'unavailable',
        unavailableReason: 'rubric_invalid',
        tier: null,
        lowestTier: null,
        highestTier: null,
        explanation: null,
        inputsHash: null,
      }),
      rubric: { id: '01900000-0000-7000-8000-0000000000r1', body: { ...RUBRIC, provenance: 'd07_recorded' } },
      riskAnswers: {},
      names: new Map(),
    });
    assert.equal(view.rubric, null);
    assert.ok(Value.Check(RiskProposalViewSchema, view));
  });
});
