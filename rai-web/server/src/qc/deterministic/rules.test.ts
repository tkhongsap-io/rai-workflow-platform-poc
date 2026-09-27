// W4-03 (W4a plan section 4): the three W4a metadata rules, each with below-, at- and above-boundary fixtures, run
// through the deterministic runner one rule at a time. Owning lanes follow W0-06 section 7 (recorded 2026-09-25):
// single-lane slots their lane, slot 5 the lane whose approve attempt raised it, the pack AI/COE, slot 9 nothing.
// Every finding must pass the W0-07 3.4 validator and owning-lane check unchanged. Provisional until D09.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_MAPPINGS_BY_VERSION, LANES, type Lane } from '@rai/shared/constants';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type {
  QcFinding,
  QcRunRequest,
  QcRunResult,
  SelectedRule,
  SlotDisposition,
  SlotNumber,
  StageContext,
} from '@rai/shared/qc/types';
import { checkOwningLane, validateQcFinding } from '@rai/shared/qc/validate';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import { createDeterministicQcRunner } from './runner.js';
import { artifactIdOf, onlyRule, requestOf, type RequestShape } from './request-builder.test-helper.js';

const runner = createDeterministicQcRunner({ now: () => new Date('2026-09-27T05:00:00Z') });
const SINGLE_LANE: ReadonlyArray<[SlotNumber, Lane]> = [
  [1, 'ai_coe'],
  [2, 'dpo'],
  [3, 'dpo'],
  [4, 'dpo'],
  [6, 'it_security'],
  [7, 'it_security'],
  [8, 'it_security'],
];
const STAGES: StageContext[] = ['idea', 'pre_build', 'pre_launch'];

async function completed(request: QcRunRequest): Promise<QcFinding[]> {
  const result: QcRunResult = await runner.run(request, new AbortController().signal);
  assert.equal(result.status, 'completed', JSON.stringify(result));
  if (result.status !== 'completed') return [];
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!;
  for (const finding of result.findings) {
    assert.equal(validateQcFinding(finding, request), null, JSON.stringify(finding));
    assert.equal(checkOwningLane(finding, mapping, request.lane), null, JSON.stringify(finding));
    assert.ok(isLocaleKey(finding.message.key), finding.message.key);
    assert.equal(finding.measure, null);
  }
  return result.findings;
}

const run = (ruleId: string, shape: RequestShape) =>
  completed(requestOf({ ...shape, rules: onlyRule(ruleId, shape.trigger ?? 'submit') }));

const brief = (f: QcFinding) => ({
  ruleId: f.ruleId,
  slot: f.scope.kind === 'slot' ? f.scope.slot : f.scope.kind,
  owningLane: f.owningLane,
});

describe('PACK-SLOT-MISSING on submit: single-lane slots, owned by their lane', () => {
  test('below: no slot missing, or a slot in another state, raises nothing', async () => {
    assert.deepEqual(await run('PACK-SLOT-MISSING', {}), []);
    for (const state of ['not_yet', 'not_applicable', 'attached'] as SlotDisposition[])
      for (const [slot] of SINGLE_LANE)
        assert.deepEqual(
          await run('PACK-SLOT-MISSING', { slots: { [slot]: state } }),
          [],
          `${slot} ${state}`,
        );
  });

  test('at: each single-lane slot missing raises one slot finding owned by its lane', async () => {
    for (const [slot, lane] of SINGLE_LANE) {
      const findings = await run('PACK-SLOT-MISSING', { slots: { [slot]: 'missing' } });
      assert.deepEqual(findings.map(brief), [{ ruleId: 'PACK-SLOT-MISSING', slot, owningLane: lane }]);
      const [finding] = findings;
      assert.equal(finding!.severity, 'medium');
      assert.equal(finding!.findingKey, `PACK-SLOT-MISSING:slot:${slot}`);
      assert.deepEqual(finding!.message, { key: 'qc.finding.pack_slot_missing', params: { slot } });
      assert.deepEqual(finding!.evidence, [
        { artifactId: null, contentHash: null, slot, locator: { kind: 'absent' } },
      ]);
    }
  });

  test('above: every slot missing raises the seven single-lane findings; slot 5 and slot 9 raise none on submit', async () => {
    const all = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => [s, 'missing']));
    const findings = await run('PACK-SLOT-MISSING', { slots: all });
    assert.deepEqual(
      findings.map(brief),
      SINGLE_LANE.map(([slot, lane]) => ({ ruleId: 'PACK-SLOT-MISSING', slot, owningLane: lane })),
    );
    assert.deepEqual(await run('PACK-SLOT-MISSING', { slots: { 5: 'missing' } }), []);
    assert.deepEqual(await run('PACK-SLOT-MISSING', { slots: { 9: 'missing' } }), []);
  });
});

describe('PACK-SLOT-MISSING on approve attempts: slot 5, owned by the run lane', () => {
  test('at: slot 5 missing raises one finding owned by each lane that attempts approval', async () => {
    for (const lane of LANES) {
      const findings = await run('PACK-SLOT-MISSING', {
        trigger: 'approve_attempt',
        lane,
        slots: { 5: 'missing' },
      });
      assert.deepEqual(findings.map(brief), [{ ruleId: 'PACK-SLOT-MISSING', slot: 5, owningLane: lane }]);
      assert.equal(findings[0]!.trigger, 'approve_attempt');
    }
  });

  test('two lanes on one version: DPO and IT/Security each raise their own slot-5 finding', async () => {
    const shape = { trigger: 'approve_attempt' as const, slots: { 5: 'missing' as const } };
    const dpo = await run('PACK-SLOT-MISSING', { ...shape, lane: 'dpo' });
    const itSecurity = await run('PACK-SLOT-MISSING', { ...shape, lane: 'it_security' });
    assert.equal(dpo[0]!.owningLane, 'dpo');
    assert.equal(itSecurity[0]!.owningLane, 'it_security');
    // The same finding key in two runs: the runs, not the key, keep them apart (no dedup in W4a).
    assert.equal(dpo[0]!.findingKey, itSecurity[0]!.findingKey);
  });

  test('below and above: slot 5 present raises nothing; single-lane and slot-9 gaps are not raised again', async () => {
    for (const state of ['attached', 'not_yet', 'not_applicable'] as SlotDisposition[])
      assert.deepEqual(
        await run('PACK-SLOT-MISSING', { trigger: 'approve_attempt', lane: 'dpo', slots: { 5: state } }),
        [],
      );
    const gaps = await run('PACK-SLOT-MISSING', {
      trigger: 'approve_attempt',
      lane: 'it_security',
      slots: { 5: 'missing', 7: 'missing', 8: 'missing', 9: 'missing' },
    });
    assert.deepEqual(gaps.map(brief), [{ ruleId: 'PACK-SLOT-MISSING', slot: 5, owningLane: 'it_security' }]);
  });
});

describe('PACK-STAGE-MISMATCH: the seeded params { attachedForbiddenAt: { idea: [8] }, notYetForbiddenAt: { pre_launch: [1..8] } }', () => {
  test('slot 8 attached: fires at idea only', async () => {
    for (const stage of STAGES) {
      const findings = await run('PACK-STAGE-MISMATCH', { stage, slots: { 8: 'attached' } });
      if (stage !== 'idea') {
        assert.deepEqual(findings, [], stage);
        continue;
      }
      assert.deepEqual(findings.map(brief), [
        { ruleId: 'PACK-STAGE-MISMATCH', slot: 'pack', owningLane: 'ai_coe' },
      ]);
      assert.equal(findings[0]!.findingKey, 'PACK-STAGE-MISMATCH:pack');
      assert.deepEqual(findings[0]!.message, { key: 'qc.finding.pack_stage_mismatch', params: {} });
      assert.deepEqual(findings[0]!.evidence, [
        {
          artifactId: artifactIdOf(8),
          contentHash: '8'.padStart(64, 'a'),
          slot: 8,
          locator: { kind: 'absent' },
        },
      ]);
    }
  });

  test('slot 8 in any other state at idea, and other slots attached at idea, raise nothing', async () => {
    for (const state of ['not_yet', 'missing', 'not_applicable'] as SlotDisposition[])
      assert.deepEqual(await run('PACK-STAGE-MISMATCH', { stage: 'idea', slots: { 8: state } }), []);
  });

  test('a lane-gated slot not yet: fires at pre_launch only, for each of slots 1-8; slot 9 never', async () => {
    for (const stage of STAGES)
      for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as SlotNumber[]) {
        const shape = { stage, slots: { [slot]: 'not_yet', ...(stage === 'idea' ? { 8: 'not_yet' } : {}) } };
        const findings = await run('PACK-STAGE-MISMATCH', shape as RequestShape);
        if (stage !== 'pre_launch' || slot === 9) {
          assert.deepEqual(findings, [], `${stage} slot ${slot}`);
          continue;
        }
        assert.deepEqual(findings.map(brief), [
          { ruleId: 'PACK-STAGE-MISMATCH', slot: 'pack', owningLane: 'ai_coe' },
        ]);
        assert.deepEqual(findings[0]!.evidence, [
          { artifactId: null, contentHash: null, slot, locator: { kind: 'absent' } },
        ]);
      }
  });

  test('above: several offending slots are one pack finding with evidence for each, in slot order', async () => {
    const findings = await run('PACK-STAGE-MISMATCH', {
      stage: 'pre_launch',
      slots: { 6: 'not_yet', 2: 'not_yet', 9: 'not_yet' },
    });
    assert.equal(findings.length, 1);
    assert.deepEqual(
      findings[0]!.evidence.map((e) => e.slot),
      [2, 6],
    );
  });

  test('params other than the seed are read from the rule; invalid params fail the run', async () => {
    const [seeded] = onlyRule('PACK-STAGE-MISMATCH');
    const custom: SelectedRule = {
      ...seeded!,
      params: { attachedForbiddenAt: { pre_build: [7] }, notYetForbiddenAt: {} },
    };
    const fired = await completed(requestOf({ stage: 'pre_build', rules: [custom] }));
    assert.deepEqual(
      fired[0]!.evidence.map((e) => e.slot),
      [7],
    );
    assert.deepEqual(await completed(requestOf({ stage: 'idea', rules: [custom] })), []);

    for (const params of [undefined, { attachedForbiddenAt: { idea: [8] } }, { a: 1 }]) {
      const bad: SelectedRule = { ...seeded!, ...(params === undefined ? {} : { params }) };
      if (params === undefined) delete bad.params;
      const result = await runner.run(requestOf({ rules: [bad] }), new AbortController().signal);
      assert.equal(result.status, 'unavailable');
      assert.deepEqual(result.status === 'unavailable' ? [result.reason, result.detail] : [], [
        'runner_error',
        'invalid_rule_params',
      ]);
    }
  });
});

describe('PACK-NA-VENDOR-DOC: a vendor case with slot 3 or 4 N/A, owned by DPO', () => {
  test('below: a non-vendor case, or a vendor slot in another state, or another slot N/A, raises nothing', async () => {
    assert.deepEqual(
      await run('PACK-NA-VENDOR-DOC', { vendor: false, slots: { 3: 'not_applicable', 4: 'not_applicable' } }),
      [],
    );
    for (const state of ['attached', 'missing', 'not_yet'] as SlotDisposition[])
      assert.deepEqual(await run('PACK-NA-VENDOR-DOC', { vendor: true, slots: { 3: state, 4: state } }), []);
    for (const slot of [1, 2, 5, 6, 7, 8, 9] as SlotNumber[])
      assert.deepEqual(
        await run('PACK-NA-VENDOR-DOC', { vendor: true, slots: { [slot]: 'not_applicable' } }),
        [],
      );
  });

  test('at: slot 3 or slot 4 N/A on a vendor case raises one DPO finding with the slot', async () => {
    for (const slot of [3, 4] as SlotNumber[]) {
      const findings = await run('PACK-NA-VENDOR-DOC', { vendor: true, slots: { [slot]: 'not_applicable' } });
      assert.deepEqual(findings.map(brief), [{ ruleId: 'PACK-NA-VENDOR-DOC', slot, owningLane: 'dpo' }]);
      assert.equal(findings[0]!.severity, 'medium');
      assert.deepEqual(findings[0]!.message, { key: 'qc.finding.pack_na_vendor_doc', params: { slot } });
      assert.deepEqual(findings[0]!.evidence, [
        { artifactId: null, contentHash: null, slot, locator: { kind: 'absent' } },
      ]);
    }
  });

  test('above: both vendor slots N/A raise two findings, whatever the reason, including the non-vendor default', async () => {
    const request = requestOf({
      vendor: true,
      slots: { 3: 'not_applicable', 4: 'not_applicable' },
      rules: onlyRule('PACK-NA-VENDOR-DOC'),
    });
    request.slots[2]!.reason = NON_VENDOR_DEFAULT_REASON_KEY;
    const findings = await completed(request);
    assert.deepEqual(
      findings.map((f) => (f.scope.kind === 'slot' ? f.scope.slot : null)),
      [3, 4],
    );
  });
});

test('no rule raises a finding on slot 9, whatever its state and the stage', async () => {
  for (const state of ['attached', 'missing', 'not_yet', 'not_applicable'] as SlotDisposition[])
    for (const stage of STAGES)
      for (const trigger of ['submit', 'approve_attempt'] as const)
        for (const lane of trigger === 'submit' ? [null] : LANES) {
          const request = requestOf({ trigger, lane, stage, vendor: true, slots: { 9: state } });
          const findings = await completed(request);
          assert.ok(
            findings.every((f) => !('slot' in f.scope) || f.scope.slot !== 9),
            `${state} ${stage} ${trigger}`,
          );
          assert.ok(findings.every((f) => f.evidence.every((e) => e.slot !== 9)));
        }
});

test('the catalogue severity is carried to the finding; the rule label keys exist in both locales', async () => {
  const [rule] = onlyRule('PACK-SLOT-MISSING');
  const findings = await completed(
    requestOf({ slots: { 7: 'missing' }, rules: [{ ...rule!, severity: 'low' }] }),
  );
  assert.equal(findings[0]!.severity, 'low');
  for (const key of [
    'qc.rule.pack_slot_missing',
    'qc.rule.pack_stage_mismatch',
    'qc.rule.pack_na_vendor_doc',
    'qc.rule.acc_metric_cited',
    'qc.rule.acc_extraction_not_hallucination',
    'qc.rule.acc_band_v1_sheet3',
    'qc.rule.acc_classic_ml_metric',
    'qc.rule.qc_unavailable',
    'qc.finding.pack_na_vendor_doc',
  ])
    assert.ok(isLocaleKey(key), key);
});
