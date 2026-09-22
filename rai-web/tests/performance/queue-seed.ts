import { checkControls, type Controls } from './server-contract.js';
import { Value } from 'typebox/value';
import { SendBackLaneRequestSchema } from '@rai/shared/schemas/review';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import type { CaseCreateRequest, CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import { PackDraftUpdateRequestSchema, type PackDraft, type SlotNumber } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type {
  Lane,
  LaneDecisionResponse,
  LaneQcRunResponse,
  ApproveLaneRequest,
} from '@rai/shared/schemas/review';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import { FIXTURE_CASES } from '@rai/fixtures/data/cases/index';
import { readManifest, fixtureSetLabel } from '@rai/fixtures/manifest';
import {
  Api,
  guard,
  hash,
  queueShape,
  expectedQueue,
  queuePath,
  validateManifest,
  type Manifest,
  type RunConfig,
} from './core.js';

export { recipe } from './seed-recipe.js';
import { ACTORS, recipe } from './seed-recipe.js';
/** No DB helper calls. Prerequisite: parent starts the built server on a dedicated, loaded fixture DB. */
export async function seed(config: RunConfig, manifestPath: string, controls: Controls): Promise<Manifest> {
  guard(config);
  checkControls(config, controls);
  // Reserve output before mutation; a partial run leaves a visible marker and is never resumed silently.
  await writeFile(manifestPath, 'INCOMPLETE: seeding not finished\n', { flag: 'wx', mode: 0o600 });
  const sessions = new Map<string, Api>();
  for (const id of [...ACTORS, 'fx-user-ai-coe', 'fx-user-it-security']) {
    const api = new Api(config.baseUrl);
    await api.signIn(id);
    sessions.set(id, api);
  }
  const admin = sessions.get('fx-user-admin')!;
  const initial = await admin.json<unknown>('/api/queue?pageSize=100');
  queueShape(initial);
  assert.equal(initial.total, 5);
  assert.deepEqual(initial.items.map((r) => r.caseId).sort(), FIXTURE_CASES.map((r) => r.caseId).sort());
  assert(
    initial.items.every((r) => r.status === 'draft' && r.latestVersionNumber === 1 && r.lanes.length === 0),
  );
  const configuration = await admin.json<ConfigurationView>('/api/configuration/current');
  assert(configuration.useCaseGroups.length);
  const planned = new Map<string, ReturnType<typeof recipe>>();
  for (let i = 0; i < 995; i++) {
    const plan = recipe(i),
      owner = sessions.get(plan.owner)!;
    const body: CaseCreateRequest = {
      useCaseName: plan.name,
      businessUnitId: plan.bu,
      businessUnit: plan.bu,
      businessOwner: `fixture:${plan.owner}`,
      technicalOwner: 'Synthetic performance owner',
      sourceRecordId: plan.sourceRecordId,
      useCaseGroup: configuration.useCaseGroups[plan.rank % configuration.useCaseGroups.length]!,
      vendorInvolved: false,
      modelType: 'llm',
    };
    const created = await owner.json<CaseView>('/api/cases', 'POST', body);
    const root = `/api/cases/${created.caseId}`;
    await controls.enroll(i, created.caseId);
    planned.set(created.caseId, plan);
    if (plan.status === 'draft') continue;
    async function submit(): Promise<SubmittedVersion> {
      const draft = await owner.json<PackDraft>(`${root}/draft`);
      const slots: Partial<Record<SlotNumber, { state: 'not_yet' }>> = {};
      for (let n = 1; n <= 9; n++) slots[n as SlotNumber] = { state: 'not_yet' };
      const patch = {
        expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
        stageContext: 'pre_build' as const,
        slots,
      };
      assert(Value.Check(PackDraftUpdateRequestSchema, patch));
      const saved = await owner.json<PackDraft>(`${root}/draft`, 'PUT', patch);
      const response = await owner.raw(`${root}/draft/submit`, 'POST', {
        expectedVersion: { versionId: saved.draftId, revision: saved.draftRevision },
      });
      assert.equal(response.status, 201);
      assert(response.correlationId);
      const committed = JSON.parse(response.text) as SubmittedVersion;
      await controls.submit({
        caseId: created.caseId,
        versionId: committed.versionId,
        correlationId: response.correlationId,
      });
      return committed;
    }
    let version = await submit();
    if (plan.status === 'sent_back' || plan.resubmit) {
      const view = await owner.json<CaseView>(root);
      const body = {
        expectedVersion: { versionId: version.versionId, revision: view.caseRevision },
        feedback: { items: [{ slot: 1 as const, deficiency: 'Synthetic performance correction cycle' }] },
      };
      assert(Value.Check(SendBackLaneRequestSchema, body));
      const result = await sessions
        .get('fx-user-ai-coe')!
        .json<LaneDecisionResponse>(
          `${root}/versions/${version.versionId}/lanes/ai_coe/send-back`,
          'POST',
          body,
        );
      assert(result.successorDraftVersionId);
      if (plan.resubmit) version = await submit();
    }
    if (plan.status === 'ready_for_launch') {
      for (const lane of ['ai_coe', 'dpo', 'it_security'] as Lane[]) {
        const actor = sessions.get(
          lane === 'ai_coe' ? 'fx-user-ai-coe' : lane === 'dpo' ? 'fx-user-dpo' : 'fx-user-it-security',
        )!;
        const view = await owner.json<CaseView>(root);
        const expectedVersion = { versionId: version.versionId, revision: view.caseRevision };
        const endpoint = `${root}/versions/${version.versionId}/lanes/${lane}`;
        const qc = await actor.json<LaneQcRunResponse>(`${endpoint}/qc-run`, 'POST', { expectedVersion });
        assert(
          qc.status === 'completed' && qc.runId && qc.findings.length === 0,
          'unexpected QC; never bypass findings',
        );
        const refreshed = await owner.json<CaseView>(root);
        const approval: ApproveLaneRequest = {
          expectedVersion: { versionId: version.versionId, revision: refreshed.caseRevision },
          qcRunId: qc.runId,
        };
        const result = await actor.json<LaneDecisionResponse>(`${endpoint}/approve`, 'POST', approval);
        if (lane === 'it_security') assert.equal(result.ready, true);
      }
    }
  }
  await controls.settled();
  const rows: QueueResponse['items'] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await admin.json<unknown>(queuePath({ page, pageSize: 100 }));
    queueShape(response);
    assert.equal(response.total, 1000);
    rows.push(...response.items);
  }
  for (const row of rows) {
    const plan = planned.get(row.caseId);
    if (!plan) {
      assert(initial.items.some((r) => r.caseId === row.caseId));
      continue;
    }
    assert.equal(row.status, plan.status);
    assert.equal(row.businessOwner, `fixture:${plan.owner}`);
    assert.equal(row.businessUnitId, plan.bu);
    assert.equal(row.useCaseName, plan.name);
    assert.deepEqual(row.sourceRecordId, plan.sourceRecordId);
    assert.equal(row.latestVersionNumber, plan.resubmit || plan.status === 'sent_back' ? 2 : 1);
    assert.equal(row.currentVersionNumber, plan.status === 'draft' ? null : plan.resubmit ? 2 : 1);
    assert.equal(row.lanes.length, plan.status === 'draft' ? 0 : 3);
  }
  const content = { head: config.finalHead, fixture: fixtureSetLabel(readManifest()), rows };
  const manifest = { ...content, sha256: hash(content) };
  validateManifest(manifest, config.finalHead);
  for (const actor of ACTORS) {
    for (const search of ['', 'ทดสอบ', 'café', 'cafe\u0301', '%', '_', '!', '\\']) {
      const query = { search, pageSize: 100 };
      const actual = await sessions.get(actor)!.json<unknown>(queuePath(query));
      queueShape(actual);
      assert.deepEqual(actual, expectedQueue(rows, actor, query));
    }
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}
