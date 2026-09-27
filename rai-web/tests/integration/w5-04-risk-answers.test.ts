// W5-04 (W5 plan sections 2, 4 and 6; W0-02 7.5): risk questionnaire answers on the pack draft, through the existing
// PUT /api/cases/{caseId}/draft. Save, clear, attribution (kept on an unchanged answer, replaced on a change), the
// `draft.saved` refs (question IDs and values only), every 422 path (not configured, unknown question, unknown option,
// shape), reviewer and Admin 403, and the freeze at submit. The rubric is the seeded SYNTHETIC PLACEHOLDER
// `synthetic-placeholder.1` (D07 open), never the approved instrument. Fixture app on the real Postgres; fixture set
// slice1-synthetic@1; identities fx-user-owner-cm (owner-a), fx-user-spoc-cm (spoc-b1, BU CM), fx-user-dpo,
// fx-user-admin. Synthetic data only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { auditStore } from '@rai/server/audit/store';
import { CONFIGURATION_SEED, SEED_KINDS } from '@rai/server/configuration/seed';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { app, capture, caseRevision, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const START = Date.parse('2026-09-27T06:00:00Z');
let clock = START;
const now = () => new Date(clock);
beforeEach(() => {
  clock = START;
});
openFixtureApp({ now });

const OWNER_A = 'fx-user-owner-cm';
const SPOC_B1 = 'fx-user-spoc-cm';
const DPO = 'fx-user-dpo';
const ADMIN = 'fx-user-admin';
const user = (id: string) => findFixtureUser(id)!;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // owner-a, BU CM

type Res = { statusCode: number; body: string; json<T>(): T };

async function readDraft(session: FixtureSession, caseId = NONVENDOR.caseId): Promise<PackDraft> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<PackDraft>();
}

async function put(session: FixtureSession, body: Record<string, unknown>, caseId = NONVENDOR.caseId) {
  const draft = await readDraft(session, caseId);
  return app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision }, ...body },
  });
}

const errorOf = (res: Res) => res.json<ErrorResponse>().error;
const fieldsOf = (res: Res) =>
  (errorOf(res).details as ErrorDetails['invalid_input'] | undefined)?.fields ?? [];

async function storedAnswers(versionId: string): Promise<unknown> {
  const r = await db.owner.execute(sql`SELECT risk_answers FROM pack_version WHERE id = ${versionId}`);
  return (r.rows[0] as { risk_answers: unknown }).risk_answers;
}

async function draftSaved() {
  return (await auditStore.read(db.owner, { caseId: NONVENDOR.caseId })).filter(
    (e) => e.action === 'draft.saved',
  );
}

const attribution = (id: string, role: string, at: number) => ({
  answeredBy: user(id).subjectId,
  answeredRole: role,
  answeredAt: new Date(at).toISOString(),
});

describe(`W5-04 draft risk answers — ${SET}`, () => {
  it('the owner saves answers: attributed, stored without names, returned with the name, audited as IDs and values', async () => {
    const owner = await signIn(OWNER_A);
    const before = await readDraft(owner);
    assert.deepEqual(before.riskAnswers, {}, 'a fixture draft starts with no answers');
    clock = START + 1000;
    const res = await put(owner, { riskAnswers: { RQ1: 'few', RQ3: 'yes', RQ7: 'unknown' } });
    assert.equal(res.statusCode, 200, res.body);
    const saved = res.json<PackDraft>();
    const by = attribution(OWNER_A, 'owner', START + 1000);
    const named = { ...by, answeredByName: user(OWNER_A).displayName };
    assert.deepEqual(saved.riskAnswers, {
      RQ1: { value: 'few', ...named },
      RQ3: { value: 'yes', ...named },
      RQ7: { value: 'unknown', ...named },
    });
    assert.equal(saved.draftRevision, before.draftRevision + 1);
    assert.deepEqual((await readDraft(owner)).riskAnswers, saved.riskAnswers, 'GET returns the same answers');
    assert.deepEqual(await storedAnswers(before.draftId), {
      RQ1: { value: 'few', ...by },
      RQ3: { value: 'yes', ...by },
      RQ7: { value: 'unknown', ...by },
    });
    const [event] = await draftSaved();
    assert.ok(event);
    assert.deepEqual(event.targetRef, {
      changed_fields: ['risk_answers'],
      slots: [],
      risk_answers: [
        { question_id: 'RQ1', value: 'few' },
        { question_id: 'RQ3', value: 'yes' },
        { question_id: 'RQ7', value: 'unknown' },
      ],
    });
    const audited = JSON.stringify(event);
    assert.ok(!audited.includes(user(OWNER_A).displayName), 'no name in the audit event');
    assert.doesNotMatch(audited, /SYNTHETIC PLACEHOLDER/);
    assert.ok(!capture.text().includes(user(OWNER_A).displayName), 'no name in the log');
  });

  it('attribution stays with the original answerer until someone changes the answer', async () => {
    const owner = await signIn(OWNER_A);
    clock = START + 1000;
    assert.equal((await put(owner, { riskAnswers: { RQ1: 'few', RQ2: 'advisory' } })).statusCode, 200);
    const spoc = await signIn(SPOC_B1);
    clock = START + 5000;
    const res = await put(spoc, { riskAnswers: { RQ1: 'few', RQ2: 'automated' } });
    assert.equal(res.statusCode, 200, res.body);
    const draft = res.json<PackDraft>();
    assert.deepEqual(draft.riskAnswers.RQ1, {
      value: 'few',
      ...attribution(OWNER_A, 'owner', START + 1000),
      answeredByName: user(OWNER_A).displayName,
    });
    assert.deepEqual(draft.riskAnswers.RQ2, {
      value: 'automated',
      ...attribution(SPOC_B1, 'bu_spoc', START + 5000),
      answeredByName: user(SPOC_B1).displayName,
    });
    // Re-sending an unchanged answer still saves (revision + 1) but lists no changed field.
    clock = START + 9000;
    const same = await put(spoc, { riskAnswers: { RQ1: 'few' } });
    assert.equal(same.statusCode, 200, same.body);
    assert.deepEqual(same.json<PackDraft>().riskAnswers, draft.riskAnswers);
    const events = await draftSaved();
    assert.deepEqual(events.at(-1)!.targetRef, {
      changed_fields: [],
      slots: [],
      risk_answers: [{ question_id: 'RQ1', value: 'few' }],
    });
  });

  it('null clears an answer; clearing an absent one changes nothing; a save without riskAnswers keeps them and its audit shape', async () => {
    const owner = await signIn(OWNER_A);
    assert.equal((await put(owner, { riskAnswers: { RQ1: 'few', RQ2: 'reviewed' } })).statusCode, 200);
    const cleared = await put(owner, { riskAnswers: { RQ1: null, RQ5: null } });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(Object.keys(cleared.json<PackDraft>().riskAnswers), ['RQ2']);
    assert.deepEqual((await draftSaved()).at(-1)!.targetRef, {
      changed_fields: ['risk_answers'],
      slots: [],
      risk_answers: [
        { question_id: 'RQ1', value: null },
        { question_id: 'RQ5', value: null },
      ],
    });
    const other = await put(owner, { stageContext: 'pre_build' });
    assert.equal(other.statusCode, 200, other.body);
    assert.deepEqual(Object.keys(other.json<PackDraft>().riskAnswers), ['RQ2']);
    assert.deepEqual((await draftSaved()).at(-1)!.targetRef, {
      changed_fields: ['stage_context'],
      slots: [],
    });
  });

  it('422 validation.not_in_configured_list for an unknown question or option, collected with the other field errors; nothing is written', async () => {
    const owner = await signIn(OWNER_A);
    const before = await readDraft(owner);
    const res = await put(owner, {
      checklistTemplateVersion: 'v9.9',
      riskAnswers: { RQ1: 'few', RQ2: 'public', RQ8: 'few' },
    });
    assert.equal(res.statusCode, 422, res.body);
    assert.equal(errorOf(res).code, 'invalid_input');
    assert.deepEqual(
      fieldsOf(res).map((f) => [f.path, f.messageKey]),
      [
        ['body.checklistTemplateVersion', 'validation.not_in_configured_list'],
        ['body.riskAnswers.RQ2', 'validation.not_in_configured_list'],
        ['body.riskAnswers.RQ8', 'validation.not_in_configured_list'],
      ],
    );
    assert.deepEqual(await storedAnswers(before.draftId), {});
    assert.equal(await caseRevision(NONVENDOR.caseId), before.draftRevision);
    assert.equal((await draftSaved()).length, 0);
  });

  it('422 invalid_input for a malformed question ID or value (no free text, R-13); nothing is written', async () => {
    const owner = await signIn(OWNER_A);
    const before = await readDraft(owner);
    for (const riskAnswers of [
      { rq1: 'few' },
      { RQ10: 'few' },
      { RQ1: 'A free-text answer' },
      { RQ1: { value: 'few' } },
      { RQ1: 3 },
      ['few'],
    ]) {
      const res = await put(owner, { riskAnswers });
      assert.equal(res.statusCode, 422, `${JSON.stringify(riskAnswers)}: ${res.body}`);
      assert.equal(errorOf(res).code, 'invalid_input');
      assert.match(fieldsOf(res)[0]!.path, /^body\.riskAnswers/, res.body);
    }
    assert.deepEqual(await storedAnswers(before.draftId), {});
    assert.equal((await draftSaved()).length, 0);
  });

  it('422 error.risk.not_configured at body.riskAnswers when no rubric is in force; a clear still saves', async () => {
    // A database configured before W5-02: every kind but risk_rubric (the TRUNCATE cascades to the fixture cases).
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
    const owner = await signIn(OWNER_A);
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(owner) },
      payload: {
        useCaseName: 'Synthetic risk answers case',
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
    const caseId = created.json<{ caseId: string }>().caseId;
    const draft = await readDraft(owner, caseId);
    assert.deepEqual(draft.riskAnswers, {});
    // An answer given while a rubric was in force (written directly: no rubric can be in force here).
    const earlier = { RQ1: { value: 'few', ...attribution(OWNER_A, 'owner', START - 10_000) } };
    await db.owner.execute(
      sql`UPDATE pack_version SET risk_answers = ${JSON.stringify(earlier)}::jsonb WHERE id = ${draft.draftId}`,
    );
    const refused = await put(owner, { riskAnswers: { RQ2: 'advisory', RQ3: null } }, caseId);
    assert.equal(refused.statusCode, 422, refused.body);
    assert.deepEqual(
      fieldsOf(refused).map((f) => [f.path, f.messageKey]),
      [['body.riskAnswers', 'error.risk.not_configured']],
    );
    assert.deepEqual(await storedAnswers(draft.draftId), earlier);
    const cleared = await put(owner, { riskAnswers: { RQ1: null } }, caseId);
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json<PackDraft>().riskAnswers, {});
    assert.deepEqual(await storedAnswers(draft.draftId), {});
  });

  it('reviewers and Admin never write answers: 403, nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const draft = await readDraft(owner);
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      const res = await app.inject({
        method: 'PUT',
        url: `/api/cases/${NONVENDOR.caseId}/draft`,
        headers: { 'content-type': 'application/json', ...asUser(session) },
        payload: {
          expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
          riskAnswers: { RQ1: 'public' },
        },
      });
      assert.equal(res.statusCode, 403, `${id}: ${res.body}`);
    }
    assert.deepEqual(await storedAnswers(draft.draftId), {});
  });

  it('answers are frozen with the version at submit: the submitted row keeps them and the draft route no longer reaches it', async () => {
    const owner = await signIn(OWNER_A);
    const draft = await readDraft(owner);
    assert.equal((await put(owner, { riskAnswers: { RQ4: 'customers' } })).statusCode, 200);
    const stored = await storedAnswers(draft.draftId);
    const version = await submitOk(owner, NONVENDOR.caseId);
    assert.equal(version.versionId, draft.draftId);
    const late = await app.inject({
      method: 'PUT',
      url: `/api/cases/${NONVENDOR.caseId}/draft`,
      headers: { 'content-type': 'application/json', ...asUser(owner) },
      payload: {
        expectedVersion: { versionId: draft.draftId, revision: await caseRevision(NONVENDOR.caseId) },
        riskAnswers: { RQ4: 'internal' },
      },
    });
    assert.equal(late.statusCode, 409, late.body);
    assert.deepEqual(await storedAnswers(draft.draftId), stored);
    await assert.rejects(
      db.owner.execute(sql`UPDATE pack_version SET risk_answers = '{}'::jsonb WHERE id = ${draft.draftId}`),
      (err: Error) => /rai\.frozen_version/.test(String((err.cause as Error | undefined)?.message)),
    );
  });
});
