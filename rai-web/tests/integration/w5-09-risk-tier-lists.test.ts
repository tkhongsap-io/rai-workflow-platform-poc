// W5-09 (W5 plan sections 6, 7 and 9): the case list (`GET /api/cases`) and the review queue (`GET /api/queue`) serve
// `riskTier` on every item: the tier W5-05's submit transaction wrote to `case.risk_tier` (`high`, `medium`, `low`,
// `unknown`), or null before any submit or when the proposal was unavailable. The shared type declares it optional
// (the frozen in-memory substitute builds these shapes without it), so this test is what holds the real server to
// always serving it. One column only: scope, filters and counts are unchanged, and an out-of-scope user sees neither
// the case nor its tier. The rubric is the SYNTHETIC PLACEHOLDER (D07 open). Fixture app on the real Postgres; fixture
// set slice1-synthetic@1; synthetic data only.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { CaseListResponse, CaseView, RiskTier } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import { setWorkflowWrite } from '@rai/server/db/transaction';
import { findFixtureCase, FIXTURE_CASES } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { assertNoLeak } from '../support/log-capture.js';
import { app, capture, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const START = Date.parse('2026-09-28T03:00:00Z');
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
openFixtureApp({ now });
afterEach(() => {
  assertNoLeak(capture);
});

const OWNER = 'fx-user-owner-cm'; // owns every fixture case
const OTHER_OWNER = 'fx-user-owner-cm-2'; // owns none
const SPOC_CM = 'fx-user-spoc-cm';
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM, slot 1 attached
const THREE_HIGH = { RQ1: 'public', RQ2: 'automated', RQ4: 'customers' } as const;

async function getJson<T>(session: FixtureSession, url: string): Promise<T> {
  const res = await app.inject({ method: 'GET', url, headers: asUser(session) });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<T>();
}
const caseList = (s: FixtureSession) => getJson<CaseListResponse>(s, '/api/cases?pageSize=100');
const queue = (s: FixtureSession) => getJson<QueueResponse>(s, '/api/queue?pageSize=100');

async function save(session: FixtureSession, caseId: string, body: Record<string, unknown>) {
  const draft = await getJson<PackDraft>(session, `/api/cases/${caseId}/draft`);
  const res = await app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision }, ...body },
  });
  assert.equal(res.statusCode, 200, res.body);
}

/** Every item carries the key (never absent on the real server); returns caseId → riskTier. */
function tiersOf(items: ReadonlyArray<{ caseId: string; riskTier?: RiskTier | null }>): Map<string, unknown> {
  for (const item of items) assert.ok(Object.hasOwn(item, 'riskTier'), `${item.caseId} serves riskTier`);
  return new Map(items.map((item) => [item.caseId, item.riskTier]));
}

describe(`W5-09 risk tier on the queue and case list — ${SET}`, () => {
  it('before any submit every item on both lists serves riskTier: null', async () => {
    for (const id of [OWNER, SPOC_CM, AI_COE, ADMIN]) {
      const session = await signIn(id);
      for (const items of [(await caseList(session)).items, (await queue(session)).items]) {
        assert.ok(items.length > 0, `${id} sees cases`);
        for (const tier of tiersOf(items).values()) assert.equal(tier, null);
      }
    }
  });

  it('a High submit shows high on both lists for everyone in scope, equal to the case read; other cases stay null', async () => {
    const owner = await signIn(OWNER);
    clock = START + 1000;
    await save(owner, NONVENDOR.caseId, { riskAnswers: THREE_HIGH });
    clock = START + 2000;
    await submitOk(owner, NONVENDOR.caseId);
    for (const id of [OWNER, SPOC_CM, AI_COE, ADMIN]) {
      const session = await signIn(id);
      const view = await getJson<CaseView>(session, `/api/cases/${NONVENDOR.caseId}`);
      assert.equal(view.riskTier, 'high');
      for (const items of [(await caseList(session)).items, (await queue(session)).items]) {
        const tiers = tiersOf(items);
        assert.equal(tiers.get(NONVENDOR.caseId), view.riskTier, `${id} sees the case read's tier`);
        for (const [caseId, tier] of tiers) if (caseId !== NONVENDOR.caseId) assert.equal(tier, null);
      }
    }
  });

  it('an unanswered submit shows unknown (never low) on both lists', async () => {
    const owner = await signIn(OWNER);
    await submitOk(owner, NONVENDOR.caseId);
    const reviewer = await signIn(AI_COE);
    for (const items of [(await caseList(reviewer)).items, (await queue(reviewer)).items])
      assert.equal(tiersOf(items).get(NONVENDOR.caseId), 'unknown');
  });

  it('each stored tier value is served as is on both lists, and the queue filters, counts and scope are unchanged', async () => {
    const reviewer = await signIn(AI_COE);
    const before = await queue(reviewer);
    const tiers: RiskTier[] = ['high', 'medium', 'low', 'unknown'];
    const cases = FIXTURE_CASES.slice(0, tiers.length);
    assert.equal(cases.length, tiers.length, 'enough fixture cases for one tier each');
    // Test setup only: the tier is a projection, so the write passes the W0-04 gate as the workflow's would.
    await db.owner.transaction(async (tx) => {
      await setWorkflowWrite(tx);
      for (const [i, fixture] of cases.entries())
        await tx.execute(sql`UPDATE "case" SET risk_tier = ${tiers[i]} WHERE id = ${fixture.caseId}`);
    });
    const listed = tiersOf((await caseList(reviewer)).items);
    const queued = tiersOf((await queue(reviewer)).items);
    for (const [i, fixture] of cases.entries()) {
      assert.equal(listed.get(fixture.caseId), tiers[i]);
      assert.equal(queued.get(fixture.caseId), tiers[i]);
    }
    const after = await queue(reviewer);
    assert.equal(after.total, before.total);
    assert.deepEqual(after.statusCounts, before.statusCounts);
    assert.deepEqual(after.filterOptions, before.filterOptions);

    // Scope is unchanged: an owner of no fixture case sees none of them, tier or not.
    const other = await signIn(OTHER_OWNER);
    const fixtureIds = new Set(FIXTURE_CASES.map((c) => c.caseId));
    for (const items of [(await caseList(other)).items, (await queue(other)).items])
      assert.equal(items.filter((item) => fixtureIds.has(item.caseId)).length, 0);
  });
});
