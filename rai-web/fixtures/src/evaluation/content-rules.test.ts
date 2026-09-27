// W4-06a cross-check (W4b plan sections 3.1-3.3 and 11.1): on the dev split of `qc-eval-synthetic@1`, the content
// runner with the seeded ACC-METRIC-CITED params, over the extraction worker's parsers run in process, raises exactly
// the labelled ACC-METRIC-CITED findings (rule, owning lane, scope slot, evidence locators) on every upload and on every
// lane's approve attempt, and its content part is unavailable exactly where the labels say so. The other content rules
// arrive in W4-06b-d, so only this rule's labels are compared; the full per-rule grading is the W4-08a harness.
// Test-only (excluded from the set hash by its suffix). Synthetic documents only; nothing is written.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import type { AuthorizedArtifactRef, QcRunRequest, SlotState } from '@rai/shared/qc/types';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { createContentQcRunner } from '@rai/server/qc/content/runner';
import type { Extractor, Segment } from '@rai/server/qc/extraction/port';
import { FIXED_WORKER_LIMITS } from '@rai/server/qc/extraction/limits';
import { extractInWorker } from '@rai/server/qc/extraction/worker/extract';
import { selectRules } from '@rai/server/qc/select';
import { EVAL_CASES } from './cases.js';
import { renderDocument } from './render.js';
import { readAllLabels } from './labels.js';
import type { EvalCase, LabelFinding, LabelRun } from './types.js';

const RULE = 'ACC-METRIC-CITED';

const inProcess: Extractor = {
  version: 'rai-extract/1+in-process',
  extract(input) {
    const reply = extractInWorker({
      mediaType: input.mediaType,
      bytes: input.bytes,
      limits: { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS },
    });
    return Promise.resolve(
      reply.ok
        ? { ok: true, extractorVersion: this.version, segments: reply.segments as Segment[] }
        : { ok: false, extractorVersion: this.version, reason: reply.reason },
    );
  },
  selfTest: () => Promise.resolve(true),
};
const runner = createContentQcRunner({ extractor: inProcess, runnerVersion: '0.0.0' });

function requestFor(evalCase: EvalCase, run: LabelRun): QcRunRequest {
  const carried = evalCase.slots.filter((s) => run.trigger !== 'upload' || s.slot === run.slot);
  const artifacts: AuthorizedArtifactRef[] = [];
  const slots: SlotState[] = carried.map((s) => {
    if (s.disposition !== 'attached')
      return {
        slot: s.slot,
        disposition: s.disposition,
        reason: s.disposition === 'not_applicable' ? s.reason : null,
        artifactId: null,
      };
    const rendered = renderDocument(s.document);
    const artifactId = `00000000-0000-7000-8000-${String(s.slot).padStart(12, '0')}`;
    artifacts.push({
      artifactId,
      slot: s.slot,
      contentHash: createHash('sha256').update(rendered.bytes).digest('hex'),
      mediaType: rendered.mediaType,
      filename: rendered.filename,
      byteLength: rendered.bytes.length,
      read: () =>
        Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(rendered.bytes));
              controller.close();
            },
          }),
        ),
    });
    return { slot: s.slot, disposition: 'attached', reason: null, artifactId };
  });
  const rules = selectRules(
    CONFIGURATION_SEED.qc_rules,
    evalCase.checklistTemplateVersion,
    run.trigger,
    evalCase.modelType,
  ).filter((r) => r.ruleId === RULE);
  return {
    correlationId: '00000000-0000-4000-8000-000000000001',
    runKey: 'f'.repeat(64),
    trigger: run.trigger,
    lane: run.lane,
    version: {
      caseId: evalCase.caseId,
      versionId: '00000000-0000-7000-8000-000000000001',
      versionNumber: 1,
      isDraft: run.trigger === 'upload',
    },
    checklistTemplateVersion: evalCase.checklistTemplateVersion,
    qcRulesRevision: '0192a0de-0000-7000-8000-00000000c0de',
    laneMappingVersion: CURRENT_LANE_MAPPING.version,
    stageContext: evalCase.stageContext,
    modelType: evalCase.modelType,
    vendorInvolved: evalCase.vendorInvolved,
    slots,
    artifacts,
    deadlineMs: Date.now() + 10_000,
    rules,
  };
}

const shapeOf = (f: Pick<LabelFinding, 'ruleId' | 'owningLane' | 'scope' | 'evidence'>) =>
  JSON.stringify({
    ruleId: f.ruleId,
    owningLane: f.owningLane,
    slot: 'slot' in f.scope ? f.scope.slot : null,
    evidence: f.evidence,
  });

test('the content runner reproduces every labelled ACC-METRIC-CITED finding and outage of the dev split', async () => {
  const labels = readAllLabels();
  let compared = 0;
  let fired = 0;
  for (const evalCase of EVAL_CASES) {
    const caseLabels = labels.get(evalCase.caseId);
    assert.ok(caseLabels, evalCase.caseId);
    for (const run of caseLabels.runs) {
      if (run.trigger === 'submit') continue; // ACC-METRIC-CITED is not a submit rule
      const request = requestFor(evalCase, run);
      if (request.rules?.length === 0) continue; // routed away (classic_ml)
      const where = `${evalCase.caseId} ${run.trigger} ${run.trigger === 'upload' ? `slot ${run.slot}` : run.lane}`;
      const expected = run.parts.content;
      const result = await runner.run(request, new AbortController().signal);
      if (expected.status === 'unavailable') {
        assert.equal(result.status, 'unavailable', where);
        if (result.status === 'unavailable') assert.equal(result.reason, expected.unavailableReason, where);
        compared += 1;
        continue;
      }
      assert.equal(result.status, 'completed', `${where}: ${JSON.stringify(result)}`);
      if (result.status !== 'completed') continue;
      const got = result.findings.map((f) =>
        shapeOf({
          ruleId: f.ruleId,
          owningLane: f.owningLane,
          scope: f.scope.kind === 'artifact' ? { kind: 'artifact', slot: f.scope.slot } : { kind: 'pack' },
          evidence: f.evidence.map((e) => ({
            slot: e.slot!,
            locator: e.locator as LabelFinding['evidence'][number]['locator'],
          })),
        }),
      );
      const want = expected.findings.filter((f) => f.ruleId === RULE).map(shapeOf);
      assert.deepEqual(got.sort(), want.sort(), where);
      compared += 1;
      fired += got.length;
    }
  }
  assert.ok(compared >= 100, `${compared} runs compared`);
  assert.ok(fired >= 10, `${fired} findings reproduced`);
});
