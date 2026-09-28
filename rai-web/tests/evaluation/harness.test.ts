// W4-08a (W4b plan section 11.2 "Runs in-process, no database"): the harness runs both parts of every labelled
// trigger of the dev split, on requests built by the orchestrator's `requestOf`, through the orchestrator's
// `callRunner`/`checkedResult`, and checks every citation by re-extraction. The extractor here runs the worker's
// parsers in process; the CLI forks the real worker. Synthetic documents only; nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { DETERMINISTIC_RUNNER } from '@rai/server/qc/kind';
import { CONTENT_RUNNER } from '@rai/server/qc/content/runner';
import { SERVER_PACKAGE_VERSION } from '@rai/server/server-version';
import type { QcRunner } from '@rai/shared/qc/types';
import { gradeRun } from './grade.js';
import { catalogueRulesOf, checkCitations, runEvalSet, type HarnessOutput } from './harness.js';
import { inProcessExtractor, IN_PROCESS_EXTRACTOR_VERSION } from './in-process-extractor.test-helper.js';
import { loadEvalSet } from './load-set.js';

const set = loadEvalSet('dev');
let output: HarnessOutput | undefined;
async function devRun(): Promise<HarnessOutput> {
  output ??= await runEvalSet(set, { extractor: inProcessExtractor() });
  return output;
}

test('both run parts of every labelled trigger run, in label order, under the product runners', async () => {
  const { parts, runners, extractorVersion, rulesRevision } = await devRun();
  const expected = set.cases.flatMap((c) =>
    c.labels.runs.flatMap((run) =>
      (['deterministic', 'content'] as const).map((part) => [
        c.evalCase.caseId,
        run.trigger,
        run.lane,
        run.trigger === 'upload' ? run.slot : null,
        part,
      ]),
    ),
  );
  assert.deepEqual(
    parts.map((p) => [p.caseId, p.trigger, p.lane, p.slot, p.part]),
    expected,
  );
  assert.deepEqual(runners, {
    deterministic: { runner: DETERMINISTIC_RUNNER, runnerVersion: SERVER_PACKAGE_VERSION },
    content: { runner: CONTENT_RUNNER, runnerVersion: SERVER_PACKAGE_VERSION },
  });
  assert.equal(extractorVersion, IN_PROCESS_EXTRACTOR_VERSION);
  for (const p of parts) {
    assert.equal(p.runner, p.part === 'deterministic' ? DETERMINISTIC_RUNNER : CONTENT_RUNNER);
    assert.ok(p.latencyMs >= 0 && p.latencyMs < 10_000, `${p.caseId} ${p.part} ${p.latencyMs}`);
    for (const f of p.findings) {
      assert.equal(f.ruleRevision, rulesRevision);
      assert.equal(f.trigger, p.trigger);
    }
    if (p.status === 'completed') assert.equal(p.reason, null);
  }
  // The content part names its extractor; an unreadable document ends the content part `artifact_unreadable`.
  assert.ok(
    parts.some((p) => p.part === 'content' && p.engine?.extractorVersion === IN_PROCESS_EXTRACTOR_VERSION),
  );
  assert.ok(
    parts.some(
      (p) => p.part === 'content' && p.status === 'unavailable' && p.reason === 'artifact_unreadable',
    ),
  );
});

test('on the dev split every catalogue rule grades 1.00, every part matches its label, and every citation is grounded', async () => {
  const { parts } = await devRun();
  const grade = gradeRun(set, parts, catalogueRulesOf(CONFIGURATION_SEED.qc_rules));
  for (const rule of grade.rules.filter((r) => r.inCatalogue)) {
    assert.equal(rule.fp, 0, `${rule.ruleId} fp`);
    assert.equal(rule.fn, 0, `${rule.ruleId} fn`);
  }
  assert.ok(
    grade.rules.filter((r) => r.inCatalogue && r.tp > 0).length >= 5,
    'metadata and content rules fire',
  );
  // W4-06d seeds PACK-CONTRADICTION, so the submit content part reads slots 2 and 5: an unreadable one makes it
  // unavailable as the labels expect, and the rule grades like every other (W4-08a left this gap reported).
  const contradiction = grade.rules.find((r) => r.ruleId === 'PACK-CONTRADICTION')!;
  assert.equal(contradiction.inCatalogue, true);
  assert.equal(contradiction.tp, contradiction.labelled);
  assert.equal(contradiction.labelled, 3);
  assert.deepEqual(grade.parts.mismatches, []);
  // Every part matches its label.
  assert.equal(grade.parts.statusMatched, grade.parts.total - grade.parts.mismatches.length);
  assert.ok(grade.parts.expectedUnavailable >= 5);
  assert.equal(grade.laneScope.foreignLaneFindings, 0);
  assert.equal(grade.metadataKept.recorded, grade.metadataKept.labelled);
  assert.ok(grade.grounding.citations >= 10, `${grade.grounding.citations} citations`);
  assert.equal(grade.grounding.rate, 1, JSON.stringify(grade.grounding.failures));
  assert.equal(grade.failures.count, 0);
});

test('checkCitations re-extracts each cited artifact and refuses what does not resolve', async () => {
  const { parts } = await devRun();
  const part = parts.find(
    (p) =>
      p.part === 'content' && p.findings.some((f) => f.evidence.some((e) => e.excerptHash !== undefined)),
  )!;
  const loaded = set.cases.find((c) => c.evalCase.caseId === part.caseId)!;
  const finding = part.findings.find((f) => f.evidence.some((e) => e.excerptHash !== undefined))!;
  const evidence = finding.evidence.find((e) => e.excerptHash !== undefined)!;
  const doc = loaded.documents.get(evidence.slot!)!;
  const artifacts = new Map([
    [
      evidence.artifactId!,
      { slot: doc.slot, contentHash: doc.sha256, mediaType: doc.mediaType, bytes: doc.bytes },
    ],
  ]);
  const rules = CONFIGURATION_SEED.qc_rules.templates[loaded.evalCase.checklistTemplateVersion]!.rules;
  const extractor = inProcessExtractor();
  const check = (e: typeof evidence) =>
    checkCitations([{ ...finding, evidence: [e] }], artifacts, extractor, rules).then((c) => c[0]!);
  assert.deepEqual(await check(evidence), {
    ruleId: finding.ruleId,
    slot: evidence.slot,
    locatorKind: evidence.locator.kind,
    grounded: true,
    problem: null,
  });
  assert.equal((await check({ ...evidence, excerptHash: 'f'.repeat(64) })).problem, 'excerpt_hash_mismatch');
  assert.equal((await check({ ...evidence, contentHash: 'f'.repeat(64) })).problem, 'content_hash_mismatch');
  assert.equal(
    (await check({ ...evidence, artifactId: 'not-in-request' })).problem,
    'artifact_not_in_request',
  );
  assert.equal((await check({ ...evidence, slot: 9 })).problem, 'artifact_not_in_request');
  const { excerptHash: _drop, ...noHash } = evidence;
  assert.equal((await check(noHash)).problem, 'excerpt_hash_missing');
  assert.equal(
    (await check({ ...evidence, locator: { kind: 'page', page: 999 } })).problem,
    'locator_not_found',
  );
  // An `absent` locator on a request artifact is grounded on the artifact alone; no artifact is no citation.
  assert.equal((await check({ ...noHash, locator: { kind: 'absent' } })).grounded, true);
  assert.deepEqual(
    await checkCitations(
      [
        {
          ...finding,
          evidence: [{ artifactId: null, contentHash: null, slot: 5, locator: { kind: 'absent' } }],
        },
      ],
      artifacts,
      extractor,
      rules,
    ),
    [],
  );
});

test('an unknown template records both parts runner_error without calling a runner, as the orchestrator does', async () => {
  const calls: Array<{ mediaType: string; byteLength: number }> = [];
  const one = {
    ...set,
    cases: set.cases.filter((c) => c.evalCase.checklistTemplateVersion === 'v2.0').slice(0, 1),
  };
  assert.equal(one.cases.length, 1);
  const catalogue = {
    ...CONFIGURATION_SEED.qc_rules,
    templates: { 'v1.0 Sheet3': CONFIGURATION_SEED.qc_rules.templates['v1.0 Sheet3']! },
  };
  const { parts } = await runEvalSet(one, { extractor: inProcessExtractor(calls), catalogue });
  assert.ok(parts.length > 0);
  for (const p of parts) {
    assert.equal(p.status, 'unavailable');
    assert.equal(p.reason, 'runner_error');
    assert.equal(p.detail, 'unknown_template_version');
    assert.deepEqual(p.findings, []);
  }
  assert.deepEqual(calls, []);
});

test('catalogueRulesOf lists each rule of the catalogue once with its engine', () => {
  const rules = catalogueRulesOf(CONFIGURATION_SEED.qc_rules);
  assert.deepEqual(
    rules.map((r) => r.ruleId),
    [...new Set(rules.map((r) => r.ruleId))],
  );
  assert.ok(rules.some((r) => r.ruleId === 'PACK-SLOT-MISSING' && r.engine === 'metadata'));
  assert.ok(rules.some((r) => r.ruleId === 'ACC-BAND-V1-SHEET3' && r.engine === 'content'));
});

test('every result passes the orchestrator boundary: a refused finding set and the deadline end the part unavailable', async () => {
  const one = { ...set, cases: set.cases.filter((c) => c.evalCase.caseId === 'ev-dev-19') };
  const { parts: real } = await runEvalSet(one, { extractor: inProcessExtractor() });
  const withFindings = real.find((p) => p.part === 'deterministic' && p.findings.length > 0)!;
  const [finding] = withFindings.findings;
  // A runner that repeats one valid finding: checkedResult refuses the whole run (duplicate_finding_key).
  const duplicating: QcRunner = {
    identity: { runner: 'deterministic', runnerVersion: 'test' },
    run: (request) =>
      Promise.resolve({
        status: 'completed',
        findings:
          request.trigger === withFindings.trigger && request.lane === withFindings.lane
            ? [finding!, finding!]
            : [],
        rulesEvaluated: [],
        startedAt: request.version.versionId,
        finishedAt: request.version.versionId,
      }),
  };
  const hanging: QcRunner = {
    identity: { runner: 'content', runnerVersion: 'test' },
    run: (_request, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  };
  const { parts } = await runEvalSet(one, {
    extractor: inProcessExtractor(),
    runners: { deterministic: duplicating, content: hanging },
    timeoutMs: 20,
  });
  const refused = parts.find(
    (p) => p.part === 'deterministic' && p.trigger === withFindings.trigger && p.lane === withFindings.lane,
  )!;
  assert.deepEqual(
    [refused.status, refused.reason, refused.detail],
    ['unavailable', 'runner_error', 'duplicate_finding_key'],
  );
  assert.deepEqual(refused.findings, []);
  for (const p of parts.filter((x) => x.part === 'content'))
    assert.deepEqual([p.status, p.reason, p.runner], ['unavailable', 'timeout', 'content']);
});
