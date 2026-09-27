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
  findingKeyOf,
  scopeKeyOf,
  validateQcFinding,
} from './validate.js';

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
