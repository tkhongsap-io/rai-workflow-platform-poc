// W4-09a: the provisional labels are complete, well formed and consistent with the plan's reading rules
// (W4b plan sections 3.1, 3.3, 3.4, 11.1; decisions 22, 27, 28, 30). These checks never compute a finding: they
// check each label against the case row it belongs to and against the rules' scope, lanes and triggers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANES, type Lane } from '@rai/shared/constants';
import type { SlotNumber } from '@rai/shared/qc/types';
import { EVAL_CASES } from './cases.js';
import { readAllLabels } from './labels.js';
import { renderDocument } from './render.js';
import {
  LABELLED_BY,
  READABLE_FORMATS,
  type EvalCase,
  type EvalDocument,
  type LabelFinding,
  type LabelPartOutcome,
  type LabelRun,
} from './types.js';

const labels = readAllLabels();

const METADATA_RULES = ['PACK-SLOT-MISSING', 'PACK-STAGE-MISMATCH', 'PACK-NA-VENDOR-DOC'];
const CONTENT_RULES = [
  'ACC-METRIC-CITED',
  'ACC-EXTRACTION-NOT-HALLUCINATION',
  'ACC-BAND-V1-SHEET3',
  'ACC-CLASSIC-ML-METRIC',
  'PACK-CONTRADICTION',
];
const APPROVE_CONTENT_RULES = CONTENT_RULES.filter((r) => r.startsWith('ACC-'));
const CLASSIC_ONLY = 'ACC-CLASSIC-ML-METRIC';

function documentOf(c: EvalCase, slot: SlotNumber): EvalDocument | undefined {
  const s = c.slots.find((x) => x.slot === slot);
  return s?.disposition === 'attached' ? s.document : undefined;
}

function every(fn: (c: EvalCase, run: LabelRun) => void): void {
  for (const c of EVAL_CASES) for (const run of labels.get(c.caseId)!.runs) fn(c, run);
}

function runName(c: EvalCase, run: LabelRun): string {
  return `${c.caseId} ${run.trigger}${run.trigger === 'upload' ? ` slot ${run.slot}` : ''}${run.lane === null ? '' : ` ${run.lane}`}`;
}

function findings(outcome: LabelPartOutcome): LabelFinding[] {
  return outcome.findings;
}

/**
 * Slots the content part reads (plan section 3.1 and the 3.3 table). Upload: ACC-METRIC-CITED reads slot 1 only
 * (decision 22), and it is not routed to classic_ml. Submit: PACK-CONTRADICTION reads slots 2 and 5. Approve
 * attempt (decision 28): AI/COE reads slots 1 and 5 (classic_ml: slot 1, ACC-CLASSIC-ML-METRIC only); DPO and
 * IT/Security read slot 5 through ACC-METRIC-CITED (classic_ml: nothing).
 */
function contentReads(c: EvalCase, run: LabelRun): SlotNumber[] {
  const classic = c.modelType === 'classic_ml';
  let slots: SlotNumber[];
  if (run.trigger === 'upload') slots = run.slot === 1 && !classic ? [1] : [];
  else if (run.trigger === 'submit') slots = [2, 5];
  else if (run.lane === 'ai_coe') slots = classic ? [1] : [1, 5];
  else slots = classic ? [] : [5];
  return slots.filter((s) => documentOf(c, s) !== undefined);
}

test('every case has one label file, and every label file names a case; the labels are marked provisional and unsigned', () => {
  assert.deepEqual([...labels.keys()].sort(), EVAL_CASES.map((c) => c.caseId).sort());
  for (const c of EVAL_CASES) {
    const l = labels.get(c.caseId)!;
    assert.equal(l.split, c.split);
    assert.equal(l.labelledBy, LABELLED_BY);
    assert.equal(
      LABELLED_BY,
      'agent-team, provisional (Ta delegation 2026-09-27); lane-expert sign-off pending (D09)',
    );
  }
});

test('each case labels every upload of an attached slot 1, 2 or 5, the submit, and one approve attempt per lane, in that order', () => {
  for (const c of EVAL_CASES) {
    const names = labels.get(c.caseId)!.runs.map((r) => runName(c, r));
    const uploads = ([1, 2, 5] as const)
      .filter((s) => documentOf(c, s) !== undefined)
      .map((s) => `${c.caseId} upload slot ${s}`);
    const approvals = LANES.map((lane) => `${c.caseId} approve_attempt ${lane}`);
    assert.deepEqual(names, [...uploads, `${c.caseId} submit`, ...approvals]);
    for (const r of labels.get(c.caseId)!.runs) {
      assert.deepEqual(Object.keys(r.parts).sort(), ['content', 'deterministic'], runName(c, r));
      if (r.trigger !== 'approve_attempt') assert.equal(r.lane, null);
    }
  }
});

test('an unavailable part carries a reason and no findings; a completed part carries no reason', () => {
  every((c, run) => {
    for (const [part, outcome] of Object.entries(run.parts)) {
      const where = `${runName(c, run)} ${part}`;
      if (outcome.status === 'unavailable') {
        assert.ok(
          ['artifact_unreadable', 'timeout', 'runner_error'].includes(outcome.unavailableReason),
          where,
        );
        assert.deepEqual(outcome.findings, [], where);
      } else {
        assert.equal(outcome.status, 'completed', where);
        assert.ok(!('unavailableReason' in outcome), where);
      }
    }
  });
});

test('the metadata part never reads bytes, so it is completed on every run, and holds only metadata rules on their triggers', () => {
  every((c, run) => {
    const where = runName(c, run);
    const outcome = run.parts.deterministic;
    assert.equal(outcome.status, 'completed', where);
    for (const f of findings(outcome)) {
      assert.ok(METADATA_RULES.includes(f.ruleId), `${where}: ${f.ruleId}`);
      assert.notEqual(run.trigger, 'upload', `${where}: no metadata rule runs on upload`);
      if (run.trigger === 'approve_attempt') {
        // PACK-SLOT-MISSING on an approve attempt: slot 5 only, owned by the run's lane (W4a, D05 refinement).
        assert.equal(f.ruleId, 'PACK-SLOT-MISSING', where);
        assert.deepEqual(f.scope, { kind: 'slot', slot: 5 }, where);
      }
      if (f.scope.kind === 'slot') {
        const s = c.slots.find((x) => x.slot === (f.scope as { slot: SlotNumber }).slot)!;
        const expected = f.ruleId === 'PACK-NA-VENDOR-DOC' ? 'not_applicable' : 'missing';
        assert.equal(s.disposition, expected, `${where}: ${f.ruleId} slot ${s.slot}`);
      }
      for (const e of f.evidence) assert.deepEqual(e.locator, { kind: 'absent' }, where);
    }
  });
});

test('a content part is unavailable exactly when a slot it reads holds an unreadable document (decisions 22, 27, 28)', () => {
  every((c, run) => {
    const reads = contentReads(c, run);
    const unreadable = reads.filter((s) => !READABLE_FORMATS.includes(documentOf(c, s)!.format));
    const outcome = run.parts.content;
    const where = `${runName(c, run)} reads [${reads.join(',')}]`;
    if (unreadable.length > 0) {
      assert.equal(outcome.status, 'unavailable', where);
      assert.equal(
        outcome.status === 'unavailable' && outcome.unavailableReason,
        'artifact_unreadable',
        where,
      );
    } else assert.equal(outcome.status, 'completed', where);
    for (const f of findings(outcome))
      for (const e of f.evidence) assert.ok(reads.includes(e.slot), `${where}: cites slot ${e.slot}`);
  });
});

test('decision 28: DPO and IT/Security attempts never cite slot 1; every approve-attempt finding is owned by the run lane', () => {
  every((c, run) => {
    if (run.trigger !== 'approve_attempt') return;
    for (const f of [...findings(run.parts.deterministic), ...findings(run.parts.content)]) {
      assert.equal(f.owningLane, run.lane, `${runName(c, run)} ${f.ruleId}`);
      if (run.lane !== 'ai_coe')
        assert.ok(
          f.evidence.every((e) => e.slot !== 1),
          `${runName(c, run)} ${f.ruleId}`,
        );
    }
  });
});

test('a scanned or unreadable slot 1: only the AI/COE approve attempt has an unavailable content part', () => {
  const cases = EVAL_CASES.filter((c) => {
    const d = documentOf(c, 1);
    const s5 = documentOf(c, 5);
    return (
      d !== undefined &&
      !READABLE_FORMATS.includes(d.format) &&
      c.modelType !== 'classic_ml' &&
      (s5 === undefined || READABLE_FORMATS.includes(s5.format))
    );
  });
  assert.ok(cases.length >= 3, 'PNG, image-only PDF and CID-font PDF in slot 1');
  for (const c of cases) {
    const byLane = new Map<Lane, LabelRun>();
    for (const r of labels.get(c.caseId)!.runs) if (r.trigger === 'approve_attempt') byLane.set(r.lane, r);
    assert.equal(byLane.get('ai_coe')!.parts.content.status, 'unavailable', c.caseId);
    assert.equal(byLane.get('dpo')!.parts.content.status, 'completed', c.caseId);
    assert.equal(byLane.get('it_security')!.parts.content.status, 'completed', c.caseId);
  }
});

test('content rules appear only on their triggers, template and model type, with their scope and owning lane', () => {
  every((c, run) => {
    const where = runName(c, run);
    for (const f of findings(run.parts.content)) {
      assert.ok(CONTENT_RULES.includes(f.ruleId), `${where}: ${f.ruleId}`);
      if (run.trigger === 'upload') {
        assert.equal(f.ruleId, 'ACC-METRIC-CITED', where);
        assert.equal(run.slot, 1, where);
        assert.equal(f.owningLane, 'ai_coe', where);
      }
      if (run.trigger === 'submit') {
        assert.equal(f.ruleId, 'PACK-CONTRADICTION', where);
        assert.deepEqual(f.scope, { kind: 'pack' }, where);
        assert.equal(f.owningLane, 'ai_coe', where);
        assert.deepEqual(
          f.evidence.map((e) => e.slot),
          [2, 5],
          where,
        );
        assert.ok(f.fact === 'personal_data' || f.fact === 'external_vendor', where);
      }
      if (run.trigger === 'approve_attempt') assert.ok(APPROVE_CONTENT_RULES.includes(f.ruleId), where);
      if (f.ruleId.startsWith('ACC-')) {
        assert.equal(f.scope.kind, 'artifact', where);
        assert.equal(f.evidence.length, 1, where);
        assert.equal(f.evidence[0]!.slot, (f.scope as { slot: SlotNumber }).slot, where);
        assert.ok(!('fact' in f), where);
      }
      if (f.ruleId === 'ACC-BAND-V1-SHEET3') assert.equal(c.checklistTemplateVersion, 'v1.0 Sheet3', where);
      if (c.modelType === 'classic_ml')
        assert.ok(!f.ruleId.startsWith('ACC-') || f.ruleId === CLASSIC_ONLY, where);
      else assert.notEqual(f.ruleId, CLASSIC_ONLY, where);
      if (['ACC-EXTRACTION-NOT-HALLUCINATION', 'ACC-BAND-V1-SHEET3', CLASSIC_ONLY].includes(f.ruleId))
        assert.equal(run.lane, 'ai_coe', where);
    }
  });
});

test('grounding: every labelled content locator is a claim the renderer placed in that slot, or absent', () => {
  const locators = new Map<string, string[]>();
  for (const c of EVAL_CASES)
    for (const s of c.slots)
      if (s.disposition === 'attached')
        locators.set(
          `${c.caseId}:${s.slot}`,
          renderDocument(s.document).claimLocators.map((l) => JSON.stringify(l)),
        );
  let cited = 0;
  every((c, run) => {
    for (const f of findings(run.parts.content))
      for (const e of f.evidence) {
        if (e.locator.kind === 'absent') {
          assert.equal(
            f.ruleId,
            CLASSIC_ONLY,
            `${runName(c, run)}: only a missing performance claim is absent`,
          );
          continue;
        }
        assert.ok(
          locators.get(`${c.caseId}:${e.slot}`)!.includes(JSON.stringify(e.locator)),
          `${runName(c, run)} ${f.ruleId}: ${JSON.stringify(e.locator)}`,
        );
        cited += 1;
      }
  });
  assert.ok(cited > 20);
});

test('findings of one part never share a rule, scope and claim position (decision 30)', () => {
  every((c, run) => {
    for (const outcome of Object.values(run.parts)) {
      const keys = findings(outcome).map((f) =>
        JSON.stringify([f.ruleId, f.scope, f.evidence, f.fact ?? null]),
      );
      assert.equal(new Set(keys).size, keys.length, runName(c, run));
    }
  });
});

test('unreadable slot 2 and slot 5 cases carry metadata labels beside the unavailable content part', () => {
  for (const slot of [2, 5] as const) {
    const cases = EVAL_CASES.filter((c) => {
      const d = documentOf(c, slot);
      return d !== undefined && !READABLE_FORMATS.includes(d.format);
    });
    assert.ok(cases.length >= 1, `an unreadable slot ${slot}`);
    assert.ok(
      cases.some((c) => {
        const submit = labels.get(c.caseId)!.runs.find((r) => r.trigger === 'submit')!;
        return (
          submit.parts.content.status === 'unavailable' && submit.parts.deterministic.findings.length > 0
        );
      }),
      `slot ${slot}: a submit whose content part is unavailable still records metadata findings`,
    );
  }
});
