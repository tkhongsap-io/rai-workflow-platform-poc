// W5-05 (W5 plan sections 2, 4, 5 and 8; R-4 to R-6, R-10): the risk proposal recorded inside the submit transaction.
// Each submit scores the frozen answers against the frozen `risk_rubric` revision and the frozen slot states, inserts
// one append-only `risk_proposal` row, projects its tier to `case.risk_tier` (NULL when unavailable), audits
// `risk.proposed` between `version.submitted` / `version.resubmitted` and the three `lane.opened`, and logs
// `risk.proposal.recorded` or `risk.proposal.unavailable` after commit. Missing evidence stays Unknown, never Low; a
// missing or invalid rubric or an engine failure records `unavailable` and the submit still commits. No tier routes,
// skips or grants anything: High opens all three lanes, and Low with no approvals is not Ready. The rubric is the
// seeded SYNTHETIC PLACEHOLDER `synthetic-placeholder.1` (D07 open), never the approved instrument. Fixture app on the
// real Postgres; fixture set slice1-synthetic@1; identities fx-user-owner-cm (owner-a), fx-user-dpo. Synthetic only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { ENGINE_VERSION } from '@rai/shared/risk/types';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { LaneDecisionResponse } from '@rai/shared/schemas/review';
import { auditStore } from '@rai/server/audit/store';
import { CONFIGURATION_SEED, SEED_KINDS } from '@rai/server/configuration/seed';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { submitDraft } from '@rai/server/versions/service';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
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
const START = Date.parse('2026-09-28T02:00:00Z');
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
openFixtureApp({ now });

const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const user = (id: string) => findFixtureUser(id)!;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // owner-a, BU CM, slot 1 attached
const ALL_LOW = {
  RQ1: 'few',
  RQ2: 'advisory',
  RQ3: 'no',
  RQ4: 'internal',
  RQ5: 'in_house',
  RQ6: 'easy',
  RQ7: 'continuous',
} as const;
const THREE_HIGH = { RQ1: 'public', RQ2: 'automated', RQ4: 'customers' } as const;

interface ProposalRow {
  id: string;
  case_id: string;
  version_id: string;
  trigger: string;
  status: string;
  unavailable_reason: string | null;
  tier: string | null;
  lowest_tier: string | null;
  highest_tier: string | null;
  rubric_revision_id: string | null;
  rubric_label: string | null;
  engine_version: string;
  inputs_hash: string | null;
  explanation: {
    questions: Array<{ questionId: string; status: string; unknownReason?: string; value?: string }>;
    counts: Record<string, number>;
    matchedRule: unknown;
    escalation: unknown;
    unknownCount: number;
  } | null;
  correlation_id: string;
  created_at: Date | string;
}

async function readDraft(session: FixtureSession, caseId: string): Promise<PackDraft> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<PackDraft>();
}

async function save(session: FixtureSession, caseId: string, body: Record<string, unknown>) {
  const draft = await readDraft(session, caseId);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision }, ...body },
  });
  assert.equal(res.statusCode, 200, res.body);
}

async function proposals(caseId: string): Promise<ProposalRow[]> {
  const r = await db.owner.execute(
    sql`SELECT * FROM risk_proposal WHERE case_id = ${caseId} ORDER BY created_at, id`,
  );
  return r.rows as unknown as ProposalRow[];
}

async function proposalOf(versionId: string): Promise<ProposalRow> {
  const r = await db.owner.execute(sql`SELECT * FROM risk_proposal WHERE version_id = ${versionId}`);
  assert.equal(r.rows.length, 1, 'exactly one proposal per submitted version');
  return r.rows[0] as unknown as ProposalRow;
}

async function caseRow(caseId: string) {
  const r = await db.owner.execute(
    sql`SELECT risk_tier, ai_readiness_status, desk_status FROM "case" WHERE id = ${caseId}`,
  );
  return r.rows[0] as { risk_tier: string | null; ai_readiness_status: string; desk_status: string };
}

async function caseView(session: FixtureSession, caseId: string): Promise<CaseView> {
  const res = await app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: asUser(session) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<CaseView>();
}

const riskLines = () =>
  capture
    .lines()
    .filter((l) => l.event === 'risk.proposal.recorded' || l.event === 'risk.proposal.unavailable');

async function rubricRevisionId(): Promise<string> {
  const r = await db.owner.execute(
    sql`SELECT id FROM configuration_revision WHERE kind = 'risk_rubric' ORDER BY revision_number DESC LIMIT 1`,
  );
  return (r.rows[0] as { id: string }).id;
}

/** A fresh case on a database configured before W5-02: every kind but risk_rubric (the TRUNCATE cascades). */
async function caseWithoutRubric(owner: () => Promise<FixtureSession>): Promise<{
  session: FixtureSession;
  caseId: string;
}> {
  await db.owner.execute(sql.raw('TRUNCATE TABLE "configuration_revision" CASCADE'));
  await withTransaction(db.app, async (tx) => {
    for (const kind of SEED_KINDS.filter((k) => k !== 'risk_rubric'))
      await publishRevision(tx, {
        kind,
        body: CONFIGURATION_SEED[kind],
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
        publishedAt: new Date(START - 30_000),
      });
  });
  const session = await owner();
  const created = await app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
      useCaseName: 'Synthetic risk proposal case',
      businessUnitId: 'CM',
      businessUnit: 'Consumer Mobile',
      businessOwner: user(OWNER_A).subjectId,
      technicalOwner: 'Anan T. (synthetic)',
      sourceRecordId: { kind: 'unknown' },
      useCaseGroup: 'customer-analytics',
      vendorInvolved: false,
      modelType: 'llm',
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  return { session, caseId: created.json<{ caseId: string }>().caseId };
}

describe(`W5-05 risk proposal at submit — ${SET}`, () => {
  it('no answers: an all-Unknown proposal (bounds low…high) is recorded, projected and audited between version.submitted and lane.opened', async () => {
    const owner = await signIn(OWNER_A);
    const { version, correlationId } = await submit(owner, NONVENDOR.caseId);
    const row = await proposalOf(version.versionId);
    assert.equal(row.case_id, NONVENDOR.caseId);
    assert.equal(row.trigger, 'submit');
    assert.equal(row.status, 'proposed');
    assert.equal(row.unavailable_reason, null);
    assert.equal(row.tier, 'unknown');
    assert.equal(row.lowest_tier, 'low');
    assert.equal(row.highest_tier, 'high');
    assert.equal(row.rubric_revision_id, await rubricRevisionId());
    assert.equal(row.rubric_label, 'synthetic-placeholder.1');
    assert.equal(row.engine_version, ENGINE_VERSION);
    assert.match(row.inputs_hash!, /^[0-9a-f]{64}$/);
    assert.equal(row.correlation_id, correlationId);
    assert.equal(new Date(row.created_at).toISOString(), version.submittedAt);
    assert.equal(row.explanation!.unknownCount, 7);
    assert.deepEqual(
      row.explanation!.questions.map((q) => [q.questionId, q.status, q.unknownReason]),
      ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6', 'RQ7'].map((id) => [id, 'unknown', 'unanswered']),
    );
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, 'unknown');
    assert.equal((await caseView(owner, NONVENDOR.caseId)).riskTier, 'unknown');

    const events = (await auditStore.read(db.owner, { correlationId })).map((e) => e.action);
    assert.deepEqual(events, [
      'version.submitted',
      'risk.proposed',
      'lane.opened',
      'lane.opened',
      'lane.opened',
      ...events.slice(5).filter((a) => a === 'notification.queued'),
    ]);
    const [proposed] = (await auditStore.read(db.owner, { correlationId })).filter(
      (e) => e.action === 'risk.proposed',
    );
    assert.equal(proposed!.targetCaseId, NONVENDOR.caseId);
    assert.equal(proposed!.targetVersionId, version.versionId);
    assert.equal(proposed!.actorSubjectId, user(OWNER_A).subjectId);
    assert.deepEqual(proposed!.targetRef, {
      proposal_id: row.id,
      status: 'proposed',
      unavailable_reason: null,
      tier: 'unknown',
      lowest_tier: 'low',
      highest_tier: 'high',
      unknown_count: 7,
      rubric_revision_id: row.rubric_revision_id,
      rubric_label: 'synthetic-placeholder.1',
      engine_version: ENGINE_VERSION,
      inputs_hash: row.inputs_hash,
    });

    const lines = riskLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.event, 'risk.proposal.recorded');
    assert.equal(lines[0]!.correlationId, correlationId);
    const { durationMs, ...fields } = lines[0]!.fields!;
    assert.equal(typeof durationMs, 'number');
    assert.deepEqual(fields, {
      proposalId: row.id,
      caseId: NONVENDOR.caseId,
      versionId: version.versionId,
      status: 'proposed',
      tier: 'unknown',
      rubricRevision: row.rubric_revision_id,
      engineVersion: ENGINE_VERSION,
      unknownCount: 7,
    });
  });

  it('partial answers: one low answer leaves the tier unknown; three high answers make it High although four questions are unanswered', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { RQ1: 'few' } });
    const partial = await proposalOf((await submit(owner, NONVENDOR.caseId)).version.versionId);
    assert.equal(partial.tier, 'unknown');
    assert.equal(partial.explanation!.unknownCount, 6);
    assert.deepEqual(partial.explanation!.questions[0], {
      questionId: 'RQ1',
      status: 'answered',
      value: 'few',
      level: 'low',
      evidence: { slot: 1, state: 'attached' },
    });

    const vendor = findFixtureCase('fx-case-vendor')!;
    const ownerOfVendor = await signIn(vendor.ownerFixtureUserId);
    await save(ownerOfVendor, vendor.caseId, { riskAnswers: { ...THREE_HIGH } });
    const high = await proposalOf((await submit(ownerOfVendor, vendor.caseId)).version.versionId);
    assert.equal(high.status, 'proposed');
    assert.equal(high.tier, 'high');
    assert.equal(high.lowest_tier, 'high');
    assert.equal(high.highest_tier, 'high');
    assert.equal(high.explanation!.unknownCount, 4);
    assert.deepEqual(high.explanation!.matchedRule, { tier: 'high', index: 0 });
    assert.equal((await caseRow(vendor.caseId)).risk_tier, 'high');
  });

  it('all seven answered low with slot 1 attached: Low (default rule); a Low-tier case with no approvals is not Ready', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { ...ALL_LOW } });
    const { version } = await submit(owner, NONVENDOR.caseId);
    const row = await proposalOf(version.versionId);
    assert.equal(row.tier, 'low');
    assert.equal(row.lowest_tier, 'low');
    assert.equal(row.highest_tier, 'low');
    assert.equal(row.explanation!.matchedRule, 'default');
    assert.equal(row.explanation!.unknownCount, 0);
    assert.deepEqual(row.explanation!.counts, { high: 0, medium: 0, low: 7 });
    const c = await caseRow(NONVENDOR.caseId);
    assert.equal(c.risk_tier, 'low');
    assert.equal(c.ai_readiness_status, 'not_ready');
    assert.equal(c.desk_status, 'in_review');
    const view = await caseView(owner, NONVENDOR.caseId);
    assert.equal(view.riskTier, 'low');
    assert.equal(view.status, 'in_review');
    assert.equal(view.aiReadinessStatus, 'not_ready');
    const opened = (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).filter(
      (e) => e.action === 'lane.opened',
    );
    assert.equal(opened.length, 3, 'a Low tier skips no lane');
    assert.equal(
      (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).some(
        (e) => e.action === 'case.ready_for_launch',
      ),
      false,
    );
  });

  it('evidence_not_attached: answers count only when slot 1 is attached; otherwise every question is Unknown, never Low', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { ...ALL_LOW }, slots: { 1: { state: 'not_yet' } } });
    const { version } = await submit(owner, NONVENDOR.caseId);
    const row = await proposalOf(version.versionId);
    assert.equal(row.status, 'proposed');
    assert.equal(row.tier, 'unknown');
    assert.equal(row.explanation!.unknownCount, 7);
    for (const q of row.explanation!.questions) {
      assert.equal(q.status, 'unknown');
      assert.equal(q.unknownReason, 'evidence_not_attached');
      assert.equal(q.value, ALL_LOW[q.questionId as keyof typeof ALL_LOW]);
    }
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, 'unknown');
  });

  it('not_configured: no risk_rubric in force → unavailable, risk_tier NULL, the submit commits, the error log line names the reason', async () => {
    const { session, caseId } = await caseWithoutRubric(() => signIn(OWNER_A));
    const { version, correlationId } = await submit(session, caseId);
    const row = await proposalOf(version.versionId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.unavailable_reason, 'not_configured');
    assert.equal(row.tier, null);
    assert.equal(row.lowest_tier, null);
    assert.equal(row.rubric_revision_id, null);
    assert.equal(row.rubric_label, null);
    assert.equal(row.inputs_hash, null);
    assert.equal(row.explanation, null);
    assert.equal(row.engine_version, ENGINE_VERSION);
    assert.equal((await caseRow(caseId)).risk_tier, null);
    assert.equal((await caseRow(caseId)).desk_status, 'in_review');
    const [proposed] = (await auditStore.read(db.owner, { correlationId })).filter(
      (e) => e.action === 'risk.proposed',
    );
    assert.deepEqual(proposed!.targetRef, {
      proposal_id: row.id,
      status: 'unavailable',
      unavailable_reason: 'not_configured',
      tier: null,
      lowest_tier: null,
      highest_tier: null,
      unknown_count: null,
      rubric_revision_id: null,
      rubric_label: null,
      engine_version: ENGINE_VERSION,
      inputs_hash: null,
    });
    const lines = riskLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.event, 'risk.proposal.unavailable');
    assert.deepEqual(lines[0]!.fields, {
      proposalId: row.id,
      caseId,
      versionId: version.versionId,
      reason: 'not_configured',
    });
  });

  it('rubric_invalid: a frozen rubric body that fails the schema → unavailable with the revision kept; the submit commits', async () => {
    const owner = await signIn(OWNER_A);
    // Written directly as the table owner: publish validates, so only corruption can put such a body in force.
    const invalidId = randomUUID();
    await db.owner.execute(sql`
      INSERT INTO configuration_revision (id, kind, revision_number, body, published_by, published_at, activation_rule)
      VALUES (${invalidId}, 'risk_rubric', 99,
              ${JSON.stringify({ ...CONFIGURATION_SEED.risk_rubric, provenance: 'd07_recorded' })}::jsonb,
              'system', ${new Date(START - 10_000)}, 'after_publish')`);
    const { version } = await submit(owner, NONVENDOR.caseId);
    const row = await proposalOf(version.versionId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.unavailable_reason, 'rubric_invalid');
    assert.equal(row.rubric_revision_id, invalidId);
    assert.equal(row.tier, null);
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, null);
    const lines = riskLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.event, 'risk.proposal.unavailable');
    assert.equal(lines[0]!.fields!.reason, 'rubric_invalid');
    assert.equal(lines[0]!.fields!.rubricRevision, invalidId);
  });

  it('engine_error: an injected engine failure still commits the submit with an unavailable proposal and reports the error', async () => {
    const owner = await signIn(OWNER_A);
    const draft = await readDraft(owner, NONVENDOR.caseId);
    const principal = user(OWNER_A);
    const correlationId = randomUUID();
    const result = await submitDraft(
      {
        db: db.app,
        now,
        emitter: diagnostics.emitter,
        errors: diagnostics.errors,
        riskEngine: () => {
          throw new Error('injected engine failure');
        },
      },
      {
        actor: {
          subjectId: principal.subjectId,
          displayName: principal.displayName,
          email: principal.email,
          roles: [...principal.roles],
        },
        role: 'owner',
        correlationId,
      },
      NONVENDOR.caseId,
      { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      randomUUID(),
    );
    assert.equal(result.status, 201);
    const row = await proposalOf(result.body.versionId);
    assert.equal(row.status, 'unavailable');
    assert.equal(row.unavailable_reason, 'engine_error');
    assert.equal(row.rubric_revision_id, await rubricRevisionId());
    assert.equal(row.rubric_label, 'synthetic-placeholder.1');
    assert.equal(row.tier, null);
    const c = await caseRow(NONVENDOR.caseId);
    assert.equal(c.risk_tier, null);
    assert.equal(c.desk_status, 'in_review');
    const actions = (await auditStore.read(db.owner, { correlationId })).map((e) => e.action);
    assert.deepEqual(actions.slice(0, 5), [
      'version.submitted',
      'risk.proposed',
      'lane.opened',
      'lane.opened',
      'lane.opened',
    ]);
    const captured = capture.lines().filter((l) => l.event === 'error.captured');
    assert.ok(
      captured.some((l) => l.fields!.category === 'internal_error'),
      'the engine error reaches the error capture',
    );
    const lines = riskLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.event, 'risk.proposal.unavailable');
    assert.equal(lines[0]!.fields!.reason, 'engine_error');
  });

  it('resubmit: v2 records its own proposal and projects its tier; v1 proposal stays unchanged (A07)', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { ...ALL_LOW } });
    const v1 = (await submit(owner, NONVENDOR.caseId)).version;
    const v1Before = await proposalOf(v1.versionId);
    assert.equal(v1Before.tier, 'low');
    const dpo = await signIn(DPO);
    const back = await app.inject({
      method: 'POST',
      url: `/api/cases/${NONVENDOR.caseId}/versions/${v1.versionId}/lanes/dpo/send-back`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(dpo) },
      payload: {
        expectedVersion: { versionId: v1.versionId, revision: await caseRevision(NONVENDOR.caseId) },
        feedback: { items: [{ slot: 2, deficiency: 'DPIA incomplete on scope' }] },
      },
    });
    assert.equal(back.statusCode, 201, back.body);
    assert.ok(back.json<LaneDecisionResponse>().successorDraftVersionId);
    clock = START + 60_000;
    await save(owner, NONVENDOR.caseId, { riskAnswers: { ...THREE_HIGH } });
    const { version: v2, correlationId } = await submit(owner, NONVENDOR.caseId);
    assert.equal(v2.versionNumber, 2);
    const v2Row = await proposalOf(v2.versionId);
    assert.equal(v2Row.tier, 'high');
    assert.equal((await caseRow(NONVENDOR.caseId)).risk_tier, 'high');
    assert.deepEqual(await proposalOf(v1.versionId), v1Before, 'v1 proposal is untouched');
    assert.equal((await proposals(NONVENDOR.caseId)).length, 2);
    const actions = (await auditStore.read(db.owner, { correlationId })).map((e) => e.action);
    assert.deepEqual(actions.slice(0, 2), ['version.resubmitted', 'risk.proposed']);
  });

  it('High opens all three lanes (no routing or skip); replaying the submit key writes no second proposal, audit or log line', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { ...THREE_HIGH } });
    const draft = await readDraft(owner, NONVENDOR.caseId);
    const key = randomUUID();
    const post = () =>
      app.inject({
        method: 'POST',
        url: `/api/cases/${NONVENDOR.caseId}/draft/submit`,
        headers: { 'content-type': 'application/json', 'idempotency-key': key, ...asUser(owner) },
        payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      });
    const first = await post();
    assert.equal(first.statusCode, 201, first.body);
    const versionId = first.json<{ versionId: string }>().versionId;
    assert.equal((await proposalOf(versionId)).tier, 'high');
    const opened = (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).filter(
      (e) => e.action === 'lane.opened',
    );
    assert.deepEqual(opened.map((e) => (e.targetRef as { lane: string }).lane).sort(), [
      'ai_coe',
      'dpo',
      'it_security',
    ]);
    const replay = await post();
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, first.body);
    assert.equal((await proposals(NONVENDOR.caseId)).length, 1);
    assert.equal(
      (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).filter(
        (e) => e.action === 'risk.proposed',
      ).length,
      1,
    );
    assert.equal(riskLines().length, 1);
  });

  it('the log lines and audit refs carry no answer value, question text or name', async () => {
    const owner = await signIn(OWNER_A);
    await save(owner, NONVENDOR.caseId, { riskAnswers: { RQ3: 'sensitive', RQ5: 'open_source' } });
    const { correlationId } = await submit(owner, NONVENDOR.caseId);
    const text = JSON.stringify(riskLines());
    const audited = JSON.stringify(
      (await auditStore.read(db.owner, { correlationId })).filter((e) => e.action === 'risk.proposed'),
    );
    for (const out of [text, audited]) {
      assert.doesNotMatch(out, /sensitive|open_source|SYNTHETIC PLACEHOLDER/);
      assert.ok(!out.includes(user(OWNER_A).displayName));
    }
  });
});
