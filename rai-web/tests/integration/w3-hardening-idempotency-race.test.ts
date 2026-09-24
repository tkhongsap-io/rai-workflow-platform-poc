// W0-06 5.3: an Idempotency-Key reused by one actor on two cases at the same moment is a client error. The case
// locks differ, so only the (actor, key) lock makes the second request see the first one's stored key and answer
// 422 `idempotency_key_reused` instead of failing on the primary key. Fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { VersionRef } from '@rai/shared/qc/types';
import { assertNoLeak } from '../support/log-capture.js';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { app, capture, caseRevision, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const CASES = [findFixtureCase('fx-case-vendor')!.caseId, findFixtureCase('fx-case-nonvendor')!.caseId];
const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));
const now = () => new Date(Date.parse('2026-09-22T06:01:00Z'));

openFixtureApp({
  now,
  qcRunner: () =>
    new ScriptedQcRunner({
      fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
      now,
    }),
});
afterEach(() => assertNoLeak(capture));

async function post(session: FixtureSession, url: string, payload: object, key?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(key === undefined ? {} : { 'idempotency-key': key }),
      ...asUser(session),
    },
    payload,
  });
}

/** Submits the case's draft and runs the DPO lane QC on it; returns the approve body that names the real run. */
async function approvable(owner: FixtureSession, dpo: FixtureSession, caseId: string) {
  const { versionId } = await submitOk(owner, caseId);
  const qc = await post(dpo, `/api/cases/${caseId}/versions/${versionId}/lanes/dpo/qc-run`, {
    expectedVersion: { versionId, revision: await caseRevision(caseId) },
  });
  assert.equal(qc.statusCode, 200, qc.body);
  const { runId } = qc.json<LaneQcRunResponse>();
  assert.ok(runId !== null);
  return {
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/dpo/approve`,
    body: { expectedVersion: { versionId, revision: await caseRevision(caseId) }, qcRunId: runId },
  };
}

describe(`idempotency key race — ${SET}`, () => {
  it('one key on two cases at once: one approval is 201, the other 422 idempotency_key_reused', async () => {
    const owner = await signIn(OWNER);
    const dpo = await signIn(DPO);
    const approvals = [];
    for (const caseId of CASES) approvals.push(await approvable(owner, dpo, caseId));
    capture.clear();

    const key = randomUUID();
    const responses = await Promise.all(approvals.map(({ url, body }) => post(dpo, url, body, key)));

    const statuses = responses.map((res) => res.statusCode).sort();
    assert.deepEqual(statuses, [201, 422], responses.map((res) => res.body).join('\n'));
    const refused = responses.find((res) => res.statusCode === 422)!.json<ErrorResponse<'invalid_input'>>();
    assert.deepEqual(refused.error.details?.fields, [
      { path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' },
    ]);
    // The refusal is captured as the client error it is; nothing is captured as internal_error.
    const captured = capture.lines().filter((line) => line.event === 'error.captured');
    assert.deepEqual(
      captured.map((line) => line.fields?.category),
      ['invalid_input'],
    );
    const decisions = await db.owner.execute(sql`SELECT count(*)::int AS n FROM lane_decision`);
    assert.equal(decisions.rows[0]!.n, 1);
  });
});
