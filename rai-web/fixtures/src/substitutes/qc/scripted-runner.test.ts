// W0-07 section 3.9 tests W1-10 must ship (unit layer, no Postgres): scripted findings for a version reference,
// zero findings for an unscripted version, `unavailable` on demand for every trigger, both timeout modes, the
// behavioural no-write-path check, determinism, the health hook and the runner identity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findingKeyOf, validateQcFinding } from '@rai/shared/qc/validate';
import type { QcRunRequest, QcRunResult, QcRunner, QcTrigger } from '@rai/shared/qc/types';
import { ScriptedQcRunner, materializeFindings } from './scripted-runner.js';
import {
  BUNDLED_QC_SCRIPTS,
  QcScriptError,
  RAW_BUNDLED_QC_SCRIPTS,
  selectorKey,
  validateScript,
} from './scripts.js';
import { QC_SUBSTITUTE_RUNNER, QC_SUBSTITUTE_RUNNER_VERSION } from './version.js';
import { buildRequest, deepFreeze, syntheticArtifactId, syntheticHash } from './test-support.js';

const TRIGGERS: QcTrigger[] = ['upload', 'submit', 'approve_attempt'];

function entryFor(fixtureCaseId: string, trigger: QcTrigger, lane?: 'ai_coe' | 'dpo' | 'it_security') {
  const script = BUNDLED_QC_SCRIPTS.find((s) => s.fixtureCaseId === fixtureCaseId);
  assert.ok(script, `bundled script for ${fixtureCaseId}`);
  const key = selectorKey({ fixtureCaseId, trigger, ...(lane === undefined ? {} : { lane }) });
  const entry = script.entries.find(
    (e) =>
      selectorKey({
        fixtureCaseId,
        trigger: e.trigger,
        ...(e.lane === undefined ? {} : { lane: e.lane }),
      }) === key,
  );
  assert.ok(entry, `entry ${key}`);
  return entry;
}

function completed(result: QcRunResult): Extract<QcRunResult, { status: 'completed' }> {
  assert.equal(result.status, 'completed');
  return result;
}

function unavailable(result: QcRunResult): Extract<QcRunResult, { status: 'unavailable' }> {
  assert.equal(result.status, 'unavailable');
  return result;
}

test('identity is the W0-04 engine_id value and the package version', () => {
  const runner: QcRunner = new ScriptedQcRunner();
  assert.deepEqual(runner.identity, {
    runner: 'substitute-scripted',
    runnerVersion: QC_SUBSTITUTE_RUNNER_VERSION,
  });
  assert.equal(QC_SUBSTITUTE_RUNNER, 'substitute-scripted');
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  assert.equal(QC_SUBSTITUTE_RUNNER_VERSION, pkg.version);
  assert.ok(Object.isFrozen(runner.identity));
});

test('returns scripted findings for a version reference (approve_attempt, ai_coe lane on fx-case-vendor)', async () => {
  const runner = new ScriptedQcRunner();
  const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe' });
  const result = completed(await runner.run(request, new AbortController().signal));
  const entry = entryFor('fx-case-vendor', 'approve_attempt', 'ai_coe');
  assert.equal(result.findings.length, entry.findings.length);
  assert.deepEqual(result.findings, materializeFindings(entry, request, runner.identity));
  assert.deepEqual(result.rulesEvaluated, ['ACC-METRIC-CITED', 'ACC-EXTRACTION-NOT-HALLUCINATION']);
  assert.ok(result.startedAt <= result.finishedAt);
  for (const [i, finding] of result.findings.entries()) {
    const scripted = entry.findings[i]!;
    // The rewrites W0-07 3.9 names, field by field.
    assert.equal(finding.ruleRevision, request.qcRulesRevision);
    assert.equal(finding.trigger, 'approve_attempt');
    assert.deepEqual(finding.provenance, {
      runner: 'substitute-scripted',
      runnerVersion: QC_SUBSTITUTE_RUNNER_VERSION,
    });
    assert.equal(finding.findingKey, findingKeyOf(finding.ruleId, finding.scope));
    // Everything the script states is carried unchanged.
    assert.equal(finding.ruleId, scripted.ruleId);
    assert.equal(finding.severity, scripted.severity);
    assert.equal(finding.owningLane, scripted.owningLane);
    assert.deepEqual(finding.measure, scripted.measure);
    assert.deepEqual(finding.message, scripted.message);
    // Each scope resolves to a request slot and artifact (the row identity, never the fixture id).
    assert.equal(finding.scope.kind, 'artifact');
    if (finding.scope.kind !== 'artifact') return;
    assert.equal(finding.scope.slot, 1);
    assert.equal(finding.scope.artifactId, syntheticArtifactId('fx-case-vendor', 1));
    assert.equal(finding.scope.contentHash, syntheticHash('fx-case-vendor', 1));
    for (const evidence of finding.evidence) {
      assert.equal(evidence.artifactId, syntheticArtifactId('fx-case-vendor', 1));
      assert.equal(evidence.contentHash, syntheticHash('fx-case-vendor', 1));
      assert.ok(!('excerpt' in evidence));
    }
    assert.equal(validateQcFinding(finding, request), null);
  }
});

test('returns the slot-scoped PACK-SLOT-MISSING finding on submit of fx-case-missing-slot', async () => {
  const runner = new ScriptedQcRunner();
  const { request } = buildRequest('fx-case-missing-slot', { trigger: 'submit' });
  const result = completed(await runner.run(request, new AbortController().signal));
  // Two since W0-06 7.3 was recorded (2026-09-25): the slot-7 omission and the pack-level PACK-STAGE-MISMATCH.
  assert.equal(result.findings.length, 2);
  const finding = result.findings.find((f) => f.ruleId === 'PACK-SLOT-MISSING')!;
  assert.equal(finding.ruleId, 'PACK-SLOT-MISSING');
  assert.deepEqual(finding.scope, { kind: 'slot', slot: 7 });
  assert.equal(finding.owningLane, 'it_security');
  assert.deepEqual(finding.evidence, [
    { artifactId: null, contentHash: null, slot: 7, locator: { kind: 'absent' } },
  ]);
  assert.equal(finding.findingKey, 'PACK-SLOT-MISSING:slot:7');
  assert.equal(finding.message.key, 'qc.finding.pack_slot_missing');
});

test('no bundled script answers the upload trigger (W4-04): an upload run on a scripted fixture case is completed with zero findings', async () => {
  // Upload content rules are W4b's (W4a plan section 5); the bundled scripts carry no `upload` entry, so the bound
  // upload trigger never writes scripted findings when a suite re-attaches a slot.
  for (const script of BUNDLED_QC_SCRIPTS)
    assert.deepEqual(
      script.entries.filter((e) => e.trigger === 'upload'),
      [],
      `${script.fixtureCaseId} has an upload entry`,
    );
  const runner = new ScriptedQcRunner();
  for (const fixtureCaseId of [
    'fx-case-nonvendor',
    'fx-case-vendor',
    'fx-case-missing-slot',
    'fx-case-na-reasons',
  ])
    for (const uploadSlot of [1, 5, 6] as const) {
      const { request } = buildRequest(fixtureCaseId, { trigger: 'upload', uploadSlot });
      const result = completed(await runner.run(request, new AbortController().signal));
      assert.deepEqual(result.findings, [], `${fixtureCaseId} slot ${uploadSlot}`);
      assert.deepEqual(result.rulesEvaluated, []);
    }
});

test('an upload entry returns only the findings on the uploaded slot (inline script)', async () => {
  const nonvendor = RAW_BUNDLED_QC_SCRIPTS.find(
    (s) => (s as { fixtureCaseId: string }).fixtureCaseId === 'fx-case-nonvendor',
  ) as { entries: unknown[] };
  const script = validateScript({
    ...nonvendor,
    entries: [
      ...nonvendor.entries,
      {
        trigger: 'upload',
        findings: [
          {
            ruleId: 'ACC-METRIC-CITED',
            scope: { kind: 'artifact', slot: 1, fixtureArtifactId: 'fx-doc-0001-01' },
            severity: 'medium',
            owningLane: 'ai_coe',
            evidence: [{ fixtureArtifactId: 'fx-doc-0001-01', slot: 1, locator: { kind: 'page', page: 2 } }],
            measure: null,
            message: { key: 'qc.finding.acc_metric_cited', params: { slot: 1 } },
          },
        ],
      },
    ],
  });
  const runner = new ScriptedQcRunner({ scripts: [script] });
  const slotOne = buildRequest('fx-case-nonvendor', { trigger: 'upload', uploadSlot: 1 });
  const one = completed(await runner.run(slotOne.request, new AbortController().signal));
  assert.deepEqual(
    one.findings.map((f) => f.ruleId),
    ['ACC-METRIC-CITED'],
  );
  const slotSix = buildRequest('fx-case-nonvendor', { trigger: 'upload', uploadSlot: 6 });
  const six = completed(await runner.run(slotSix.request, new AbortController().signal));
  assert.deepEqual(six.findings, []);
  assert.deepEqual(six.rulesEvaluated, []);
});

test('unscripted version yields completed with zero findings, never unavailable', async () => {
  const runner = new ScriptedQcRunner();
  for (const trigger of TRIGGERS) {
    const { request } = buildRequest('fx-case-hr-dualrole', { trigger, lane: 'dpo' });
    const result = completed(await runner.run(request, new AbortController().signal));
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.rulesEvaluated, []);
  }
  // A non-fixture case id (a real UUID) resolves to no script at all.
  const { request } = buildRequest('fx-case-vendor', {
    trigger: 'approve_attempt',
    lane: 'ai_coe',
    caseId: '0199a1b2-0000-7000-8000-000000000001',
  });
  const result = completed(await runner.run(request, new AbortController().signal));
  assert.deepEqual(result.findings, []);
});

test('a scripted lane that is not the requested lane yields zero findings (dpo lane on fx-case-vendor)', async () => {
  const runner = new ScriptedQcRunner();
  const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'dpo' });
  const result = completed(await runner.run(request, new AbortController().signal));
  assert.deepEqual(result.findings, []);
});

test('fixtureCaseIdOf resolves a row id to a fixture case (the W2-05 binding)', async () => {
  const runner = new ScriptedQcRunner({
    fixtureCaseIdOf: (version) => (version.caseId === 'row-42' ? 'fx-case-missing-slot' : undefined),
  });
  const { request } = buildRequest('fx-case-missing-slot', { trigger: 'submit', caseId: 'row-42' });
  const result = completed(await runner.run(request, new AbortController().signal));
  assert.equal(result.findings.length, 2); // slot-7 omission plus the pack-level finding (W0-06 7.3, 2026-09-25)
});

test('unavailable on demand, for every trigger, with no lane and a safe detail', async () => {
  const runner = new ScriptedQcRunner();
  for (const reason of ['runner_error', 'artifact_unreadable'] as const) {
    for (const trigger of TRIGGERS) {
      runner.simulateError(reason);
      const { request } = buildRequest('fx-case-vendor', { trigger, lane: 'ai_coe' });
      const result = unavailable(await runner.run(request, new AbortController().signal));
      assert.equal(result.reason, reason);
      assert.ok(!('lane' in result), 'no lane field on an unavailable result (W0-06 7.4)');
      assert.ok(!('findings' in result));
      assert.equal(typeof result.detail, 'string');
      for (const artifact of request.artifacts) assert.ok(!result.detail!.includes(artifact.filename));
      assert.doesNotMatch(result.detail!, /@|\.pdf|\.xlsx|\.docx|synthetic-/);
      assert.ok(result.startedAt <= result.finishedAt);
    }
  }
  // The simulation was consumed: the next run is scripted again.
  const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe' });
  assert.equal((await runner.run(request, new AbortController().signal)).status, 'completed');
});

test("simulated timeout 'immediate' answers unavailable:timeout at once", async () => {
  const runner = new ScriptedQcRunner();
  runner.simulateTimeout('immediate');
  const { request } = buildRequest('fx-case-vendor', { trigger: 'submit' });
  const started = performance.now();
  const result = unavailable(await runner.run(request, new AbortController().signal));
  assert.ok(performance.now() - started < 50, 'immediate mode keeps suites fast');
  assert.equal(result.reason, 'timeout');
  assert.ok(!('lane' in result));
});

test("simulated timeout 'hang' resolves only after the signal aborts; a 100 ms caller observes timeout", async () => {
  const runner = new ScriptedQcRunner();
  runner.simulateTimeout('hang');
  const { request } = buildRequest('fx-case-vendor', { trigger: 'submit' });
  // A caller shaped like the orchestrator's step 3: timer, abort, late result discarded.
  const controller = new AbortController();
  let settled = false;
  const pending = runner.run(request, controller.signal).then(
    () => {
      settled = true;
      return 'resolved' as const;
    },
    (err: unknown) => {
      settled = true;
      return err instanceof Error && err.name === 'AbortError' ? ('timeout' as const) : ('other' as const);
    },
  );
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(settled, false, 'still hanging before the timer');
  const timer = setTimeout(() => controller.abort(), 40);
  const outcome = await pending;
  clearTimeout(timer);
  assert.equal(outcome, 'timeout');
});

test("simulateTimeout with a versionId selector fires only for that version; 'next' fires for the next call", async () => {
  const runner = new ScriptedQcRunner();
  runner.simulateTimeout('immediate', { versionId: 'v-target' });
  const other = buildRequest('fx-case-vendor', { trigger: 'submit', versionId: 'v-other' });
  assert.equal((await runner.run(other.request, new AbortController().signal)).status, 'completed');
  const target = buildRequest('fx-case-vendor', { trigger: 'submit', versionId: 'v-target' });
  assert.equal(unavailable(await runner.run(target.request, new AbortController().signal)).reason, 'timeout');
  assert.equal((await runner.run(target.request, new AbortController().signal)).status, 'completed');
});

test('an already-aborted signal rejects with AbortError before any work', async () => {
  const runner = new ScriptedQcRunner();
  const controller = new AbortController();
  controller.abort();
  const { request } = buildRequest('fx-case-vendor', { trigger: 'submit' });
  await assert.rejects(runner.run(request, controller.signal), (err: Error) => err.name === 'AbortError');
});

test('no write path, behavioural: request deep-frozen and unchanged, store spy never called, read() never invoked', async () => {
  const runner = new ScriptedQcRunner();
  const storeSpy = { calls: 0, insert: () => (storeSpy.calls += 1), update: () => (storeSpy.calls += 1) };
  for (const trigger of TRIGGERS) {
    const built = buildRequest('fx-case-vendor', { trigger, lane: 'ai_coe' });
    const snapshot = JSON.stringify(built.request);
    const request = deepFreeze(built.request);
    const result = await runner.run(request, new AbortController().signal);
    assert.equal(result.status, 'completed');
    assert.equal(JSON.stringify(request), snapshot, 'the request is byte-identical after the run');
    assert.equal(built.reads.length, 0, `artifacts[i].read is never invoked on ${trigger}`);
  }
  assert.equal(storeSpy.calls, 0, 'nothing reached a store: the runner is passed none');
  // The run result is fresh data every call; mutating it cannot reach the runner's script table.
  const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe' });
  const a = completed(await runner.run(request, new AbortController().signal));
  assert.equal(a.findings.length, 2);
  a.findings.push(a.findings[0]!);
  a.findings[0]!.severity = 'low';
  const b = completed(await runner.run(request, new AbortController().signal));
  assert.equal(b.findings.length, 2);
  assert.equal(b.findings[0]!.severity, 'medium');
});

test('determinism: same request and script give the same output apart from timestamps', async () => {
  const fixed = new Date('2026-09-21T03:00:00.000Z');
  const runner = new ScriptedQcRunner({ now: () => fixed });
  const { request } = buildRequest('fx-case-na-reasons', { trigger: 'approve_attempt', lane: 'ai_coe' });
  const first = await runner.run(request, new AbortController().signal);
  const second = await runner.run(request, new AbortController().signal);
  assert.deepEqual(first, second);
  assert.equal(completed(first).startedAt, fixed.toISOString());
  assert.equal(completed(first).finishedAt, fixed.toISOString());
});

test('W4-02: the scripted substitute ignores request.rules (none, empty or a selection give the same result)', async () => {
  const fixed = new Date('2026-09-21T03:00:00.000Z');
  const runner = new ScriptedQcRunner({ now: () => fixed });
  const selection = [
    { ruleId: 'PACK-SLOT-MISSING', engine: 'metadata' as const, severity: 'medium' as const },
    { ruleId: 'ACC-METRIC-CITED', engine: 'content' as const, severity: 'medium' as const },
  ];
  const results = [];
  for (const rules of [null, [], selection]) {
    const { request } = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe', rules });
    results.push(await runner.run(request, new AbortController().signal));
  }
  assert.ok(completed(results[0]!).findings.length > 0);
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});

test('calls records every request received, in order; reset clears simulations, overrides, health and calls', async () => {
  const runner = new ScriptedQcRunner();
  const one = buildRequest('fx-case-vendor', { trigger: 'submit' });
  const two = buildRequest('fx-case-nonvendor', { trigger: 'submit' });
  runner.simulateError('runner_error');
  await runner.run(one.request, new AbortController().signal);
  await runner.run(two.request, new AbortController().signal);
  assert.deepEqual(
    runner.calls.map((c) => c.request.version.caseId),
    ['fx-case-vendor', 'fx-case-nonvendor'],
  );
  assert.ok(runner.calls.every((c) => typeof c.at === 'string'));
  runner.health('unavailable');
  runner.simulateTimeout('immediate');
  runner.script({ fixtureCaseId: 'fx-case-hr-dualrole', trigger: 'submit' }, [
    {
      ruleId: 'PACK-SLOT-MISSING',
      scope: { kind: 'slot', slot: 7 },
      severity: 'medium',
      owningLane: 'it_security',
      evidence: [{ slot: 7, locator: { kind: 'absent' } }],
      measure: null,
      message: { key: 'qc.finding.pack_slot_missing', params: { slot: 7 } },
    },
  ]);
  runner.reset();
  assert.equal(runner.calls.length, 0);
  assert.equal(await runner.probe(), 'ok');
  const three = buildRequest('fx-case-hr-dualrole', { trigger: 'submit' });
  const result = completed(await runner.run(three.request, new AbortController().signal));
  assert.deepEqual(result.findings, [], 'the test-added script and the timeout were cleared');
});

test('script() adds findings for a selector, validated like a bundled script, and overrides a bundled entry', async () => {
  const runner = new ScriptedQcRunner();
  runner.script({ fixtureCaseId: 'fx-case-hr-dualrole', trigger: 'approve_attempt', lane: 'it_security' }, [
    {
      ruleId: 'PACK-SLOT-MISSING',
      scope: { kind: 'slot', slot: 7 },
      severity: 'medium',
      owningLane: 'it_security',
      evidence: [{ slot: 7, locator: { kind: 'absent' } }],
      measure: null,
      message: { key: 'qc.finding.pack_slot_missing', params: { slot: 7 } },
    },
  ]);
  const { request } = buildRequest('fx-case-hr-dualrole', {
    trigger: 'approve_attempt',
    lane: 'it_security',
  });
  const result = completed(await runner.run(request, new AbortController().signal));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.owningLane, 'it_security');

  runner.script({ fixtureCaseId: 'fx-case-vendor', trigger: 'approve_attempt', lane: 'ai_coe' }, []);
  const vendor = buildRequest('fx-case-vendor', { trigger: 'approve_attempt', lane: 'ai_coe' });
  assert.deepEqual(completed(await runner.run(vendor.request, new AbortController().signal)).findings, []);

  // W0-06 7.3 recorded 2026-09-25: a pack-level finding owned by AI/COE is valid; slot 9 still carries no defects.
  runner.script({ fixtureCaseId: 'fx-case-hr-dualrole', trigger: 'submit' }, [
    {
      ruleId: 'PACK-STAGE-MISMATCH',
      scope: { kind: 'pack' },
      severity: 'medium',
      owningLane: 'ai_coe',
      evidence: [{ slot: null, locator: { kind: 'absent' } }],
      measure: null,
      message: { key: 'qc.finding.pack_stage_mismatch', params: {} },
    },
  ]);
  assert.throws(
    () =>
      runner.script({ fixtureCaseId: 'fx-case-hr-dualrole', trigger: 'submit' }, [
        {
          ruleId: 'PACK-SLOT-MISSING',
          scope: { kind: 'slot', slot: 9 },
          severity: 'medium',
          owningLane: 'ai_coe',
          evidence: [{ slot: 9, locator: { kind: 'absent' } }],
          measure: null,
          message: { key: 'qc.finding.pack_slot_missing', params: { slot: 9 } },
        },
      ]),
    (err: unknown) => err instanceof QcScriptError && err.code === 'scope_slot_9_informational',
  );
});

test('a script that names an artifact the request does not carry is a script bug: throws, or unavailable:runner_error when so configured', async () => {
  const strict = new ScriptedQcRunner();
  strict.script({ fixtureCaseId: 'fx-case-missing-slot', trigger: 'submit' }, [
    {
      ruleId: 'ACC-METRIC-CITED',
      scope: { kind: 'artifact', slot: 7, fixtureArtifactId: 'fx-doc-0003-07' }, // slot 7 is missing on this case
      severity: 'medium',
      owningLane: 'it_security',
      evidence: [{ slot: 7, locator: { kind: 'absent' } }],
      measure: null,
      message: { key: 'qc.finding.acc_metric_cited', params: { slot: 7 } },
    },
  ]);
  const { request } = buildRequest('fx-case-missing-slot', { trigger: 'submit' });
  await assert.rejects(
    strict.run(request, new AbortController().signal),
    (err: QcScriptError) => err instanceof QcScriptError && err.code === 'artifact_not_attached',
  );

  const lenient = new ScriptedQcRunner({ onScriptMismatch: 'unavailable' });
  lenient.script({ fixtureCaseId: 'fx-case-missing-slot', trigger: 'submit' }, [
    {
      ruleId: 'ACC-METRIC-CITED',
      scope: { kind: 'artifact', slot: 7, fixtureArtifactId: 'fx-doc-0003-07' },
      severity: 'medium',
      owningLane: 'it_security',
      evidence: [{ slot: 7, locator: { kind: 'absent' } }],
      measure: null,
      message: { key: 'qc.finding.acc_metric_cited', params: { slot: 7 } },
    },
  ]);
  const result = unavailable(await lenient.run(request, new AbortController().signal));
  assert.equal(result.reason, 'runner_error');
  assert.equal(result.detail, 'artifact_not_attached');
});

test('a request whose checklist template differs from the script is refused as threshold_source_mismatch (L12)', async () => {
  const runner = new ScriptedQcRunner();
  const built = buildRequest('fx-case-na-reasons', { trigger: 'approve_attempt', lane: 'ai_coe' });
  const request: QcRunRequest = { ...built.request, checklistTemplateVersion: 'v2.0' };
  await assert.rejects(
    runner.run(request, new AbortController().signal),
    (err: QcScriptError) => err instanceof QcScriptError && err.code === 'threshold_source_mismatch',
  );
});

test('health answer reaches the W0-10 qc probe; QC never gates readiness', async () => {
  const runner = new ScriptedQcRunner();
  assert.equal(await runner.probe(), 'ok');
  runner.health('unavailable');
  assert.equal(await runner.probe(), 'unavailable');
  runner.health('disabled');
  assert.equal(await runner.probe(), 'disabled');
  // The probe is the `HealthProbes['qc']` shape of W0-10 5.5: readiness composes it and stays `ready` on
  // `unavailable` (W0-10 5.3); `computeReadiness` itself lands with W3-07 and asserts the composed report there.
  const probes: { qc(): Promise<'ok' | 'unavailable' | 'disabled'> } = { qc: () => runner.probe() };
  assert.equal(await probes.qc(), 'disabled');
  // A run still answers while health is not ok: health is an operator signal, not a gate on the runner.
  const { request } = buildRequest('fx-case-vendor', { trigger: 'submit' });
  assert.equal((await runner.run(request, new AbortController().signal)).status, 'completed');
});
