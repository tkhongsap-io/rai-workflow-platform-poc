// W4-08a (W4b plan section 11.2): the pure part of the orchestrator's request builder, moved out of `orchestrator.ts`
// so the evaluation harness builds each `QcRunRequest` exactly as the product does. Synthetic rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import type { SelectedRule } from '@rai/shared/qc/types';
import { requestOf, runKeyOf, type RequestSlotRead } from './request.js';

const CASE_ID = '00000000-0000-7000-8000-00000000ca5e';
const VERSION_ID = '00000000-0000-7000-8000-000000000001';
const REVISION = '0192a0de-0000-7000-8000-00000000c0de';
const artifactIdOf = (slot: number) => `00000000-0000-7000-8000-${String(slot).padStart(12, '0')}`;
const hashOf = (slot: number) => slot.toString(16).padStart(64, 'a');
const RULES: SelectedRule[] = [{ ruleId: 'PACK-SLOT-MISSING', engine: 'metadata', severity: 'high' }];

function slotRead(): RequestSlotRead {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => ({
    slot,
    state: slot === 4 ? 'not_applicable' : slot === 7 ? 'missing' : 'attached',
    reason: slot === 4 ? 'synthetic reason' : null,
    artifactId: slot === 4 || slot === 7 ? null : artifactIdOf(slot),
  }));
  const artifacts = new Map(
    rows
      .filter((r) => r.artifactId !== null)
      .map((r) => [
        r.artifactId!,
        {
          artifactId: r.artifactId!,
          sha256: hashOf(r.slot),
          mediaType: 'application/pdf' as const,
          filename: `synthetic-${r.slot}.pdf`,
          sizeBytes: 100 + r.slot,
        },
      ]),
  );
  // Slot 8's artifact row is absent: the builder leaves it out of `artifacts` but keeps the slot row.
  artifacts.delete(artifactIdOf(8));
  return { rows, artifacts };
}

const caseRow = { modelType: 'llm', vendorInvolved: true };
const submitted = {
  id: VERSION_ID,
  caseId: CASE_ID,
  versionNumber: 2,
  submittedAt: new Date('2026-09-27T05:00:00Z'),
  laneMappingVersion: CURRENT_LANE_MAPPING.version,
  checklistTemplateVersion: 'v1.0 Sheet3',
  stageContext: 'pre_launch',
};

test('requestOf builds a submit request over all nine slots and the artifacts with rows', () => {
  const request = requestOf(slotRead(), caseRow, submitted, 'submit', null, 'corr-1', 1234, REVISION, RULES, {
    status: 'proposed',
    tier: 'unknown',
  });
  assert.equal(request.trigger, 'submit');
  assert.equal(request.lane, null);
  assert.equal(request.correlationId, 'corr-1');
  assert.equal(request.deadlineMs, 1234);
  assert.equal(request.qcRulesRevision, REVISION);
  assert.deepEqual(request.rules, RULES);
  assert.deepEqual(request.riskProposal, { status: 'proposed', tier: 'unknown' }); // W5-10: passed through as given
  assert.deepEqual(request.version, {
    caseId: CASE_ID,
    versionId: VERSION_ID,
    versionNumber: 2,
    isDraft: false,
  });
  assert.equal(request.checklistTemplateVersion, 'v1.0 Sheet3');
  assert.equal(request.laneMappingVersion, CURRENT_LANE_MAPPING.version);
  assert.equal(request.stageContext, 'pre_launch');
  assert.equal(request.modelType, 'llm');
  assert.equal(request.vendorInvolved, true);
  assert.deepEqual(
    request.slots.map((s) => [s.slot, s.disposition, s.reason, s.artifactId]),
    [
      [1, 'attached', null, artifactIdOf(1)],
      [2, 'attached', null, artifactIdOf(2)],
      [3, 'attached', null, artifactIdOf(3)],
      [4, 'not_applicable', 'synthetic reason', null],
      [5, 'attached', null, artifactIdOf(5)],
      [6, 'attached', null, artifactIdOf(6)],
      [7, 'missing', null, null],
      [8, 'attached', null, artifactIdOf(8)],
      [9, 'attached', null, artifactIdOf(9)],
    ],
  );
  assert.deepEqual(
    request.artifacts.map((a) => [
      a.slot,
      a.artifactId,
      a.contentHash,
      a.mediaType,
      a.filename,
      a.byteLength,
    ]),
    [1, 2, 3, 5, 6, 9].map((slot) => [
      slot,
      artifactIdOf(slot),
      hashOf(slot),
      'application/pdf',
      `synthetic-${slot}.pdf`,
      100 + slot,
    ]),
  );
  assert.equal(
    request.runKey,
    runKeyOf(
      VERSION_ID,
      'submit',
      null,
      REVISION,
      request.artifacts.map((a) => ({ slot: a.slot, contentHash: a.contentHash })),
    ),
  );
});

test('requestOf: the read handle of a built request streams nothing (W4-05a binds real bytes)', async () => {
  const request = requestOf(slotRead(), caseRow, submitted, 'submit', null, 'c', 1, REVISION, RULES, null);
  const reader = (await request.artifacts[0]!.read()).getReader();
  const first = await Promise.race([
    reader.read(),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20)),
  ]);
  assert.equal(first, 'pending');
  await reader.cancel();
});

test('requestOf carries the lane on an approve attempt and one slot on an upload', () => {
  const approve = requestOf(
    slotRead(),
    caseRow,
    submitted,
    'approve_attempt',
    'dpo',
    'c',
    1,
    REVISION,
    RULES,
    null,
  );
  assert.equal(approve.lane, 'dpo');
  assert.equal(approve.riskProposal, null);
  assert.equal(approve.slots.length, 9);
  const draft = { ...submitted, submittedAt: null, laneMappingVersion: null };
  const upload = requestOf(slotRead(), caseRow, draft, 'upload', null, 'c', 1, REVISION, RULES, null, 5);
  assert.deepEqual(
    upload.slots.map((s) => s.slot),
    [5],
  );
  assert.deepEqual(
    upload.artifacts.map((a) => a.slot),
    [5],
  );
  assert.equal(upload.version.isDraft, true);
  // A draft has no mapping frozen yet: the current constant (W4a plan section 5).
  assert.equal(upload.laneMappingVersion, CURRENT_LANE_MAPPING.version);
  assert.equal(
    upload.runKey,
    runKeyOf(VERSION_ID, 'upload', null, REVISION, [{ slot: 5, contentHash: hashOf(5) }]),
  );
});

test('requestOf refuses a submitted version without a lane mapping version', () => {
  assert.throws(
    () =>
      requestOf(
        slotRead(),
        caseRow,
        { ...submitted, laneMappingVersion: null },
        'submit',
        null,
        'c',
        1,
        REVISION,
        RULES,
        null,
      ),
    /submitted version has no lane_mapping_version/,
  );
});

test('runKeyOf ignores artifact order and changes with every input', () => {
  const a = [
    { slot: 1, contentHash: hashOf(1) },
    { slot: 5, contentHash: hashOf(5) },
  ];
  const base = runKeyOf(VERSION_ID, 'approve_attempt', 'ai_coe', REVISION, a);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(runKeyOf(VERSION_ID, 'approve_attempt', 'ai_coe', REVISION, [...a].reverse()), base);
  const variants = [
    runKeyOf(artifactIdOf(99), 'approve_attempt', 'ai_coe', REVISION, a),
    runKeyOf(VERSION_ID, 'submit', null, REVISION, a),
    runKeyOf(VERSION_ID, 'approve_attempt', 'dpo', REVISION, a),
    runKeyOf(VERSION_ID, 'approve_attempt', 'ai_coe', artifactIdOf(1), a),
    runKeyOf(VERSION_ID, 'approve_attempt', 'ai_coe', REVISION, [a[0]!]),
    runKeyOf(VERSION_ID, 'approve_attempt', 'ai_coe', REVISION, [a[0]!, { slot: 5, contentHash: hashOf(6) }]),
  ];
  for (const v of variants) assert.notEqual(v, base);
  assert.equal(new Set(variants).size, variants.length);
});
