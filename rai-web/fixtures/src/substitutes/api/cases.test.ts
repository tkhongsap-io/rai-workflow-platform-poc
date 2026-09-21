// W1-13: W0-02 section 7.3 (configuration, scoped list, create, read, edit) and the W0-05 rows that name them:
// T2, T3, T5, T6, T7, T8, T9, T10, T11, T13, T31, T33(i). The reason of each 403 is asserted on the recorded
// `authz.denied` line, as W0-05 section 7 says; the body never carries it.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { REGISTRY_ID_PATTERN } from '@rai/shared/ids';
import type { CaseListResponse, CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { FIXTURE_CASES, findFixtureCase } from '../../data/cases/index.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { call, signIn, type CallResult } from './testing.js';

interface Envelope {
  error: { code: string; messageKey: string; correlationId: string; details?: unknown };
}

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const vendor = findFixtureCase('fx-case-vendor')!; // HR
const hrDual = findFixtureCase('fx-case-hr-dualrole')!;

function validCreateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    useCaseName: 'Synthetic Assistant (substitute test)',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    businessOwner: 'fixture:fx-user-owner-cm',
    technicalOwner: 'Synthetic T.',
    sourceRecordId: { kind: 'known', value: 'TPM-FX-0001' },
    useCaseGroup: 'customer-analytics',
    vendorInvolved: false,
    modelType: 'llm',
    ...overrides,
  };
}

describe('W1-13 substitute: cases (7.3)', () => {
  let substitute: ApiSubstitute;
  const clock = new Date('2026-09-22T02:00:00Z');
  const users: Record<string, string> = {};
  beforeEach(async () => {
    substitute = createApiSubstitute({ now: () => clock });
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

  function denied(): Array<Record<string, unknown>> {
    return substitute.store.logLines.filter((l) => l.event === 'authz.denied').map((l) => l.fields);
  }

  it('GET /api/configuration/current answers the W1-00 seed as a ConfigurationView; 401 without a session', async () => {
    const response = await call(substitute, 'GET', '/api/configuration/current', {
      cookie: users['fx-user-owner-cm'],
    });
    assert.equal(response.status, 200);
    const view = response.json<ConfigurationView>();
    assert.deepEqual(view.useCaseGroups, ['customer-analytics', 'customer-service', 'field-operations']);
    assert.deepEqual(view.checklistTemplateVersions, ['v1.0 Sheet3', 'v2.0']);
    assert.deepEqual(view.slaWorkingDays, { dpo: 3, ai_coe: 5, it_security: 5 });
    assert.equal(view.timezone, 'Asia/Bangkok');
    assert.match(view.revisionId, /^[0-9a-f-]{36}$/);
    assert.equal((await call(substitute, 'GET', '/api/configuration/current')).status, 401);
  });

  it('GET /api/cases is scoped: own cases, the BU, or all (T8); total counts only in-scope cases', async () => {
    const list = async (user: string, query = ''): Promise<CaseListResponse> => {
      const response = await call(substitute, 'GET', `/api/cases${query}`, { cookie: users[user] });
      assert.equal(response.status, 200);
      return response.json<CaseListResponse>();
    };
    const owner = await list('fx-user-owner-cm');
    assert.equal(owner.total, 5);
    assert.deepEqual(
      owner.items.map((i) => i.registryId).sort(),
      FIXTURE_CASES.map((c) => c.registryId).sort(),
    );
    const ownerB = await list('fx-user-owner-cm-2');
    assert.deepEqual(ownerB, { items: [], page: 1, pageSize: 25, total: 0 });
    const spoc = await list('fx-user-spoc-cm');
    assert.equal(spoc.total, 2);
    assert.ok(spoc.items.every((i) => i.businessUnitId === 'CM'));
    assert.ok(!spoc.items.some((i) => i.caseId === vendor.caseId)); // no B2 case
    assert.equal((await list('fx-user-dpo')).total, 5);
    assert.equal((await list('fx-user-admin')).total, 5);
    assert.equal((await list('fx-user-dpo-spoc-hr')).total, 5); // all_cases through the dpo grant
    const page2 = await list('fx-user-owner-cm', '?page=2&pageSize=2');
    assert.equal(page2.items.length, 2);
    assert.deepEqual(
      { page: page2.page, pageSize: page2.pageSize, total: page2.total },
      { page: 2, pageSize: 2, total: 5 },
    );
    assert.equal((await list('fx-user-owner-cm', '?page=3&pageSize=2')).items.length, 1);
    const item = owner.items[0]!;
    assert.deepEqual(Object.keys(item).sort(), [
      'businessOwner',
      'businessUnit',
      'businessUnitId',
      'caseId',
      'currentVersionNumber',
      'registryId',
      'status',
      'updatedAt',
      'useCaseGroup',
      'useCaseName',
    ]);
    assert.equal(item.currentVersionNumber, null);
  });

  it('GET /api/cases rejects a bad page with 422 on query.page; 401 without a session', async () => {
    const bad = await call(substitute, 'GET', '/api/cases?page=0', { cookie: users['fx-user-owner-cm'] });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json<Envelope>().error.details, {
      fields: [{ path: 'query.page', messageKey: 'validation.not_in_configured_list' }],
    });
    assert.equal(
      (await call(substitute, 'GET', '/api/cases?pageSize=101', { cookie: users['fx-user-owner-cm'] }))
        .status,
      422,
    );
    assert.equal(
      (await call(substitute, 'GET', '/api/cases?page=abc', { cookie: users['fx-user-owner-cm'] })).status,
      422,
    );
    assert.equal((await call(substitute, 'GET', '/api/cases')).status, 401);
  });

  it('GET /api/cases/{caseId}: 200 for the owner (T2) and reviewers (T9); the CaseView shape', async () => {
    const response = await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
    });
    assert.equal(response.status, 200);
    const view = response.json<CaseView>();
    assert.equal(view.registryId, 'RAI-2000-0001');
    assert.equal(view.status, 'draft');
    assert.equal(view.riskTier, null);
    assert.deepEqual(
      [view.privacyStatus, view.securityStatus, view.raiStatus, view.aiReadinessStatus],
      ['pending', 'pending', 'pending', 'not_ready'],
    );
    assert.equal(view.currentVersion, null);
    assert.equal(view.draft?.draftId, nonvendor.draftVersionId);
    assert.equal(view.caseRevision, 1);
    assert.equal(view.businessOwner, 'fixture:fx-user-owner-cm');
    assert.deepEqual(view.sourceRecordId, { kind: 'known', value: 'AIR-FX-2291' }); // read back unchanged (L10)
    assert.equal(view.createdBy, 'fixture:fx-user-owner-cm');
    for (const user of ['fx-user-dpo', 'fx-user-admin', 'fx-user-spoc-cm'])
      assert.equal(
        (await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users[user] })).status,
        200,
        user,
      );
    const thai = await call(
      substitute,
      'GET',
      `/api/cases/${findFixtureCase('fx-case-na-reasons')!.caseId}`,
      { cookie: users['fx-user-dpo'] },
    );
    assert.equal(thai.json<CaseView>().useCaseName, 'ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)');
  });

  it('GET /api/cases/{caseId}: 403 scope for another owner (T3) and a SPOC of another BU (T5); no case field leaks', async () => {
    const other = await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm-2'],
    });
    assert.equal(other.status, 403);
    const body = other.json<Envelope>();
    assert.deepEqual(body.error, {
      code: 'forbidden',
      messageKey: 'error.forbidden',
      correlationId: body.error.correlationId,
    });
    assert.ok(!other.text().includes('Churn'));
    const spoc = await call(substitute, 'GET', `/api/cases/${vendor.caseId}`, {
      cookie: users['fx-user-spoc-cm'],
    });
    assert.equal(spoc.status, 403);
    assert.deepEqual(
      denied().map((d) => [d.action, d.reason, d.targetId]),
      [
        ['case.view', 'scope', nonvendor.caseId],
        ['case.view', 'scope', vendor.caseId],
      ],
    );
    assert.equal((await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`)).status, 401); // T1
  });

  it('an unresolvable caseId is 403 scope for own/BU-only actors and 404 not_found for all_cases holders (T33 i)', async () => {
    const random = randomUUID();
    for (const user of ['fx-user-owner-cm-2', 'fx-user-spoc-cm', 'fx-user-owner-cm']) {
      const response = await call(substitute, 'GET', `/api/cases/${random}`, { cookie: users[user] });
      assert.equal(response.status, 403, user);
      assert.equal(response.json<Envelope>().error.details, undefined);
    }
    for (const user of ['fx-user-dpo', 'fx-user-admin']) {
      const response = await call(substitute, 'GET', `/api/cases/${random}`, { cookie: users[user] });
      assert.equal(response.status, 404, user);
      assert.deepEqual(response.json<Envelope>().error.details, { resource: 'case' });
    }
    assert.equal(denied().length, 3); // the 404s emit no authz.denied line
    assert.equal(
      (await call(substitute, 'GET', '/api/cases/not-a-uuid', { cookie: users['fx-user-dpo'] })).status,
      404,
    );
    assert.equal(
      (await call(substitute, 'GET', '/api/cases/not-a-uuid', { cookie: users['fx-user-owner-cm'] })).status,
      403,
    );
  });

  it('POST /api/cases: 201 CaseView in draft with the nine default slots and caseRevision 1', async () => {
    const response = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: validCreateBody(),
    });
    assert.equal(response.status, 201, response.text());
    const view = response.json<CaseView>();
    assert.match(view.registryId, REGISTRY_ID_PATTERN);
    assert.equal(view.registryId, 'RAI-2026-0001');
    assert.equal(view.status, 'draft');
    assert.equal(view.caseRevision, 1);
    assert.equal(view.createdBy, 'fixture:fx-user-owner-cm');
    assert.equal(view.currentVersion, null);
    assert.ok(view.draft !== null);
    const draft = (
      await call(substitute, 'GET', `/api/cases/${view.caseId}/draft`, { cookie: users['fx-user-owner-cm'] })
    ).json<PackDraft>();
    assert.deepEqual(draft.slots[3], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });
    assert.deepEqual(draft.slots[4], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });
    assert.deepEqual(draft.slots[1], { state: 'missing' });
    assert.equal(draft.stageContext, 'idea');
    assert.equal(draft.checklistTemplateVersion, 'v1.0 Sheet3');
    assert.equal(draft.draftRevision, 1);
    const vendorCase = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: validCreateBody({ vendorInvolved: true, sourceRecordId: { kind: 'unknown' } }),
    });
    assert.equal(vendorCase.status, 201);
    assert.equal(vendorCase.json<CaseView>().registryId, 'RAI-2026-0002');
    const vendorDraft = (
      await call(substitute, 'GET', `/api/cases/${vendorCase.json<CaseView>().caseId}/draft`, {
        cookie: users['fx-user-owner-cm'],
      })
    ).json<PackDraft>();
    assert.deepEqual(vendorDraft.slots[3], { state: 'missing' });
    const list = (
      await call(substitute, 'GET', '/api/cases', { cookie: users['fx-user-owner-cm'] })
    ).json<CaseListResponse>();
    assert.equal(list.total, 7);
  });

  it('POST /api/cases: reviewers and Admin are 403 role, with and without a projected field in the body (T10)', async () => {
    for (const user of ['fx-user-dpo', 'fx-user-admin']) {
      for (const body of [validCreateBody(), validCreateBody({ privacyStatus: 'approved' })]) {
        const response = await call(substitute, 'POST', '/api/cases', {
          cookie: users[user],
          headers: { 'idempotency-key': randomUUID() },
          json: body,
        });
        assert.equal(response.status, 403, user);
      }
    }
    assert.ok(denied().every((d) => d.action === 'case.create' && d.reason === 'role'));
    assert.equal(denied().length, 4);
    assert.equal(substitute.store.cases.size, 5); // nothing written
  });

  it('POST /api/cases: a SPOC naming another BU is 403 scope (T6); an owner naming another owner is 403 scope (T7)', async () => {
    const spoc = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-spoc-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: validCreateBody({ businessUnitId: 'HR', businessUnit: 'Human Resources' }),
    });
    assert.equal(spoc.status, 403);
    const owner = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: validCreateBody({ businessOwner: 'fixture:fx-user-owner-cm-2' }),
    });
    assert.equal(owner.status, 403);
    assert.deepEqual(
      denied().map((d) => [d.action, d.reason]),
      [
        ['case.create', 'scope'],
        ['case.create', 'scope'],
      ],
    );
    assert.equal(substitute.store.cases.size, 5);
    // T7 positive half: the SPOC creates in its BU on the owner's behalf; owner = owner-a, creator = the SPOC.
    const onBehalf = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-spoc-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: validCreateBody({ businessOwner: 'fixture:fx-user-owner-cm' }),
    });
    assert.equal(onBehalf.status, 201);
    assert.equal(onBehalf.json<CaseView>().businessOwner, 'fixture:fx-user-owner-cm');
    assert.equal(onBehalf.json<CaseView>().createdBy, 'fixture:fx-user-spoc-cm');
  });

  it('POST /api/cases: the 422 rows (missing key, projected field, group, source id prefix, BU, owner, shape)', async () => {
    const post = (body: unknown, key: string | null = randomUUID()): Promise<CallResult> =>
      call(substitute, 'POST', '/api/cases', {
        cookie: users['fx-user-owner-cm'],
        headers: key === null ? {} : { 'idempotency-key': key },
        json: body,
      });
    const noKey = await post(validCreateBody(), null);
    assert.equal(noKey.status, 422);
    assert.deepEqual(noKey.json<Envelope>().error.details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'validation.required' }],
    });
    const projected = await post(validCreateBody({ privacyStatus: 'approved', status: 'in_review' }));
    assert.equal(projected.status, 422); // T13: the policy allowed the action; step 4 rejects the body
    assert.deepEqual(projected.json<Envelope>().error.details, {
      fields: [
        { path: 'body.privacyStatus', messageKey: 'error.invalid_input.projected_field' },
        { path: 'body.status', messageKey: 'error.invalid_input.projected_field' },
      ],
    });
    const group = await post(validCreateBody({ useCaseGroup: 'not-configured' }));
    assert.deepEqual(group.json<Envelope>().error.details, {
      fields: [{ path: 'body.useCaseGroup', messageKey: 'validation.not_in_configured_list' }],
    });
    const source = await post(validCreateBody({ sourceRecordId: { kind: 'known', value: 'AIR-0001' } }));
    assert.deepEqual(source.json<Envelope>().error.details, {
      fields: [{ path: 'body.sourceRecordId.value', messageKey: 'validation.not_in_configured_list' }],
    });
    assert.equal(
      (await post(validCreateBody({ sourceRecordId: { kind: 'known', value: 'VRO-77' } }))).status,
      201,
    );
    const bu = await post(validCreateBody({ businessUnitId: 'ZZ' }));
    assert.deepEqual(bu.json<Envelope>().error.details, {
      fields: [{ path: 'body.businessUnitId', messageKey: 'validation.not_in_configured_list' }],
    });
    const ownerUnknown = await post(validCreateBody({ businessOwner: 'fixture:nobody' }));
    assert.deepEqual(ownerUnknown.json<Envelope>().error.details, {
      fields: [{ path: 'body.businessOwner', messageKey: 'validation.not_in_configured_list' }],
    });
    const empty = await post(validCreateBody({ useCaseName: '' }));
    assert.deepEqual(empty.json<Envelope>().error.details, {
      fields: [{ path: 'body.useCaseName', messageKey: 'validation.not_in_configured_list' }],
    });
    const missing = await post({ useCaseName: 'x' });
    assert.equal(missing.status, 422);
    assert.ok(
      (
        missing.json<Envelope>().error.details as { fields: Array<{ path: string; messageKey: string }> }
      ).fields.some((f) => f.path === 'body.businessUnitId' && f.messageKey === 'validation.required'),
    );
    assert.equal(denied().length, 0); // a 422 is not a denial
  });

  it('POST /api/cases: a replay with the same key and body returns the original 201; another body is 422', async () => {
    const key = randomUUID();
    const body = validCreateBody();
    const first = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': key },
      json: body,
    });
    const second = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': key },
      json: body,
    });
    assert.equal(second.status, 201);
    assert.equal(second.text(), first.text());
    assert.equal(substitute.store.cases.size, 6);
    const reused = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': key },
      json: validCreateBody({ useCaseName: 'other' }),
    });
    assert.equal(reused.status, 422);
    assert.deepEqual(reused.json<Envelope>().error.details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' }],
    });
    // Another actor with the same key is a different record.
    const spoc = await call(substitute, 'POST', '/api/cases', {
      cookie: users['fx-user-spoc-cm'],
      headers: { 'idempotency-key': key },
      json: body,
    });
    assert.equal(spoc.status, 201);
    assert.notEqual(spoc.json<CaseView>().caseId, first.json<CaseView>().caseId);
  });

  it('PATCH /api/cases/{caseId}: 200 with caseRevision + 1; a stale expectedCaseRevision is 409 revision_changed', async () => {
    const patch = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
      json: {
        expectedCaseRevision: 1,
        fields: { useCaseName: 'Churn Propensity Scoring v2', technicalOwner: 'Anucha M. (updated)' },
      },
    });
    assert.equal(patch.status, 200, patch.text());
    const view = patch.json<CaseView>();
    assert.equal(view.caseRevision, 2);
    assert.equal(view.useCaseName, 'Churn Propensity Scoring v2');
    assert.equal(view.updatedAt, clock.toISOString());
    assert.equal(view.draft?.updatedAt, clock.toISOString());
    const stale = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
      json: { expectedCaseRevision: 1, fields: { useCaseName: 'lost update' } },
    });
    assert.equal(stale.status, 409);
    const body = stale.json<Envelope>();
    assert.equal(body.error.code, 'stale_version');
    assert.equal(body.error.messageKey, 'error.stale_version');
    assert.deepEqual(body.error.details, {
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
    const after = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<CaseView>();
    assert.equal(after.useCaseName, 'Churn Propensity Scoring v2'); // nothing written by the stale request
    // The draft's revision is the same counter (W0-04 row_version).
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<PackDraft>().draftRevision,
      2,
    );
  });

  it('PATCH: reviewers and Admin are 403 role (T10); another owner is 403 scope on any body (T11); no field written', async () => {
    for (const [user, reason] of [
      ['fx-user-dpo', 'role'],
      ['fx-user-admin', 'role'],
      ['fx-user-owner-cm-2', 'scope'],
    ] as const) {
      for (const fields of [{ useCaseName: 'x' }, { useCaseName: 'x', privacyStatus: 'approved' }]) {
        const response = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
          cookie: users[user],
          json: { expectedCaseRevision: 1, fields },
        });
        assert.equal(response.status, 403, `${user}`);
        assert.equal(denied().at(-1)?.reason, reason);
      }
    }
    assert.equal(denied().length, 6);
    const view = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<CaseView>();
    assert.equal(view.caseRevision, 1);
    assert.equal(view.useCaseName, 'Churn Propensity Scoring');
  });

  it('PATCH: a projected field is 422 projected_field for an allowed actor (T13); any unknown key is 422', async () => {
    const projected = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-spoc-cm'],
      json: { expectedCaseRevision: 1, fields: { privacyStatus: 'approved', riskTier: 'high' } },
    });
    assert.equal(projected.status, 422);
    assert.deepEqual(projected.json<Envelope>().error.details, {
      fields: [
        { path: 'body.fields.privacyStatus', messageKey: 'error.invalid_input.projected_field' },
        { path: 'body.fields.riskTier', messageKey: 'error.invalid_input.projected_field' },
      ],
    });
    const unknown = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
      json: { expectedCaseRevision: 1, fields: { somethingElse: 1 } },
    });
    assert.equal(unknown.status, 422);
    assert.deepEqual(unknown.json<Envelope>().error.details, {
      fields: [{ path: 'body.fields.somethingElse', messageKey: 'validation.not_in_configured_list' }],
    });
    assert.equal(denied().length, 0);
  });

  it('PATCH with a scope field: owner cannot transfer the case, SPOC cannot move it out of its BU (T31); SPOC may name an owner in its BU', async () => {
    const transfer = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
      json: { expectedCaseRevision: 1, fields: { businessOwner: 'fixture:fx-user-owner-cm-2' } },
    });
    assert.equal(transfer.status, 403);
    const move = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-spoc-cm'],
      json: { expectedCaseRevision: 1, fields: { businessUnitId: 'HR' } },
    });
    assert.equal(move.status, 403);
    assert.deepEqual(
      denied().map((d) => [d.action, d.reason]),
      [
        ['case.edit_draft', 'scope'],
        ['case.edit_draft', 'scope'],
      ],
    );
    const view = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-owner-cm'] })
    ).json<CaseView>();
    assert.equal(view.businessOwner, 'fixture:fx-user-owner-cm');
    assert.equal(view.businessUnitId, 'CM');
    assert.equal(view.caseRevision, 1);
    const named = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-spoc-cm'],
      json: { expectedCaseRevision: 1, fields: { businessOwner: 'fixture:fx-user-owner-cm-2' } },
    });
    assert.equal(named.status, 200);
    assert.equal(named.json<CaseView>().businessOwner, 'fixture:fx-user-owner-cm-2');
    // The case moved out of owner-a's own_cases and into owner-b's.
    assert.equal(
      (await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-owner-cm'] }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
          cookie: users['fx-user-owner-cm-2'],
        })
      ).status,
      200,
    );
  });

  it('PATCH flipping vendorInvolved to true reverts default N/A slots 3 and 4 to missing; a typed reason is kept', async () => {
    const flipped = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-owner-cm'],
      json: { expectedCaseRevision: 1, fields: { vendorInvolved: true } },
    });
    assert.equal(flipped.status, 200);
    const draft = (
      await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}/draft`, {
        cookie: users['fx-user-owner-cm'],
      })
    ).json<PackDraft>();
    assert.deepEqual(draft.slots[3], { state: 'missing' });
    assert.deepEqual(draft.slots[4], { state: 'missing' });
    // fx-case-na-reasons: vendorInvolved already true; slot 4 carries a typed reason and must survive any edit.
    const na = findFixtureCase('fx-case-na-reasons')!;
    await call(substitute, 'PATCH', `/api/cases/${na.caseId}`, {
      cookie: users['fx-user-dpo-spoc-hr'],
      json: { expectedCaseRevision: 1, fields: { vendorInvolved: true } },
    });
    const naDraft = (
      await call(substitute, 'GET', `/api/cases/${na.caseId}/draft`, { cookie: users['fx-user-dpo-spoc-hr'] })
    ).json<PackDraft>();
    assert.equal(naDraft.slots[4].state, 'not_applicable');
  });

  it('the dual-role identity edits HR cases as SPOC (its bu_spoc grant) and views every case (its dpo grant)', async () => {
    const edit = await call(substitute, 'PATCH', `/api/cases/${hrDual.caseId}`, {
      cookie: users['fx-user-dpo-spoc-hr'],
      json: { expectedCaseRevision: 1, fields: { technicalOwner: 'Ekachai P. (SPOC edit)' } },
    });
    assert.equal(edit.status, 200);
    const cmEdit = await call(substitute, 'PATCH', `/api/cases/${nonvendor.caseId}`, {
      cookie: users['fx-user-dpo-spoc-hr'],
      json: { expectedCaseRevision: 1, fields: { technicalOwner: 'x' } },
    });
    assert.equal(cmEdit.status, 403); // dpo has no edit row; bu_spoc grant is HR only
    assert.equal(denied().at(-1)?.reason, 'scope');
    assert.equal(
      (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
          cookie: users['fx-user-dpo-spoc-hr'],
        })
      ).status,
      200,
    );
  });
});
