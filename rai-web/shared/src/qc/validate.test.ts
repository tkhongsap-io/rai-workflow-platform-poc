// W0-07 section 3.4 steps 4 and 5 as a pure function: the violation names, scope keys and the result schema.
// The scripted substitute's colocated tests (fixtures/src/substitutes/qc/scripts.test.ts) exercise every named
// violation against materialised findings; this file pins the contract pieces the orchestrator (W2-05) relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { LANE_MAPPING_V1 } from '../constants.js';
import type { QcFinding, QcRunResult } from './types.js';
import {
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

test('step 5: owning lane per W0-06 7.1; slot 5, slot 9 and pack are rule_pending until 7.3 is recorded', () => {
  assert.equal(checkOwningLane(finding, LANE_MAPPING_V1), null);
  assert.equal(checkOwningLane({ ...finding, owningLane: 'dpo' }, LANE_MAPPING_V1), 'owning_lane_mismatch');
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'slot', slot: 5 } }, LANE_MAPPING_V1),
    'owning_lane_rule_pending',
  );
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'slot', slot: 9 } }, LANE_MAPPING_V1),
    'owning_lane_rule_pending',
  );
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'pack' } }, LANE_MAPPING_V1),
    'owning_lane_rule_pending',
  );
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
