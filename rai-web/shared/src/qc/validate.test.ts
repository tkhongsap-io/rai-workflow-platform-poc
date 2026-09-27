// W0-07 section 3.4 steps 4 and 5 as a pure function: the violation names, scope keys and the result schema.
// The scripted substitute's colocated tests (fixtures/src/substitutes/qc/scripts.test.ts) exercise every named
// violation against materialised findings; this file pins the contract pieces the orchestrator (W2-05) relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { LANE_MAPPING_V1 } from '../constants.js';
import type { QcFinding, QcRunResult } from './types.js';
import {
  QcEngineIdentitySchema,
  QcRunResultSchema,
  checkOwningLane,
  duplicateFindingKey,
  findingKeyOf,
  isEvidenceLocator,
  scopeKeyOf,
  validateQcFinding,
} from './validate.js';
import { CELL_REFERENCE_PATTERN } from './types.js';

const hash = 'a'.repeat(64);
const context = {
  trigger: 'submit' as const,
  qcRulesRevision: 'cfg-rev-0001',
  checklistTemplateVersion: 'v1.0 Sheet3',
};

const finding: QcFinding = {
  findingKey: 'PACK-SLOT-MISSING:slot:7',
  ruleId: 'PACK-SLOT-MISSING',
  ruleRevision: 'cfg-rev-0001',
  trigger: 'submit',
  scope: { kind: 'slot', slot: 7 },
  severity: 'medium',
  owningLane: 'it_security',
  evidence: [{ artifactId: null, contentHash: null, slot: 7, locator: { kind: 'absent' } }],
  measure: null,
  message: { key: 'qc.finding.pack_slot_missing', params: { slot: 7 } },
  provenance: { runner: 'substitute-scripted', runnerVersion: '0.0.0' },
};

test('scopeKey joins the scope fields in order so triggers, lanes and placements stay distinct', () => {
  assert.equal(scopeKeyOf({ kind: 'slot', slot: 7 }), 'slot:7');
  assert.equal(
    scopeKeyOf({ kind: 'artifact', slot: 1, artifactId: 'art-1', contentHash: hash }),
    `artifact:1:art-1:${hash}`,
  );
  assert.equal(scopeKeyOf({ kind: 'pack' }), 'pack');
  assert.equal(
    scopeKeyOf({ kind: 'run', trigger: 'approve_attempt', lane: 'dpo' }),
    'run:approve_attempt:dpo',
  );
  assert.equal(scopeKeyOf({ kind: 'run', trigger: 'submit', lane: null }), 'run:submit:-');
  assert.equal(findingKeyOf('PACK-SLOT-MISSING', { kind: 'slot', slot: 7 }), 'PACK-SLOT-MISSING:slot:7');
});

test('a conforming finding validates; each step-4 rule has a named violation; non-objects are schema_violation', () => {
  assert.equal(validateQcFinding(finding, context), null);
  assert.equal(validateQcFinding(null, context), 'schema_violation');
  assert.equal(validateQcFinding('text', context), 'schema_violation');
  assert.equal(validateQcFinding({ ...finding, ruleId: 'lowercase' }, context), 'rule_id_invalid');
  assert.equal(validateQcFinding({ ...finding, owningLane: 'admin' }, context), 'owning_lane_invalid');
  assert.equal(validateQcFinding({ ...finding, trigger: 'upload' }, context), 'trigger_mismatch');
  assert.equal(
    validateQcFinding({ ...finding, findingKey: 'PACK-SLOT-MISSING:slot:8' }, context),
    'finding_key_mismatch',
  );
  assert.equal(
    validateQcFinding({ ...finding, message: { key: 'Slot 7 is missing', params: {} } }, context),
    'schema_violation',
  );
  assert.equal(validateQcFinding({ ...finding, severity: 'critical' }, context), 'schema_violation');
  assert.equal(validateQcFinding({ ...finding, disposition: 'waived' }, context), 'unknown_field');
  assert.equal(
    validateQcFinding({ ...finding, evidence: [{ ...finding.evidence[0], excerpt: 'text' }] }, context),
    'document_text_field',
  );
  assert.equal(
    validateQcFinding(
      { ...finding, evidence: [{ ...finding.evidence[0], excerptHash: hash.toUpperCase() }] },
      context,
    ),
    'excerpt_hash_invalid',
  );
  assert.equal(validateQcFinding({ ...finding, evidence: [] }, context), 'evidence_missing');
  assert.equal(validateQcFinding({ ...finding, ruleRevision: 'other' }, context), 'rule_revision_mismatch');
  const measured: QcFinding = {
    ...finding,
    measure: {
      metric: 'hallucination_rate',
      value: 2.4,
      denominator: 500,
      threshold: 2,
      unit: 'percent',
      thresholdSource: 'v2.0',
    },
  };
  assert.equal(validateQcFinding(measured, context), 'threshold_source_mismatch');
  assert.equal(
    validateQcFinding(
      { ...measured, measure: { ...measured.measure!, thresholdSource: 'v1.0 Sheet3' } },
      context,
    ),
    null,
  );
  const run: QcFinding = {
    ...finding,
    ruleId: 'QC-UNAVAILABLE',
    scope: { kind: 'run', trigger: 'submit', lane: null },
    findingKey: 'QC-UNAVAILABLE:run:submit:-',
  };
  assert.equal(validateQcFinding(run, context), 'qc_unavailable_rule_forbidden');
  assert.equal(
    validateQcFinding({ ...run, ruleId: 'SOME-RULE', findingKey: 'SOME-RULE:run:submit:-' }, context),
    'run_scope_forbidden',
  );
});

test('step 5: owning lane per W0-06 7.1 and the 7.3 rule recorded 2026-09-25', () => {
  // single-lane slot (7.1): `finding` is slot 7, it_security
  assert.equal(checkOwningLane(finding, LANE_MAPPING_V1, null), null);
  assert.equal(
    checkOwningLane({ ...finding, owningLane: 'dpo' }, LANE_MAPPING_V1, null),
    'owning_lane_mismatch',
  );
  // slot 5: any reviewing lane on submit; on an approve attempt only that run's lane
  const slot5 = { ...finding, scope: { kind: 'slot', slot: 5 } as const };
  assert.equal(checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, null), null);
  assert.equal(checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, 'dpo'), null);
  assert.equal(
    checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, 'it_security'),
    'finding_outside_lane',
  );
  // slot 9: informational only
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'slot', slot: 9 } }, LANE_MAPPING_V1, null),
    'owning_lane_slot_informational',
  );
  // pack: AI/COE
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'pack' }, owningLane: 'ai_coe' }, LANE_MAPPING_V1, null),
    null,
  );
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'pack' }, owningLane: 'dpo' }, LANE_MAPPING_V1, null),
    'owning_lane_mismatch',
  );
  // a single-lane finding on another lane's approve attempt is outside that lane
  assert.equal(checkOwningLane(finding, LANE_MAPPING_V1, 'dpo'), 'finding_outside_lane');
});

test('QcRunResultSchema accepts both result shapes and rejects a lane or findings on an unavailable result', () => {
  const completed: QcRunResult = {
    status: 'completed',
    findings: [finding],
    rulesEvaluated: ['PACK-SLOT-MISSING'],
    startedAt: 't0',
    finishedAt: 't1',
  };
  const unavailable: QcRunResult = {
    status: 'unavailable',
    reason: 'timeout',
    detail: null,
    startedAt: 't0',
    finishedAt: 't1',
  };
  assert.ok(Value.Check(QcRunResultSchema, completed));
  assert.ok(Value.Check(QcRunResultSchema, unavailable));
  assert.ok(!Value.Check(QcRunResultSchema, { ...unavailable, lane: 'dpo' }));
  assert.ok(!Value.Check(QcRunResultSchema, { ...unavailable, findings: [] }));
  assert.ok(!Value.Check(QcRunResultSchema, { ...unavailable, reason: 'model_down' }));
  assert.ok(!Value.Check(QcRunResultSchema, { ...completed, approved: true }));
});

// W4-11b (W4b plan section 7): the optional engine identity a runner reports, validated at the boundary.
const engine = {
  extractorVersion: 'rai-extract/1+0.0.0',
  model: {
    provider: 'local-fake' as const,
    modelId: 'fake-claims-1',
    promptRevision: 'claims/v1@0123456789ab',
    inputTokens: 10,
    outputTokens: 2,
    latencyMs: 5,
    costUsdMicros: 0,
  },
};

test('W4-11b: QcRunResultSchema accepts an engine identity on both statuses', () => {
  const unavailable: QcRunResult = {
    status: 'unavailable',
    reason: 'artifact_unreadable',
    detail: 'extract_limit_time',
    startedAt: 't0',
    finishedAt: 't1',
    engine: { extractorVersion: engine.extractorVersion },
  };
  const completed: QcRunResult = {
    status: 'completed',
    findings: [],
    rulesEvaluated: [],
    startedAt: 't0',
    finishedAt: 't1',
    engine,
  };
  assert.ok(Value.Check(QcRunResultSchema, completed));
  assert.ok(Value.Check(QcRunResultSchema, unavailable));
  assert.ok(!Value.Check(QcRunResultSchema, { ...completed, engine: { ...engine, prompt: 'text' } }));
});

test('W4-11b: QcEngineIdentitySchema bounds identities to identifiers and usage to non-negative integers', () => {
  assert.ok(Value.Check(QcEngineIdentitySchema, engine));
  assert.ok(Value.Check(QcEngineIdentitySchema, {}));
  assert.ok(Value.Check(QcEngineIdentitySchema, { extractorVersion: 'rai-extract/1' }));
  assert.ok(Value.Check(QcEngineIdentitySchema, { model: engine.model }));
  // no provider value exists besides the local fake (WA-D08, decision 6)
  assert.ok(!Value.Check(QcEngineIdentitySchema, { model: { ...engine.model, provider: 'openai' } }));
  for (const unsafe of ['', 'has spaces', 'x'.repeat(129), 'line\nbreak', '-leading', 'ข้อความ'])
    for (const candidate of [
      { extractorVersion: unsafe },
      { model: { ...engine.model, modelId: unsafe } },
      { model: { ...engine.model, promptRevision: unsafe } },
    ])
      assert.ok(!Value.Check(QcEngineIdentitySchema, candidate), JSON.stringify(candidate));
  for (const key of ['inputTokens', 'outputTokens', 'latencyMs', 'costUsdMicros'] as const) {
    for (const bad of [-1, 1.5, Number.NaN])
      assert.ok(
        !Value.Check(QcEngineIdentitySchema, { model: { ...engine.model, [key]: bad } }),
        `${key}=${bad}`,
      );
    const { [key]: _omitted, ...missing } = engine.model;
    assert.ok(!Value.Check(QcEngineIdentitySchema, { model: missing }), `${key} missing`);
  }
  assert.ok(!Value.Check(QcEngineIdentitySchema, { model: { ...engine.model, inputTokens: 2 ** 31 } }));
  assert.ok(!Value.Check(QcEngineIdentitySchema, { extractorVersion: 'x', excerpt: 'text' }));
  assert.ok(!Value.Check(QcEngineIdentitySchema, { model: { ...engine.model, output: 'text' } }));
});

test('W4-16: a locator carries no document text; section by ordinal, cell by sheet ordinal and A1 reference', () => {
  const withLocator = (locator: unknown): unknown => ({
    ...finding,
    evidence: [{ artifactId: 'a-1', contentHash: hash, slot: 7, locator }],
  });
  for (const locator of [
    { kind: 'section', index: 1 },
    { kind: 'section', index: 12 },
    { kind: 'section' },
    { kind: 'cell', sheetIndex: 2, cell: 'B7' },
    { kind: 'cell', sheetIndex: 1, cell: 'XFD1048576' },
    { kind: 'cell', sheetIndex: 3 },
    { kind: 'cell', cell: 'A1' },
    { kind: 'cell' },
    { kind: 'page', page: 3 },
    { kind: 'text_range', start: 0, end: 4 },
  ]) {
    assert.ok(isEvidenceLocator(locator), JSON.stringify(locator));
    assert.equal(validateQcFinding(withLocator(locator), context), null, JSON.stringify(locator));
  }
  // The pre-W4-16 text shapes are refused: a heading or a sheet name is document text (W0-07 3.1, decision 21).
  for (const locator of [
    { kind: 'section', heading: '4. Hallucination and accuracy' },
    { kind: 'section', index: 4, heading: '4. Hallucination and accuracy' },
    { kind: 'cell', sheet: 'Checklist', cell: 'B7' },
    { kind: 'cell', sheetIndex: 1, sheet: 'Checklist', cell: 'B7' },
    { kind: 'section', index: 1, note: 'x' },
  ]) {
    assert.ok(!isEvidenceLocator(locator), JSON.stringify(locator));
    assert.equal(validateQcFinding(withLocator(locator), context), 'unknown_field', JSON.stringify(locator));
  }
  for (const locator of [
    { kind: 'section', index: 0 },
    { kind: 'section', index: 1.5 },
    { kind: 'section', index: '4' },
    { kind: 'cell', sheetIndex: 0, cell: 'A1' },
    { kind: 'cell', sheetIndex: 1, cell: 'a1' },
    { kind: 'cell', sheetIndex: 1, cell: 'A0' },
    { kind: 'cell', sheetIndex: 1, cell: 'Checklist!B7' },
    { kind: 'cell', sheetIndex: 1, cell: 'total revenue' },
  ]) {
    assert.ok(!isEvidenceLocator(locator), JSON.stringify(locator));
    // A union reports the other kinds' closed shapes too, so the violation name may be either schema failure.
    assert.ok(
      ['schema_violation', 'unknown_field'].includes(
        validateQcFinding(withLocator(locator), context) ?? 'null',
      ),
      JSON.stringify(locator),
    );
  }
  assert.equal(CELL_REFERENCE_PATTERN, '^[A-Z]{1,3}[1-9][0-9]{0,6}$');
});

// ---- W4-06a (W4b plan sections 3.1 and 6; decisions 28 and 30) --------------------------------------------------

const artifactHash = 'b'.repeat(64);
const artifactFinding: QcFinding = {
  findingKey: `ACC-METRIC-CITED:artifact:1:art-1:${artifactHash}:0123456789abcdef`,
  ruleId: 'ACC-METRIC-CITED',
  ruleRevision: 'cfg-rev-0001',
  trigger: 'upload',
  scope: { kind: 'artifact', slot: 1, artifactId: 'art-1', contentHash: artifactHash },
  claimKey: '0123456789abcdef',
  severity: 'medium',
  owningLane: 'ai_coe',
  evidence: [
    {
      artifactId: 'art-1',
      contentHash: artifactHash,
      slot: 1,
      locator: { kind: 'section', index: 4 },
      excerptHash: 'c'.repeat(64),
    },
  ],
  measure: null,
  message: { key: 'qc.finding.acc_metric_cited', params: { slot: 1, missing: 'denominator,threshold' } },
  provenance: { runner: 'content', runnerVersion: '0.0.0' },
};
const uploadContext = { ...context, trigger: 'upload' as const };

test('W4-06a: findingKeyOf appends the claim key only when one is given (decision 30)', () => {
  const scope = {
    kind: 'artifact' as const,
    slot: 1 as const,
    artifactId: 'art-1',
    contentHash: artifactHash,
  };
  assert.equal(findingKeyOf('ACC-METRIC-CITED', scope), `ACC-METRIC-CITED:artifact:1:art-1:${artifactHash}`);
  assert.equal(
    findingKeyOf('ACC-METRIC-CITED', scope, 'abc_1'),
    `ACC-METRIC-CITED:artifact:1:art-1:${artifactHash}:abc_1`,
  );
  // Every metadata key is unchanged.
  assert.equal(
    findingKeyOf('PACK-SLOT-MISSING', { kind: 'slot', slot: 7 }, undefined),
    'PACK-SLOT-MISSING:slot:7',
  );
});

test('W4-06a: a finding with a claim key validates; the key must be checked with its claim part and match the pattern', () => {
  assert.equal(validateQcFinding(artifactFinding, uploadContext), null);
  // The key without the claim part no longer matches.
  assert.equal(
    validateQcFinding(
      { ...artifactFinding, findingKey: findingKeyOf(artifactFinding.ruleId, artifactFinding.scope) },
      uploadContext,
    ),
    'finding_key_mismatch',
  );
  for (const claimKey of ['', 'ABC', 'has space', 'x'.repeat(65), 'naïve'])
    assert.equal(
      validateQcFinding(
        {
          ...artifactFinding,
          claimKey,
          findingKey: findingKeyOf(artifactFinding.ruleId, artifactFinding.scope, claimKey),
        },
        uploadContext,
      ),
      'schema_violation',
      JSON.stringify(claimKey),
    );
});

test('W4-06a: message_param_text allows keys, key lists, item references, decimals, numbers and the template only', () => {
  const withParams = (params: Record<string, string | number>) =>
    validateQcFinding({ ...artifactFinding, message: { ...artifactFinding.message, params } }, uploadContext);
  for (const value of [
    'denominator',
    'extraction_accuracy',
    'a',
    'k'.repeat(64),
    'denominator,threshold',
    'metric,value,denominator,threshold,evidence',
    '2',
    '2.1',
    '10.2.3.4',
    '-0.5',
    '97.25',
    '1'.repeat(18) + '.' + '2'.repeat(18),
    'v1.0 Sheet3', // exactly the request's template version (context.checklistTemplateVersion)
  ])
    assert.equal(withParams({ p: value }), null, value);
  assert.equal(withParams({ slot: 1, value: 2.4 }), null, 'numbers are always allowed');
  for (const value of [
    '',
    'The model achieved 97.5% accuracy', // document text
    'Denominator', // not lower case
    'denominator, threshold', // a space in the list
    'denominator,', // a trailing comma
    'k'.repeat(65),
    '97.5%',
    '1.2.3.4.5',
    '-1.2.3', // neither a decimal nor an item reference
    'v2.0', // another template version
    'v1.0 sheet3', // not exactly the template
    'ข้อมูล',
    'a\nb',
    Array.from({ length: 17 }, (_, i) => `k${i}`).join(','), // at most 16 keys
  ])
    assert.equal(withParams({ p: value }), 'message_param_text', JSON.stringify(value));
  // The allowance follows the request: under v2.0 the v1.0 string is document text as far as the check knows.
  assert.equal(
    validateQcFinding(
      { ...artifactFinding, message: { ...artifactFinding.message, params: { source: 'v1.0 Sheet3' } } },
      { ...uploadContext, checklistTemplateVersion: 'v2.0' },
    ),
    'message_param_text',
  );
});

test('W4-06a: evidence_outside_request runs only when the context lists the request artifacts', () => {
  const artifacts = [{ artifactId: 'art-1', contentHash: artifactHash, slot: 1 }];
  // Absent (the frozen API substitute's context literal): the check does not run.
  assert.equal(validateQcFinding(artifactFinding, uploadContext), null);
  assert.equal(validateQcFinding(artifactFinding, { ...uploadContext, artifacts }), null);
  const citing = (evidence: Partial<QcFinding['evidence'][number]>) => ({
    ...artifactFinding,
    evidence: [{ ...artifactFinding.evidence[0]!, ...evidence }],
  });
  assert.equal(
    validateQcFinding(citing({ artifactId: 'art-2' }), { ...uploadContext, artifacts }),
    'evidence_outside_request',
  );
  assert.equal(
    validateQcFinding(citing({ contentHash: 'd'.repeat(64) }), { ...uploadContext, artifacts }),
    'evidence_outside_request',
  );
  assert.equal(
    validateQcFinding(citing({ slot: 5 }), { ...uploadContext, artifacts }),
    'evidence_outside_request',
  );
  assert.equal(
    validateQcFinding(citing({ artifactId: null, contentHash: artifactHash }), {
      ...uploadContext,
      artifacts,
    }),
    'evidence_outside_request',
  );
  assert.equal(
    validateQcFinding(citing({ artifactId: 'art-2' }), { ...uploadContext, artifacts: [] }),
    'evidence_outside_request',
  );
  // A slot-level reference with no artifact is not a citation of one.
  assert.equal(validateQcFinding(finding, { ...context, artifacts: [] }), null);
});

test('W4-06a: duplicateFindingKey refuses two findings with one key in one run (decision 30)', () => {
  assert.equal(duplicateFindingKey([]), null);
  assert.equal(duplicateFindingKey([finding, artifactFinding]), null);
  assert.equal(duplicateFindingKey([finding, artifactFinding, { ...finding }]), 'duplicate_finding_key');
  const second = {
    ...artifactFinding,
    claimKey: 'fedcba9876543210',
    findingKey: findingKeyOf(artifactFinding.ruleId, artifactFinding.scope, 'fedcba9876543210'),
  };
  assert.equal(
    duplicateFindingKey([artifactFinding, second]),
    null,
    'two claims in one artifact are two keys',
  );
});
