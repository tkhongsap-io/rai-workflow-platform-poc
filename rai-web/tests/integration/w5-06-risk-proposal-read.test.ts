// W5-06 (W5 plan sections 6 and 9, R-14): GET /api/cases/{caseId}/versions/{versionId}/risk-proposal reads the risk
// proposal W5-05 recorded at submit for exactly that version. Authorized like the version's qc-runs read (W0-05
// `version.view` on the case; 404 for a malformed, unknown or other-case version), plus 404 for a draft, which has no
// proposal by construction. The body is `{ proposal: RiskProposalView | null }`: null for a version submitted before
// W5; otherwise the recorded tier, bounds, Council indication, explanation with each frozen answer's attribution, and
// the rubric revision the version FROZE, never the one in force today. The read writes nothing. The rubric is the
// seeded SYNTHETIC PLACEHOLDER `synthetic-placeholder.1` (D07 open). Fixture app on the real Postgres; fixture set
// slice1-synthetic@1; synthetic data only.

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import { ENGINE_VERSION } from '@rai/shared/risk/types';
import type { PackDraft } from '@rai/shared/schemas/pack';
import type { RiskProposalResponse } from '@rai/shared/schemas/risk';
import { CONFIGURATION_SEED, SEED_KINDS } from '@rai/server/configuration/seed';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { findFixtureUser } from '@rai/fixtures/data/users';
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
const SPOC_CM = 'fx-user-spoc-cm'; // BU SPOC of CM: another BU than the HR vendor case
const AI_COE = 'fx-user-ai-coe';
const ADMIN = 'fx-user-admin';
const user = (id: string) => findFixtureUser(id)!;
const VENDOR = findFixtureCase('fx-case-vendor')!; // HR
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM, slot 1 attached
const THREE_HIGH = { RQ1: 'public', RQ2: 'automated', RQ4: 'customers' } as const;

const proposalUrl = (caseId: string, versionId: string) =>
  `/api/cases/${caseId}/versions/${versionId}/risk-proposal`;
const runsUrl = (caseId: string, versionId: string) => `/api/cases/${caseId}/versions/${versionId}/qc-runs`;

function get(session: FixtureSession | null, url: string) {
  return app.inject({ method: 'GET', url, headers: session === null ? {} : asUser(session) });
}

async function readProposal(session: FixtureSession, caseId: string, versionId: string) {
  const res = await get(session, proposalUrl(caseId, versionId));
  assert.equal(res.statusCode, 200, res.body);
  return res.json<RiskProposalResponse>().proposal;
}

async function readDraft(session: FixtureSession, caseId: string): Promise<PackDraft> {
  const res = await get(session, `/api/cases/${caseId}/draft`);
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

async function storedRow(versionId: string) {
  const r = await db.owner.execute(
    sql`SELECT id, rubric_revision_id, inputs_hash, created_at FROM risk_proposal WHERE version_id = ${versionId}`,
  );
  assert.equal(r.rows.length, 1);
  return r.rows[0] as {
    id: string;
    rubric_revision_id: string | null;
    inputs_hash: string | null;
    created_at: Date;
  };
}

async function rowCounts(): Promise<Record<string, number>> {
  const r = await db.owner.execute(sql`
    SELECT (SELECT count(*)::int FROM risk_proposal) AS proposals,
           (SELECT count(*)::int FROM audit_event) AS audit,
           (SELECT count(*)::int FROM qc_run) AS runs`);
  return r.rows[0] as Record<string, number>;
}

describe(`W5-06 risk proposal read — ${SET}`, () => {
  it('a High proposal reads with its bounds, Council required, the frozen rubric and each answer attributed and named; the read writes nothing', async () => {
    const owner = await signIn(OWNER);
    clock = START + 1000;
    await save(owner, NONVENDOR.caseId, { riskAnswers: THREE_HIGH });
    clock = START + 2000;
    const version = await submitOk(owner, NONVENDOR.caseId);
    const row = await storedRow(version.versionId);

    const reviewer = await signIn(AI_COE); // before the count: a sign-in audits
    const before = await rowCounts();
    const proposal = await readProposal(reviewer, NONVENDOR.caseId, version.versionId);
    assert.deepEqual(await rowCounts(), before, 'GET writes no proposal, audit event or run');
    assert.ok(proposal !== null);
    assert.equal(proposal.proposalId, row.id);
    assert.equal(proposal.versionId, version.versionId);
    assert.equal(proposal.trigger, 'submit');
    assert.equal(proposal.status, 'proposed');
    assert.equal(proposal.unavailableReason, null);
    assert.equal(proposal.tier, 'high');
    assert.deepEqual(proposal.bounds, { lowest: 'high', highest: 'high' });
    assert.equal(proposal.councilConfirmation, 'required');
    assert.equal(proposal.engineVersion, ENGINE_VERSION);
    assert.equal(proposal.inputsHash, row.inputs_hash);
    assert.equal(proposal.createdAt, version.submittedAt);

    assert.ok(proposal.rubric !== null);
    assert.equal(proposal.rubric.revisionId, row.rubric_revision_id);
    assert.equal(proposal.rubric.label, 'synthetic-placeholder.1');
    assert.equal(proposal.rubric.provenance, 'synthetic_placeholder');
    assert.deepEqual(proposal.rubric.questions, CONFIGURATION_SEED.risk_rubric.questions);
    assert.deepEqual(proposal.rubric.tierLabels, CONFIGURATION_SEED.risk_rubric.tierLabels);

    const explanation = proposal.explanation!;
    assert.equal(explanation.unknownCount, 4);
    assert.deepEqual(explanation.matchedRule, { tier: 'high', index: 0 });
    assert.deepEqual(
      explanation.questions.map((q) => q.questionId),
      ['RQ1', 'RQ2', 'RQ3', 'RQ4', 'RQ5', 'RQ6', 'RQ7'],
    );
    const rq1 = explanation.questions.find((q) => q.questionId === 'RQ1')!;
    assert.deepEqual(rq1, {
      questionId: 'RQ1',
      status: 'answered',
      value: 'public',
      level: 'high',
      answeredBy: user(OWNER).subjectId,
      answeredByName: user(OWNER).displayName,
      answeredRole: 'owner',
      answeredAt: new Date(START + 1000).toISOString(),
      evidence: { slot: 1, state: 'attached' },
    });
    const rq3 = explanation.questions.find((q) => q.questionId === 'RQ3')!;
    assert.equal(rq3.status, 'unknown');
    assert.equal(rq3.unknownReason, 'unanswered');
    assert.equal(rq3.answeredBy, undefined, 'an unanswered question carries no attribution');
    assert.equal(explanation.counts.high, 3);
  });

  it('no answers: the all-Unknown proposal reads unknown with bounds low…high and Council possible; the owner and the BU SPOC may read it', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    for (const session of [owner, await signIn(SPOC_CM), await signIn(ADMIN)]) {
      const proposal = await readProposal(session, NONVENDOR.caseId, version.versionId);
      assert.ok(proposal !== null);
      assert.equal(proposal.status, 'proposed');
      assert.equal(proposal.tier, 'unknown');
      assert.deepEqual(proposal.bounds, { lowest: 'low', highest: 'high' });
      assert.equal(proposal.councilConfirmation, 'possible');
      assert.equal(proposal.explanation!.unknownCount, 7);
      assert.equal(proposal.explanation!.matchedRule, null);
    }
  });

  it('not_configured: an unavailable proposal reads with no tier, bounds, rubric or explanation and is never Low', async () => {
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
    const owner = await signIn(OWNER);
    const created = await app.inject({
      method: 'POST',
      url: '/api/cases',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(owner) },
      payload: {
        useCaseName: 'Synthetic risk read case',
        businessUnitId: 'CM',
        businessUnit: 'Consumer Mobile',
        businessOwner: user(OWNER).subjectId,
        technicalOwner: 'Anan T. (synthetic)',
        sourceRecordId: { kind: 'unknown' },
        useCaseGroup: 'customer-analytics',
        vendorInvolved: false,
        modelType: 'llm',
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const caseId = created.json<{ caseId: string }>().caseId;
    const version = await submitOk(owner, caseId);
    const proposal = await readProposal(owner, caseId, version.versionId);
    assert.deepEqual(
      {
        status: proposal!.status,
        unavailableReason: proposal!.unavailableReason,
        tier: proposal!.tier,
        bounds: proposal!.bounds,
        rubric: proposal!.rubric,
        explanation: proposal!.explanation,
        inputsHash: proposal!.inputsHash,
        councilConfirmation: proposal!.councilConfirmation,
      },
      {
        status: 'unavailable',
        unavailableReason: 'not_configured',
        tier: null,
        bounds: null,
        rubric: null,
        explanation: null,
        inputsHash: null,
        councilConfirmation: 'not_indicated',
      },
    );
  });

  it('a submitted version with no proposal row (submitted before W5) reads { proposal: null }', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    // A pre-W5 version: TRUNCATE is not an UPDATE or DELETE, so the append-only trigger does not refuse it.
    await db.owner.execute(sql.raw('TRUNCATE TABLE "risk_proposal"'));
    const res = await get(owner, proposalUrl(NONVENDOR.caseId, version.versionId));
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { proposal: null });
  });

  it('the frozen rubric is returned after a newer risk_rubric revision is published; a later version reads the newer one', async () => {
    const owner = await signIn(OWNER);
    const v1 = await submitOk(owner, NONVENDOR.caseId);
    const frozenId = (await storedRow(v1.versionId)).rubric_revision_id;
    const newer = structuredClone(CONFIGURATION_SEED.risk_rubric);
    newer.label = 'synthetic-placeholder.2';
    newer.questions[0]!.text = {
      th: '[SYNTHETIC PLACEHOLDER] คำถามใหม่',
      en: '[SYNTHETIC PLACEHOLDER] A newer question',
    };
    clock = START + 60_000;
    const newerId = await withTransaction(
      db.app,
      async (tx) =>
        (
          await publishRevision(tx, {
            kind: 'risk_rubric',
            body: newer,
            publishedBy: 'system',
            publishedRole: 'system',
            correlationId: randomUUID(),
            publishedAt: new Date(START + 30_000),
          })
        ).id,
    );
    const current = await get(owner, '/api/configuration/risk-rubric/current');
    assert.equal(
      current.json<{ label: string }>().label,
      'synthetic-placeholder.2',
      'the newer revision is in force',
    );

    const read = await readProposal(await signIn(AI_COE), NONVENDOR.caseId, v1.versionId);
    assert.equal(read!.rubric!.revisionId, frozenId);
    assert.notEqual(read!.rubric!.revisionId, newerId);
    assert.equal(read!.rubric!.label, 'synthetic-placeholder.1');
    assert.deepEqual(read!.rubric!.questions, CONFIGURATION_SEED.risk_rubric.questions);
  });

  it('scope: exactly the qc-runs read — 401, 403 for another owner and another BU, 200 for reviewers and Admin, 404 for unknown, malformed and other-case versions', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, VENDOR.caseId); // HR
    const other = await submitOk(owner, NONVENDOR.caseId); // CM
    const sessions: Array<[string, FixtureSession | null]> = [
      ['anonymous', null],
      [OWNER, owner],
      [OTHER_OWNER, await signIn(OTHER_OWNER)],
      [SPOC_CM, await signIn(SPOC_CM)],
      [AI_COE, await signIn(AI_COE)],
      [ADMIN, await signIn(ADMIN)],
      ['fx-user-dpo-spoc-hr', await signIn('fx-user-dpo-spoc-hr')],
    ];
    const targets: Array<[string, string, string]> = [
      ['the version', VENDOR.caseId, version.versionId],
      ['an unknown version', VENDOR.caseId, randomUUID()],
      ['a malformed version id', VENDOR.caseId, 'not-a-uuid'],
      ["another case's version", VENDOR.caseId, other.versionId],
      ['an unknown case', randomUUID(), version.versionId],
    ];
    const seen: Record<string, number> = {};
    for (const [who, session] of sessions) {
      for (const [what, caseId, versionId] of targets) {
        const proposal = await get(session, proposalUrl(caseId, versionId));
        const runs = await get(session, runsUrl(caseId, versionId));
        assert.equal(proposal.statusCode, runs.statusCode, `${who} on ${what}: ${proposal.body}`);
        if (proposal.statusCode !== 200)
          assert.deepEqual(
            proposal.json<ErrorResponse>().error.code,
            runs.json<ErrorResponse>().error.code,
            `${who} on ${what}`,
          );
        seen[`${who} ${what}`] = proposal.statusCode;
      }
    }
    assert.deepEqual(
      {
        anonymous: seen['anonymous the version'],
        owner: seen[`${OWNER} the version`],
        otherOwner: seen[`${OTHER_OWNER} the version`],
        otherBu: seen[`${SPOC_CM} the version`],
        reviewer: seen[`${AI_COE} the version`],
        admin: seen[`${ADMIN} the version`],
        dualRole: seen['fx-user-dpo-spoc-hr the version'],
        unknown: seen[`${OWNER} an unknown version`],
        malformed: seen[`${OWNER} a malformed version id`],
        otherCase: seen[`${OWNER} another case's version`],
        unknownCaseReviewer: seen[`${AI_COE} an unknown case`],
      },
      {
        anonymous: 401,
        owner: 200,
        otherOwner: 403,
        otherBu: 403,
        reviewer: 200,
        admin: 200,
        dualRole: 200,
        unknown: 404,
        malformed: 404,
        otherCase: 404,
        unknownCaseReviewer: 404,
      },
    );
    const notFound = await get(owner, proposalUrl(VENDOR.caseId, randomUUID()));
    assert.deepEqual(notFound.json<ErrorResponse>().error.details, { resource: 'version' });
  });

  it('a draft has no proposal: 404 not_found (version) for everyone who may read the case, 403 for the rest', async () => {
    const owner = await signIn(OWNER);
    const draft = await readDraft(owner, NONVENDOR.caseId);
    for (const [who, expected] of [
      [OWNER, 404],
      [AI_COE, 404],
      [ADMIN, 404],
      [SPOC_CM, 404],
      [OTHER_OWNER, 403],
    ] as const) {
      const res = await get(await signIn(who), proposalUrl(NONVENDOR.caseId, draft.draftId));
      assert.equal(res.statusCode, expected, `${who}: ${res.body}`);
      if (expected === 404)
        assert.deepEqual(res.json<ErrorResponse>().error.details, { resource: 'version' });
    }
    // Once submitted, the same case's version reads its proposal.
    const v1 = await submitOk(owner, NONVENDOR.caseId);
    assert.ok((await readProposal(owner, NONVENDOR.caseId, v1.versionId)) !== null);
  });
});
