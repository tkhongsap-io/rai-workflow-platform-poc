// `npm run perf:run -- <plan.json>` (from rai-web): the one entry point of the synthetic performance harness.
// The plan's mode picks one step; the runbook in changes/2026-09-22-w3-06-performance/ covers the preparation.
//   smoke   - mutation server only: 48 cases through the real API, one of them to Ready (a fresh, fixture-loaded DB);
//   setup   - smoke, then the 995-case queue seed and measurement-plan.json;
//   measure - both servers on a finished setup: queue, JSON/HTTP and page profiles.
// Every output is created exclusively under artifactDir, so a step never overwrites, resumes or resets another.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest } from '@rai/fixtures/manifest';
import type { CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { Lane, LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { Api, expectedQueue, queueShape, validateManifest, type Manifest, type RunConfig } from './core.js';
import {
  guardLaunch,
  ownerDisplayName,
  SCENARIO,
  type Controls,
  type ExpectedCase,
  type LaunchConfig,
} from './server-contract.js';
import { startPerformanceServer } from './server-launcher.js';
import { seed } from './queue-seed.js';
import { recipe } from './seed-recipe.js';
import { measure, type Selection } from './queue-measure.js';
import { measureSurfaces, type SurfacePlan } from './surface-measure.js';
import { measurePages, type PagePlan } from './page-measure.js';

type Target = 'queue' | 'mutation';
type PageSelectors = Omit<PagePlan['pages'][number], 'ids'>;
interface RunPlan {
  mode: 'smoke' | 'setup' | 'measure';
  artifactDir: string;
  /** Immediate children of the launcher's canonical temp directory, each holding blobs/ and mail/. */
  resourceRoots: Record<Target, string>;
  queue: RunConfig;
  mutation: RunConfig;
  machine: string;
  responseFinishVerified: true;
  /** Selectors may name {caseId}, {versionId} and {firstQueueCaseId}; setup binds them to the seeded cases. */
  pages: PageSelectors[];
}
type Resources = Pick<SurfacePlan, 'submissions' | 'uploadCaseId' | 'mutationActor'> & {
  pages: Record<Exclude<PagePlan['pages'][number]['kind'], 'queue'>, Record<string, string>>;
};
type MeasurementPlan = Omit<SurfacePlan & PagePlan, 'readLog'> & { queueSelections: Selection[] };
interface Binding {
  key: number;
  caseId: string;
}

const OWNER = 'fx-user-owner-cm';
const SUBJECT = `fixture:${OWNER}`;
const REVIEWERS: Record<Lane, string> = {
  ai_coe: 'fx-user-ai-coe',
  dpo: 'fx-user-dpo',
  it_security: 'fx-user-it-security',
};
// Keys 0-44 are the measured submit drafts, 45 the editor/upload draft, 46 the two-version case, 47 the Ready case.
const MUTATION_CASES = 48;
const QUEUE_CASES = 995;

const planFile = process.argv[2];
assert(planFile, 'usage: npm run perf:run -- <plan.json>');
const plan = JSON.parse(await readFile(planFile, 'utf8')) as RunPlan;
assert(['smoke', 'setup', 'measure'].includes(plan.mode), 'mode must be smoke, setup or measure');
const dir = path.resolve(plan.artifactDir);
const file = (name: string) => path.join(dir, name);
const readJson = async <T>(name: string) => JSON.parse(await readFile(file(name), 'utf8')) as T;
const exclusive = (name: string, data: unknown) =>
  writeFile(file(name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
const start = (target: Target, log: string) =>
  startPerformanceServer(file(`${target}-launch.json`), file(log));
let stage = 'plan';

function mutationCase(key: number): ExpectedCase {
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
function launchConfig(target: Target): LaunchConfig {
  return {
    queue: plan.queue,
    mutation: plan.mutation,
    target,
    fixtureSha256: readManifest().sha256,
    serverRoot: fileURLToPath(new URL('../../', import.meta.url)),
    resourceRoot: plan.resourceRoots[target],
    scenario: SCENARIO,
    mutationCases: Array.from({ length: MUTATION_CASES }, (_, key) => mutationCase(key)),
  };
}
async function signedIn(baseUrl: string, actor: string) {
  const api = new Api(baseUrl);
  await api.signIn(actor);
  return api;
}
async function readyDraft(owner: Api, caseId: string) {
  const root = `/api/cases/${caseId}`;
  const draft = await owner.json<PackDraft>(`${root}/draft`);
  const slots = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, { state: 'not_yet' }]));
  return owner.json<PackDraft>(`${root}/draft`, 'PUT', {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
    stageContext: 'pre_build',
    slots,
  });
}
async function submit(
  owner: Api,
  control: Controls,
  caseId: string,
  versionNumber: number,
  parentVersionId: string | null,
) {
  const saved = await readyDraft(owner, caseId);
  const response = await owner.raw(`/api/cases/${caseId}/draft/submit`, 'POST', {
    expectedVersion: { versionId: saved.draftId, revision: saved.draftRevision },
  });
  assert.equal(response.status, 201);
  assert(response.correlationId);
  const version = JSON.parse(response.text) as SubmittedVersion;
  assert.equal(version.caseId, caseId);
  assert.equal(version.versionId, saved.draftId);
  assert.equal(version.versionNumber, versionNumber);
  assert.equal(version.parentVersionId, parentVersionId);
  await control.submit({ caseId, versionId: version.versionId, correlationId: response.correlationId });
  return version;
}
async function approve(owner: Api, reviewers: Record<Lane, Api>, caseId: string, versionId: string) {
  for (const lane of Object.keys(REVIEWERS) as Lane[]) {
    const endpoint = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
    const view = await owner.json<CaseView>(`/api/cases/${caseId}`);
    const qc = await reviewers[lane].json<LaneQcRunResponse>(`${endpoint}/qc-run`, 'POST', {
      expectedVersion: { versionId, revision: view.caseRevision },
    });
    assert(qc.status === 'completed' && qc.runId && qc.findings.length === 0, 'unexpected QC');
    const refreshed = await owner.json<CaseView>(`/api/cases/${caseId}`);
    const decision = await reviewers[lane].json<LaneDecisionResponse>(`${endpoint}/approve`, 'POST', {
      expectedVersion: { versionId, revision: refreshed.caseRevision },
      qcRunId: qc.runId,
    });
    if (lane === 'it_security') assert.equal(decision.ready, true);
  }
  assert.equal((await owner.json<CaseView>(`/api/cases/${caseId}`)).status, 'ready_for_launch');
}

/** Real API preparation of the mutation dataset; the smoke is exactly this step. */
async function prepareMutation(): Promise<Resources> {
  const control = await start('mutation', 'mutation-setup-server.jsonl');
  try {
    const owner = await signedIn(plan.mutation.baseUrl, OWNER);
    const admin = await signedIn(plan.mutation.baseUrl, 'fx-user-admin');
    const initial = await admin.json<unknown>('/api/queue?pageSize=100');
    queueShape(initial);
    assert.equal(initial.total, 5, 'the mutation database must hold exactly the canonical fixtures');
    assert(initial.items.every((x) => x.status === 'draft' && x.currentVersionNumber === null));
    const { useCaseGroups } = await owner.json<ConfigurationView>('/api/configuration/current');
    assert(useCaseGroups.length);
    const bindings: Binding[] = [];
    const submissions: Resources['submissions'] = [];
    for (let key = 0; key < MUTATION_CASES; key++) {
      const row = mutationCase(key);
      const created = await owner.json<CaseView>('/api/cases', 'POST', {
        sourceRecordId: { kind: 'known', value: row.source_record_id },
        useCaseName: row.use_case_name,
        businessOwner: row.owner_subject_id,
        businessUnitId: row.business_unit_id,
        businessUnit: row.business_unit,
        technicalOwner: row.technical_owner,
        vendorInvolved: false,
        modelType: 'llm',
        useCaseGroup: useCaseGroups[key % useCaseGroups.length],
      });
      assert.equal(created.businessOwner, SUBJECT);
      assert.equal(created.useCaseName, row.use_case_name);
      bindings.push({ key, caseId: created.caseId });
      await control.enroll(key, created.caseId);
      if (key > 45) continue;
      const draft = await readyDraft(owner, created.caseId);
      if (key < 45)
        submissions.push({ caseId: created.caseId, versionId: draft.draftId, revision: draft.draftRevision });
    }
    const reviewers = {} as Record<Lane, Api>;
    for (const [lane, actor] of Object.entries(REVIEWERS) as [Lane, string][])
      reviewers[lane] = await signedIn(plan.mutation.baseUrl, actor);
    const historyCase = bindings[46]!.caseId;
    const v1 = await submit(owner, control, historyCase, 1, null);
    const beforeSendBack = await owner.json<CaseView>(`/api/cases/${historyCase}`);
    const sentBack = await reviewers.ai_coe.json<LaneDecisionResponse>(
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
    const readyCase = bindings[47]!.caseId;
    const readyVersion = await submit(owner, control, readyCase, 1, null);
    await approve(owner, reviewers, readyCase, readyVersion.versionId);
    await control.settled();
    const final = await admin.json<unknown>('/api/queue?pageSize=100');
    queueShape(final);
    assert.equal(final.total, 5 + MUTATION_CASES);
    const resources: Resources = {
      submissions,
      uploadCaseId: bindings[45]!.caseId,
      mutationActor: OWNER,
      pages: {
        editor: { caseId: bindings[45]!.caseId },
        // Overview redirects to the Ready case's current version, so its final route needs that version too.
        overview: { caseId: readyCase, versionId: readyVersion.versionId },
        reviewer: { caseId: historyCase, versionId: v2.versionId },
        history: { caseId: historyCase, versionId: v1.versionId },
      },
    };
    await exclusive('mutation-bindings.json', bindings);
    await exclusive('mutation-resources.json', resources);
    return resources;
  } finally {
    await control.stop();
  }
}
async function selectedReads(rows: QueueResponse['items']): Promise<SurfacePlan['reads']> {
  const owner = await signedIn(plan.queue.baseUrl, OWNER);
  const admin = await signedIn(plan.queue.baseUrl, 'fx-user-admin');
  const draftRow = rows.find((x) => x.businessOwner === SUBJECT && x.status === 'draft');
  const versionRow = rows.find((x) => x.businessOwner === SUBJECT && x.currentVersionNumber === 2);
  assert(draftRow && versionRow);
  const view = await owner.json<CaseView>(`/api/cases/${versionRow.caseId}`);
  assert(view.currentVersion);
  const draft = await owner.json<PackDraft>(`/api/cases/${draftRow.caseId}/draft`);
  const version = await owner.json<SubmittedVersion>(
    `/api/cases/${view.caseId}/versions/${view.currentVersion.versionId}`,
  );
  const history = await owner.json<{ items: unknown[] }>(`/api/cases/${view.caseId}/versions`);
  assert.equal(history.items.length, 2);
  assert.equal(version.versionNumber, 2);
  assert.equal((await owner.json<SessionInfo>('/api/session')).principal.subjectId, SUBJECT);
  const operator = await admin.json<DeskHealthReport>('/api/operator/desk-health');
  for (const field of ['failedMail', 'unavailableQc', 'lateQc'] as const)
    assert.deepEqual(operator[field], []);
  const ids = {
    session: {},
    case: { caseId: view.caseId },
    draft: { caseId: draftRow.caseId },
    version: { caseId: view.caseId, versionId: version.versionId },
    history: { caseId: view.caseId },
    operator: {},
  };
  const read = (
    name: keyof typeof ids,
    actor: string,
    expected: Record<string, unknown>,
  ): SurfacePlan['reads'][number] => ({ name, kind: name, actor, ids: ids[name], expected });
  return [
    read('session', OWNER, { identityMode: 'fixture', locale: 'th' }),
    read('case', OWNER, { caseId: view.caseId, useCaseName: view.useCaseName, status: view.status }),
    read('draft', OWNER, { draftId: draft.draftId, draftRevision: draft.draftRevision }),
    read('version', OWNER, {
      caseId: view.caseId,
      versionId: version.versionId,
      versionNumber: 2,
      parentVersionId: version.parentVersionId,
    }),
    read('history', OWNER, { items: history.items }),
    read('operator', 'fx-user-admin', { failedMail: [], unavailableQc: [], lateQc: [] }),
  ];
}
function boundPages(resources: Resources, rows: QueueResponse['items']): PagePlan['pages'] {
  const first = expectedQueue(rows, 'fx-user-dpo', {}).items[0];
  assert(first);
  return plan.pages.map((page) => {
    const ids = page.kind === 'queue' ? {} : resources.pages[page.kind];
    const values: Record<string, string> = { ...ids, firstQueueCaseId: first.caseId };
    const bind = (text: string) =>
      text.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
        assert(values[key], `unbound selector ${key}`);
        return values[key];
      });
    return { ...page, ids, visible: page.visible.map(bind), absent: page.absent.map(bind) };
  });
}
async function setup(resources: Resources) {
  const control = await start('queue', 'queue-setup-server.jsonl');
  try {
    stage = 'queue-seed';
    const manifest = await seed(plan.queue, file('queue-manifest.json'), control);
    const queueSelections: Selection[] = [
      { actor: 'fx-user-dpo', query: { pageSize: 100 } },
      { actor: 'fx-user-spoc-cm', query: { search: 'ทดสอบ', pageSize: 100 } },
      { actor: OWNER, query: {} },
      { actor: 'fx-user-owner-cm-2', query: {} },
      { actor: 'fx-user-admin', query: { page: 10, pageSize: 100 } },
      { actor: 'fx-user-admin', query: { search: '%_!\\', pageSize: 100 } },
    ];
    for (const { actor, query } of queueSelections)
      assert(expectedQueue(manifest.rows, actor, query).items.length > 0, 'empty queue selection');
    const measurementPlan: MeasurementPlan = {
      queue: plan.queue,
      mutation: plan.mutation,
      evidence: {
        startupVerified: true,
        responseFinishVerified: plan.responseFinishVerified,
        qcScenarioApproved: SCENARIO,
        machine: plan.machine,
      },
      outputPrefix: file('profiles'),
      ...resources,
      queueSelections,
      reads: await selectedReads(manifest.rows),
      pages: boundPages(resources, manifest.rows),
    };
    await control.settled();
    await exclusive('measurement-plan.json', measurementPlan);
  } finally {
    await control.stop();
  }
}
async function measurement() {
  const measurementPlan = await readJson<MeasurementPlan>('measurement-plan.json');
  const manifest = await readJson<Manifest>('queue-manifest.json');
  const bindings = await readJson<Binding[]>('mutation-bindings.json');
  validateManifest(manifest, plan.queue.finalHead);
  assert.deepEqual(measurementPlan.queue, plan.queue);
  assert.deepEqual(measurementPlan.mutation, plan.mutation);
  for (const target of ['queue', 'mutation'] as const)
    assert.deepEqual(await readJson(`${target}-launch.json`), launchConfig(target));
  const readLog = (target: Target) => readFile(file(`${target}-server.jsonl`), 'utf8');
  const queue = await start('queue', 'queue-server.jsonl');
  try {
    const mutation = await start('mutation', 'mutation-server.jsonl');
    try {
      stage = 'enrollment';
      for (let key = 0; key < QUEUE_CASES; key++) {
        const source = recipe(key).sourceRecordId.value;
        const matches = manifest.rows.filter(
          (row) => row.sourceRecordId.kind === 'known' && row.sourceRecordId.value === source,
        );
        assert.equal(matches.length, 1);
        await queue.enroll(key, matches[0]!.caseId);
      }
      for (const row of bindings) await mutation.enroll(row.key, row.caseId);
      stage = 'queue-measurement';
      await measure(
        plan.queue,
        manifest,
        measurementPlan.queueSelections,
        file('queue-samples.jsonl'),
        () => readLog('queue'),
        queue,
      );
      stage = 'surface-measurement';
      await measureSurfaces({ ...measurementPlan, readLog }, { queue, mutation });
      stage = 'page-measurement';
      await measurePages({ ...measurementPlan, readLog }, { queue, mutation });
    } finally {
      await mutation.stop();
    }
  } finally {
    await queue.stop();
  }
}

try {
  for (const target of ['queue', 'mutation'] as const) guardLaunch(launchConfig(target));
  if (plan.mode === 'measure') await measurement();
  else {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const target of ['queue', 'mutation'] as const)
      await exclusive(`${target}-launch.json`, launchConfig(target));
    stage = 'mutation-setup';
    const resources = await prepareMutation();
    if (plan.mode === 'setup') await setup(resources);
  }
  console.log(JSON.stringify({ event: 'performance_run_complete', mode: plan.mode, artifactDir: dir }));
} catch {
  // Assertion text can echo role URLs and their passwords; the stage and the retained files are the diagnosis.
  console.error(JSON.stringify({ event: 'performance_run_failed', mode: plan.mode, stage }));
  process.exitCode = 1;
}
