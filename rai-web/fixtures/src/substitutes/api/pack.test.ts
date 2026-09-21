// W1-13: W0-02 section 7.5 (read and save the nine-slot draft) with the W0-06 4.2 save-draft error rows.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Value } from 'typebox/value';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { PackDraftSchema, type PackDraft } from '@rai/shared/schemas/pack';
import { FIXTURE_CASES, findFixtureCase } from '../../data/cases/index.js';
import { findFixtureDocument } from '../../data/documents/index.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { call, multipartFile, signIn, type CallResult } from './testing.js';

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: unknown };
}

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const missingSlot = findFixtureCase('fx-case-missing-slot')!;
const naReasons = findFixtureCase('fx-case-na-reasons')!;
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

describe('W1-13 substitute: pack draft (7.5)', () => {
  let substitute: ApiSubstitute;
  const users: Record<string, string> = {};
  beforeEach(async () => {
    substitute = createApiSubstitute({ now: () => new Date('2026-09-22T04:00:00Z') });
    for (const id of [
      'fx-user-owner-cm',
      'fx-user-owner-cm-2',
      'fx-user-spoc-cm',
      'fx-user-dpo',
      'fx-user-admin',
      'fx-user-dpo-spoc-hr',
    ])
      users[id] = await signIn(substitute, id);
  });

  const put = (user: string, caseId: string, body: unknown): Promise<CallResult> =>
    call(substitute, 'PUT', `/api/cases/${caseId}/draft`, { cookie: users[user], json: body });

  it('GET /api/cases/{caseId}/draft answers every fixture draft with the W0-08 8.3 slot dispositions', async () => {
    for (const fixtureCase of FIXTURE_CASES) {
      const response = await call(substitute, 'GET', `/api/cases/${fixtureCase.caseId}/draft`, {
        cookie: users['fx-user-owner-cm'],
      });
      assert.equal(response.status, 200, fixtureCase.fixtureCaseId);
      const draft = response.json<PackDraft>();
      assert.ok(Value.Check(PackDraftSchema, draft), JSON.stringify(draft));
      assert.equal(draft.draftId, fixtureCase.draftVersionId);
      assert.equal(draft.caseId, fixtureCase.caseId);
      assert.equal(draft.versionNumber, 1);
      assert.equal(draft.parentVersionId, null);
      assert.equal(draft.checklistTemplateVersion, fixtureCase.checklistTemplateVersion);
      assert.equal(draft.stageContext, fixtureCase.stageContext);
      assert.equal(draft.draftRevision, 1);
      for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
        const expected = fixtureCase.slots[slot];
        const actual = draft.slots[slot];
        if (expected.state === 'attached')
          assert.deepEqual(actual, {
            state: 'attached',
            artifactId: findFixtureDocument(expected.fixtureDocumentId)!.artifactId,
          });
        else assert.deepEqual(actual, expected);
      }
    }
    const na = (
      await call(substitute, 'GET', `/api/cases/${naReasons.caseId}/draft`, { cookie: users['fx-user-dpo'] })
    ).json<PackDraft>();
    assert.deepEqual(na.slots[4], {
      state: 'not_applicable',
      reason: {
        kind: 'text',
        text: 'Vendor engaged under synthetic master agreement MSA-FX-0042; no separate statement of work',
      },
    });
    assert.deepEqual(na.slots[8], { state: 'not_yet' });
    const ms = (
      await call(substitute, 'GET', `/api/cases/${missingSlot.caseId}/draft`, {
        cookie: users['fx-user-spoc-cm'],
      })
    ).json<PackDraft>();
    assert.deepEqual(ms.slots[7], { state: 'missing' });
  });

  it('GET draft: 401, 403 out of scope, 404 case (all_cases) and 404 version once the draft was submitted', async () => {
    assert.equal((await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`)).status, 401);
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
          cookie: users['fx-user-owner-cm-2'],
        })
      ).status,
      403,
    );
    const unknown = await call(substitute, 'GET', `/api/cases/${randomUUID()}/draft`, {
      cookie: users['fx-user-dpo'],
    });
    assert.deepEqual(unknown.json<Envelope>().error.details, { resource: 'case' });
    const submit = await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/draft/submit`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: { expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 } },
    });
    assert.equal(submit.status, 201);
    const closed = await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
      cookie: users['fx-user-owner-cm'],
    });
    assert.equal(closed.status, 404);
    assert.deepEqual(closed.json<Envelope>().error.details, { resource: 'version' });
  });

  it('PUT draft: attaches an uploaded artifact, changes stage and template, and answers draftRevision + 1', async () => {
    const part = multipartFile('Slot7_Security.pdf', PDF);
    const uploaded = await call(substitute, 'POST', `/api/cases/${missingSlot.caseId}/artifacts`, {
      cookie: users['fx-user-spoc-cm'],
      headers: { 'content-type': part.contentType },
      body: part.body,
    });
    assert.equal(uploaded.status, 201);
    const ref = uploaded.json<ArtifactRef>();
    const response = await put('fx-user-spoc-cm', missingSlot.caseId, {
      expectedVersion: { versionId: missingSlot.draftVersionId, revision: 1 },
      stageContext: 'pre_launch',
      checklistTemplateVersion: 'v2.0',
      slots: {
        7: { state: 'attached', artifactId: ref.artifactId },
        8: {
          state: 'not_applicable',
          reason: { kind: 'text', text: 'Deployment checklist follows in pre-launch' },
        },
      },
    });
    assert.equal(response.status, 200, response.text());
    const draft = response.json<PackDraft>();
    assert.equal(draft.draftRevision, 2);
    assert.equal(draft.stageContext, 'pre_launch');
    assert.equal(draft.checklistTemplateVersion, 'v2.0');
    assert.deepEqual(draft.slots[7], { state: 'attached', artifactId: ref.artifactId });
    assert.equal(draft.slots[8].state, 'not_applicable');
    assert.deepEqual(draft.slots[1], {
      state: 'attached',
      artifactId: findFixtureDocument('fx-doc-0003-01')!.artifactId,
    }); // untouched
    assert.equal(draft.updatedAt, '2026-09-22T04:00:00.000Z');
    const view = (
      await call(substitute, 'GET', `/api/cases/${missingSlot.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<{ caseRevision: number }>();
    assert.equal(view.caseRevision, 2); // one counter per case
    // Detach again: the slot returns to missing.
    const detached = await put('fx-user-owner-cm', missingSlot.caseId, {
      expectedVersion: { versionId: missingSlot.draftVersionId, revision: 2 },
      slots: { 7: { state: 'missing' } },
    });
    assert.equal(detached.status, 200);
    assert.deepEqual(detached.json<PackDraft>().slots[7], { state: 'missing' });
  });

  it('PUT draft: N/A without a reason is 422 validation.reason_required on the slot path; nothing written', async () => {
    for (const body of [
      { slots: { 9: { state: 'not_applicable', reason: { kind: 'text', text: '' } } } },
      { slots: { 9: { state: 'not_applicable', reason: { kind: 'text', text: '   ' } } } },
      { slots: { 9: { state: 'not_applicable' } } },
    ]) {
      const response = await put('fx-user-owner-cm', nonvendor.caseId, {
        expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
        ...body,
      });
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.deepEqual(response.json<Envelope>().error.details, {
        fields: [{ path: 'body.slots[9].reason', messageKey: 'validation.reason_required' }],
      });
    }
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<PackDraft>().draftRevision,
      1,
    );
  });

  it('PUT draft: an artifact of another case or unknown is 422 error.artifact_case_mismatch; bad template and slot are 422', async () => {
    const foreign = findFixtureDocument('fx-doc-0002-03')!.artifactId; // belongs to fx-case-vendor
    const mismatch = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      slots: { 9: { state: 'attached', artifactId: foreign } },
    });
    assert.equal(mismatch.status, 422);
    assert.deepEqual(mismatch.json<Envelope>().error.details, {
      fields: [{ path: 'body.slots[9].artifactId', messageKey: 'error.artifact_case_mismatch' }],
    });
    const unknown = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      slots: { 9: { state: 'attached', artifactId: randomUUID() } },
    });
    assert.equal(unknown.status, 422);
    const template = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      checklistTemplateVersion: 'v9.9',
    });
    assert.deepEqual(template.json<Envelope>().error.details, {
      fields: [{ path: 'body.checklistTemplateVersion', messageKey: 'validation.not_in_configured_list' }],
    });
    const slot10 = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      slots: { 10: { state: 'missing' } },
    });
    assert.equal(slot10.status, 422);
    assert.deepEqual(slot10.json<Envelope>().error.details, {
      fields: [{ path: 'body.slots.10', messageKey: 'validation.not_in_configured_list' }],
    });
    const badState = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      slots: { 1: { state: 'approved' } },
    });
    assert.equal(badState.status, 422);
    const noExpected = await put('fx-user-owner-cm', nonvendor.caseId, {
      slots: { 1: { state: 'missing' } },
    });
    assert.deepEqual(noExpected.json<Envelope>().error.details, {
      fields: [{ path: 'body.expectedVersion', messageKey: 'validation.required' }],
    });
  });

  it('PUT draft: 409 revision_changed on a stale revision and version_superseded on a wrong or closed draft id', async () => {
    const first = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      stageContext: 'pre_build',
    });
    assert.equal(first.status, 200);
    const stale = await put('fx-user-spoc-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      stageContext: 'pre_launch',
    });
    assert.equal(stale.status, 409);
    assert.deepEqual(stale.json<Envelope>().error.details, {
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: {
        versionId: nonvendor.draftVersionId,
        versionNumber: 1,
        revision: 2,
        state: 'draft',
        ready: false,
      },
      refreshPath: `/cases/${nonvendor.caseId}`,
    });
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<PackDraft>().stageContext,
      'pre_build',
    );
    const wrongId = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: randomUUID(), revision: 2 },
      stageContext: 'pre_launch',
    });
    assert.equal(wrongId.status, 409);
    assert.equal((wrongId.json<Envelope>().error.details as { reason: string }).reason, 'version_superseded');
    const submit = await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/draft/submit`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: { expectedVersion: { versionId: nonvendor.draftVersionId, revision: 2 } },
    });
    assert.equal(submit.status, 201);
    const closed = await put('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 2 },
      stageContext: 'pre_launch',
    });
    assert.equal(closed.status, 409);
    const details = closed.json<Envelope>().error.details as {
      reason: string;
      current: { state: string; versionId: string };
      refreshPath: string;
    };
    assert.equal(details.reason, 'version_superseded');
    assert.equal(details.current.state, 'submitted');
    assert.equal(details.refreshPath, `/cases/${nonvendor.caseId}/versions/${details.current.versionId}`);
  });

  it('PUT draft: reviewers and Admin are 403 role; another owner and a SPOC of another BU are 403 scope', async () => {
    const body = {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      stageContext: 'pre_launch',
    };
    for (const [user, reason] of [
      ['fx-user-dpo', 'role'],
      ['fx-user-admin', 'role'],
      ['fx-user-owner-cm-2', 'scope'],
      ['fx-user-dpo-spoc-hr', 'scope'],
    ] as const) {
      const response = await put(user, nonvendor.caseId, body);
      assert.equal(response.status, 403, user);
      assert.equal(
        substitute.store.logLines.filter((l) => l.event === 'authz.denied').at(-1)?.fields.reason,
        reason,
      );
    }
    assert.equal(
      (
        await put('fx-user-dpo-spoc-hr', naReasons.caseId, {
          expectedVersion: { versionId: naReasons.draftVersionId, revision: 1 },
          stageContext: 'pre_build',
        })
      ).status,
      200,
    ); // its own BU
  });

  it('PUT draft: attaching over the pack limit is 422 unsafe_upload pack_total_exceeded, re-checked at attach', async () => {
    const small = createApiSubstitute({ uploadMaxPackBytes: 2 * 1024 * 1024 });
    const cookie = await signIn(small, 'fx-user-owner-cm');
    // fx-case-vendor already references the 2 MiB DPA, so its draft sits at the limit; attaching anything more fails.
    const vendor = findFixtureCase('fx-case-vendor')!;
    const part = multipartFile('one_more.pdf', PDF);
    const uploaded = await call(small, 'POST', `/api/cases/${vendor.caseId}/artifacts`, {
      cookie,
      headers: { 'content-type': part.contentType },
      body: part.body,
    });
    assert.equal(uploaded.status, 422); // the upload itself already exceeds the total (W0-08 check 10)
    assert.deepEqual(uploaded.json<Envelope>().error.details, {
      reasonKey: 'error.unsafe_upload.pack_total_exceeded',
      params: { max_pack_mb: 2 },
    });
    // Attach a fixture artifact of the same case to a second slot: the attach re-check refuses it too.
    const attach = await call(small, 'PUT', `/api/cases/${vendor.caseId}/draft`, {
      cookie,
      json: {
        expectedVersion: { versionId: vendor.draftVersionId, revision: 1 },
        slots: { 9: { state: 'attached', artifactId: findFixtureDocument('fx-doc-0002-03')!.artifactId } },
      },
    });
    assert.equal(attach.status, 422);
    assert.deepEqual(attach.json<Envelope>().error.details, {
      reasonKey: 'error.unsafe_upload.pack_total_exceeded',
      params: { max_pack_mb: 2 },
    });
  });
});
