// W1-13: W0-02 section 7.6 (submit, version list, version by id, latest) with the W0-06 4.3 submit rules, the
// 5.3 idempotency rules and the immutability promise (A07): every read of a version is byte-identical.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';
import { findFixtureCase } from '../../data/cases/index.js';
import { findFixtureDocument } from '../../data/documents/index.js';
import { readManifest } from '../../manifest.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { FIXTURE_CONFIGURATION_REVISION_ID } from './store.js';
import { call, signIn, type CallResult } from './testing.js';

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: unknown };
}

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const missingSlot = findFixtureCase('fx-case-missing-slot')!;
const vendor = findFixtureCase('fx-case-vendor')!;

describe('W1-13 substitute: submit and version navigation (7.6)', () => {
  let substitute: ApiSubstitute;
  const users: Record<string, string> = {};
  beforeEach(async () => {
    substitute = createApiSubstitute({ now: () => new Date('2026-09-22T05:00:00Z') });
    for (const id of [
      'fx-user-owner-cm',
      'fx-user-owner-cm-2',
      'fx-user-spoc-cm',
      'fx-user-dpo',
      'fx-user-admin',
    ])
      users[id] = await signIn(substitute, id);
  });

  const submit = (
    user: string,
    caseId: string,
    body: unknown,
    key: string | null = randomUUID(),
  ): Promise<CallResult> =>
    call(substitute, 'POST', `/api/cases/${caseId}/draft/submit`, {
      cookie: users[user],
      headers: key === null ? {} : { 'idempotency-key': key },
      json: body,
    });

  it('POST submit: 201 SubmittedVersion frozen from the draft; the case moves to in_review with no draft', async () => {
    const response = await submit('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
    });
    assert.equal(response.status, 201, response.text());
    const version = response.json<SubmittedVersion>();
    assert.equal(version.versionId, nonvendor.draftVersionId);
    assert.equal(version.caseId, nonvendor.caseId);
    assert.equal(version.versionNumber, 1);
    assert.equal(version.parentVersionId, null);
    assert.equal(version.submittedBy, 'fixture:fx-user-owner-cm');
    assert.equal(version.submittedAt, '2026-09-22T05:00:00.000Z');
    assert.equal(version.checklistTemplateVersion, 'v1.0 Sheet3');
    assert.equal(version.stageContext, 'pre_launch');
    assert.equal(version.configurationRevisionId, FIXTURE_CONFIGURATION_REVISION_ID);
    assert.equal(version.laneMappingVersion, CURRENT_LANE_MAPPING.version);
    assert.equal(version.isLatest, true);
    const slot1 = version.slots[1];
    assert.equal(slot1.state, 'attached');
    if (slot1.state === 'attached') {
      assert.equal(slot1.artifact.artifactId, findFixtureDocument('fx-doc-0001-01')!.artifactId);
      assert.equal(slot1.artifact.sha256, readManifest().documents['fx-doc-0001-01']?.sha256); // embedded reference
    }
    assert.deepEqual(version.slots[3], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });
    const view = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<CaseView>();
    assert.equal(view.status, 'in_review');
    assert.equal(view.draft, null);
    assert.deepEqual(view.currentVersion, {
      versionId: version.versionId,
      versionNumber: 1,
      submittedBy: version.submittedBy,
      submittedAt: version.submittedAt,
      isLatest: true,
    });
    assert.deepEqual(
      [view.privacyStatus, view.securityStatus, view.raiStatus],
      ['pending', 'pending', 'pending'],
    );
    const list = (await call(substitute, 'GET', '/api/cases', { cookie: users['fx-user-owner-cm'] })).json<{
      items: Array<{ caseId: string; status: string; currentVersionNumber: number | null }>;
    }>();
    assert.deepEqual(list.items.find((i) => i.caseId === nonvendor.caseId)?.currentVersionNumber, 1);
  });

  it('a missing document does not block submit (L7): the missing-slot case submits with slot 7 missing', async () => {
    const response = await submit('fx-user-spoc-cm', missingSlot.caseId, {
      expectedVersion: { versionId: missingSlot.draftVersionId, revision: 1 },
    });
    assert.equal(response.status, 201);
    const version = response.json<SubmittedVersion>();
    assert.deepEqual(version.slots[7], { state: 'missing' });
    assert.deepEqual(version.slots[8], { state: 'not_yet' });
    // The BU SPOC submitting on the owner's behalf is recorded as itself; the owner is unchanged (T4, W1-INT).
    assert.equal(version.submittedBy, 'fixture:fx-user-spoc-cm');
    const view = (
      await call(substitute, 'GET', `/api/cases/${missingSlot.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<CaseView>();
    assert.equal(view.businessOwner, 'fixture:fx-user-owner-cm');
  });

  it('submit: replay with the same key returns the identical 201; the same key with another body is 422', async () => {
    const key = randomUUID();
    const body = { expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 } };
    const first = await submit('fx-user-owner-cm', nonvendor.caseId, body, key);
    const replay = await submit('fx-user-owner-cm', nonvendor.caseId, body, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.text(), first.text());
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<VersionListResponse>().items.length,
      1,
    );
    const reused = await submit(
      'fx-user-owner-cm',
      nonvendor.caseId,
      { expectedVersion: { versionId: nonvendor.draftVersionId, revision: 2 } },
      key,
    );
    assert.equal(reused.status, 422);
    assert.deepEqual(reused.json<Envelope>().error.details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' }],
    });
    const noKey = await submit(
      'fx-user-owner-cm',
      vendor.caseId,
      { expectedVersion: { versionId: vendor.draftVersionId, revision: 1 } },
      null,
    );
    assert.equal(noKey.status, 422);
    assert.deepEqual(noKey.json<Envelope>().error.details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'validation.required' }],
    });
  });

  it('submit: 409 revision_changed on a stale revision; a second submit under a new key is 409 version_superseded', async () => {
    const stale = await submit('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 7 },
    });
    assert.equal(stale.status, 409);
    assert.equal((stale.json<Envelope>().error.details as { reason: string }).reason, 'revision_changed');
    assert.equal(
      (
        await submit('fx-user-owner-cm', nonvendor.caseId, {
          expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
        })
      ).status,
      201,
    );
    const again = await submit('fx-user-owner-cm', nonvendor.caseId, {
      expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
    });
    assert.equal(again.status, 409);
    const details = again.json<Envelope>().error.details as {
      reason: string;
      guidanceKey: string;
      current: { state: string; versionId: string; versionNumber: number };
    };
    assert.equal(details.reason, 'version_superseded');
    assert.equal(details.guidanceKey, 'error.stale_version.guidance.version_superseded');
    assert.deepEqual(
      [details.current.state, details.current.versionId, details.current.versionNumber],
      ['submitted', nonvendor.draftVersionId, 1],
    );
    const badBody = await submit('fx-user-owner-cm', vendor.caseId, {
      expectedVersion: { versionId: vendor.draftVersionId },
    });
    assert.equal(badBody.status, 422);
  });

  it('submit: reviewers and Admin are 403 role, another owner is 403 scope (T10, T11); no version written', async () => {
    for (const [user, reason] of [
      ['fx-user-dpo', 'role'],
      ['fx-user-admin', 'role'],
      ['fx-user-owner-cm-2', 'scope'],
    ] as const) {
      const response = await submit(user, nonvendor.caseId, {
        expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      });
      assert.equal(response.status, 403, user);
      assert.equal(
        substitute.store.logLines.filter((l) => l.event === 'authz.denied').at(-1)?.fields.reason,
        reason,
      );
    }
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions`, {
          cookie: users['fx-user-dpo'],
        })
      ).json<VersionListResponse>().items.length,
      0,
    );
    assert.equal(
      (await submit('fx-user-owner-cm', randomUUID(), { expectedVersion: { versionId: 'x', revision: 1 } }))
        .status,
      403,
    );
    assert.equal(
      (await submit('fx-user-dpo', randomUUID(), { expectedVersion: { versionId: 'x', revision: 1 } }))
        .status,
      403,
    ); // role before existence
    assert.equal(
      (await call(substitute, 'POST', `/api/cases/${nonvendor.caseId}/draft/submit`, { json: {} })).status,
      401,
    );
  });

  it('GET versions, by id and latest: 404 version before any submit, then the frozen version, byte-identical on every read', async () => {
    const before = await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions/latest`, {
      cookie: users['fx-user-dpo'],
    });
    assert.equal(before.status, 404);
    assert.deepEqual(before.json<Envelope>().error.details, { resource: 'version' });
    assert.deepEqual(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions`, {
          cookie: users['fx-user-dpo'],
        })
      ).json<VersionListResponse>(),
      { items: [] },
    );
    const submitted = (
      await submit('fx-user-owner-cm', nonvendor.caseId, {
        expectedVersion: { versionId: nonvendor.draftVersionId, revision: 1 },
      })
    ).json<SubmittedVersion>();
    const list = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions`, {
        cookie: users['fx-user-dpo'],
      })
    ).json<VersionListResponse>();
    assert.deepEqual(list, {
      items: [
        {
          versionId: submitted.versionId,
          versionNumber: 1,
          submittedBy: submitted.submittedBy,
          submittedAt: submitted.submittedAt,
          isLatest: true,
        },
      ],
    });
    const byId = await call(
      substitute,
      'GET',
      `/api/cases/${nonvendor.caseId}/versions/${submitted.versionId}`,
      { cookie: users['fx-user-admin'] },
    );
    const latest = await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions/latest`, {
      cookie: users['fx-user-spoc-cm'],
    });
    assert.equal(byId.status, 200);
    assert.equal(latest.status, 200);
    assert.equal(byId.text(), latest.text());
    assert.deepEqual(byId.json(), submitted);
    const again = await call(
      substitute,
      'GET',
      `/api/cases/${nonvendor.caseId}/versions/${submitted.versionId}`,
      { cookie: users['fx-user-admin'] },
    );
    assert.equal(again.text(), byId.text());
    // A version id under another case is 404 version (also for all_cases holders); out of scope is 403.
    const wrongCase = await call(
      substitute,
      'GET',
      `/api/cases/${vendor.caseId}/versions/${submitted.versionId}`,
      { cookie: users['fx-user-dpo'] },
    );
    assert.equal(wrongCase.status, 404);
    assert.deepEqual(wrongCase.json<Envelope>().error.details, { resource: 'version' });
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions/${submitted.versionId}`, {
          cookie: users['fx-user-owner-cm-2'],
        })
      ).status,
      403,
    ); // T3
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions`, {
          cookie: users['fx-user-owner-cm-2'],
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/versions/latest`)).status,
      401,
    );
    assert.equal(
      (await call(substitute, 'GET', `/api/cases/${randomUUID()}/versions`, { cookie: users['fx-user-dpo'] }))
        .status,
      404,
    );
  });
});
