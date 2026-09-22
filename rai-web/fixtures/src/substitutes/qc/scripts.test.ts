// W0-07 section 3.9 rows "schema conformance" and "owning lane follows W0-06 7.1 only", plus the W0-06 7.4 posture:
// every bundled script finding passes the shared validator once materialised; a finding carrying document text or a
// malformed excerptHash fails; every script finding sits on a single-lane slot with the mapped owning lane; a script
// with a slot-5, slot-9, pack-level, run-scoped or QC-UNAVAILABLE finding throws at construction; the reserved
// W0-07 3.5 rule ids are absent; message keys are locale keys in both catalogues (D12).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LANE_MAPPINGS_BY_VERSION, owningLaneForSlot } from '@rai/shared/constants';
import { LOCALE_CATALOGUES, isLocaleKey } from '@rai/shared/locales/keys';
import type { QcFinding } from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import { ScriptedQcRunner, materializeFindings } from './scripted-runner.js';
import { BUNDLED_QC_SCRIPTS, QcScriptError, RAW_BUNDLED_QC_SCRIPTS, validateScript } from './scripts.js';
import { buildRequest } from './test-support.js';

const SCRIPTED_RULE_IDS = [
  'PACK-SLOT-MISSING',
  'ACC-METRIC-CITED',
  'ACC-EXTRACTION-NOT-HALLUCINATION',
  'ACC-BAND-V1-SHEET3',
  'ACC-CLASSIC-ML-METRIC',
];
const RESERVED_RULE_IDS = ['PACK-STAGE-MISMATCH', 'PACK-CONTRADICTION', 'QC-UNAVAILABLE']; // W0-07 3.5, W0-06 7.3

function baseScript(finding: Record<string, unknown>): Record<string, unknown> {
  return {
    fixtureCaseId: 'fx-case-test',
    laneMappingVersion: 'lane-mapping/v1',
    checklistTemplateVersion: 'v1.0 Sheet3',
    entries: [{ trigger: 'submit', findings: [finding] }],
  };
}

const goodSlotFinding = {
  ruleId: 'PACK-SLOT-MISSING',
  scope: { kind: 'slot', slot: 7 },
  severity: 'medium',
  owningLane: 'it_security',
  evidence: [{ slot: 7, locator: { kind: 'absent' } }],
  measure: null,
  message: { key: 'qc.finding.pack_slot_missing', params: { slot: 7 } },
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof QcScriptError) return err.code;
    throw err;
  }
  throw new Error('expected a QcScriptError');
}

test('every JSON file in scripts/ is bundled, and every bundled script is one of the W0-08 fixture cases', () => {
  const dir = fileURLToPath(new URL('./scripts/', import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  assert.deepEqual(files, [
    'fx-case-missing-slot.json',
    'fx-case-na-reasons.json',
    'fx-case-nonvendor.json',
    'fx-case-vendor.json',
  ]);
  assert.deepEqual(
    BUNDLED_QC_SCRIPTS.map((s) => s.fixtureCaseId).sort(),
    files.map((f) => f.replace(/\.json$/, '')),
  );
  assert.equal(RAW_BUNDLED_QC_SCRIPTS.length, files.length);
  for (const script of BUNDLED_QC_SCRIPTS) assert.ok(Object.isFrozen(script));
});

test('schema conformance: every materialised bundled finding passes the shared validator and the owning-lane check', async () => {
  const runner = new ScriptedQcRunner();
  let checked = 0;
  for (const script of BUNDLED_QC_SCRIPTS) {
    const mapping = LANE_MAPPINGS_BY_VERSION[script.laneMappingVersion]!;
    for (const entry of script.entries) {
      const built = buildRequest(script.fixtureCaseId, {
        trigger: entry.trigger,
        ...(entry.lane === undefined ? {} : { lane: entry.lane }),
        uploadSlot: 1,
      });
      const result = await runner.run(built.request, new AbortController().signal);
      assert.equal(result.status, 'completed');
      if (result.status !== 'completed') return;
      // For `upload` the run is scoped to one slot; every entry's findings are on slot 1 in the bundled scripts.
      assert.equal(result.findings.length, entry.findings.length, `${script.fixtureCaseId}/${entry.trigger}`);
      for (const finding of result.findings) {
        assert.equal(validateQcFinding(finding, built.request), null, finding.findingKey);
        assert.equal(checkOwningLane(finding, mapping), null, finding.findingKey);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 6, `checked ${checked} findings`);
});

test('a finding carrying an excerpt (document text) or a malformed excerptHash fails the shared validator', () => {
  const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe' });
  const runner = new ScriptedQcRunner();
  const script = BUNDLED_QC_SCRIPTS.find((s) => s.fixtureCaseId === 'fx-case-vendor')!;
  const entry = script.entries.find((e) => e.trigger === 'approve_attempt')!;
  const [finding] = materializeFindings(entry, request, runner.identity) as [QcFinding];
  assert.equal(validateQcFinding(finding, request), null);

  const withExcerpt = structuredClone(finding) as QcFinding & { evidence: Record<string, unknown>[] };
  withExcerpt.evidence[0]!['excerpt'] = 'The model achieved 97.5% accuracy';
  assert.equal(validateQcFinding(withExcerpt, request), 'document_text_field');

  const withText = structuredClone(finding) as QcFinding & { evidence: Record<string, unknown>[] };
  withText.evidence[0]!['text'] = 'any document text';
  assert.equal(validateQcFinding(withText, request), 'document_text_field');

  const badHash = structuredClone(finding);
  badHash.evidence[0]!.excerptHash = 'ABCDEF'; // not 64 lowercase hex
  assert.equal(validateQcFinding(badHash, request), 'excerpt_hash_invalid');

  const upperHash = structuredClone(finding);
  upperHash.evidence[0]!.excerptHash = 'A'.repeat(64);
  assert.equal(validateQcFinding(upperHash, request), 'excerpt_hash_invalid');

  const noEvidence = structuredClone(finding);
  noEvidence.evidence = [];
  assert.equal(validateQcFinding(noEvidence, request), 'evidence_missing');

  const unknownField = structuredClone(finding) as QcFinding & Record<string, unknown>;
  unknownField['approved'] = true;
  assert.equal(validateQcFinding(unknownField, request), 'unknown_field');

  const otherRevision = structuredClone(finding);
  otherRevision.ruleRevision = 'cfg-rev-9999';
  assert.equal(validateQcFinding(otherRevision, request), 'rule_revision_mismatch');

  const otherTemplate = structuredClone(finding);
  otherTemplate.measure!.thresholdSource = 'v1.0 Sheet3';
  assert.equal(validateQcFinding(otherTemplate, request), 'threshold_source_mismatch');

  const runScoped = structuredClone(finding);
  runScoped.scope = { kind: 'run', trigger: 'approve_attempt', lane: 'ai_coe' };
  runScoped.findingKey = 'ACC-METRIC-CITED:run:approve_attempt:ai_coe';
  assert.equal(validateQcFinding(runScoped, request), 'run_scope_forbidden');

  const unavailableRule = structuredClone(finding);
  unavailableRule.ruleId = 'QC-UNAVAILABLE';
  unavailableRule.findingKey = unavailableRule.findingKey.replace('ACC-METRIC-CITED', 'QC-UNAVAILABLE');
  assert.equal(validateQcFinding(unavailableRule, request), 'qc_unavailable_rule_forbidden');

  const wrongLane = structuredClone(finding);
  wrongLane.owningLane = 'dpo';
  assert.equal(validateQcFinding(wrongLane, request), null, 'step 4 passes; step 5 catches it');
  assert.equal(
    checkOwningLane(wrongLane, LANE_MAPPINGS_BY_VERSION['lane-mapping/v1']!),
    'owning_lane_mismatch',
  );
});

test('owning lane follows W0-06 7.1 only: every script finding is on a single-lane slot with the mapped lane', () => {
  let count = 0;
  for (const script of BUNDLED_QC_SCRIPTS) {
    const mapping = LANE_MAPPINGS_BY_VERSION[script.laneMappingVersion]!;
    for (const entry of script.entries) {
      for (const finding of entry.findings) {
        count += 1;
        assert.ok(finding.scope.kind === 'artifact' || finding.scope.kind === 'slot');
        assert.ok(
          [1, 2, 3, 4, 6, 7, 8].includes(finding.scope.slot),
          `slot ${finding.scope.slot} is single-lane`,
        );
        assert.equal(finding.owningLane, owningLaneForSlot(finding.scope.slot, mapping));
        if (entry.trigger === 'approve_attempt') assert.equal(finding.owningLane, entry.lane);
        assert.ok(SCRIPTED_RULE_IDS.includes(finding.ruleId), finding.ruleId);
        assert.ok(
          !RESERVED_RULE_IDS.includes(finding.ruleId),
          `${finding.ruleId} is reserved until W0-06 7.3`,
        );
        for (const evidence of finding.evidence) assert.ok(!('excerpt' in evidence));
      }
    }
  }
  assert.ok(count >= 6);
  // The five scripted families of W0-07 3.5 all appear with the severities that section states.
  const all = BUNDLED_QC_SCRIPTS.flatMap((s) => s.entries.flatMap((e) => e.findings));
  for (const ruleId of SCRIPTED_RULE_IDS)
    assert.ok(
      all.some((f) => f.ruleId === ruleId),
      `${ruleId} scripted`,
    );
  for (const f of all) {
    const expected = ['ACC-BAND-V1-SHEET3', 'ACC-EXTRACTION-NOT-HALLUCINATION'].includes(f.ruleId)
      ? 'high'
      : 'medium';
    assert.equal(f.severity, expected, f.ruleId);
  }
});

test('the substitute throws at construction on slot 5, slot 9, pack, run scope, QC-UNAVAILABLE or a wrong lane', () => {
  const slot5 = { ...goodSlotFinding, scope: { kind: 'slot', slot: 5 }, owningLane: 'ai_coe' };
  assert.equal(
    codeOf(() => validateScript(baseScript(slot5))),
    'scope_slot_5_pending_w0_06_7_3',
  );
  const slot9 = { ...goodSlotFinding, scope: { kind: 'slot', slot: 9 }, owningLane: 'ai_coe' };
  assert.equal(
    codeOf(() => validateScript(baseScript(slot9))),
    'scope_slot_9_pending_w0_06_7_3',
  );
  const pack = { ...goodSlotFinding, scope: { kind: 'pack' }, owningLane: 'ai_coe' };
  assert.equal(
    codeOf(() => validateScript(baseScript(pack))),
    'scope_pack_forbidden',
  );
  const run = { ...goodSlotFinding, scope: { kind: 'run', trigger: 'submit', lane: null } };
  assert.equal(
    codeOf(() => validateScript(baseScript(run))),
    'scope_run_forbidden',
  );
  const unavailable = { ...goodSlotFinding, ruleId: 'QC-UNAVAILABLE' };
  assert.equal(
    codeOf(() => validateScript(baseScript(unavailable))),
    'qc_unavailable_rule_forbidden',
  );
  const wrongLane = { ...goodSlotFinding, owningLane: 'dpo' };
  assert.equal(
    codeOf(() => validateScript(baseScript(wrongLane))),
    'owning_lane_mismatch',
  );
  const excerpt = {
    ...goodSlotFinding,
    evidence: [{ slot: 7, locator: { kind: 'absent' }, excerpt: 'text' }],
  };
  assert.equal(
    codeOf(() => validateScript(baseScript(excerpt))),
    'document_text_field',
  );
  const badHash = {
    ...goodSlotFinding,
    evidence: [{ slot: 7, locator: { kind: 'absent' }, excerptHash: 'zz' }],
  };
  assert.equal(
    codeOf(() => validateScript(baseScript(badHash))),
    'excerpt_hash_invalid',
  );
  const noKey = { ...goodSlotFinding, message: { key: 'qc.finding.does_not_exist', params: {} } };
  assert.equal(
    codeOf(() => validateScript(baseScript(noKey))),
    'message_key_not_locale_key',
  );
  const wrongTemplate = {
    ...goodSlotFinding,
    measure: {
      metric: 'x',
      value: null,
      denominator: null,
      threshold: null,
      unit: 'count',
      thresholdSource: 'v2.0',
    },
  };
  assert.equal(
    codeOf(() => validateScript(baseScript(wrongTemplate))),
    'threshold_source_mismatch',
  );
  const outsideLane = baseScript(goodSlotFinding);
  (outsideLane['entries'] as Record<string, unknown>[])[0] = {
    trigger: 'approve_attempt',
    lane: 'dpo',
    findings: [goodSlotFinding],
  };
  assert.equal(
    codeOf(() => validateScript(outsideLane)),
    'finding_outside_lane',
  );
  const laneOnSubmit = baseScript(goodSlotFinding);
  (laneOnSubmit['entries'] as Record<string, unknown>[])[0] = {
    trigger: 'submit',
    lane: 'dpo',
    findings: [],
  };
  assert.equal(
    codeOf(() => validateScript(laneOnSubmit)),
    'lane_only_for_approve_attempt',
  );
  const badCase = { ...baseScript(goodSlotFinding), fixtureCaseId: 'RAI-2000-0001' };
  assert.equal(
    codeOf(() => validateScript(badCase)),
    'fixture_case_id_invalid',
  );
  // The good finding itself validates and comes back frozen.
  const ok = validateScript(baseScript(goodSlotFinding));
  assert.equal(ok.entries[0]!.findings.length, 1);
  assert.ok(Object.isFrozen(ok.entries[0]!.findings[0]));
  assert.throws(
    () => new ScriptedQcRunner({ scripts: [ok, ok] }),
    (e: QcScriptError) => e.code === 'duplicate_entry',
  );
});

test('every script message key exists in both locale catalogues with a Thai default (D12)', () => {
  const keys = new Set(
    BUNDLED_QC_SCRIPTS.flatMap((s) => s.entries.flatMap((e) => e.findings.map((f) => f.message.key))),
  );
  assert.ok(keys.size >= 5);
  for (const key of keys) {
    assert.ok(isLocaleKey(key), key);
    if (!isLocaleKey(key)) continue;
    assert.ok(LOCALE_CATALOGUES.th[key].length > 0 && LOCALE_CATALOGUES.en[key].length > 0, key);
    assert.match(LOCALE_CATALOGUES.th[key], /[฀-๿]/, `${key} has Thai text`);
  }
  // The orchestrator's own finding key (W0-07 3.6) is also in the catalogues, ready for W2-05.
  assert.ok(isLocaleKey('qc.finding.unavailable'));
});
