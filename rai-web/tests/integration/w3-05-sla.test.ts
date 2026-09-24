// W3-05 done-when: a lane opened before a weekend and a holiday gets the frozen calendar's due date;
// resubmit restarts the clock; a later SLA revision does not change an already-frozen version; the breach
// query returns only pending lanes on the current review target that are past due. Issue #35 stays open.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { LaneDecisionResponse, LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { SlaBreach } from '@rai/shared/schemas/sla';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { listSlaBreaches } from '@rai/server/sla/breach';
import { laneDueDates } from '@rai/server/sla/due-dates';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { app, caseRevision, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const VENDOR = findFixtureCase('fx-case-vendor')!;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;
const REVIEWER = { dpo: DPO, ai_coe: 'fx-user-ai-coe', it_security: 'fx-user-it-security' } as const;
const OPEN = new Date('2026-04-09T02:00:00.000Z'); // Thursday 09:00 Bangkok, before Songkran

// The fixture set loads at OPEN; the app clock starts a minute later.
const START = OPEN.getTime() + 60_000;
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
// Unscripted: every lane-QC run completes clean.
openFixtureApp({ now, qcRunner: () => new ScriptedQcRunner({ fixtureCaseIdOf: () => undefined, now }) });

/** Runs the lane QC the reviewer sees, then approves on that run (H2: approve needs the latest lane-QC run). */
async function approve(caseId: string, versionId: string, lane: keyof typeof REVIEWER) {
  const reviewer = await signIn(REVIEWER[lane]);
  const expectedVersion = { versionId, revision: await caseRevision(caseId) };
  const base = `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}`;
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

describe(`W3-05 working-day SLA — ${SET}`, () => {
  it('freezes the due date across a later SLA revision, a holiday, and a resubmit', async () => {
    const owner = await signIn(OWNER_A);
    const v1 = await submitOk(owner, VENDOR.caseId);
    const first = await laneDueDates(db.app, v1.versionId);
    const byLane = Object.fromEntries(first.map((row) => [row.lane, row.dueOn]));
    assert.equal(byLane.dpo, '2026-04-17');
    assert.equal(byLane.ai_coe, '2026-04-21');
    assert.equal(byLane.it_security, '2026-04-21');

    const onDueDay = await listSlaBreaches(db.app, new Date('2026-04-17T02:00:00.000Z'));
    assert.equal(onDueDay.filter((row) => row.caseId === VENDOR.caseId).length, 0);
    const dayAfter = await listSlaBreaches(db.app, new Date('2026-04-18T02:00:00.000Z'));
    assert.deepEqual(
      dayAfter.filter((row) => row.caseId === VENDOR.caseId).map((row) => row.lane),
      ['dpo'],
    );

    await withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'sla',
        body: { dpo: 1, ai_coe: 1, it_security: 1 },
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
        publishedAt: new Date('2026-04-09T03:00:00.000Z'),
      }),
    );
    const stillFrozen = await laneDueDates(db.app, v1.versionId);
    assert.equal(stillFrozen.find((row) => row.lane === 'dpo')?.dueOn, '2026-04-17');

    const revision = await caseRevision(VENDOR.caseId);
    const dpo = await signIn(DPO);
    const sent = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${v1.versionId}/lanes/dpo/send-back`,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...asUser(dpo),
      },
      payload: {
        expectedVersion: { versionId: v1.versionId, revision },
        feedback: { items: [{ slot: 2, deficiency: 'purpose is missing' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const whileDraftOpen = await listSlaBreaches(db.app, new Date('2026-04-22T02:00:00.000Z'));
    assert.equal(whileDraftOpen.filter((row) => row.caseId === VENDOR.caseId).length, 0);

    clock = Date.parse('2026-04-20T02:00:00.000Z');
    const ownerAgain = await signIn(OWNER_A);
    const v2 = await submitOk(ownerAgain, VENDOR.caseId);
    assert.notEqual(v2.versionId, v1.versionId);
    const restarted = await laneDueDates(db.app, v2.versionId);
    assert.equal(restarted.find((row) => row.lane === 'dpo')?.dueOn, '2026-04-21');
    assert.equal(
      (await laneDueDates(db.app, v1.versionId)).find((row) => row.lane === 'dpo')?.dueOn,
      '2026-04-17',
    );
    const afterRestart = await listSlaBreaches(db.app, new Date('2026-04-21T02:00:00.000Z'));
    assert.equal(afterRestart.filter((row) => row.caseId === VENDOR.caseId).length, 0);
  });

  it('lists only pending lanes of open review targets, sorted by due date, case and lane', async () => {
    const owner = await signIn(OWNER_A);
    const vendor = await submitOk(owner, VENDOR.caseId);
    const nonvendor = await submitOk(owner, NONVENDOR.caseId);
    await approve(NONVENDOR.caseId, nonvendor.versionId, 'dpo');

    const asOf = new Date('2026-04-22T02:00:00.000Z'); // every lane of both versions is past due
    const dpoLate: SlaBreach = {
      caseId: VENDOR.caseId,
      versionId: vendor.versionId,
      lane: 'dpo',
      dueOn: '2026-04-17',
    };
    const late = (caseId: string, v: SubmittedVersion): SlaBreach[] =>
      (['ai_coe', 'it_security'] as const).map((lane) => ({
        caseId,
        versionId: v.versionId,
        lane,
        dueOn: '2026-04-21',
      }));
    const vendorLate = late(VENDOR.caseId, vendor);
    const nonvendorLate = late(NONVENDOR.caseId, nonvendor); // its dpo lane is approved, so absent
    const byCase =
      VENDOR.caseId < NONVENDOR.caseId
        ? [...vendorLate, ...nonvendorLate]
        : [...nonvendorLate, ...vendorLate];
    assert.deepEqual(await listSlaBreaches(db.app, asOf), [dpoLate, ...byCase]);

    await approve(NONVENDOR.caseId, nonvendor.versionId, 'ai_coe');
    assert.equal((await approve(NONVENDOR.caseId, nonvendor.versionId, 'it_security')).ready, true);
    assert.deepEqual(await listSlaBreaches(db.app, asOf), [dpoLate, ...vendorLate]); // Ready drops out
  });
});
