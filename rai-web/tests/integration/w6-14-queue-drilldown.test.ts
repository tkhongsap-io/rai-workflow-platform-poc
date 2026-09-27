// W6-14 (W6 plan section 8.2, row W6-14): the dashboard drill-down filters on `GET /api/queue`, on real Postgres
// through the authenticated handlers. Each filter is applied inside the actor's scope before counts, options and
// pages (A06): an out-of-scope case is never listed or counted. Lane and SLA filters land on the dashboard's own
// numbers (W6-13 rule: pending = the open review target set). Synthetic fixtures only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Value } from 'typebox/value';
import { LANES, type Lane } from '@rai/shared/constants';
import type { ErrorResponse } from '@rai/shared/errors';
import type { DashboardResponse } from '@rai/shared/schemas/dashboard';
import { QueueQuerySchema, type QueueResponse } from '@rai/shared/schemas/queue';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { Actor } from '@rai/server/authz/policy';
import { cases } from '@rai/server/db/schema/case';
import { dispositionEvent } from '@rai/server/db/schema/disposition-event';
import { qcFinding } from '@rai/server/db/schema/qc-finding';
import { qcRun } from '@rai/server/db/schema/qc-run';
import { setWorkflowWrite } from '@rai/server/db/transaction';
import { readDashboard } from '@rai/server/dashboard/repository';
import { readQueue } from '@rai/server/queue/repository';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { app, caseRevision, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm'; // owns every fixture case
const OWNER_B = 'fx-user-owner-cm-2'; // owns none
const SPOC_CM = 'fx-user-spoc-cm'; // business unit CM
const ADMIN = 'fx-user-admin';
const REVIEWER = {
  dpo: 'fx-user-dpo',
  ai_coe: 'fx-user-ai-coe',
  it_security: 'fx-user-it-security',
} as const;
const VENDOR = findFixtureCase('fx-case-vendor')!; // HR
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM
const MISSING = findFixtureCase('fx-case-missing-slot')!; // CM
const NA = findFixtureCase('fx-case-na-reasons')!; // HR
const DUAL = findFixtureCase('fx-case-hr-dualrole')!; // HR
const OPEN = new Date('2026-04-09T02:00:00.000Z'); // Thursday 09:00 Bangkok, before Songkran (13-15 April)
const START = OPEN.getTime() + 60_000;
/** A Bangkok wall-clock instant (UTC+7, no daylight saving). */
const bangkok = (local: string) => Date.parse(`${local}+07:00`);

let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
// Unscripted: every lane-QC run completes clean.
openFixtureApp({ now, qcRunner: () => new ScriptedQcRunner({ fixtureCaseIdOf: () => undefined, now }) });

const actorFor = (id: string): Actor => {
  const user = FIXTURE_USERS.find((u) => u.fixtureUserId === id)!;
  return { subjectId: user.subjectId, roles: [...user.roles] };
};

/** `GET /api/queue?…` as a fixture identity, signed in at the current clock. */
async function queue(
  fixtureUserId: string,
  query: Record<string, string | number> = {},
): Promise<QueueResponse> {
  const session = await signIn(fixtureUserId);
  const search = new URLSearchParams(
    Object.entries({ pageSize: 100, ...query }).map(([k, v]) => [k, String(v)]),
  );
  const res = await app.inject({ url: `/api/queue?${search.toString()}`, headers: asUser(session) });
  assert.equal(res.statusCode, 200, `${fixtureUserId} ${search.toString()}: ${res.body.slice(0, 300)}`);
  return res.json<QueueResponse>();
}
const ids = (response: QueueResponse) => response.items.map((item) => item.caseId).sort();
const sorted = (...caseIds: string[]) => [...caseIds].sort();

async function dashboard(fixtureUserId: string): Promise<DashboardResponse> {
  const session = await signIn(fixtureUserId);
  const res = await app.inject({ url: '/api/dashboard', headers: asUser(session) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<DashboardResponse>();
}

async function approve(caseId: string, versionId: string, name: Lane) {
  const reviewer = await signIn(REVIEWER[name]);
  const expectedVersion = { versionId, revision: await caseRevision(caseId) };
  const base = `/api/cases/${caseId}/versions/${versionId}/lanes/${name}`;
  const qc = await app.inject({
    method: 'POST',
    url: `${base}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(reviewer) },
    payload: { expectedVersion },
  });
  assert.equal(qc.statusCode, 200, qc.body);
  const res = await app.inject({
    method: 'POST',
    url: `${base}/approve`,
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(reviewer) },
    payload: { expectedVersion, qcRunId: qc.json<LaneQcRunResponse>().runId },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<LaneDecisionResponse>();
}

async function sendBack(caseId: string, versionId: string, name: Lane) {
  const reviewer = await signIn(REVIEWER[name]);
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${name}/send-back`,
    headers: { ...asUser(reviewer), 'idempotency-key': randomUUID() },
    payload: {
      expectedVersion: { versionId, revision: await caseRevision(caseId) },
      feedback: { items: [{ slot: 2, deficiency: 'synthetic missing purpose' }] },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
}

/** Every lane projection approved without a decision row: the read, not the transition, is under test. */
async function projectAllApproved(caseId: string) {
  await db.owner.transaction(async (tx) => {
    await setWorkflowWrite(tx);
    await tx
      .update(cases)
      .set({ raiStatus: 'approved', privacyStatus: 'approved', securityStatus: 'approved' })
      .where(eq(cases.id, caseId));
  });
}

async function insertRun(versionId: string): Promise<string> {
  const id = randomUUID();
  await db.owner.insert(qcRun).values({
    id,
    versionId,
    trigger: 'submit',
    engineId: 'synthetic',
    runnerVersion: 'test',
    ruleRevision: '1',
    status: 'completed',
    unavailableReason: null,
    rulesEvaluated: 0,
    requestedAt: now(),
    completedAt: now(),
    correlationId: randomUUID(),
  });
  return id;
}

async function insertFinding(
  runId: string,
  versionId: string,
  owningLane: Lane,
  severity: 'high' | 'medium' | 'low' | 'info',
  kind: 'defect' | 'unavailable' = 'defect',
): Promise<string> {
  const id = randomUUID();
  await db.owner.insert(qcFinding).values({
    id,
    runId,
    versionId,
    kind,
    ruleId: kind === 'defect' ? 'SYNTHETIC-RULE' : 'QC-UNAVAILABLE',
    ruleRevision: '1',
    severity,
    owningLane,
    evidence: [],
    messageKey: 'synthetic',
    messageParams: {},
    createdAt: now(),
  });
  return id;
}

let eventSeq = 0;
async function dispose(findingId: string, kind: string) {
  eventSeq += 1;
  await db.owner.insert(dispositionEvent).values({
    id: randomUUID(),
    findingId,
    kind,
    reason: 'synthetic',
    actorSubjectId: 'synthetic',
    actorRole: 'dpo',
    createdAt: new Date(clock + eventSeq),
    correlationId: randomUUID(),
  });
}

/**
 * One case in each status on 2026-04-09 (Thursday): VENDOR in review (HR), NONVENDOR sent back by DPO (CM), NA Ready
 * (HR), DUAL awaiting disposition (HR) with an open DPO high defect, MISSING still a draft (CM).
 */
async function mixedJourney() {
  const owner = await signIn(OWNER);
  const vendor = await submitOk(owner, VENDOR.caseId);
  const nonvendor = await submitOk(owner, NONVENDOR.caseId);
  await sendBack(NONVENDOR.caseId, nonvendor.versionId, 'dpo');
  const na = await submitOk(owner, NA.caseId);
  for (const name of LANES) await approve(NA.caseId, na.versionId, name);
  const dual = await submitOk(owner, DUAL.caseId);
  await projectAllApproved(DUAL.caseId);
  const run = await insertRun(dual.versionId);
  await insertFinding(run, dual.versionId, 'dpo', 'high');
  return { vendor, nonvendor, na, dual };
}

describe(`W6-14 queue drill-down filters — ${SET}`, () => {
  it('serves every drill-down key and refuses bad values, riskTier and repeated keys', async () => {
    assert.equal(
      Value.Check(QueueQuerySchema, {
        lane: 'dpo',
        laneStatus: 'pending',
        sla: 'breached',
        findingLane: 'ai_coe',
        findingSeverity: 'high',
        findingKind: 'unavailable',
      }),
      true,
    );
    const all = await queue(ADMIN, {
      lane: 'dpo',
      laneStatus: 'pending',
      sla: 'due_soon',
      findingLane: 'ai_coe',
      findingSeverity: 'low',
      findingKind: 'defect',
    });
    assert.equal(all.total, 0);
    const admin = await signIn(ADMIN);
    for (const bad of [
      'lane=hr',
      'laneStatus=ready',
      'sla=overdue',
      'findingSeverity=info',
      'findingKind=advisory',
      'findingLane=',
      'riskTier=high',
    ]) {
      const res = await app.inject({ url: `/api/queue?${bad}`, headers: asUser(admin) });
      assert.equal(res.statusCode, 422, `${bad}: ${res.body}`);
      assert.equal(res.json<ErrorResponse>().error.code, 'invalid_input', bad);
    }
  });

  it('filters by lane state on the current version and lands on the dashboard numbers for every identity', async () => {
    const journey = await mixedJourney();
    // 22 April: VENDOR's three pending lanes are all past due.
    clock = bangkok('2026-04-22T10:00:00');
    const admin = (q: Record<string, string>) => queue(ADMIN, q);
    assert.deepEqual(ids(await admin({ lane: 'dpo', laneStatus: 'pending' })), [VENDOR.caseId]);
    assert.deepEqual(
      ids(await admin({ lane: 'dpo', laneStatus: 'approved' })),
      sorted(NA.caseId, DUAL.caseId),
    );
    assert.deepEqual(ids(await admin({ lane: 'dpo', laneStatus: 'sent_back' })), [NONVENDOR.caseId]);
    // NONVENDOR's undecided AI/COE lane sits on a version DPO sent back: nobody waits on it (W6-13 rule).
    assert.deepEqual(ids(await admin({ lane: 'ai_coe', laneStatus: 'pending' })), [VENDOR.caseId]);
    assert.deepEqual(ids(await admin({ lane: 'ai_coe', laneStatus: 'sent_back' })), []);
    // Without `lane`, any lane in that state.
    assert.deepEqual(ids(await admin({ laneStatus: 'sent_back' })), [NONVENDOR.caseId]);
    assert.deepEqual(ids(await admin({ laneStatus: 'approved' })), sorted(NA.caseId, DUAL.caseId));
    // `lane` alone: every case with a current submitted version; the draft is not one.
    assert.deepEqual(
      ids(await admin({ lane: 'it_security' })),
      sorted(VENDOR.caseId, NONVENDOR.caseId, NA.caseId, DUAL.caseId),
    );
    assert.ok(!ids(await admin({ lane: 'it_security' })).includes(MISSING.caseId));
    // Counts and options describe the drilled-down population; the status filter still narrows inside it.
    const approved = await admin({ laneStatus: 'approved' });
    assert.deepEqual(approved.statusCounts, {
      draft: 0,
      in_review: 0,
      sent_back: 0,
      awaiting_disposition: 1,
      ready_for_launch: 1,
    });
    assert.deepEqual(approved.filterOptions.statuses, ['awaiting_disposition', 'ready_for_launch']);
    const readyOnly = await admin({ laneStatus: 'approved', status: 'ready_for_launch' });
    assert.deepEqual(ids(readyOnly), [NA.caseId]);
    assert.equal(readyOnly.statusCounts.awaiting_disposition, 1);
    // Pagination runs after the drill-down.
    const page2 = await queue(ADMIN, { laneStatus: 'approved', pageSize: 1, page: 2 });
    assert.equal(page2.total, 2);
    assert.equal(page2.items.length, 1);
    assert.ok(
      !ids(await queue(ADMIN, { laneStatus: 'approved', pageSize: 1 })).includes(page2.items[0]!.caseId),
    );

    // Consistency with the dashboard, per fixture identity and lane: a dashboard number opens exactly that many cases.
    for (const user of FIXTURE_USERS) {
      const id = user.fixtureUserId;
      const d = await dashboard(id);
      for (const row of d.lanes) {
        const total = async (q: Record<string, string>) => (await queue(id, { lane: row.lane, ...q })).total;
        assert.equal(await total({ laneStatus: 'pending' }), row.pending, `${id} ${row.lane} pending`);
        assert.equal(await total({ laneStatus: 'approved' }), row.approved, `${id} ${row.lane} approved`);
        assert.equal(await total({ laneStatus: 'sent_back' }), row.sentBack, `${id} ${row.lane} sent back`);
        assert.equal(await total({ sla: 'breached' }), row.breached, `${id} ${row.lane} breached`);
        assert.equal(await total({ sla: 'due_soon' }), row.dueSoon, `${id} ${row.lane} due soon`);
      }
    }
    assert.equal(journey.na.versionNumber, 1);
  });

  it('resolves SLA due soon and breached on the frozen calendar, per lane and across lanes', async () => {
    const owner = await signIn(OWNER);
    const v = await submitOk(owner, VENDOR.caseId); // DPO due 17 April (Songkran skipped); others 21 April
    await submitOk(owner, NA.caseId); // same dates
    const at = async (local: string, q: Record<string, string>) => {
      clock = bangkok(local);
      return ids(await queue(ADMIN, q));
    };
    // Thursday 16: DPO due next working day (due soon); the others three working days out (not yet).
    assert.deepEqual(await at('2026-04-16T09:00:00', { sla: 'due_soon' }), sorted(VENDOR.caseId, NA.caseId));
    assert.deepEqual(await at('2026-04-16T09:00:00', { sla: 'due_soon', lane: 'ai_coe' }), []);
    assert.deepEqual(await at('2026-04-16T09:00:00', { sla: 'breached' }), []);
    // Saturday 18: DPO breached, the others due soon.
    assert.deepEqual(
      await at('2026-04-18T09:00:00', { sla: 'breached', lane: 'dpo' }),
      sorted(VENDOR.caseId, NA.caseId),
    );
    assert.deepEqual(await at('2026-04-18T09:00:00', { sla: 'breached', lane: 'it_security' }), []);
    assert.deepEqual(
      await at('2026-04-18T09:00:00', { sla: 'due_soon', lane: 'it_security' }),
      sorted(VENDOR.caseId, NA.caseId),
    );
    // DPO approves VENDOR: it leaves the DPO breach list; its other lanes still count across lanes.
    await approve(VENDOR.caseId, v.versionId, 'dpo');
    assert.deepEqual(await at('2026-04-18T09:30:00', { sla: 'breached', lane: 'dpo' }), [NA.caseId]);
    assert.deepEqual(await at('2026-04-22T09:00:00', { sla: 'breached' }), sorted(VENDOR.caseId, NA.caseId));
    // `laneStatus` and `sla` together must both hold for the lane.
    assert.deepEqual(
      await at('2026-04-22T09:00:00', { sla: 'breached', laneStatus: 'approved', lane: 'dpo' }),
      [],
    );
    assert.deepEqual(
      await at('2026-04-22T09:00:00', { sla: 'breached', laneStatus: 'pending', lane: 'ai_coe' }),
      sorted(VENDOR.caseId, NA.caseId),
    );
    // A send-back ends the review target: the case leaves every SLA list.
    await sendBack(VENDOR.caseId, v.versionId, 'ai_coe');
    assert.deepEqual(await at('2026-04-22T09:30:00', { sla: 'breached' }), [NA.caseId]);
    // The in-process read takes the clock it is given.
    assert.deepEqual(
      ids(
        await readQueue(
          db.app,
          actorFor(ADMIN),
          { sla: 'breached', pageSize: 100 },
          new Date(bangkok('2026-04-16T09:00:00')),
        ),
      ),
      [],
    );
  });

  it('matches one undispositioned finding on the current version by lane, severity and kind', async () => {
    const owner = await signIn(OWNER);
    const vendor = await submitOk(owner, VENDOR.caseId);
    const nonvendor = await submitOk(owner, NONVENDOR.caseId);
    const na = await submitOk(owner, NA.caseId);
    const run = await insertRun(vendor.versionId);
    await insertFinding(run, vendor.versionId, 'dpo', 'high');
    const proposed = await insertFinding(run, vendor.versionId, 'ai_coe', 'low');
    await dispose(proposed, 'fixed_proposed'); // still open under the Ready rule
    await insertFinding(run, vendor.versionId, 'it_security', 'medium', 'unavailable');
    const naRun = await insertRun(na.versionId);
    const waived = await insertFinding(naRun, na.versionId, 'dpo', 'high');
    await dispose(waived, 'waived');
    const confirmed = await insertFinding(naRun, na.versionId, 'ai_coe', 'low');
    await dispose(confirmed, 'fixed_proposed');
    await dispose(confirmed, 'fixed_confirmed');
    await insertFinding(naRun, na.versionId, 'dpo', 'info'); // info matches no requestable severity
    // NONVENDOR v1 has an open DPO high defect, then v2 is submitted: v1 is no longer current.
    const old = await insertRun(nonvendor.versionId);
    await insertFinding(old, nonvendor.versionId, 'dpo', 'high');
    const f = async (q: Record<string, string>) => ids(await queue(ADMIN, q));
    assert.deepEqual(await f({ findingLane: 'dpo' }), sorted(VENDOR.caseId, NONVENDOR.caseId, NA.caseId));
    await sendBack(NONVENDOR.caseId, nonvendor.versionId, 'dpo');
    await submitOk(await signIn(OWNER), NONVENDOR.caseId);

    // NA's `info` finding is still an open finding for its lane, but never for a requested severity.
    assert.deepEqual(await f({ findingLane: 'dpo' }), sorted(VENDOR.caseId, NA.caseId));
    assert.deepEqual(await f({ findingLane: 'dpo', findingSeverity: 'high' }), [VENDOR.caseId]);
    assert.deepEqual(await f({ findingSeverity: 'high', findingKind: 'defect' }), [VENDOR.caseId]);
    assert.deepEqual(await f({ findingLane: 'ai_coe', findingSeverity: 'low' }), [VENDOR.caseId]);
    assert.deepEqual(await f({ findingKind: 'unavailable' }), [VENDOR.caseId]);
    assert.deepEqual(await f({ findingKind: 'unavailable', findingLane: 'it_security' }), [VENDOR.caseId]);
    // One finding must match every key: VENDOR's unavailable finding is IT/Security, not DPO.
    assert.deepEqual(await f({ findingKind: 'unavailable', findingLane: 'dpo' }), []);
    assert.deepEqual(await f({ findingKind: 'defect', findingSeverity: 'medium' }), []);
    assert.deepEqual(await f({ findingSeverity: 'medium' }), [VENDOR.caseId]);
    // Findings combine with the lane-state filters (AND).
    assert.deepEqual(await f({ findingLane: 'dpo', laneStatus: 'approved' }), []);
    assert.deepEqual(
      await f({ findingLane: 'dpo', lane: 'dpo', laneStatus: 'pending' }),
      sorted(VENDOR.caseId, NA.caseId),
    );
  });

  it('never lists or counts an out-of-scope case that matches a drill-down filter', async () => {
    const journey = await mixedJourney(); // HR: VENDOR, NA, DUAL; CM: NONVENDOR, MISSING
    const run = await insertRun(journey.vendor.versionId);
    await insertFinding(run, journey.vendor.versionId, 'dpo', 'high');
    clock = bangkok('2026-04-22T10:00:00');
    const drills: Record<string, string>[] = [
      { lane: 'dpo', laneStatus: 'pending' },
      { laneStatus: 'approved' },
      { laneStatus: 'sent_back' },
      { sla: 'breached' },
      { findingLane: 'dpo', findingSeverity: 'high' },
      { lane: 'ai_coe' },
    ];
    // Admin sees the HR matches; the CM SPOC sees none of them.
    assert.deepEqual(ids(await queue(ADMIN, { findingLane: 'dpo' })), sorted(VENDOR.caseId, DUAL.caseId));
    for (const drill of drills) {
      const spoc = await queue(SPOC_CM, drill);
      for (const caseId of ids(spoc))
        assert.ok([NONVENDOR.caseId, MISSING.caseId].includes(caseId), JSON.stringify(drill));
      const inScope = await queue(SPOC_CM, {});
      assert.ok(spoc.total <= inScope.total);
      assert.equal(
        Object.values(spoc.statusCounts).reduce((a, b) => a + b, 0),
        spoc.total,
        `statusCounts count the drilled population: ${JSON.stringify(drill)}`,
      );
      for (const owner of spoc.filterOptions.owners)
        assert.ok(inScope.filterOptions.owners.some((o) => o.value === owner.value));
      const empty = await queue(OWNER_B, drill);
      assert.equal(empty.total, 0, JSON.stringify(drill));
      assert.deepEqual(empty.filterOptions, { statuses: [], owners: [], useCaseGroups: [] });
      const none = await readQueue(
        db.app,
        { subjectId: 'synthetic:no-grants', roles: [] },
        { ...drill },
        now(),
      );
      assert.equal(none.total, 0);
    }
    assert.deepEqual(ids(await queue(SPOC_CM, { laneStatus: 'sent_back' })), [NONVENDOR.caseId]);
    assert.deepEqual(ids(await queue(SPOC_CM, { findingLane: 'dpo' })), []);
    assert.deepEqual(ids(await queue(SPOC_CM, { sla: 'breached' })), []);
    // The SPOC's dashboard and drill-down agree on the lane numbers.
    const d = await readDashboard(db.app, actorFor(SPOC_CM), now());
    assert.equal(d.lanes.find((row) => row.lane === 'dpo')!.sentBack, 1);
    // Moving a case out of the SPOC's unit removes it from the drill-down at once.
    await db.owner.update(cases).set({ businessUnitId: 'HR' }).where(eq(cases.id, NONVENDOR.caseId));
    assert.deepEqual(ids(await queue(SPOC_CM, { laneStatus: 'sent_back' })), []);
  });
});
