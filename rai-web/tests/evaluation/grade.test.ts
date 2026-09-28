// W4-08a (W4b plan section 11.2 "Grading"): matching on rule, owning lane, scope and locator position; per-rule and
// per-segment counts; unavailable handling; lane scope; metadata kept; grounding; latency; failures; cost. The parts
// here are built from the labels themselves and then perturbed, so every expected count is known. Synthetic only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QcFinding } from '@rai/shared/qc/types';
import type { LabelFinding } from '@rai/fixtures/evaluation/types';
import { gradeRun, percentile } from './grade.js';
import type { PartRecord } from './harness.js';
import { loadEvalSet, type LoadedSet } from './load-set.js';

const set = loadEvalSet('dev');
const CATALOGUE = [
  { ruleId: 'PACK-SLOT-MISSING', engine: 'metadata' as const },
  { ruleId: 'PACK-STAGE-MISMATCH', engine: 'metadata' as const },
  { ruleId: 'PACK-NA-VENDOR-DOC', engine: 'metadata' as const },
  { ruleId: 'ACC-METRIC-CITED', engine: 'content' as const },
  { ruleId: 'ACC-EXTRACTION-NOT-HALLUCINATION', engine: 'content' as const },
  { ruleId: 'ACC-BAND-V1-SHEET3', engine: 'content' as const },
  { ruleId: 'ACC-CLASSIC-ML-METRIC', engine: 'content' as const },
];

function asFinding(set: LoadedSet, caseId: string, label: LabelFinding): QcFinding {
  const docs = set.cases.find((c) => c.evalCase.caseId === caseId)!.documents;
  const ref = (slot: number) => {
    const doc = docs.get(slot as never);
    return doc === undefined
      ? { artifactId: null, contentHash: null }
      : { artifactId: `art-${doc.documentId}`, contentHash: doc.sha256 };
  };
  const scope =
    label.scope.kind === 'artifact'
      ? {
          kind: 'artifact' as const,
          slot: label.scope.slot,
          ...(ref(label.scope.slot) as { artifactId: string; contentHash: string }),
        }
      : label.scope;
  return {
    findingKey: `${label.ruleId}:${JSON.stringify(label.scope)}:${JSON.stringify(label.evidence)}`,
    ruleId: label.ruleId,
    ruleRevision: 'rev',
    trigger: 'submit',
    scope,
    severity: 'high',
    owningLane: label.owningLane,
    evidence: label.evidence.map((e) => ({ ...ref(e.slot), slot: e.slot, locator: e.locator })),
    measure: null,
    message: { key: 'qc.finding.synthetic', params: {} },
    provenance: { runner: 'test', runnerVersion: '0' },
  };
}

/** Parts that reproduce every label exactly (both parts of every labelled run), with latency `i + 1` ms. */
function perfectParts(): PartRecord[] {
  const out: PartRecord[] = [];
  for (const c of set.cases)
    for (const run of c.labels.runs)
      for (const part of ['deterministic', 'content'] as const) {
        const expected = run.parts[part];
        out.push({
          caseId: c.evalCase.caseId,
          trigger: run.trigger,
          lane: run.lane,
          slot: run.trigger === 'upload' ? run.slot : null,
          part,
          expected,
          runner: part,
          runnerVersion: '0',
          status: expected.status,
          reason: expected.status === 'unavailable' ? expected.unavailableReason : null,
          detail: null,
          findings: expected.findings.map((f) => asFinding(set, c.evalCase.caseId, f)),
          latencyMs: out.length + 1,
          engine: null,
          citations: [],
        });
      }
  return out;
}

const labelledRules = () => {
  const count = new Map<string, number>();
  for (const c of set.cases)
    for (const run of c.labels.runs)
      for (const part of Object.values(run.parts))
        for (const f of part.findings) count.set(f.ruleId, (count.get(f.ruleId) ?? 0) + 1);
  return count;
};

test('parts that reproduce the labels grade perfectly on every rule, part and segment', () => {
  const parts = perfectParts();
  const grade = gradeRun(set, parts, CATALOGUE);
  const labelled = labelledRules();
  for (const rule of grade.rules) {
    const n = labelled.get(rule.ruleId) ?? 0;
    assert.equal(rule.tp, n, rule.ruleId);
    assert.equal(rule.fp, 0, rule.ruleId);
    assert.equal(rule.fn, 0, rule.ruleId);
    assert.equal(rule.precision, n === 0 ? null : 1, rule.ruleId);
    assert.equal(rule.recall, n === 0 ? null : 1, rule.ruleId);
  }
  // Every catalogue rule and every labelled rule is listed; a labelled rule outside the catalogue says so.
  assert.deepEqual(
    grade.rules.map((r) => r.ruleId).sort(),
    [...new Set([...CATALOGUE.map((r) => r.ruleId), ...labelled.keys()])].sort(),
  );
  const contradiction = grade.rules.find((r) => r.ruleId === 'PACK-CONTRADICTION');
  assert.ok(contradiction, 'the dev labels carry PACK-CONTRADICTION');
  assert.equal(contradiction.inCatalogue, false);
  assert.equal(contradiction.engine, 'content'); // labelled in the content part
  assert.equal(grade.rules.find((r) => r.ruleId === 'ACC-METRIC-CITED')!.engine, 'content');
  assert.equal(grade.rules.find((r) => r.ruleId === 'PACK-SLOT-MISSING')!.engine, 'metadata');
  assert.equal(grade.parts.total, parts.length);
  assert.equal(grade.parts.statusMatched, parts.length);
  assert.equal(grade.parts.accuracy, 1);
  assert.ok(grade.parts.expectedUnavailable > 0);
  assert.equal(grade.parts.unavailableMatched, grade.parts.expectedUnavailable);
  assert.deepEqual(grade.parts.mismatches, []);
  assert.deepEqual(grade.findings.mismatches, []);
  for (const dimension of ['template', 'modelType', 'language', 'format'] as const) {
    const rows = grade.segments[dimension];
    assert.ok(rows.length > 0, dimension);
    assert.equal(
      rows.reduce((n, r) => n + r.tp, 0),
      [...labelled.values()].reduce((a, b) => a + b, 0),
      dimension,
    );
    for (const r of rows) assert.equal(r.fp + r.fn, 0, `${dimension} ${r.value}`);
  }
  assert.deepEqual(
    grade.segments.template.map((r) => r.value),
    ['v1.0 Sheet3', 'v2.0'],
  );
  assert.ok(
    grade.segments.format.some((r) => r.value === 'none'),
    'absent-slot findings cite no document',
  );
  assert.ok(grade.segments.format.some((r) => r.value === 'docx'));
  assert.equal(grade.metadataKept.recorded, grade.metadataKept.labelled);
  assert.ok(grade.metadataKept.labelled > 0, 'the unreadable-slot cases carry metadata labels');
  assert.equal(grade.laneScope.foreignLaneFindings, 0);
  assert.equal(grade.laneScope.approveContentPartsMatched, grade.laneScope.approveContentParts);
  assert.equal(grade.failures.count, 0);
  assert.deepEqual(grade.cost, { usdMicros: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0 });
});

test('an extra, a missing and a misplaced finding are counted on their rule and segment, by identity only', () => {
  const parts = perfectParts();
  // ev-dev-19 AI/COE attempt: PACK-SLOT-MISSING slot 5 labelled. Drop it (FN) and raise one on slot 7 (FP).
  const target = parts.find(
    (p) =>
      p.caseId === 'ev-dev-19' &&
      p.trigger === 'approve_attempt' &&
      p.lane === 'ai_coe' &&
      p.part === 'deterministic',
  )!;
  assert.equal(target.findings.length, 1);
  const missed = target.findings[0]!;
  target.findings = [
    { ...missed, scope: { kind: 'slot', slot: 7 }, evidence: [{ ...missed.evidence[0]!, slot: 7 }] },
  ];
  // A content finding with the right rule and slot but another locator is one FP and one FN.
  const content = parts.find(
    (p) => p.part === 'content' && p.findings.some((f) => f.evidence[0]?.locator.kind !== 'absent'),
  )!;
  const moved = content.findings[0]!;
  const locator = moved.evidence[0]!.locator;
  content.findings = [
    {
      ...moved,
      evidence: [
        {
          ...moved.evidence[0]!,
          locator:
            locator.kind === 'section'
              ? { kind: 'section', index: (locator.index ?? 0) + 100 }
              : locator.kind === 'page'
                ? { kind: 'page', page: locator.page + 100 }
                : { kind: 'cell', sheetIndex: 9, cell: 'Z99' },
        },
      ],
    },
    ...content.findings.slice(1),
  ];
  const grade = gradeRun(set, parts, CATALOGUE);
  const slotMissing = grade.rules.find((r) => r.ruleId === 'PACK-SLOT-MISSING')!;
  assert.equal(slotMissing.fp, 1);
  assert.equal(slotMissing.fn, 1);
  assert.equal(slotMissing.tp, (labelledRules().get('PACK-SLOT-MISSING') ?? 0) - 1);
  assert.ok(slotMissing.precision! < 1 && slotMissing.recall! < 1);
  const movedRule = grade.rules.find((r) => r.ruleId === moved.ruleId)!;
  assert.equal(movedRule.fp, 1);
  assert.equal(movedRule.fn, 1);
  assert.equal(grade.findings.mismatches.length, 4);
  const fp = grade.findings.mismatches.find((m) => m.kind === 'fp' && m.ruleId === 'PACK-SLOT-MISSING')!;
  assert.deepEqual(fp, {
    kind: 'fp',
    caseId: 'ev-dev-19',
    trigger: 'approve_attempt',
    lane: 'ai_coe',
    slot: null,
    part: 'deterministic',
    ruleId: 'PACK-SLOT-MISSING',
    owningLane: 'ai_coe',
    scope: { kind: 'slot', slot: 7 },
    evidence: [{ slot: 7, locator: { kind: 'absent' } }],
  });
  // Slot 5 of ev-dev-19 is missing, so its FN cites no document; every segment dimension counts each mismatch once.
  assert.ok(grade.segments.format.find((r) => r.value === 'none')!.fn >= 1);
  for (const dimension of ['template', 'modelType', 'language', 'format'] as const) {
    assert.equal(
      grade.segments[dimension].reduce((n, r) => n + r.fp, 0),
      2,
      dimension,
    );
    assert.equal(
      grade.segments[dimension].reduce((n, r) => n + r.fn, 0),
      2,
      dimension,
    );
  }
});

test('a part whose status or reason differs from its label is an unavailable-handling mismatch; its labels are missed', () => {
  const parts = perfectParts();
  const unreadable = parts.find((p) => p.expected.status === 'unavailable')!;
  unreadable.status = 'completed';
  unreadable.reason = null;
  const wrongReason = parts.filter((p) => p.expected.status === 'unavailable')[1]!;
  wrongReason.reason = 'timeout';
  const labelledMetadata = parts.find(
    (p) => p.part === 'deterministic' && p.expected.status === 'completed' && p.expected.findings.length > 0,
  )!;
  labelledMetadata.status = 'unavailable';
  labelledMetadata.reason = 'runner_error';
  labelledMetadata.detail = 'invalid_rule_params';
  labelledMetadata.findings = [];
  const grade = gradeRun(set, parts, CATALOGUE);
  assert.equal(grade.parts.statusMatched, parts.length - 3);
  assert.equal(grade.parts.unavailableMatched, grade.parts.expectedUnavailable - 2);
  assert.equal(grade.parts.mismatches.length, 3);
  assert.deepEqual(
    grade.parts.mismatches.find((m) => m.caseId === labelledMetadata.caseId && m.part === 'deterministic'),
    {
      caseId: labelledMetadata.caseId,
      trigger: labelledMetadata.trigger,
      lane: labelledMetadata.lane,
      slot: labelledMetadata.slot,
      part: 'deterministic',
      expected: { status: 'completed', reason: null },
      actual: { status: 'unavailable', reason: 'runner_error', detail: 'invalid_rule_params' },
    },
  );
  const fn = grade.rules.reduce((n, r) => n + r.fn, 0);
  assert.equal(fn, labelledMetadata.expected.findings.length);
  assert.equal(grade.failures.count, 2);
  assert.deepEqual(grade.failures.byReason, { runner_error: 1, timeout: 1 });
});

test('lane scope counts a content finding on an approve attempt owned by another lane', () => {
  const parts = perfectParts();
  const approve = parts.find(
    (p) => p.trigger === 'approve_attempt' && p.part === 'content' && p.findings.length > 0,
  )!;
  approve.findings = approve.findings.map((f, i) =>
    i === 0 ? { ...f, owningLane: approve.lane === 'dpo' ? 'ai_coe' : 'dpo' } : f,
  );
  const grade = gradeRun(set, parts, CATALOGUE);
  assert.equal(grade.laneScope.foreignLaneFindings, 1);
});

test('grounding, latency and cost aggregate what the parts carry', () => {
  const parts = perfectParts();
  const [a, b] = parts.filter((p) => p.part === 'content' && p.findings.length > 0);
  a!.citations = [
    { ruleId: 'ACC-METRIC-CITED', slot: 1, locatorKind: 'section', grounded: true, problem: null },
    {
      ruleId: 'ACC-METRIC-CITED',
      slot: 1,
      locatorKind: 'section',
      grounded: false,
      problem: 'excerpt_hash_mismatch',
    },
  ];
  b!.citations = [
    { ruleId: 'ACC-BAND-V1-SHEET3', slot: 1, locatorKind: 'page', grounded: true, problem: null },
  ];
  a!.engine = {
    model: {
      provider: 'local-fake',
      modelId: 'm',
      promptRevision: 'p',
      inputTokens: 5,
      outputTokens: 7,
      latencyMs: 1,
      costUsdMicros: 3,
    },
  };
  const grade = gradeRun(set, parts, CATALOGUE);
  assert.equal(grade.grounding.citations, 3);
  assert.equal(grade.grounding.grounded, 2);
  assert.equal(grade.grounding.rate, 2 / 3);
  assert.deepEqual(
    grade.grounding.byRule.map((r) => [r.ruleId, r.citations, r.grounded]),
    [
      ['ACC-BAND-V1-SHEET3', 1, 1],
      ['ACC-METRIC-CITED', 2, 1],
    ],
  );
  assert.equal(grade.grounding.failures.length, 1);
  assert.equal(grade.grounding.failures[0]!.problem, 'excerpt_hash_mismatch');
  assert.equal(grade.grounding.failures[0]!.caseId, a!.caseId);
  assert.deepEqual(grade.cost, { usdMicros: 3, modelCalls: 1, inputTokens: 5, outputTokens: 7 });
  const n = parts.length;
  assert.deepEqual(grade.latency.overall, {
    count: n,
    p50: percentile(
      parts.map((p) => p.latencyMs),
      0.5,
    ),
    p95: percentile(
      parts.map((p) => p.latencyMs),
      0.95,
    ),
    max: n,
  });
  assert.equal(grade.latency.deterministic.count + grade.latency.content.count, n);
  // No citation at all: the rate is undefined, never 1.
  assert.equal(gradeRun(set, perfectParts(), CATALOGUE).grounding.rate, null);
});

test('percentile is nearest-rank', () => {
  const values = Array.from({ length: 20 }, (_, i) => 20 - i);
  assert.equal(percentile(values, 0.5), 10);
  assert.equal(percentile(values, 0.95), 19);
  assert.equal(percentile(values, 1), 20);
  assert.equal(percentile([7], 0.5), 7);
  assert.equal(percentile([], 0.5), null);
});
