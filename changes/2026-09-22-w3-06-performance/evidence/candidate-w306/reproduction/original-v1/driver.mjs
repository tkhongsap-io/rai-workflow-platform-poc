// REVIEW ONLY until explicit parent GO. No DB provisioning, reset, recovery or custom measurements.
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Api, hash, queueShape, expectedQueue, validateManifest } from '../../tests/performance/core.ts';
import { guardLaunch, ownerDisplayName, SCENARIO } from '../../tests/performance/server-contract.ts';
import { startPerformanceServer } from '../../tests/performance/server-launcher.ts';
import { seed } from '../../tests/performance/queue-seed.ts';
import { recipe } from '../../tests/performance/seed-recipe.ts';
import { measure } from '../../tests/performance/queue-measure.ts';
import { measureSurfaces } from '../../tests/performance/surface-measure.ts';
import { measurePages } from '../../tests/performance/page-measure.ts';

const OWNER = 'fx-user-owner-cm';
const SUBJECT = `fixture:${OWNER}`;
const REVIEWERS = { ai_coe: 'fx-user-ai-coe', dpo: 'fx-user-dpo', it_security: 'fx-user-it-security' };
let stage = 'input-gates';
const sha = (data) => createHash('sha256').update(data).digest('hex');
const jsonFile = async (file) => JSON.parse(await readFile(file, 'utf8'));
const exclusive = (file, data) => writeFile(file, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function mutationRecipe(key) {
  return {
    source_record_id: `TPM-SYNTHETIC-PERF-MUT-${key}`,
    use_case_name: `SYNTHETIC-PERF-MUT-${key}`,
    owner_subject_id: SUBJECT,
    business_owner: ownerDisplayName(SUBJECT),
    business_unit_id: 'CM',
    business_unit: 'CM',
    technical_owner: 'Synthetic performance owner',
    created_by: SUBJECT,
    vendor_involved: false,
    model_type: 'llm',
    maxVersion: key === 46 ? 2 : 1,
  };
}
function launchConfig(input, target) {
  return {
    queue: input.queue,
    mutation: input.mutation,
    target,
    fixtureSha256: input.fixtureSha256,
    serverRoot: input.serverRoot,
    resourceRoot: input.resourceRoots[target],
    scenario: SCENARIO,
    mutationCases: Array.from({ length: 48 }, (_, key) => mutationRecipe(key)),
  };
}
async function gates(mode, inputPath) {
  assert(['setup', 'measure'].includes(mode), 'usage: driver.mjs setup|measure ABSOLUTE_INPUT_PATH');
  assert(path.isAbsolute(inputPath));
  const stat = await lstat(inputPath);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const input = await jsonFile(inputPath);
  assert.equal(input.go[mode], 'parent-explicit-go', 'approval token is required, not proof of authority');
  assert.equal(input.review.driverSha256, sha(await readFile(fileURLToPath(import.meta.url))));
  assert.equal(input.review.clean, true);
  for (const field of [
    'localIntegrationClean',
    'localRealBrowserClean',
    'localTestsIdle',
    'freshDatabasesProvisioned',
    'matchingFixturesLoaded',
    'finalSelectorsReviewed',
  ])
    assert.equal(input.attestations[field], true, field);
  assert(/^[a-f0-9]{40}$/.test(input.candidateIntHead));
  assert.equal(git('rev-parse', input.candidateIntHead), input.candidateIntHead);
  assert.equal(input.queue.finalHead, git('rev-parse', 'HEAD'));
  assert.equal(input.mutation.finalHead, input.queue.finalHead);
  assert.equal(await realpath(input.serverRoot), await realpath('.'));
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  assert.equal(input.queue.baseUrl, 'http://127.0.0.1:60870');
  assert.equal(input.mutation.baseUrl, 'http://127.0.0.1:60871');
  assert.equal(input.runId, 'w306_20260923_a01');
  assert.equal(input.queue.target.database, `rai_perf_queue_${input.runId}`);
  assert.equal(input.mutation.target.database, `rai_perf_mutation_${input.runId}`);
  assert.equal(
    await realpath(input.artifactDir),
    path.join(await realpath('.'), '.local/performance', input.runId),
  );
  for (const target of ['queue', 'mutation']) {
    guardLaunch(launchConfig(input, target));
    assert.equal(
      await realpath(input.resourceRoots[target]),
      `/private/tmp/rai-perf-${target}-${input.runId}`,
    );
  }
  const fingerprint = await readFile(input.productionFingerprint.path);
  assert.equal(sha(fingerprint), input.productionFingerprint.sha256);
  const identity = JSON.parse(fingerprint);
  assert.equal(identity.candidateIntHead, input.candidateIntHead);
  assert.equal(identity.builtHead, input.queue.finalHead);
  assert.equal(identity.productionConfigCompared, true);
  assert(Array.isArray(identity.inventory) && identity.inventory.length > 0);
  assert.equal(input.responseFinishVerified, true);
  assert(typeof input.machine === 'string' && input.machine.trim());
  const selectors = await jsonFile(input.selectors.path);
  assert.equal(sha(await readFile(input.selectors.path)), input.selectors.sha256);
  assert.equal(selectors.reviewedBuiltHead, input.queue.finalHead);
  assert.equal(selectors.reviewed, true);
  assert.deepEqual(selectors.pages.map((x) => x.kind).sort(), [
    'editor',
    'history',
    'overview',
    'queue',
    'reviewer',
  ]);
  const actors = {
    queue: 'fx-user-dpo',
    overview: OWNER,
    editor: OWNER,
    reviewer: 'fx-user-ai-coe',
    history: OWNER,
  };
  for (const page of selectors.pages) {
    assert.equal(page.actor, actors[page.kind]);
    assert(page.visible.length && page.absent.length);
    assert(page.absent.includes('.notice-error'));
  }
  return { input, selectors };
}
async function signedIn(baseUrl, actor) {
  const api = new Api(baseUrl);
  await api.signIn(actor);
  return api;
}
async function readyDraft(owner, caseId) {
  const root = `/api/cases/${caseId}`;
  const draft = await owner.json(`${root}/draft`);
  const slots = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, { state: 'not_yet' }]));
  return owner.json(`${root}/draft`, 'PUT', {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    stageContext: 'pre_build',
    slots,
  });
}
async function submit(owner, control, caseId, number, parentVersionId) {
  const saved = await readyDraft(owner, caseId);
  const response = await owner.raw(`/api/cases/${caseId}/draft/submit`, 'POST', {
    expectedVersion: { versionId: saved.draftId, revision: saved.draftRevision },
  });
  assert.equal(response.status, 201);
  assert(response.correlationId);
  const version = JSON.parse(response.text);
  assert.equal(version.caseId, caseId);
  assert.equal(version.versionId, saved.draftId);
  assert.equal(version.versionNumber, number);
  assert.equal(version.parentVersionId, parentVersionId);
  await control.submit({ caseId, versionId: version.versionId, correlationId: response.correlationId });
  return version;
}
async function approve(owner, reviewers, caseId, versionId) {
  for (const lane of Object.keys(REVIEWERS)) {
    const endpoint = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
    const view = await owner.json(`/api/cases/${caseId}`);
    const qc = await reviewers[lane].json(`${endpoint}/qc-run`, 'POST', {
      expectedVersion: { versionId, revision: view.caseRevision },
    });
    assert.equal(qc.status, 'completed');
    assert(qc.runId);
    assert.equal(qc.findings.length, 0);
    const refreshed = await owner.json(`/api/cases/${caseId}`);
    const decision = await reviewers[lane].json(`${endpoint}/approve`, 'POST', {
      expectedVersion: { versionId, revision: refreshed.caseRevision },
      qcRunId: qc.runId,
    });
    if (lane === 'it_security') assert.equal(decision.ready, true);
  }
  assert.equal((await owner.json(`/api/cases/${caseId}`)).status, 'ready_for_launch');
}
async function prepareMutation(input) {
  const dir = input.artifactDir;
  const control = await startPerformanceServer(
    path.join(dir, 'mutation-launch.json'),
    path.join(dir, 'mutation-setup-server.jsonl'),
  );
  try {
    const owner = await signedIn(input.mutation.baseUrl, OWNER);
    const admin = await signedIn(input.mutation.baseUrl, 'fx-user-admin');
    const initial = await admin.json('/api/queue?pageSize=100');
    queueShape(initial);
    assert.equal(initial.total, 5);
    assert(initial.items.every((x) => x.status === 'draft' && x.currentVersionNumber === null));
    const configuration = await owner.json('/api/configuration/current');
    assert(configuration.useCaseGroups.length);
    const bindings = [],
      submissions = [];
    // Append-only journal intentionally contains only synthetic IDs, never sessions or response bodies.
    await writeFile(
      path.join(dir, 'mutation-created.jsonl'),
      JSON.stringify({ phase: 'INCOMPLETE' }) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    for (let key = 0; key < 48; key++) {
      const row = mutationRecipe(key);
      const created = await owner.json('/api/cases', 'POST', {
        sourceRecordId: { kind: 'known', value: row.source_record_id },
        useCaseName: row.use_case_name,
        businessOwner: row.owner_subject_id,
        businessUnitId: row.business_unit_id,
        businessUnit: row.business_unit,
        technicalOwner: row.technical_owner,
        vendorInvolved: false,
        modelType: 'llm',
        useCaseGroup: configuration.useCaseGroups[key % configuration.useCaseGroups.length],
      });
      bindings.push({ key, caseId: created.caseId });
      await appendFile(path.join(dir, 'mutation-created.jsonl'), JSON.stringify(bindings.at(-1)) + '\n');
      assert.equal(created.businessOwner, SUBJECT);
      assert.equal(created.useCaseName, row.use_case_name);
      await control.enroll(key, created.caseId);
      if (key <= 45) {
        const draft = await readyDraft(owner, created.caseId);
        if (key < 45)
          submissions.push({
            caseId: created.caseId,
            versionId: draft.draftId,
            revision: draft.draftRevision,
          });
      }
    }
    const reviewers = {};
    for (const [lane, actor] of Object.entries(REVIEWERS))
      reviewers[lane] = await signedIn(input.mutation.baseUrl, actor);
    const historyCase = bindings[46].caseId;
    const v1 = await submit(owner, control, historyCase, 1, null);
    const beforeSendBack = await owner.json(`/api/cases/${historyCase}`);
    const sentBack = await reviewers.ai_coe.json(
      `/api/cases/${historyCase}/versions/${v1.versionId}/lanes/ai_coe/send-back`,
      'POST',
      {
        expectedVersion: { versionId: v1.versionId, revision: beforeSendBack.caseRevision },
        feedback: { items: [{ slot: 1, deficiency: 'Synthetic performance correction cycle' }] },
      },
    );
    assert(sentBack.successorDraftVersionId);
    const v2 = await submit(owner, control, historyCase, 2, v1.versionId);
    assert.equal(v2.versionId, sentBack.successorDraftVersionId);
    const readyCase = bindings[47].caseId;
    const readyVersion = await submit(owner, control, readyCase, 1, null);
    await approve(owner, reviewers, readyCase, readyVersion.versionId);
    await control.settled();
    const final = await admin.json('/api/queue?pageSize=100');
    queueShape(final);
    assert.equal(final.total, 53);
    const resources = {
      submissions,
      uploadCaseId: bindings[45].caseId,
      mutationActor: OWNER,
      pages: {
        editor: { caseId: bindings[45].caseId },
        overview: { caseId: readyCase },
        reviewer: { caseId: historyCase, versionId: v2.versionId },
        history: { caseId: historyCase, versionId: v1.versionId },
      },
    };
    await exclusive(path.join(dir, 'mutation-bindings.json'), bindings);
    await exclusive(path.join(dir, 'mutation-resources.json'), resources);
    return resources;
  } finally {
    await control.stop();
  }
}
async function selectedReads(input, manifest) {
  const owner = await signedIn(input.queue.baseUrl, OWNER);
  const admin = await signedIn(input.queue.baseUrl, 'fx-user-admin');
  const draftRow = manifest.rows.find((x) => x.businessOwner === SUBJECT && x.status === 'draft');
  const versionRow = manifest.rows.find((x) => x.businessOwner === SUBJECT && x.currentVersionNumber === 2);
  assert(draftRow && versionRow);
  const view = await owner.json(`/api/cases/${versionRow.caseId}`);
  assert(view.currentVersion);
  const draft = await owner.json(`/api/cases/${draftRow.caseId}/draft`);
  const version = await owner.json(`/api/cases/${view.caseId}/versions/${view.currentVersion.versionId}`);
  const history = await owner.json(`/api/cases/${view.caseId}/versions`);
  assert.equal(history.items.length, 2);
  assert.equal(version.versionNumber, 2);
  const session = await owner.json('/api/session');
  assert.equal(session.principal.subjectId, SUBJECT);
  const operator = await admin.json('/api/operator/desk-health');
  for (const field of ['failedMail', 'unavailableQc', 'lateQc']) assert.deepEqual(operator[field], []);
  return [
    {
      name: 'session',
      kind: 'session',
      actor: OWNER,
      ids: {},
      expected: { identityMode: 'fixture', locale: 'th' },
    },
    {
      name: 'case',
      kind: 'case',
      actor: OWNER,
      ids: { caseId: view.caseId },
      expected: { caseId: view.caseId, useCaseName: view.useCaseName, status: view.status },
    },
    {
      name: 'draft',
      kind: 'draft',
      actor: OWNER,
      ids: { caseId: draftRow.caseId },
      expected: { draftId: draft.draftId, draftRevision: draft.draftRevision },
    },
    {
      name: 'version',
      kind: 'version',
      actor: OWNER,
      ids: { caseId: view.caseId, versionId: version.versionId },
      expected: {
        caseId: view.caseId,
        versionId: version.versionId,
        versionNumber: 2,
        parentVersionId: version.parentVersionId,
      },
    },
    {
      name: 'history',
      kind: 'history',
      actor: OWNER,
      ids: { caseId: view.caseId },
      expected: { items: history.items },
    },
    {
      name: 'operator',
      kind: 'operator',
      actor: 'fx-user-admin',
      ids: {},
      expected: { failedMail: [], unavailableQc: [], lateQc: [] },
    },
  ];
}
function boundPages(selectors, resources, manifest) {
  const first = expectedQueue(manifest.rows, 'fx-user-dpo', {}).items[0];
  assert(first);
  return selectors.pages.map((page) => {
    const ids = page.kind === 'queue' ? {} : resources.pages[page.kind];
    const values = { ...ids, firstQueueCaseId: first.caseId };
    const bind = (text) =>
      text.replace(/\{([A-Za-z]+)\}/g, (_, key) => {
        assert(values[key], `unbound selector ${key}`);
        return values[key];
      });
    return {
      kind: page.kind,
      actor: page.actor,
      ids,
      visible: page.visible.map(bind),
      absent: page.absent.map(bind),
    };
  });
}
async function setup(input, selectors) {
  const dir = input.artifactDir;
  await exclusive(path.join(dir, 'setup-started.json'), {
    state: 'INCOMPLETE',
    candidateIntHead: input.candidateIntHead,
    builtHead: input.queue.finalHead,
    driverSha256: input.review.driverSha256,
  });
  for (const target of ['queue', 'mutation'])
    await exclusive(path.join(dir, `${target}-launch.json`), launchConfig(input, target));
  stage = 'mutation-setup';
  const resources = await prepareMutation(input); // Fail on small mutation proof BEFORE 995-case queue seed.
  let completion;
  const control = await startPerformanceServer(
    path.join(dir, 'queue-launch.json'),
    path.join(dir, 'queue-setup-server.jsonl'),
  );
  try {
    stage = 'queue-seed';
    const manifest = await seed(input.queue, path.join(dir, 'queue-manifest.json'), control);
    validateManifest(manifest, input.queue.finalHead);
    const queueSelections = [
      { actor: 'fx-user-dpo', query: { pageSize: 100 } },
      { actor: 'fx-user-spoc-cm', query: { search: 'ทดสอบ', pageSize: 100 } },
      { actor: OWNER, query: {} },
      { actor: 'fx-user-owner-cm-2', query: {} },
      { actor: 'fx-user-admin', query: { page: 10, pageSize: 100 } },
      { actor: 'fx-user-admin', query: { search: '%_!\\', pageSize: 100 } },
    ];
    for (const choice of queueSelections)
      assert(expectedQueue(manifest.rows, choice.actor, choice.query).items.length > 0);
    const plan = {
      queue: input.queue,
      mutation: input.mutation,
      evidence: {
        startupVerified: true,
        responseFinishVerified: input.responseFinishVerified,
        qcScenarioApproved: SCENARIO,
        machine: input.machine,
      },
      outputPrefix: path.join(dir, 'profiles'),
      ...resources,
      queueSelections,
      reads: await selectedReads(input, manifest),
      pages: boundPages(selectors, resources, manifest),
    };
    await control.settled();
    await exclusive(path.join(dir, 'measurement-plan.json'), plan);
    completion = {
      planHash: hash(plan),
      candidateIntHead: input.candidateIntHead,
      builtHead: input.queue.finalHead,
      driverSha256: input.review.driverSha256,
      productionFingerprint: input.productionFingerprint,
      selectorSha256: input.selectors.sha256,
      manifestHash: manifest.sha256,
      mutationBindingsHash: hash(await jsonFile(path.join(dir, 'mutation-bindings.json'))),
    };
  } finally {
    await control.stop();
  }
  await exclusive(path.join(dir, 'setup-complete.json'), completion);
}
async function measurement(input) {
  const dir = input.artifactDir;
  const complete = await jsonFile(path.join(dir, 'setup-complete.json'));
  const raw = await jsonFile(path.join(dir, 'measurement-plan.json'));
  const manifest = await jsonFile(path.join(dir, 'queue-manifest.json'));
  const bindings = await jsonFile(path.join(dir, 'mutation-bindings.json'));
  assert.equal(complete.mutationBindingsHash, hash(bindings));
  assert.equal(complete.planHash, hash(raw));
  assert.equal(complete.manifestHash, manifest.sha256);
  assert.equal(complete.candidateIntHead, input.candidateIntHead);
  assert.equal(complete.builtHead, input.queue.finalHead);
  assert.equal(complete.driverSha256, input.review.driverSha256);
  assert.equal(complete.selectorSha256, input.selectors.sha256);
  assert.deepEqual(complete.productionFingerprint, input.productionFingerprint);
  validateManifest(manifest, input.queue.finalHead);
  assert.deepEqual(raw.queue, input.queue);
  assert.deepEqual(raw.mutation, input.mutation);
  assert.equal(bindings.length, 48);
  assert.equal(new Set(bindings.map((x) => x.key)).size, 48);
  assert.deepEqual(
    bindings.map((x) => x.key).sort((a, b) => a - b),
    Array.from({ length: 48 }, (_, i) => i),
  );
  assert.equal(new Set(bindings.map((x) => x.caseId)).size, 48);
  for (const target of ['queue', 'mutation'])
    assert.deepEqual(await jsonFile(path.join(dir, `${target}-launch.json`)), launchConfig(input, target));
  await exclusive(path.join(dir, 'measurement-started.json'), {
    state: 'INCOMPLETE',
    candidateIntHead: input.candidateIntHead,
    planHash: complete.planHash,
  });
  const plan = { ...raw, readLog: (target) => readFile(path.join(dir, `${target}-server.jsonl`), 'utf8') };
  const queue = await startPerformanceServer(
    path.join(dir, 'queue-launch.json'),
    path.join(dir, 'queue-server.jsonl'),
  );
  try {
    const mutation = await startPerformanceServer(
      path.join(dir, 'mutation-launch.json'),
      path.join(dir, 'mutation-server.jsonl'),
    );
    try {
      for (let key = 0; key < 995; key++) {
        const source = recipe(key).sourceRecordId.value;
        const matches = manifest.rows.filter(
          (row) => row.sourceRecordId.kind === 'known' && row.sourceRecordId.value === source,
        );
        assert.equal(matches.length, 1);
        await queue.enroll(key, matches[0].caseId);
      }
      for (const row of bindings) await mutation.enroll(row.key, row.caseId);
      await queue.settled();
      await mutation.settled();
      stage = 'queue-measurement';
      await measure(
        input.queue,
        manifest,
        raw.queueSelections,
        path.join(dir, 'queue-samples.jsonl'),
        () => plan.readLog('queue'),
        queue,
      );
      stage = 'surface-measurement';
      await measureSurfaces(plan, { queue, mutation });
      stage = 'page-measurement';
      await measurePages(plan, { queue, mutation });
    } finally {
      await mutation.stop();
    }
  } finally {
    await queue.stop();
  }
  await exclusive(path.join(dir, 'measurement-complete.json'), {
    candidateEvidenceOnly: true,
    candidateIntHead: input.candidateIntHead,
    builtHead: input.queue.finalHead,
    planHash: complete.planHash,
  });
}
const mode = process.argv[2],
  inputPath = process.argv[3];
// Explicit executable entry: never import this driver from a test or another module.
try {
  const { input, selectors } = await gates(mode, inputPath);
  await (mode === 'setup' ? setup(input, selectors) : measurement(input));
  console.log(JSON.stringify({ event: 'performance_driver_complete', stage }));
} catch {
  // Assertion/provider errors may contain private configuration. Retain stage and private artifacts only.
  console.error(JSON.stringify({ event: 'performance_driver_failed', stage, partialEvidenceRetained: true }));
  process.exitCode = 1;
}
