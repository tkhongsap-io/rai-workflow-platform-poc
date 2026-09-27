// W6-13 (W6 plan section 8.1, row W6-13): `GET /api/dashboard` on real Postgres through the authenticated handlers.
// Scope per fixture identity, the consistency invariant (byStatus = queue statusCounts; summed breached = in-scope
// listSlaBreaches), the SLA due-soon and breached boundaries on the frozen calendar, findings and QC counts, eight
// Bangkok activity weeks, and the recheck counts served as 0 until W6-09. Synthetic fixtures only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Value } from 'typebox/value';
import { LANES, type Lane } from '@rai/shared/constants';
import type { ErrorResponse } from '@rai/shared/errors';
import { DashboardResponseSchema, type DashboardResponse } from '@rai/shared/schemas/dashboard';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { Actor } from '@rai/server/authz/policy';
import { cases } from '@rai/server/db/schema/case';
import { dispositionEvent } from '@rai/server/db/schema/disposition-event';
import { qcFinding } from '@rai/server/db/schema/qc-finding';
import { qcRun } from '@rai/server/db/schema/qc-run';
import { setWorkflowWrite } from '@rai/server/db/transaction';
import { readDashboard } from '@rai/server/dashboard/repository';
import { readQueue } from '@rai/server/queue/repository';
import { listSlaBreaches } from '@rai/server/sla/breach';
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
const NA = findFixtureCase('fx-case-na-reasons')!; // HR
const DUAL = findFixtureCase('fx-case-hr-dualrole')!; // HR
const OPEN = new Date('2026-04-09T02:00:00.000Z'); // Thursday 09:00 Bangkok, before Songkran (13-15 April)
const START = OPEN.getTime() + 60_000;
const DAY = 24 * 60 * 60 * 1000;
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

/** Signs in at the current clock (sessions idle out after 120 minutes) and reads the dashboard. */
async function dashboard(fixtureUserId: string): Promise<DashboardResponse> {
  const session = await signIn(fixtureUserId);
  const res = await app.inject({ url: '/api/dashboard', headers: asUser(session) });
  assert.equal(res.statusCode, 200, res.body);
  const body: unknown = res.json();
  assert.ok(Value.Check(DashboardResponseSchema, body), `${fixtureUserId}: ${res.body.slice(0, 300)}`);
  return body;
}

const lane = (d: DashboardResponse, name: Lane) => d.lanes.find((row) => row.lane === name)!;

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

/** Every lane projection approved without a decision row: the read derivation, not the transition, is under test. */
async function projectAllApproved(caseId: string) {
  await db.owner.transaction(async (tx) => {
    await setWorkflowWrite(tx);
    await tx
      .update(cases)
      .set({ raiStatus: 'approved', privacyStatus: 'approved', securityStatus: 'approved' })
      .where(eq(cases.id, caseId));
  });
}

async function insertRun(
  versionId: string,
  fields: { status?: 'completed' | 'unavailable'; reason?: string; requestedAt?: Date } = {},
): Promise<string> {
  const id = randomUUID();
  const at = fields.requestedAt ?? now();
  await db.owner.insert(qcRun).values({
    id,
    versionId,
    trigger: 'submit',
    engineId: 'synthetic',
    runnerVersion: 'test',
    ruleRevision: '1',
    status: fields.status ?? 'completed',
    unavailableReason: fields.reason ?? null,
    rulesEvaluated: 0,
    requestedAt: at,
    completedAt: at,
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
 * (HR), DUAL awaiting disposition (HR), MISSING still a draft (CM).
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

const inScopeCaseIds = async (fixtureUserId: string) =>
  new Set((await readQueue(db.app, actorFor(fixtureUserId), { pageSize: 100 })).items.map((i) => i.caseId));

describe(`W6-13 dashboard API — ${SET}`, () => {
  it('needs a session, refuses query keys, and serves the W6-01 shape to every fixture identity', async () => {
    assert.equal((await app.inject('/api/dashboard')).statusCode, 401);
    const admin = await signIn(ADMIN);
    const bad = await app.inject({ url: '/api/dashboard?lane=dpo', headers: asUser(admin) });
    assert.equal(bad.statusCode, 422, bad.body);
    assert.equal(bad.json<ErrorResponse>().error.code, 'invalid_input');
    for (const user of FIXTURE_USERS) {
      const d = await dashboard(user.fixtureUserId);
      assert.equal(d.asOf, now().toISOString());
      assert.equal(d.today, '2026-04-09');
      assert.deepEqual(
        d.lanes.map((row) => row.lane),
        [...LANES],
      );
      assert.deepEqual(d.risk, { available: false });
      // W6-09 adds the recheck column and wires these two counts (W6 plan section 5).
      assert.equal(d.findings.advisory, 0);
      assert.equal(d.qc.rechecks30d, 0);
    }
  });

  it('keeps every count inside the scope of each fixture identity and matches the queue (invariant)', async () => {
    const journey = await mixedJourney();
    // An out-of-scope-for-CM finding and run on the HR case, and one on the CM case.
    const hrRun = await insertRun(journey.vendor.versionId, { status: 'unavailable', reason: 'timeout' });
    await insertFinding(hrRun, journey.vendor.versionId, 'it_security', 'medium');
    await insertFinding(hrRun, journey.vendor.versionId, 'ai_coe', 'high', 'unavailable');
    // 22 April (Wednesday): VENDOR's DPO lane was due 17 April and its other lanes 21 April, so all three breach.
    clock = bangkok('2026-04-22T10:00:00');
    const asOf = now();
    const breaches = await listSlaBreaches(db.app, asOf);
    assert.deepEqual(
      breaches.map((b) => [b.caseId, b.lane]),
      [
        [VENDOR.caseId, 'dpo'],
        [VENDOR.caseId, 'ai_coe'],
        [VENDOR.caseId, 'it_security'],
      ],
    );
    for (const user of FIXTURE_USERS) {
      const id = user.fixtureUserId;
      const d = await dashboard(id);
      const queue = await readQueue(db.app, actorFor(id), {});
      assert.deepEqual(d.cases.byStatus, queue.statusCounts, id);
      assert.equal(d.cases.total, queue.total, id);
      const scope = await inScopeCaseIds(id);
      assert.equal(
        d.lanes.reduce((sum, row) => sum + row.breached, 0),
        breaches.filter((b) => scope.has(b.caseId)).length,
        id,
      );
      // The same read in-process equals the HTTP answer for the same instant.
      assert.deepEqual(await readDashboard(db.app, actorFor(id), asOf), d, id);
    }

    const admin = await dashboard(ADMIN);
    assert.deepEqual(admin.cases, {
      total: 5,
      byStatus: { draft: 1, in_review: 1, sent_back: 1, awaiting_disposition: 1, ready_for_launch: 1 },
    });
    // NONVENDOR's undecided AI/COE and IT/Security lanes sit on a version DPO sent back: not pending.
    assert.deepEqual(admin.lanes, [
      { lane: 'ai_coe', pending: 1, approved: 2, sentBack: 0, dueSoon: 0, breached: 1 },
      { lane: 'dpo', pending: 1, approved: 2, sentBack: 1, dueSoon: 0, breached: 1 },
      { lane: 'it_security', pending: 1, approved: 2, sentBack: 0, dueSoon: 0, breached: 1 },
    ]);
    assert.deepEqual(admin.findings.open, [
      { lane: 'dpo', severity: 'high', count: 1 },
      { lane: 'it_security', severity: 'medium', count: 1 },
    ]);
    assert.deepEqual(admin.findings.unavailableOpen, {
      ai_coe: { outage: 1, paused: 0 },
      dpo: { outage: 0, paused: 0 },
      it_security: { outage: 0, paused: 0 },
    });

    // CM SPOC: NONVENDOR (sent back) and MISSING (draft) only; nothing of the HR cases leaks into any count.
    const spoc = await dashboard(SPOC_CM);
    assert.deepEqual(spoc.cases, {
      total: 2,
      byStatus: { draft: 1, in_review: 0, sent_back: 1, awaiting_disposition: 0, ready_for_launch: 0 },
    });
    assert.deepEqual(spoc.lanes, [
      { lane: 'ai_coe', pending: 0, approved: 0, sentBack: 0, dueSoon: 0, breached: 0 },
      { lane: 'dpo', pending: 0, approved: 0, sentBack: 1, dueSoon: 0, breached: 0 },
      { lane: 'it_security', pending: 0, approved: 0, sentBack: 0, dueSoon: 0, breached: 0 },
    ]);
    assert.deepEqual(spoc.findings.open, []);
    assert.deepEqual(spoc.findings.unavailableOpen, {
      ai_coe: { outage: 0, paused: 0 },
      dpo: { outage: 0, paused: 0 },
      it_security: { outage: 0, paused: 0 },
    });
    assert.equal(spoc.qc.runs30d, 0);
    assert.equal(
      spoc.activity.reduce((sum, w) => sum + w.submitted + w.sentBack + w.ready, 0),
      2,
    );

    // An owner with no case sees only zeros.
    const empty = await dashboard(OWNER_B);
    assert.equal(empty.cases.total, 0);
    assert.ok(empty.lanes.every((row) => row.pending + row.approved + row.sentBack + row.breached === 0));
    assert.deepEqual(empty.findings.open, []);
    assert.deepEqual(empty.qc, { runs30d: 0, unavailableRuns30d: 0, pausedRuns30d: 0, rechecks30d: 0 });
    assert.ok(empty.activity.every((w) => w.submitted + w.resubmitted + w.sentBack + w.ready === 0));
    // No grant at all: nothing is in scope.
    const none = await readDashboard(db.app, { subjectId: 'synthetic:no-grants', roles: [] }, asOf);
    assert.deepEqual({ ...none, asOf: empty.asOf }, empty);

    // Moving a case out of the SPOC's business unit removes it from every count at once.
    await db.owner.update(cases).set({ businessUnitId: 'HR' }).where(eq(cases.id, NONVENDOR.caseId));
    const moved = await dashboard(SPOC_CM);
    assert.equal(moved.cases.total, 1);
    assert.equal(lane(moved, 'dpo').sentBack, 0);
    assert.ok(moved.activity.every((w) => w.submitted + w.sentBack === 0));
  });

  it('marks due soon within two working days on the frozen calendar and breached from the day after due', async () => {
    const owner = await signIn(OWNER);
    const v = await submitOk(owner, VENDOR.caseId); // DPO due 17 April (3 days, Songkran skipped); others 21 April
    const at = async (local: string) => {
      clock = bangkok(local);
      const d = await dashboard(ADMIN);
      const scope = await inScopeCaseIds(ADMIN);
      const breaches = (await listSlaBreaches(db.app, now())).filter((b) => scope.has(b.caseId));
      assert.equal(
        d.lanes.reduce((sum, row) => sum + row.breached, 0),
        breaches.length,
        local,
      );
      return Object.fromEntries(
        d.lanes.map((row) => [row.lane, [row.pending, row.dueSoon, row.breached]]),
      ) as Record<Lane, [number, number, number]>;
    };
    // Friday 10 April: the horizon skips the weekend and Songkran to Friday 17, so DPO is already due soon.
    assert.deepEqual(await at('2026-04-10T09:00:00'), {
      ai_coe: [1, 0, 0],
      dpo: [1, 1, 0],
      it_security: [1, 0, 0],
    });
    // Thursday 16: DPO due in one working day; the others in three (Fri 17, Mon 20, Tue 21) are not due soon.
    assert.deepEqual(await at('2026-04-16T23:59:00'), {
      ai_coe: [1, 0, 0],
      dpo: [1, 1, 0],
      it_security: [1, 0, 0],
    });
    // Friday 17: DPO due today is due soon, not breached; the others are due in exactly two working days.
    assert.deepEqual(await at('2026-04-17T00:00:00'), {
      ai_coe: [1, 1, 0],
      dpo: [1, 1, 0],
      it_security: [1, 1, 0],
    });
    // Saturday 18: DPO is breached (due before today) and no longer due soon.
    assert.deepEqual(await at('2026-04-18T00:00:00'), {
      ai_coe: [1, 1, 0],
      dpo: [1, 0, 1],
      it_security: [1, 1, 0],
    });
    // An approved lane leaves pending and every SLA count.
    await approve(VENDOR.caseId, v.versionId, 'dpo');
    assert.deepEqual(await at('2026-04-22T09:00:00'), {
      ai_coe: [1, 0, 1],
      dpo: [0, 0, 0],
      it_security: [1, 0, 1],
    });
    // A send-back ends the review target: no lane is pending, due soon or breached any more.
    await sendBack(VENDOR.caseId, v.versionId, 'ai_coe');
    assert.deepEqual(await at('2026-04-22T09:30:00'), {
      ai_coe: [0, 0, 0],
      dpo: [0, 0, 0],
      it_security: [0, 0, 0],
    });
    const d = await dashboard(ADMIN);
    assert.deepEqual(lane(d, 'ai_coe'), {
      lane: 'ai_coe',
      pending: 0,
      approved: 0,
      sentBack: 1,
      dueSoon: 0,
      breached: 0,
    });
    assert.equal(lane(d, 'dpo').approved, 1);
  });

  it('counts open defects by lane and severity and open unavailable findings, on current versions only', async () => {
    const owner = await signIn(OWNER);
    const vendor = await submitOk(owner, VENDOR.caseId);
    const nonvendor = await submitOk(owner, NONVENDOR.caseId);
    const run = await insertRun(vendor.versionId);
    await insertFinding(run, vendor.versionId, 'dpo', 'high');
    await insertFinding(run, vendor.versionId, 'dpo', 'high');
    await insertFinding(run, vendor.versionId, 'ai_coe', 'low');
    await insertFinding(run, vendor.versionId, 'dpo', 'info'); // never a defect severity (W0-07); not counted
    const proposed = await insertFinding(run, vendor.versionId, 'dpo', 'medium');
    await dispose(proposed, 'fixed_proposed'); // still open under the Ready rule
    const confirmed = await insertFinding(run, vendor.versionId, 'it_security', 'medium');
    await dispose(confirmed, 'fixed_proposed');
    await dispose(confirmed, 'fixed_confirmed');
    const waived = await insertFinding(run, vendor.versionId, 'it_security', 'high');
    await dispose(waived, 'waived');
    const down = await insertRun(vendor.versionId, { status: 'unavailable', reason: 'runner_error' });
    await insertFinding(down, vendor.versionId, 'dpo', 'high', 'unavailable');
    await insertFinding(down, vendor.versionId, 'dpo', 'high', 'unavailable');
    const closed = await insertFinding(down, vendor.versionId, 'ai_coe', 'high', 'unavailable');
    await dispose(closed, 'not_applicable');
    // NONVENDOR v1 gets a finding, then DPO sends it back and v2 is submitted: v1 is no longer current.
    const old = await insertRun(nonvendor.versionId);
    await insertFinding(old, nonvendor.versionId, 'ai_coe', 'high');
    await insertFinding(old, nonvendor.versionId, 'it_security', 'low', 'unavailable');
    const before = await dashboard(ADMIN);
    assert.deepEqual(before.findings.open, [
      { lane: 'ai_coe', severity: 'high', count: 1 },
      { lane: 'ai_coe', severity: 'low', count: 1 },
      { lane: 'dpo', severity: 'high', count: 2 },
      { lane: 'dpo', severity: 'medium', count: 1 },
    ]);
    await sendBack(NONVENDOR.caseId, nonvendor.versionId, 'dpo');
    await submitOk(await signIn(OWNER), NONVENDOR.caseId);
    const d = await dashboard(ADMIN);
    assert.deepEqual(d.findings.open, [
      { lane: 'ai_coe', severity: 'low', count: 1 },
      { lane: 'dpo', severity: 'high', count: 2 },
      { lane: 'dpo', severity: 'medium', count: 1 },
    ]);
    assert.deepEqual(d.findings.unavailableOpen, {
      ai_coe: { outage: 0, paused: 0 },
      dpo: { outage: 2, paused: 0 },
      it_security: { outage: 0, paused: 0 },
    });
    assert.equal(d.findings.advisory, 0);
    // The CM SPOC sees NONVENDOR only, whose current version has no finding.
    const spoc = await dashboard(SPOC_CM);
    assert.deepEqual(spoc.findings.open, []);
    assert.deepEqual(spoc.findings.unavailableOpen, {
      ai_coe: { outage: 0, paused: 0 },
      dpo: { outage: 0, paused: 0 },
      it_security: { outage: 0, paused: 0 },
    });
  });

  it('counts QC run rows of the last 30 days inside scope; rechecks stay 0 until W6-09', async () => {
    const owner = await signIn(OWNER);
    const vendor = await submitOk(owner, VENDOR.caseId);
    const nonvendor = await submitOk(owner, NONVENDOR.caseId);
    clock = bangkok('2026-05-20T12:00:00');
    const asOf = now().getTime();
    await insertRun(vendor.versionId, { requestedAt: new Date(asOf - 30 * DAY) }); // exactly 30 days: out
    await insertRun(vendor.versionId, { requestedAt: new Date(asOf - 30 * DAY + 1) }); // in
    await insertRun(vendor.versionId, {
      status: 'unavailable',
      reason: 'timeout',
      requestedAt: new Date(asOf - DAY),
    });
    await insertRun(vendor.versionId, { status: 'unavailable', requestedAt: new Date(asOf) }); // NULL reason
    await insertRun(nonvendor.versionId, {
      status: 'unavailable',
      reason: 'not_configured',
      requestedAt: new Date(asOf - 2 * DAY),
    });
    await insertRun(nonvendor.versionId, { requestedAt: new Date(asOf + 1) }); // after the read: out
    const admin = await dashboard(ADMIN);
    assert.deepEqual(admin.qc, { runs30d: 4, unavailableRuns30d: 3, pausedRuns30d: 0, rechecks30d: 0 });
    const spoc = await dashboard(SPOC_CM);
    assert.deepEqual(spoc.qc, { runs30d: 1, unavailableRuns30d: 1, pausedRuns30d: 0, rechecks30d: 0 });
    assert.deepEqual((await dashboard(OWNER_B)).qc, {
      runs30d: 0,
      unavailableRuns30d: 0,
      pausedRuns30d: 0,
      rechecks30d: 0,
    });
  });

  it('reports eight Monday-to-Sunday Bangkok weeks of submissions, resubmissions, send-backs and Ready', async () => {
    const journey = await mixedJourney();
    // Monday 20 April 00:30 in Bangkok is still Sunday 19 April in UTC: the resubmission belongs to the week of 20 April.
    clock = Date.parse('2026-04-19T17:30:00.000Z');
    const owner = await signIn(OWNER);
    const v2 = await submitOk(owner, NONVENDOR.caseId);
    assert.equal(v2.versionNumber, 2);
    assert.equal(v2.parentVersionId, journey.nonvendor.versionId);
    clock = bangkok('2026-04-22T10:00:00');
    const d = await dashboard(ADMIN);
    assert.equal(d.today, '2026-04-22');
    assert.deepEqual(
      d.activity.map((w) => w.weekStart),
      [
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
        '2026-04-06',
        '2026-04-13',
        '2026-04-20',
      ],
    );
    const week = (start: string) => d.activity.find((w) => w.weekStart === start)!;
    assert.deepEqual(week('2026-04-06'), {
      weekStart: '2026-04-06',
      submitted: 4,
      resubmitted: 0,
      sentBack: 1,
      ready: 1,
    });
    assert.deepEqual(week('2026-04-13'), {
      weekStart: '2026-04-13',
      submitted: 0,
      resubmitted: 0,
      sentBack: 0,
      ready: 0,
    });
    assert.deepEqual(week('2026-04-20'), {
      weekStart: '2026-04-20',
      submitted: 1,
      resubmitted: 1,
      sentBack: 0,
      ready: 0,
    });
    const spoc = await dashboard(SPOC_CM);
    assert.deepEqual(
      spoc.activity.filter((w) => w.submitted + w.sentBack + w.ready > 0),
      [
        { weekStart: '2026-04-06', submitted: 1, resubmitted: 0, sentBack: 1, ready: 0 },
        { weekStart: '2026-04-20', submitted: 1, resubmitted: 1, sentBack: 0, ready: 0 },
      ],
    );
    // Seven weeks on, the window starts at the resubmission's week: the 6 April week has left it.
    clock = bangkok('2026-06-08T10:00:00');
    const later = await dashboard(ADMIN);
    assert.equal(later.activity[0]!.weekStart, '2026-04-20');
    assert.equal(later.activity.at(-1)!.weekStart, '2026-06-08');
    assert.equal(
      later.activity.reduce((sum, w) => sum + w.submitted, 0),
      1,
    );
  });
});
