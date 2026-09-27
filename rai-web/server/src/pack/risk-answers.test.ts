// W5-04 (W5 plan sections 2, 4 and 6): the pure half of the draft risk answers. Validation against the rubric in force
// (422 `error.risk.not_configured` at body.riskAnswers; `validation.not_in_configured_list` at
// body.riskAnswers.<questionId>; `null` always clears), the merge that keeps an unchanged answer's attribution, the
// `draft.saved` refs (question IDs and values only) and the request shape. The rubric is the seeded SYNTHETIC
// PLACEHOLDER (D07 open), never the approved instrument.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { PackDraftSchema, PackDraftUpdateRequestSchema } from '@rai/shared/schemas/pack';
import { CONFIGURATION_SEED } from '../configuration/seed.js';
import {
  RISK_NOT_CONFIGURED,
  mergeRiskAnswers,
  riskAnswerAuditRefs,
  riskAnswerProblems,
  storedRiskAnswers,
  type StoredRiskAnswers,
} from './risk-answers.js';

const RUBRIC = CONFIGURATION_SEED.risk_rubric;
const OWNER = {
  answeredBy: 'fixture:owner-a',
  answeredRole: 'owner' as const,
  answeredAt: '2026-09-27T06:00:00.000Z',
};
const SPOC = {
  answeredBy: 'fixture:spoc-b1',
  answeredRole: 'bu_spoc' as const,
  answeredAt: '2026-09-27T07:00:00.000Z',
};

describe('W5-04 riskAnswerProblems', () => {
  it('accepts an option of the question, the reserved unknown and null', () => {
    assert.deepEqual(
      riskAnswerProblems({ RQ1: 'few', RQ3: 'sensitive', RQ7: 'unknown', RQ2: null }, RUBRIC),
      [],
    );
  });

  it('a question not in the rubric, or a value that is not one of its options, is not_in_configured_list at its key', () => {
    assert.deepEqual(riskAnswerProblems({ RQ1: 'public', RQ8: 'few', RQ2: 'few', RQ3: 'yes' }, RUBRIC), [
      { path: 'body.riskAnswers.RQ2', messageKey: 'validation.not_in_configured_list' },
      { path: 'body.riskAnswers.RQ8', messageKey: 'validation.not_in_configured_list' },
    ]);
  });

  it('an answer with no rubric in force is one error.risk.not_configured at body.riskAnswers', () => {
    assert.equal(RISK_NOT_CONFIGURED, 'error.risk.not_configured');
    assert.deepEqual(riskAnswerProblems({ RQ1: 'few', RQ2: 'unknown' }, undefined), [
      { path: 'body.riskAnswers', messageKey: 'error.risk.not_configured' },
    ]);
  });

  it('null always clears: with no rubric, and for a question the rubric no longer has', () => {
    assert.deepEqual(riskAnswerProblems({ RQ1: null, RQ9: null }, undefined), []);
    assert.deepEqual(riskAnswerProblems({ RQ9: null }, RUBRIC), []);
    assert.deepEqual(riskAnswerProblems({}, undefined), []);
  });
});

describe('W5-04 mergeRiskAnswers', () => {
  it('a new answer is stored with the acting subject, role and instant; nothing else', () => {
    const { merged, changed } = mergeRiskAnswers({}, { RQ1: 'few' }, OWNER);
    assert.equal(changed, true);
    assert.deepEqual(merged, { RQ1: { value: 'few', ...OWNER } });
  });

  it('an unchanged value keeps its original attribution; a changed value takes the new one', () => {
    const stored: StoredRiskAnswers = {
      RQ1: { value: 'few', ...OWNER },
      RQ2: { value: 'advisory', ...OWNER },
    };
    const same = mergeRiskAnswers(stored, { RQ1: 'few' }, SPOC);
    assert.equal(same.changed, false);
    assert.deepEqual(same.merged, stored);
    const changed = mergeRiskAnswers(stored, { RQ1: 'few', RQ2: 'automated' }, SPOC);
    assert.equal(changed.changed, true);
    assert.deepEqual(changed.merged, {
      RQ1: { value: 'few', ...OWNER },
      RQ2: { value: 'automated', ...SPOC },
    });
  });

  it('null removes the answer; clearing an absent answer changes nothing', () => {
    const stored: StoredRiskAnswers = { RQ1: { value: 'few', ...OWNER } };
    assert.deepEqual(mergeRiskAnswers(stored, { RQ1: null }, SPOC), { merged: {}, changed: true });
    assert.deepEqual(mergeRiskAnswers(stored, { RQ4: null }, SPOC), { merged: stored, changed: false });
  });

  it('does not mutate the stored object', () => {
    const stored: StoredRiskAnswers = { RQ1: { value: 'few', ...OWNER } };
    const copy = structuredClone(stored);
    mergeRiskAnswers(stored, { RQ1: null, RQ2: 'reviewed' }, SPOC);
    assert.deepEqual(stored, copy);
  });
});

describe('W5-04 riskAnswerAuditRefs', () => {
  it('lists every answer the request carried, in question-ID order, with its value or null; no attribution', () => {
    assert.deepEqual(riskAnswerAuditRefs({ RQ3: 'yes', RQ1: null, RQ2: 'unknown' }), [
      { question_id: 'RQ1', value: null },
      { question_id: 'RQ2', value: 'unknown' },
      { question_id: 'RQ3', value: 'yes' },
    ]);
  });
});

describe('W5-04 storedRiskAnswers (the jsonb column read defensively)', () => {
  it('keeps well-formed entries and drops anything else', () => {
    assert.deepEqual(storedRiskAnswers({}), {});
    assert.deepEqual(storedRiskAnswers(null), {});
    assert.deepEqual(
      storedRiskAnswers({
        RQ1: { value: 'few', ...OWNER },
        RQ2: 'few',
        bad: { value: 'x', ...OWNER },
        RQ3: { value: 1 },
      }),
      { RQ1: { value: 'few', ...OWNER } },
    );
  });
});

describe('W5-04 shapes (W0-02 7.5)', () => {
  const expectedVersion = { versionId: 'v', revision: 1 };
  it('the update request takes question IDs to an option value or null; nothing else', () => {
    assert.ok(
      Value.Check(PackDraftUpdateRequestSchema, { expectedVersion, riskAnswers: { RQ1: 'few', RQ2: null } }),
    );
    assert.ok(
      Value.Check(PackDraftUpdateRequestSchema, { expectedVersion, riskAnswers: { RQ7: 'unknown' } }),
    );
    for (const riskAnswers of [
      { rq1: 'few' },
      { RQ0: 'few' },
      { RQ10: 'few' },
      { RQ1: 'Few' },
      { RQ1: '' },
      { RQ1: 3 },
      { RQ1: { value: 'few' } },
      { RQ1: 'free text answer' },
      'RQ1',
    ])
      assert.equal(
        Value.Check(PackDraftUpdateRequestSchema, { expectedVersion, riskAnswers }),
        false,
        JSON.stringify(riskAnswers),
      );
  });

  it('PackDraft carries riskAnswers with attribution; answeredByName is optional', () => {
    const draft = {
      draftId: 'd',
      caseId: 'c',
      versionNumber: 1,
      parentVersionId: null,
      checklistTemplateVersion: 'v1.0',
      stageContext: 'idea',
      slots: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, { state: 'missing' }])),
      draftRevision: 1,
      updatedAt: '2026-09-27T06:00:00.000Z',
      riskAnswers: { RQ1: { value: 'few', ...OWNER } },
    };
    assert.ok(Value.Check(PackDraftSchema, draft));
    assert.ok(
      Value.Check(PackDraftSchema, {
        ...draft,
        riskAnswers: { RQ1: { value: 'few', ...OWNER, answeredByName: 'Owner A (synthetic)' } },
      }),
    );
    const { riskAnswers: _omitted, ...withoutAnswers } = draft;
    assert.equal(Value.Check(PackDraftSchema, withoutAnswers), false);
    assert.equal(
      Value.Check(PackDraftSchema, {
        ...draft,
        riskAnswers: { RQ1: { ...OWNER, value: 'few', answeredRole: 'reviewer' } },
      }),
      false,
    );
  });
});
