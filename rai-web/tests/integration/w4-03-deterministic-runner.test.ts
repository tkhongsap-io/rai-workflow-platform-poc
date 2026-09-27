// W4-03 (W4a plan section 4): the deterministic runner behind the real orchestrator, on the real Postgres, through
// the in-process fixture app with the runner injected (QC_MODE=deterministic arrives with W4-13, which adds the
// real-server test). Submit findings for each W4a metadata rule, the two-lane slot-5 case (two findings, each owned
// and dispositionable only by its lane), replay of completed runs, `rules: null` answered `not_configured` by the
// runner itself, and `rules_evaluated` counting executed metadata rules only. Fixture set slice1-synthetic@1; slot
// and stage changes are made on the synthetic draft before submit.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import { runAndPersistLaneQc, runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { createDeterministicQcRunner } from '@rai/server/qc/deterministic/runner';
import { assertNoLeak } from '../support/log-capture.js';
import {
  app,
  capture,
  caseRevision,
  db,
  diagnostics,
  openFixtureApp,
  signIn,
  submit,
} from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const AI_COE = 'fx-user-ai-coe';
const IT_SECURITY = 'fx-user-it-security';
const MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!; // CM, pre_build, non-vendor, slot 7 missing
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM, pre_launch, non-vendor, 3/4 N/A default
const VENDOR = findFixtureCase('fx-case-vendor')!; // HR, pre_launch, vendor, all attached
const NA_REASONS = findFixtureCase('fx-case-na-reasons')!; // vendor, idea, slot 4 N/A with a reason

const SERVER_VERSION = (
  JSON.parse(readFileSync(new URL('../../server/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const START = Date.parse('2026-09-27T05:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now, qcRunner: () => createDeterministicQcRunner({ now }) });

afterEach(() => {
  assertNoLeak(capture);
});

const runner = createDeterministicQcRunner({ now });
const deps = () => ({ db: db.app, runner, now, ...diagnostics });

async function draftIdOf(caseId: string): Promise<string> {
  const rows = (await db.owner.execute(sql`SELECT draft_version_id FROM "case" WHERE id = ${caseId}`))
    .rows as Array<{ draft_version_id: string }>;
  return rows[0]!.draft_version_id;
}

/** Synthetic draft edits before submit (the save-draft route's own rules are W1-04's and tested there). */
async function setSlot(caseId: string, slot: number, state: 'missing' | 'not_yet') {
  await db.owner.execute(
    sql`UPDATE artifact_slot SET state = ${state}, artifact_id = NULL, reason = NULL
          WHERE version_id = ${await draftIdOf(caseId)} AND slot = ${slot}`,
  );
}

async function setStage(caseId: string, stage: 'idea' | 'pre_build' | 'pre_launch') {
  await db.owner.execute(
    sql`UPDATE pack_version SET stage_context = ${stage} WHERE id = ${await draftIdOf(caseId)}`,
  );
}

async function submitCase(caseId: string) {
  const { version, correlationId } = await submit(await signIn(OWNER), caseId);
  return { caseId, versionId: version.versionId, correlationId };
}

async function findingRows(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT f.id, f.kind, f.slot, f.rule_id, f.owning_lane, f.severity, f.message_key, f.message_params,
                 f.evidence, r.trigger, r.lane
            FROM qc_finding f JOIN qc_run r ON r.id = f.run_id
           WHERE f.version_id = ${versionId} ORDER BY f.created_at, f.id`,
    )
  ).rows as Array<{
    id: string;
    kind: string;
    slot: number | null;
    rule_id: string;
    owning_lane: string;
    severity: string;
    message_key: string;
    message_params: Record<string, unknown>;
    evidence: Array<{ slot: number | null; artifact_id: string | null; locator: { kind: string } }>;
    trigger: string;
    lane: string | null;
  }>;
}

async function runRows(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT id, trigger, lane, engine_id, runner_version, status, unavailable_reason, rules_evaluated
            FROM qc_run WHERE version_id = ${versionId} ORDER BY requested_at, id`,
    )
  ).rows as Array<{
    id: string;
    trigger: string;
    lane: string | null;
    engine_id: string;
    runner_version: string;
    status: string;
    unavailable_reason: string | null;
    rules_evaluated: number | null;
  }>;
}

const brief = (rows: Awaited<ReturnType<typeof findingRows>>) =>
  rows.map((r) => ({ rule: r.rule_id, slot: r.slot, lane: r.owning_lane, trigger: r.trigger }));

async function laneQc(session: FixtureSession, caseId: string, versionId: string, lane: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision: await caseRevision(caseId) } },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<LaneQcRunResponse>();
}

async function waive(session: FixtureSession, caseId: string, versionId: string, findingId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/findings/${findingId}/dispositions`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
      expectedVersion: { versionId, revision: await caseRevision(caseId) },
      kind: 'waived',
      reason: 'synthetic waiver for the W4-03 owning-lane case',
    },
  });
}

/** Rewrites a version's frozen revision to a view kind, as a version frozen before W4-02 records it. */
async function freezeWithoutQcRules(versionId: string) {
  const legacy = (
    (
      await db.owner.execute(
        sql`SELECT id FROM configuration_revision WHERE kind = 'checklist_templates' LIMIT 1`,
      )
    ).rows[0] as { id: string }
  ).id;
  await db.raw('owner', async (client) => {
    await client.query('BEGIN');
    await client.query('ALTER TABLE pack_version DISABLE TRIGGER pack_version_frozen');
    await client.query(
      `UPDATE pack_version SET configuration_revision_id = $2, frozen_configuration = frozen_configuration - 'qc_rules'
        WHERE id = $1`,
      [versionId, legacy],
    );
    await client.query('ALTER TABLE pack_version ENABLE TRIGGER pack_version_frozen');
    await client.query('COMMIT');
  });
  return legacy;
}

describe(`W4-03 deterministic runner — ${SET}`, () => {
  it('submit: PACK-SLOT-MISSING on a single-lane slot, owned by its lane; three rules evaluated; the run names the runner', async () => {
    const target = await submitCase(MISSING_SLOT.caseId);
    const outcome = await runAndPersistSubmitQc(deps(), target);
    assert.equal(outcome.status, 'completed');
    const rows = await findingRows(target.versionId);
    assert.deepEqual(brief(rows), [
      { rule: 'PACK-SLOT-MISSING', slot: 7, lane: 'it_security', trigger: 'submit' },
    ]);
    assert.deepEqual(
      {
        kind: rows[0]!.kind,
        severity: rows[0]!.severity,
        key: rows[0]!.message_key,
        params: rows[0]!.message_params,
      },
      { kind: 'defect', severity: 'medium', key: 'qc.finding.pack_slot_missing', params: { slot: 7 } },
    );
    assert.deepEqual(rows[0]!.evidence, [
      { artifact_id: null, content_hash: null, slot: 7, locator: { kind: 'absent' } },
    ]);
    const [run] = await runRows(target.versionId);
    assert.deepEqual(
      {
        engine: run!.engine_id,
        version: run!.runner_version,
        status: run!.status,
        evaluated: run!.rules_evaluated,
      },
      { engine: 'deterministic', version: SERVER_VERSION, status: 'completed', evaluated: 3 },
    );
    const completed = capture
      .lines()
      .find((l) => l.event === 'qc.run.completed' && l.correlationId === target.correlationId);
    assert.equal(completed?.fields?.runner, 'deterministic');
    assert.equal(completed?.fields?.rulesEvaluated, 3);
    const started = capture
      .lines()
      .find((l) => l.event === 'qc.run.started' && l.correlationId === target.correlationId);
    assert.equal(started?.fields?.qcKind, 'deterministic');
  });

  it('submit: PACK-STAGE-MISMATCH is one AI/COE pack finding (slot 8 attached at idea; a lane-gated slot not yet at pre_launch)', async () => {
    await setStage(NONVENDOR.caseId, 'idea');
    const idea = await submitCase(NONVENDOR.caseId);
    await runAndPersistSubmitQc(deps(), idea);
    const ideaRows = await findingRows(idea.versionId);
    assert.deepEqual(brief(ideaRows), [
      { rule: 'PACK-STAGE-MISMATCH', slot: null, lane: 'ai_coe', trigger: 'submit' },
    ]);
    assert.equal(ideaRows[0]!.message_key, 'qc.finding.pack_stage_mismatch');
    assert.deepEqual(
      ideaRows[0]!.evidence.map((e) => [e.slot, typeof e.artifact_id, e.locator.kind]),
      [[8, 'string', 'absent']],
    );

    await setSlot(VENDOR.caseId, 6, 'not_yet');
    await setSlot(VENDOR.caseId, 9, 'not_yet');
    const preLaunch = await submitCase(VENDOR.caseId);
    await runAndPersistSubmitQc(deps(), preLaunch);
    const launchRows = await findingRows(preLaunch.versionId);
    assert.deepEqual(brief(launchRows), [
      { rule: 'PACK-STAGE-MISMATCH', slot: null, lane: 'ai_coe', trigger: 'submit' },
    ]);
    assert.deepEqual(
      launchRows[0]!.evidence.map((e) => e.slot),
      [6],
      'slot 9 is never evidence of a defect',
    );
  });

  it('submit: PACK-NA-VENDOR-DOC on a vendor case with slot 4 N/A is a DPO finding the DPO may waive and AI/COE may not', async () => {
    const target = await submitCase(NA_REASONS.caseId);
    await runAndPersistSubmitQc(deps(), target);
    const rows = await findingRows(target.versionId);
    assert.deepEqual(brief(rows), [{ rule: 'PACK-NA-VENDOR-DOC', slot: 4, lane: 'dpo', trigger: 'submit' }]);
    assert.deepEqual(
      { severity: rows[0]!.severity, key: rows[0]!.message_key, params: rows[0]!.message_params },
      { severity: 'medium', key: 'qc.finding.pack_na_vendor_doc', params: { slot: 4 } },
    );
    const wrong = await waive(await signIn(AI_COE), target.caseId, target.versionId, rows[0]!.id);
    assert.equal(wrong.statusCode, 403, wrong.body);
    const right = await waive(await signIn(DPO), target.caseId, target.versionId, rows[0]!.id);
    assert.equal(right.statusCode, 201, right.body);
  });

  it('two lanes on slot 5: submit raises none; the DPO and IT/Security approve attempts each raise one, owned and dispositionable only by that lane', async () => {
    await setSlot(MISSING_SLOT.caseId, 5, 'missing');
    const target = await submitCase(MISSING_SLOT.caseId);
    await runAndPersistSubmitQc(deps(), target);
    assert.ok(
      (await findingRows(target.versionId)).every((r) => r.slot !== 5),
      'no lane is invented on submit',
    );

    const dpo = await signIn(DPO);
    const itSecurity = await signIn(IT_SECURITY);
    const dpoRun = await laneQc(dpo, target.caseId, target.versionId, 'dpo');
    const itRun = await laneQc(itSecurity, target.caseId, target.versionId, 'it_security');
    assert.equal(dpoRun.status, 'completed');
    assert.equal(itRun.status, 'completed');
    const dpoFinding = dpoRun.findings.find((f) => f.slot === 5);
    const itFinding = itRun.findings.find((f) => f.slot === 5);
    assert.deepEqual(
      [dpoFinding?.ruleId, dpoFinding?.owningLane, itFinding?.ruleId, itFinding?.owningLane],
      ['PACK-SLOT-MISSING', 'dpo', 'PACK-SLOT-MISSING', 'it_security'],
    );
    assert.equal(dpoRun.findings.length, 1, 'the DPO run raises only its slot-5 finding');
    assert.equal(itRun.findings.length, 1, 'slot 7 is not raised again on the approve attempt');
    const slot5 = (await findingRows(target.versionId)).filter((r) => r.slot === 5);
    assert.deepEqual(
      slot5.map((r) => [r.owning_lane, r.trigger, r.lane]),
      [
        ['dpo', 'approve_attempt', 'dpo'],
        ['it_security', 'approve_attempt', 'it_security'],
      ],
    );

    const crossA = await waive(itSecurity, target.caseId, target.versionId, dpoFinding!.findingId);
    assert.equal(crossA.statusCode, 403, crossA.body);
    const crossB = await waive(dpo, target.caseId, target.versionId, itFinding!.findingId);
    assert.equal(crossB.statusCode, 403, crossB.body);
    const ownA = await waive(dpo, target.caseId, target.versionId, dpoFinding!.findingId);
    assert.equal(ownA.statusCode, 201, ownA.body);
    const ownB = await waive(itSecurity, target.caseId, target.versionId, itFinding!.findingId);
    assert.equal(ownB.statusCode, 201, ownB.body);

    const runs = await runRows(target.versionId);
    assert.deepEqual(
      runs.map((r) => [r.trigger, r.lane, r.rules_evaluated]),
      [
        ['submit', null, 3],
        ['approve_attempt', 'dpo', 1], // PACK-SLOT-MISSING; the selected content rules are not executed
        ['approve_attempt', 'it_security', 1],
      ],
    );
  });

  it('completed submit and approve-attempt runs replay: no second run row and no second finding', async () => {
    await setSlot(MISSING_SLOT.caseId, 5, 'missing');
    const target = await submitCase(MISSING_SLOT.caseId);
    const first = await runAndPersistSubmitQc(deps(), target);
    const again = await runAndPersistSubmitQc(deps(), { ...target, correlationId: randomUUID() });
    assert.equal(again.runId, first.runId);
    assert.deepEqual(again.findings, first.findings);

    const lane = { ...target, lane: 'dpo' as const };
    const laneFirst = await runAndPersistLaneQc(deps(), lane);
    const laneAgain = await runAndPersistLaneQc(deps(), { ...lane, correlationId: randomUUID() });
    assert.equal(laneAgain.runId, laneFirst.runId);
    assert.deepEqual(laneAgain.findings, laneFirst.findings);

    assert.equal((await runRows(target.versionId)).length, 2);
    assert.deepEqual(brief(await findingRows(target.versionId)), [
      { rule: 'PACK-SLOT-MISSING', slot: 7, lane: 'it_security', trigger: 'submit' },
      { rule: 'PACK-SLOT-MISSING', slot: 5, lane: 'dpo', trigger: 'approve_attempt' },
    ]);
  });

  it('a version with no qc_rules revision: the runner itself answers not_configured, recorded as the lane outage and retried', async () => {
    const target = await submitCase(MISSING_SLOT.caseId);
    await freezeWithoutQcRules(target.versionId);
    const input = { ...target, lane: 'it_security' as const };
    const first = await runAndPersistLaneQc(deps(), input);
    assert.equal(first.status, 'unavailable');
    assert.equal(first.status === 'unavailable' ? first.reason : null, 'not_configured');
    const second = await runAndPersistLaneQc(deps(), { ...input, correlationId: randomUUID() });
    assert.notEqual(second.runId, first.runId, 'an unavailable approve attempt is retried, not replayed');

    const runs = await runRows(target.versionId);
    assert.deepEqual(
      runs.map((r) => [r.engine_id, r.status, r.unavailable_reason, r.rules_evaluated]),
      [
        ['deterministic', 'unavailable', 'not_configured', 0],
        ['deterministic', 'unavailable', 'not_configured', 0],
      ],
      'the bound runner, not the unbound path, answered',
    );
    const rows = await findingRows(target.versionId);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.rule_id, r.owning_lane]),
      [['unavailable', 'QC-UNAVAILABLE', 'it_security']],
    );
    const line = capture
      .lines()
      .find((l) => l.event === 'qc.run.unavailable' && l.correlationId === target.correlationId);
    assert.equal(line?.fields?.runner, 'deterministic');
    assert.equal(line?.fields?.reason, 'not_configured');
  });
});
