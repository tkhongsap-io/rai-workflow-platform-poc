// W3-F1 (#163), register row "W3 deferred rulings" item 8: case, version and decision reads carry display names
// next to the subject IDs they already carry (IDs stay for audit and for the SPA's own-subject checks). Names come
// from sources the server already holds: the case's `business_owner` column (the queue's source) and the in-process
// subject directory. The submit 201, its replay and every later read of the version stay byte-identical (A07).
// Fixture set slice1-synthetic@1.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CaseListResponse, CaseView } from '@rai/shared/schemas/cases';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { app, caseRevision, openFixtureApp, signIn, submit } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = findFixtureUser('fx-user-owner-cm')!;
const SPOC = findFixtureUser('fx-user-spoc-cm')!;
const DPO = findFixtureUser('fx-user-dpo')!;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!;

const now = () => new Date(Date.parse('2026-09-26T06:01:00Z'));
openFixtureApp({ now, qcRunner: () => new ScriptedQcRunner({ now }) });

const get = (session: FixtureSession, url: string) =>
  app.inject({ method: 'GET', url, headers: asUser(session) });

describe(`W3-F1 display names on reads — ${SET}`, () => {
  it('the case read and the case list carry the owner display name beside the owner subject id', async () => {
    const owner = await signIn(OWNER.fixtureUserId);
    const view = (await get(owner, `/api/cases/${NONVENDOR.caseId}`)).json<CaseView>();
    assert.equal(view.businessOwner, OWNER.subjectId);
    assert.equal(view.ownerDisplayName, OWNER.displayName);
    const list = (await get(owner, '/api/cases?pageSize=100')).json<CaseListResponse>();
    const row = list.items.find((item) => item.caseId === NONVENDOR.caseId)!;
    assert.equal(row.businessOwner, OWNER.subjectId);
    assert.equal(row.ownerDisplayName, OWNER.displayName);
  });

  it('a version submitted by the BU SPOC names the SPOC on the 201, its replay, the list, the case and every read, byte-identically', async () => {
    const spoc = await signIn(SPOC.fixtureUserId);
    const draft = (await get(spoc, `/api/cases/${NONVENDOR.caseId}/draft`)).json<{
      draftId: string;
      draftRevision: number;
    }>();
    const key = randomUUID();
    const post = () =>
      app.inject({
        method: 'POST',
        url: `/api/cases/${NONVENDOR.caseId}/draft/submit`,
        headers: { 'content-type': 'application/json', 'idempotency-key': key, ...asUser(spoc) },
        payload: { expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } },
      });
    const created = await post();
    assert.equal(created.statusCode, 201, created.body);
    const version = created.json<SubmittedVersion>();
    assert.equal(version.submittedBy, SPOC.subjectId);
    assert.equal(version.submittedByDisplayName, SPOC.displayName);
    assert.equal((await post()).body, created.body, 'the replayed 201 is byte-identical (A07)');
    const byId = await get(spoc, `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`);
    assert.equal(byId.body, created.body, 'a later read is byte-identical to the 201 (A07)');

    const owner = await signIn(OWNER.fixtureUserId);
    const list = (await get(owner, `/api/cases/${NONVENDOR.caseId}/versions`)).json<VersionListResponse>();
    assert.equal(list.items[0]!.submittedByDisplayName, SPOC.displayName);
    const view = (await get(owner, `/api/cases/${NONVENDOR.caseId}`)).json<CaseView>();
    assert.equal(view.currentVersion?.submittedByDisplayName, SPOC.displayName);
  });

  it('a lane decision names the reviewer who decided it, including the send-back feedback the owner reads', async () => {
    const owner = await signIn(OWNER.fixtureUserId);
    const { version } = await submit(owner, NONVENDOR.caseId);
    const dpo = await signIn(DPO.fixtureUserId);
    const lane = `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}/lanes/dpo`;
    const expectedVersion = { versionId: version.versionId, revision: await caseRevision(NONVENDOR.caseId) };
    const qc = await app.inject({
      method: 'POST',
      url: `${lane}/qc-run`,
      headers: { 'content-type': 'application/json', ...asUser(dpo) },
      payload: { expectedVersion },
    });
    assert.equal(qc.statusCode, 200, qc.body);
    assert.ok(qc.json<LaneQcRunResponse>().runId);
    const sent = await app.inject({
      method: 'POST',
      url: `${lane}/send-back`,
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(dpo) },
      payload: {
        expectedVersion,
        feedback: { items: [{ slot: 2, deficiency: 'synthetic: name the processor' }] },
      },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const read = (
      await get(owner, `/api/cases/${NONVENDOR.caseId}/versions/${version.versionId}`)
    ).json<SubmittedVersion>();
    assert.equal(read.decisions.length, 1);
    assert.equal(read.decisions[0]!.decidedBy, DPO.subjectId);
    assert.equal(read.decisions[0]!.decidedByDisplayName, DPO.displayName);
    assert.ok(read.decisions[0]!.feedback, 'the send-back feedback travels with the named decision');
  });
});
