// W1-02 Done when, against the real Postgres and the real routes through app.inject(): a case with Unknown source
// saves; a known TPM-/VRO- value is stored and read back unchanged; the external register is never called; a user
// from another BU is forbidden on read, list and write; use_case_group rejects a value outside the configured list
// (D11); the four inherited status fields follow the W0-04-confirmed rule at all three layers (shape 422
// projected_field after the policy decision, repository Pick, database trigger) and a forbidden write is rejected.
// Also the W0-05 section 7 rows naming W1-02 (T2-T8, T9 view, T10, T11 edit, T13, T31, T33 view) and the W0-06
// section 10 "stale save draft" row for fields. Fixture data: set slice1-synthetic@1 (W1-09) loaded per test;
// identities from W0-03 section 7 (fx-user-owner-cm = owner-a, fx-user-owner-cm-2 = owner-b, fx-user-spoc-cm =
// spoc-b1, fx-user-dpo = reviewer-dpo, fx-user-admin, fx-user-dpo-spoc-hr = dual-role); B1 = CM, B2 = HR.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  CaseCreateRequest,
  CaseListResponse,
  CaseView,
  ConfigurationView,
} from '@rai/shared/schemas/cases';
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import { buildApp } from '@rai/server/app';
import { auditStore } from '@rai/server/audit/store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { PROJECTED_FIELDS, PROJECTED_FIELD_KEY } from '@rai/server/cases/projected-fields';
import { updateDraftFields } from '@rai/server/cases/repository';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { withTransaction } from '@rai/server/db/transaction';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { RAISE_EXCEPTION, expectSqlError, openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const SERVER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/src');
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  trustProxy: false,
  publicBaseUrl,
};

const OWNER_A = 'fx-user-owner-cm';
const OWNER_B = 'fx-user-owner-cm-2';
const SPOC_B1 = 'fx-user-spoc-cm';
const DPO = 'fx-user-dpo';
const ADMIN = 'fx-user-admin';
const DUAL = 'fx-user-dpo-spoc-hr';
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;
const CASE_CM = findFixtureCase('fx-case-nonvendor')!.caseId; // owner-a, B1
const CASE_HR = findFixtureCase('fx-case-hr-dualrole')!.caseId; // owner-a, B2
const CM_CASES = FIXTURE_CASES.filter((c) => c.businessUnitId === 'CM').map((c) => c.caseId);
const HR_CASES = FIXTURE_CASES.filter((c) => c.businessUnitId === 'HR').map((c) => c.caseId);

let db: TestDatabase;
let app: FastifyInstance;
let blobDir: string;
let outputDir: string;
const denied: Array<Record<string, unknown>> = [];
let clock = Date.parse('2026-09-22T03:00:00Z');
const now = () => new Date(clock);

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-02-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-02-out-'));
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  const built = buildApp({
    config,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
      now,
    },
    cases: {
      db: db.app,
      businessUnits: createBusinessUnitDirectory(
        businessUnitsFromGrants(FIXTURE_USERS.flatMap((u) => [...u.roles])),
      ),
      subjects: createSubjectDirectory(db.app, { known: FIXTURE_USERS }),
      now,
    },
  });
  app = built.fastify;
  const original = built.emitter.log.bind(built.emitter);
  built.emitter.log = (event: never, fields: never, level?: never) => {
    if ((event as string) === 'authz.denied') denied.push(fields);
    return original(event, fields, level);
  };
  await app.ready();
});
beforeEach(async () => {
  clock = Date.parse('2026-09-22T03:00:00Z');
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: now(),
  });
  denied.length = 0;
});
after(async () => {
  await app.close();
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const signIn = (id: string) => signInAsFixture(app, id);

function validCreate(overrides: Partial<CaseCreateRequest> = {}): CaseCreateRequest {
  return {
    useCaseName: 'ระบบแนะนำแพ็กเกจ (Package Recommender)',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    businessOwner: subjectOf(OWNER_A),
    technicalOwner: 'Anan T. (synthetic)',
    sourceRecordId: { kind: 'unknown' },
    useCaseGroup: 'customer-analytics',
    vendorInvolved: false,
    modelType: 'llm',
    ...overrides,
  };
}

/** `key: null` sends no Idempotency-Key header at all. */
function create(session: FixtureSession | undefined, body: unknown, key: string | null = randomUUID()) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session !== undefined) Object.assign(headers, asUser(session));
  if (key !== null) headers['idempotency-key'] = key;
  return app.inject({ method: 'POST', url: '/api/cases', headers, payload: body as object });
}
function getCase(session: FixtureSession | undefined, caseId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}`,
    headers: session === undefined ? {} : asUser(session),
  });
}
function patchCase(session: FixtureSession | undefined, caseId: string, body: unknown) {
  return app.inject({
    method: 'PATCH',
    url: `/api/cases/${caseId}`,
    headers: { 'content-type': 'application/json', ...(session === undefined ? {} : asUser(session)) },
    payload: body as object,
  });
}
function list(session: FixtureSession | undefined, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/cases${query}`,
    headers: session === undefined ? {} : asUser(session),
  });
}

async function caseRow(caseId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM "case" WHERE id = ${caseId}`);
  return r.rows[0];
}
async function caseCount(): Promise<number> {
  const r = await db.owner.execute(sql`SELECT count(*)::int AS n FROM "case"`);
  return (r.rows[0] as { n: number }).n;
}
async function audit(action: 'case.created' | 'draft.saved') {
  return (await auditStore.read(db.owner)).filter((e) => e.action === action);
}
function errorOf(res: { json<T>(): T }): ErrorResponse['error'] {
  return res.json<ErrorResponse>().error;
}
function invalidFields(res: { json<T>(): T }): ErrorDetails['invalid_input']['fields'] | undefined {
  return (errorOf(res).details as ErrorDetails['invalid_input'] | undefined)?.fields;
}
function staleOf(res: { json<T>(): T }): ErrorDetails['stale_version'] | undefined {
  return errorOf(res).details as ErrorDetails['stale_version'] | undefined;
}
function assertPlainForbidden(res: { statusCode: number; body: string; json<T>(): T }): void {
  assert.equal(res.statusCode, 403, res.body);
  const err = errorOf(res);
  assert.deepEqual(Object.keys(err).sort(), ['code', 'correlationId', 'messageKey']);
  assert.equal(err.code, 'forbidden');
  assert.equal(err.messageKey, 'error.forbidden');
  for (const c of FIXTURE_CASES) {
    assert.doesNotMatch(res.body, new RegExp(c.useCaseName.replaceAll(/[()]/g, '\\$&')));
    assert.doesNotMatch(res.body, new RegExp(c.registryId));
  }
}
function lastDenied(): Record<string, unknown> {
  assert.equal(denied.length, 1, `expected one authz.denied line, got ${JSON.stringify(denied)}`);
  return denied.pop()!;
}

// ---------------------------------------------------------------------------------------------------------------
// A02: Unknown, known values, no register call, desk-local fields, D11
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-02 create and read (A02) — ${SET}, fx-user-owner-cm`, () => {
  it('a case with Unknown source saves as the literal Unknown, answers 201 CaseView with status draft, a draft and caseRevision 1, and writes case.created', async () => {
    const owner = await signIn(OWNER_A);
    const res = await create(owner, validCreate());
    assert.equal(res.statusCode, 201, res.body);
    const view = res.json<CaseView>();
    assert.deepEqual(view.sourceRecordId, { kind: 'unknown' });
    assert.equal(view.status, 'draft');
    assert.equal(view.caseRevision, 1);
    assert.equal(view.currentVersion, null);
    assert.notEqual(view.draft, null);
    assert.equal(view.draft?.versionNumber, 1);
    assert.equal(view.riskTier, null);
    assert.equal(view.privacyStatus, 'pending');
    assert.equal(view.securityStatus, 'pending');
    assert.equal(view.raiStatus, 'pending');
    assert.equal(view.aiReadinessStatus, 'not_ready');
    assert.equal(view.businessOwner, subjectOf(OWNER_A));
    assert.equal(view.createdBy, subjectOf(OWNER_A));
    assert.match(view.registryId, /^RAI-2026-0001$/); // the per-year counter; fixtures live in year 2000
    const row = (await caseRow(view.caseId))!;
    assert.equal(row.source_record_id, 'Unknown');
    assert.equal(row.business_owner, findFixtureUser(OWNER_A)!.displayName); // server-written descriptive text
    assert.equal(row.owner_subject_id, subjectOf(OWNER_A));
    assert.equal(row.business_unit_id, 'CM');
    assert.equal(row.draft_version_id, view.draft?.draftId);
    const events = await audit('case.created');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.actorSubjectId, subjectOf(OWNER_A));
    assert.equal(events[0]!.actorRole, 'owner');
    assert.equal(events[0]!.targetCaseId, view.caseId);
    assert.equal(events[0]!.targetVersionId, view.draft?.draftId);
    assert.equal(events[0]!.correlationId, res.headers['x-correlation-id']);
    const read = await getCase(owner, view.caseId);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json<CaseView>(), view);
    const second = await create(owner, validCreate({ useCaseName: 'Second' }));
    assert.equal(second.json<CaseView>().registryId, 'RAI-2026-0002');
  });

  it('a known TPM-… or VRO-… value is stored and read back unchanged; a value without the prefix is 422 at sourceRecordId.value', async () => {
    const owner = await signIn(OWNER_A);
    for (const value of ['TPM-2026-0042', 'VRO-2569/ก-7']) {
      const res = await create(owner, validCreate({ sourceRecordId: { kind: 'known', value } }));
      assert.equal(res.statusCode, 201, res.body);
      const view = res.json<CaseView>();
      assert.deepEqual(view.sourceRecordId, { kind: 'known', value });
      assert.equal((await caseRow(view.caseId))!.source_record_id, value);
      assert.deepEqual((await getCase(owner, view.caseId)).json<CaseView>().sourceRecordId, {
        kind: 'known',
        value,
      });
    }
    const before = await caseCount();
    const bad = await create(owner, validCreate({ sourceRecordId: { kind: 'known', value: 'AIR-FX-9999' } }));
    assert.equal(bad.statusCode, 422, bad.body);
    assert.deepEqual(errorOf(bad).details, {
      fields: [{ path: 'body.sourceRecordId.value', messageKey: 'validation.source_record_id_prefix' }],
    });
    assert.equal(await caseCount(), before);
    assert.equal(denied.length, 0);
  });

  it('the external register is never called: no HTTP client exists in the cases module and a create/read completes with fetch disabled', async () => {
    const files = (await readdir(path.join(SERVER_SRC, 'cases'))).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    for (const file of files) {
      const text = await readFile(path.join(SERVER_SRC, 'cases', file), 'utf8');
      assert.doesNotMatch(
        text,
        /\bfetch\(|from 'node:http'|from 'node:https'|from 'undici'|new WebSocket|XMLHttpRequest/,
        file,
      );
    }
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('outbound call attempted');
    };
    try {
      const owner = await signIn(OWNER_A);
      const res = await create(owner, validCreate({ sourceRecordId: { kind: 'known', value: 'TPM-0001' } }));
      assert.equal(res.statusCode, 201, res.body);
      assert.equal((await getCase(owner, res.json<CaseView>().caseId)).statusCode, 200);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('vendorInvolved and modelType are stored as desk-local fields and round-trip through create and edit; slots 3 and 4 default to N/A only when no vendor is involved', async () => {
    const owner = await signIn(OWNER_A);
    const vendor = (
      await create(owner, validCreate({ vendorInvolved: true, modelType: 'classic_ml' }))
    ).json<CaseView>();
    assert.equal(vendor.vendorInvolved, true);
    assert.equal(vendor.modelType, 'classic_ml');
    const nonVendor = (
      await create(owner, validCreate({ vendorInvolved: false, modelType: 'other' }))
    ).json<CaseView>();
    const slots = async (draftId: string) =>
      (
        await db.owner.execute(
          sql`SELECT slot, state, reason FROM artifact_slot WHERE version_id = ${draftId} ORDER BY slot`,
        )
      ).rows as Array<{
        slot: number;
        state: string;
        reason: string | null;
      }>;
    const vendorSlots = await slots(vendor.draft!.draftId);
    assert.equal(vendorSlots.length, 9);
    assert.ok(vendorSlots.every((s) => s.state === 'missing' && s.reason === null));
    const nonVendorSlots = await slots(nonVendor.draft!.draftId);
    assert.deepEqual(
      nonVendorSlots.filter((s) => s.state === 'not_applicable').map((s) => [s.slot, s.reason]),
      [
        [3, NON_VENDOR_DEFAULT_REASON_KEY],
        [4, NON_VENDOR_DEFAULT_REASON_KEY],
      ],
    );
    const edited = await patchCase(owner, vendor.caseId, {
      expectedCaseRevision: 1,
      fields: { vendorInvolved: false, modelType: 'other' },
    });
    assert.equal(edited.statusCode, 200, edited.body);
    assert.equal(edited.json<CaseView>().vendorInvolved, false);
    assert.equal(edited.json<CaseView>().modelType, 'other');
    assert.equal(edited.json<CaseView>().caseRevision, 2);
    const bad = await create(owner, validCreate({ modelType: 'neural' as never }));
    assert.equal(bad.statusCode, 422);
  });

  it('D11: use_case_group must be in the configured list on create and on edit; the list is read from configuration', async () => {
    const owner = await signIn(OWNER_A);
    const cfg = await app.inject({
      method: 'GET',
      url: '/api/configuration/current',
      headers: asUser(owner),
    });
    assert.equal(cfg.statusCode, 200);
    const view = cfg.json<ConfigurationView>();
    assert.deepEqual(view.useCaseGroups, CONFIGURATION_SEED.use_case_groups.groups);
    assert.equal(view.timezone, 'Asia/Bangkok');
    for (const group of view.useCaseGroups) {
      const ok = await create(owner, validCreate({ useCaseGroup: group }));
      assert.equal(ok.statusCode, 201, ok.body);
      assert.equal(ok.json<CaseView>().useCaseGroup, group);
    }
    const before = await caseCount();
    const bad = await create(owner, validCreate({ useCaseGroup: 'marketing-experiments' }));
    assert.equal(bad.statusCode, 422, bad.body);
    assert.deepEqual(errorOf(bad).details, {
      fields: [{ path: 'body.useCaseGroup', messageKey: 'validation.not_in_configured_list' }],
    });
    assert.equal(await caseCount(), before);
    const edit = await patchCase(owner, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { useCaseGroup: 'marketing-experiments' },
    });
    assert.equal(edit.statusCode, 422, edit.body);
    assert.deepEqual(errorOf(edit).details, {
      fields: [{ path: 'body.fields.useCaseGroup', messageKey: 'validation.not_in_configured_list' }],
    });
    assert.equal((await caseRow(CASE_CM))!.row_version, 1);
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal(denied.length, 0);
    const empty = await create(owner, { ...validCreate(), useCaseGroup: '' });
    assert.equal(empty.statusCode, 422);
    const missing = await create(owner, (({ useCaseGroup: _g, ...rest }) => rest)(validCreate()));
    assert.equal(missing.statusCode, 422);
    assert.equal(invalidFields(missing)?.[0]?.path, 'body.useCaseGroup');
  });

  it('an unknown businessUnitId and an unresolvable businessOwner are 422 with field paths; an empty name is 422', async () => {
    const owner = await signIn(OWNER_A);
    const bu = await create(owner, validCreate({ businessUnitId: 'Consumer Mobile' })); // the descriptive text is not a key
    assert.equal(bu.statusCode, 422, bu.body);
    assert.deepEqual(invalidFields(bu), [
      { path: 'body.businessUnitId', messageKey: 'validation.not_in_configured_list' },
    ]);
    const spoc = await signIn(SPOC_B1);
    const who = await create(spoc, validCreate({ businessOwner: 'fixture:fx-user-nobody' }));
    assert.equal(who.statusCode, 422, who.body);
    assert.deepEqual(invalidFields(who), [
      { path: 'body.businessOwner', messageKey: 'validation.subject_unresolvable' },
    ]);
    const name = await create(owner, validCreate({ useCaseName: '' }));
    assert.equal(name.statusCode, 422);
    assert.equal(await caseCount(), FIXTURE_CASES.length);
  });

  it('7.3: a key outside CaseWritableFields on edit (a client typo) is 422 validation.unknown_field at body.fields.<key>, never stripped; nothing saved, caseRevision unchanged, zero draft.saved rows', async () => {
    const owner = await signIn(OWNER_A);
    const original = findFixtureCase('fx-case-nonvendor')!.useCaseName;
    for (const fields of [{ useCaseNmae: 'x' }, { useCaseName: 'renamed', useCaseNmae: 'x' }]) {
      const res = await patchCase(owner, CASE_CM, { expectedCaseRevision: 1, fields });
      assert.equal(res.statusCode, 422, res.body);
      assert.equal(errorOf(res).code, 'invalid_input');
      assert.deepEqual(invalidFields(res), [
        { path: 'body.fields.useCaseNmae', messageKey: 'validation.unknown_field' },
      ]);
      const row = (await caseRow(CASE_CM))!;
      assert.equal(row.row_version, 1);
      assert.equal(row.use_case_name, original);
    }
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal(denied.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// W0-04 fields rule: the four inherited status fields (T13, repository Pick, database trigger)
// ---------------------------------------------------------------------------------------------------------------

describe('W1-02 projected status fields (W0-04 fields rule, W0-05 section 5) — fx-user-owner-cm, fx-user-spoc-cm', () => {
  it('T13: an allowed actor sending a projected field on create or edit is 422 projected_field; nothing written, no authz.denied', async () => {
    for (const id of [OWNER_A, SPOC_B1]) {
      const session = await signIn(id);
      for (const field of PROJECTED_FIELDS) {
        const before = await caseCount();
        const created = await create(session, { ...validCreate(), [field]: 'approved' });
        assert.equal(created.statusCode, 422, `${id} create ${field}: ${created.body}`);
        assert.deepEqual(errorOf(created).details, {
          fields: [{ path: `body.${field}`, messageKey: PROJECTED_FIELD_KEY }],
        });
        assert.equal(await caseCount(), before);
        const edited = await patchCase(session, CASE_CM, {
          expectedCaseRevision: 1,
          fields: { useCaseName: 'x', [field]: 'approved' },
        });
        assert.equal(edited.statusCode, 422, `${id} edit ${field}: ${edited.body}`);
        assert.deepEqual(errorOf(edited).details, {
          fields: [{ path: `body.fields.${field}`, messageKey: PROJECTED_FIELD_KEY }],
        });
      }
    }
    const row = (await caseRow(CASE_CM))!;
    assert.equal(row.row_version, 1);
    assert.equal(row.privacy_status, 'pending');
    assert.equal(row.use_case_name, findFixtureCase('fx-case-nonvendor')!.useCaseName);
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal((await audit('case.created')).length, 0);
    assert.equal(denied.length, 0);
  });

  it('database layer: a raw UPDATE of any projection as rai_app outside rai.workflow_write raises rai.projection_write_forbidden; the setting admits it', async () => {
    for (const column of ['privacy_status', 'security_status', 'rai_status', 'ai_readiness_status']) {
      const value = column === 'ai_readiness_status' ? 'ready' : 'approved';
      const err = await expectSqlError(db, 'app', `UPDATE "case" SET ${column} = $1 WHERE id = $2`, [
        value,
        CASE_CM,
      ]);
      assert.ok(err !== undefined, `${column} was written`);
      assert.equal(err.code, RAISE_EXCEPTION);
      assert.match(err.message, /rai\.projection_write_forbidden/);
    }
    const tier = await expectSqlError(db, 'app', `UPDATE "case" SET risk_tier = 'high' WHERE id = $1`, [
      CASE_CM,
    ]);
    assert.equal(tier?.code, RAISE_EXCEPTION);
    const row = (await caseRow(CASE_CM))!;
    assert.deepEqual(
      [row.privacy_status, row.security_status, row.rai_status, row.ai_readiness_status, row.risk_tier],
      ['pending', 'pending', 'pending', 'not_ready', null],
    );
    // The gate is the transaction setting only the workflow helper executes (W2); proven here and rolled back.
    await db.raw('app', async (client) => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL rai.workflow_write = 'on'`);
      const r = await client.query<{ privacy_status: string }>(
        `UPDATE "case" SET privacy_status = 'approved' WHERE id = $1 RETURNING privacy_status`,
        [CASE_CM],
      );
      assert.equal(r.rows[0]?.privacy_status, 'approved');
      await client.query('ROLLBACK');
    });
    assert.equal((await caseRow(CASE_CM))!.privacy_status, 'pending');
  });

  it('repository layer: updateDraftFields takes a Pick of the editable columns; a projection smuggled past the type hits the trigger and nothing changes', async () => {
    await assert.rejects(
      withTransaction(db.app, (tx) =>
        updateDraftFields(tx, CASE_CM, { privacyStatus: 'approved' } as never, 1, now()),
      ),
      (err: unknown) => /rai\.projection_write_forbidden/.test(String((err as Error).cause ?? err)),
    );
    const row = (await caseRow(CASE_CM))!;
    assert.equal(row.privacy_status, 'pending');
    assert.equal(row.row_version, 1);
  });

  it('the projections are read back on every view and list row but are never accepted from a body even with a valid value (edit with only a projection)', async () => {
    const owner = await signIn(OWNER_A);
    const res = await patchCase(owner, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { aiReadinessStatus: 'not_ready' },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(invalidFields(res)?.[0]?.messageKey, PROJECTED_FIELD_KEY);
    const view = (await getCase(owner, CASE_CM)).json<CaseView>();
    assert.equal(view.aiReadinessStatus, 'not_ready');
    assert.equal(view.caseRevision, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A01: scope on read, list and write (T2-T8, T9, T10, T11, T31, T33)
// ---------------------------------------------------------------------------------------------------------------

describe('W1-02 scope on read (A01: T2, T3, T5, T9, T33) — fx-case-nonvendor (CM), fx-case-hr-dualrole (HR)', () => {
  it('T2 / T4 / T9: owner-a, spoc-b1, the reviewers, Admin and the dual-role identity read an in-scope case with 200', async () => {
    for (const [id, caseId] of [
      [OWNER_A, CASE_CM],
      [SPOC_B1, CASE_CM],
      [DPO, CASE_CM],
      [DPO, CASE_HR],
      [ADMIN, CASE_HR],
      [DUAL, CASE_HR],
      [DUAL, CASE_CM], // via its dpo all_cases grant
      ['fx-user-ai-coe', CASE_CM],
      ['fx-user-it-security', CASE_HR],
    ] as const) {
      const res = await getCase(await signIn(id), caseId);
      assert.equal(res.statusCode, 200, `${id} on ${caseId}: ${res.body}`);
      assert.equal(res.json<CaseView>().caseId, caseId);
    }
    assert.equal(denied.length, 0);
  });

  it('T3 / T5: another owner and a SPOC of another BU are 403 scope on read with the plain envelope and one authz.denied line each', async () => {
    const ownerB = await signIn(OWNER_B);
    const res = await getCase(ownerB, CASE_CM);
    assertPlainForbidden(res);
    let line = lastDenied();
    assert.equal(line.reason, 'scope');
    assert.equal(line.action, 'case.view');
    assert.equal(line.targetId, CASE_CM);
    assert.equal(line.actorSubjectId, subjectOf(OWNER_B));
    const spoc = await signIn(SPOC_B1);
    assertPlainForbidden(await getCase(spoc, CASE_HR));
    line = lastDenied();
    assert.equal(line.reason, 'scope');
    assert.equal(line.actorRole, 'bu_spoc');
    assert.equal((await audit('draft.saved')).length + (await audit('case.created')).length, 0);
  });

  it('T33 (case.view): a random UUID is 403 scope for owner-b and spoc-b1, byte-for-byte the T3 body shape; 404 not_found resource case for reviewer-dpo and Admin with no authz.denied', async () => {
    const missing = randomUUID();
    for (const id of [OWNER_B, SPOC_B1]) {
      const res = await getCase(await signIn(id), missing);
      assertPlainForbidden(res);
      const existing = await getCase(await signIn(id), id === OWNER_B ? CASE_CM : CASE_HR);
      const strip = (body: string) => body.replace(/"correlationId":"[^"]+"/, '');
      assert.equal(strip(res.body), strip(existing.body));
      assert.equal(denied.length, 2);
      assert.equal(denied[0]!.targetId, missing);
      denied.length = 0;
    }
    for (const id of [DPO, ADMIN]) {
      const res = await getCase(await signIn(id), missing);
      assert.equal(res.statusCode, 404, res.body);
      assert.equal(errorOf(res).code, 'not_found');
      assert.deepEqual(errorOf(res).details, { resource: 'case' });
      assert.equal(denied.length, 0);
    }
    const patched = await patchCase(await signIn(OWNER_A), missing, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'x' },
    });
    assertPlainForbidden(patched);
  });

  it('401 unauthenticated on every route without a session; nothing else runs', async () => {
    for (const res of [
      await create(undefined, validCreate()),
      await getCase(undefined, CASE_CM),
      await patchCase(undefined, CASE_CM, { expectedCaseRevision: 1, fields: {} }),
      await list(undefined),
      await app.inject({ method: 'GET', url: '/api/configuration/current' }),
    ]) {
      assert.equal(res.statusCode, 401, res.body);
      assert.equal(errorOf(res).code, 'unauthenticated');
      assert.equal(errorOf(res).details, undefined);
      assert.equal(res.headers['cache-control'], 'no-store');
    }
    assert.equal(denied.length, 0);
    assert.equal(await caseCount(), FIXTURE_CASES.length);
  });
});

describe('W1-02 scope on list (A01: T8) — the five fixture cases: CM ×2, HR ×3, all owned by fx-user-owner-cm', () => {
  it("T8: owner-b sees none of owner-a's cases; spoc-b1 sees B1 only; owner-a sees its five; reviewers and Admin see all; total counts in-scope rows only", async () => {
    const ownerB = await signIn(OWNER_B);
    let res = await list(ownerB);
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json<CaseListResponse>(), { items: [], page: 1, pageSize: 25, total: 0 });
    const own = (
      await create(ownerB, validCreate({ businessOwner: subjectOf(OWNER_B), useCaseName: 'Owner B case' }))
    ).json<CaseView>();
    res = await list(ownerB);
    assert.deepEqual(
      res.json<CaseListResponse>().items.map((i) => i.caseId),
      [own.caseId],
    );
    assert.equal(res.json<CaseListResponse>().total, 1);
    assert.equal(res.json<CaseListResponse>().items[0]!.currentVersionNumber, null);
    assert.equal(res.json<CaseListResponse>().items[0]!.status, 'draft');

    const spoc = (await list(await signIn(SPOC_B1))).json<CaseListResponse>();
    assert.deepEqual(spoc.items.map((i) => i.caseId).sort(), [...CM_CASES, own.caseId].sort());
    assert.equal(spoc.total, CM_CASES.length + 1);
    assert.ok(spoc.items.every((i) => i.businessUnitId === 'CM'));
    assert.ok(!spoc.items.some((i) => HR_CASES.includes(i.caseId)));

    const ownerA = (await list(await signIn(OWNER_A))).json<CaseListResponse>();
    assert.deepEqual(ownerA.items.map((i) => i.caseId).sort(), FIXTURE_CASES.map((c) => c.caseId).sort());
    assert.equal(ownerA.total, FIXTURE_CASES.length);

    const dual = (await list(await signIn(DUAL))).json<CaseListResponse>();
    assert.equal(dual.total, FIXTURE_CASES.length + 1); // dpo all_cases grant: everything
    for (const id of [DPO, ADMIN]) {
      const all = (await list(await signIn(id))).json<CaseListResponse>();
      assert.equal(all.total, FIXTURE_CASES.length + 1);
    }
    assert.equal(denied.length, 0);
  });

  it('pagination never leaks: pageSize bounds the page, total stays the scoped count, a bad page is 422', async () => {
    const owner = await signIn(OWNER_A);
    const p1 = (await list(owner, '?page=1&pageSize=2')).json<CaseListResponse>();
    const p2 = (await list(owner, '?page=2&pageSize=2')).json<CaseListResponse>();
    const p3 = (await list(owner, '?page=3&pageSize=2')).json<CaseListResponse>();
    assert.equal(p1.items.length, 2);
    assert.equal(p2.items.length, 2);
    assert.equal(p3.items.length, 1);
    assert.deepEqual([p1.total, p2.total, p3.total, p1.pageSize], [5, 5, 5, 2]);
    const ids = new Set([...p1.items, ...p2.items, ...p3.items].map((i) => i.caseId));
    assert.equal(ids.size, 5);
    const spoc = await signIn(SPOC_B1);
    const far = (await list(spoc, '?page=9&pageSize=100')).json<CaseListResponse>();
    assert.deepEqual(far.items, []);
    assert.equal(far.total, CM_CASES.length);
    for (const q of ['?page=0', '?pageSize=101', '?page=abc', '?pageSize=0']) {
      const bad = await list(owner, q);
      assert.equal(bad.statusCode, 422, `${q}: ${bad.body}`);
      assert.equal(errorOf(bad).code, 'invalid_input');
    }
  });

  it('the list is ordered by updatedAt descending, so an edited case moves to the top', async () => {
    const owner = await signIn(OWNER_A);
    clock += 60_000;
    const edited = await patchCase(owner, CASE_HR, {
      expectedCaseRevision: 1,
      fields: { technicalOwner: 'Somchai P. (synthetic)' },
    });
    assert.equal(edited.statusCode, 200, edited.body);
    const items = (await list(owner)).json<CaseListResponse>().items;
    assert.equal(items[0]!.caseId, CASE_HR);
    assert.equal(items[0]!.updatedAt, now().toISOString());
  });
});

describe('W1-02 scope on write (A01: T4, T6, T7, T10, T11, T31) — fx-user-owner-cm, fx-user-owner-cm-2, fx-user-spoc-cm, fx-user-dpo, fx-user-admin, fx-user-dpo-spoc-hr', () => {
  it('T6: spoc-b1 creating a case in B2 is 403 scope; no case row, one authz.denied, zero audit rows', async () => {
    const spoc = await signIn(SPOC_B1);
    const res = await create(spoc, validCreate({ businessUnitId: 'HR', businessUnit: 'Human Resources' }));
    assertPlainForbidden(res);
    const line = lastDenied();
    assert.deepEqual(
      [line.action, line.reason, line.targetType, line.actorRole],
      ['case.create', 'scope', 'case', 'bu_spoc'],
    );
    assert.equal(await caseCount(), FIXTURE_CASES.length);
    assert.equal((await audit('case.created')).length, 0);
  });

  it('T7: owner-a naming owner-b as businessOwner is 403 scope with no row; spoc-b1 naming owner-a in B1 is 201 with owner_subject_id = owner-a and audit actor = spoc-b1', async () => {
    const ownerA = await signIn(OWNER_A);
    const denied1 = await create(ownerA, validCreate({ businessOwner: subjectOf(OWNER_B) }));
    assertPlainForbidden(denied1);
    assert.equal(lastDenied().reason, 'scope');
    assert.equal(await caseCount(), FIXTURE_CASES.length);

    const spoc = await signIn(SPOC_B1);
    const res = await create(spoc, validCreate({ businessOwner: subjectOf(OWNER_A) }));
    assert.equal(res.statusCode, 201, res.body);
    const view = res.json<CaseView>();
    assert.equal(view.businessOwner, subjectOf(OWNER_A));
    assert.equal(view.createdBy, subjectOf(SPOC_B1));
    const row = (await caseRow(view.caseId))!;
    assert.equal(row.owner_subject_id, subjectOf(OWNER_A));
    assert.equal(row.business_owner, findFixtureUser(OWNER_A)!.displayName);
    const [event] = await audit('case.created');
    assert.equal(event!.actorSubjectId, subjectOf(SPOC_B1));
    assert.equal(event!.actorRole, 'bu_spoc');
    // the named owner now reads and edits it; owner-b still cannot
    assert.equal((await getCase(ownerA, view.caseId)).statusCode, 200);
    assertPlainForbidden(await getCase(await signIn(OWNER_B), view.caseId));
    denied.length = 0;
    // a SPOC create without naming an owner is not possible under the 7.3 shape (businessOwner is required) → 422
    const noOwner = await create(spoc, (({ businessOwner: _o, ...rest }) => rest)(validCreate()));
    assert.equal(noOwner.statusCode, 422);
  });

  it("T4: spoc-b1 edits owner-a's B1 draft: 200, caseRevision + 1, draft.saved actor = spoc-b1, owner unchanged; the dual-role identity edits an HR case through its SPOC grant", async () => {
    const spoc = await signIn(SPOC_B1);
    const res = await patchCase(spoc, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'Churn Propensity Scoring v2' },
    });
    assert.equal(res.statusCode, 200, res.body);
    const view = res.json<CaseView>();
    assert.equal(view.caseRevision, 2);
    assert.equal(view.useCaseName, 'Churn Propensity Scoring v2');
    assert.equal(view.businessOwner, subjectOf(OWNER_A));
    const [event] = await audit('draft.saved');
    assert.equal(event!.actorSubjectId, subjectOf(SPOC_B1));
    assert.equal(event!.actorRole, 'bu_spoc');
    assert.equal(event!.targetVersionId, view.draft!.draftId);
    assert.deepEqual(event!.targetRef, { changed_fields: ['useCaseName'] });
    assert.deepEqual(event!.beforeRef, { row_version: 1 });
    assert.deepEqual(event!.afterRef, { row_version: 2 });
    const dual = await signIn(DUAL);
    const hr = await patchCase(dual, CASE_HR, {
      expectedCaseRevision: 1,
      fields: { technicalOwner: 'Kanya S. (synthetic)' },
    });
    assert.equal(hr.statusCode, 200, hr.body);
    const hrEvent = (await audit('draft.saved'))[1]!;
    assert.equal(hrEvent.actorRole, 'bu_spoc'); // the row that allowed, not the dpo grant
    const created = await create(
      dual,
      validCreate({ businessUnitId: 'HR', businessUnit: 'Human Resources' }),
    );
    assert.equal(created.statusCode, 201, created.body);
    assertPlainForbidden(
      await patchCase(dual, CASE_CM, { expectedCaseRevision: 2, fields: { useCaseName: 'x' } }),
    ); // dpo never writes; SPOC of HR only
    assert.equal(lastDenied().reason, 'scope');
  });

  it('T10: reviewer-dpo and Admin are 403 role on create and edit, with and without a projected field in the body; nothing written', async () => {
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      for (const body of [validCreate(), { ...validCreate(), privacyStatus: 'approved' }, '{not json']) {
        const res = await create(session, body);
        assertPlainForbidden(res);
        assert.deepEqual([lastDenied().reason, denied.length], ['role', 0]);
      }
      for (const fields of [{ useCaseName: 'x' }, { useCaseName: 'x', privacyStatus: 'approved' }]) {
        const res = await patchCase(session, CASE_CM, { expectedCaseRevision: 1, fields });
        assertPlainForbidden(res);
        const line = lastDenied();
        assert.deepEqual([line.action, line.reason, line.targetId], ['case.edit_draft', 'role', CASE_CM]);
      }
    }
    assert.equal(await caseCount(), FIXTURE_CASES.length);
    assert.equal((await caseRow(CASE_CM))!.row_version, 1);
    assert.equal((await audit('case.created')).length + (await audit('draft.saved')).length, 0);
  });

  it("T11 (edit): owner-b on owner-a's draft is 403 scope with and without a projected field; no field written, caseRevision unchanged, zero audit rows", async () => {
    const ownerB = await signIn(OWNER_B);
    for (const fields of [
      { useCaseName: 'taken over' },
      { useCaseName: 'taken over', privacyStatus: 'approved' },
    ]) {
      const res = await patchCase(ownerB, CASE_CM, { expectedCaseRevision: 1, fields });
      assertPlainForbidden(res);
      const line = lastDenied();
      assert.deepEqual(
        [line.action, line.reason, line.actorSubjectId],
        ['case.edit_draft', 'scope', subjectOf(OWNER_B)],
      );
    }
    const row = (await caseRow(CASE_CM))!;
    assert.equal(row.row_version, 1);
    assert.equal(row.use_case_name, findFixtureCase('fx-case-nonvendor')!.useCaseName);
    assert.equal((await audit('draft.saved')).length, 0);
  });

  it("T31: a scope-field edit that would move the case out of the actor's scope is 403 scope and changes nothing; spoc-b1 may hand a B1 case to owner-b, recorded old → new", async () => {
    const ownerA = await signIn(OWNER_A);
    assertPlainForbidden(
      await patchCase(ownerA, CASE_CM, {
        expectedCaseRevision: 1,
        fields: { businessOwner: subjectOf(OWNER_B) },
      }),
    );
    let line = lastDenied();
    assert.deepEqual([line.action, line.reason, line.targetId], ['case.edit_draft', 'scope', CASE_CM]);
    const spoc = await signIn(SPOC_B1);
    assertPlainForbidden(
      await patchCase(spoc, CASE_CM, { expectedCaseRevision: 1, fields: { businessUnitId: 'HR' } }),
    );
    line = lastDenied();
    assert.equal(line.reason, 'scope');
    let row = (await caseRow(CASE_CM))!;
    assert.deepEqual(
      [row.owner_subject_id, row.business_unit_id, row.row_version],
      [subjectOf(OWNER_A), 'CM', 1],
    );
    assert.equal((await audit('draft.saved')).length, 0);
    // an owner may change the descriptive businessUnit text freely: own_cases covers the case whatever its BU
    const text = await patchCase(ownerA, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { businessUnit: 'Consumer Mobile (TH)' },
    });
    assert.equal(text.statusCode, 200, text.body);
    // positive counterpart
    const handed = await patchCase(spoc, CASE_CM, {
      expectedCaseRevision: 2,
      fields: { businessOwner: subjectOf(OWNER_B) },
    });
    assert.equal(handed.statusCode, 200, handed.body);
    assert.equal(handed.json<CaseView>().businessOwner, subjectOf(OWNER_B));
    row = (await caseRow(CASE_CM))!;
    assert.equal(row.owner_subject_id, subjectOf(OWNER_B));
    assert.equal(row.business_owner, findFixtureUser(OWNER_B)!.displayName);
    const events = await audit('draft.saved');
    const event = events[events.length - 1]!;
    assert.equal(event.actorSubjectId, subjectOf(SPOC_B1));
    assert.deepEqual(event.beforeRef, {
      row_version: 2,
      owner_subject_id: subjectOf(OWNER_A),
      business_unit_id: 'CM',
    });
    assert.deepEqual(event.afterRef, {
      row_version: 3,
      owner_subject_id: subjectOf(OWNER_B),
      business_unit_id: 'CM',
    });
    assert.deepEqual(event.targetRef, { changed_fields: ['ownerSubjectId', 'businessOwner'] });
    // owner-b now reads it and owner-a no longer can
    assert.equal((await getCase(await signIn(OWNER_B), CASE_CM)).statusCode, 200);
    assertPlainForbidden(await getCase(ownerA, CASE_CM));
    assert.equal(denied.length, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// W0-06: stale save (fields) and idempotent create
// ---------------------------------------------------------------------------------------------------------------

describe('W1-02 stale save and idempotent create (W0-06 4.2, 5.2, 5.3) — fx-case-nonvendor, fx-user-owner-cm', () => {
  it('an edit with an old expectedCaseRevision is 409 revision_changed with current, guidanceKey and refreshPath; nothing changes; the revision increments by exactly one per save', async () => {
    const owner = await signIn(OWNER_A);
    const first = await patchCase(owner, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'first save' },
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json<CaseView>().caseRevision, 2);
    const stale = await patchCase(owner, CASE_CM, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'second save' },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    const err = errorOf(stale);
    assert.equal(err.code, 'stale_version');
    assert.equal(err.messageKey, 'error.stale_version');
    assert.deepEqual(err.details, {
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: {
        versionId: first.json<CaseView>().draft!.draftId,
        versionNumber: 1,
        revision: 2,
        state: 'draft',
        ready: false,
      },
      refreshPath: `/cases/${CASE_CM}`,
    });
    const row = (await caseRow(CASE_CM))!;
    assert.equal(row.use_case_name, 'first save');
    assert.equal(row.row_version, 2);
    assert.equal((await audit('draft.saved')).length, 1);
    const future = await patchCase(owner, CASE_CM, { expectedCaseRevision: 3, fields: { useCaseName: 'x' } });
    assert.equal(future.statusCode, 409);
    const zero = await patchCase(owner, CASE_CM, { expectedCaseRevision: 0, fields: { useCaseName: 'x' } });
    assert.equal(zero.statusCode, 422); // minimum 1 (schema)
  });

  it('an edit on a case whose draft was submitted meanwhile is 409 version_superseded pointing at the submitted version; a Ready case answers version_closed', async () => {
    const owner = await signIn(OWNER_A);
    const fx = findFixtureCase('fx-case-nonvendor')!;
    // W1-05 owns submit; here the rows a submit leaves behind are written directly as rai_owner to reach the branch.
    const revision = (
      await db.owner.execute(
        sql`SELECT id FROM configuration_revision WHERE kind = 'checklist_templates' LIMIT 1`,
      )
    ).rows[0] as { id: string };
    await db.owner
      .execute(sql`UPDATE pack_version SET submitted_by = ${subjectOf(OWNER_A)}, submitted_role = 'owner',
      submitted_at = ${now()}, configuration_revision_id = ${revision.id}, frozen_configuration = '{}'::jsonb,
      lane_mapping_version = 'lane-mapping/v1', lane_mapping = '{}'::jsonb, manifest_hash = ${'0'.repeat(64)}
      WHERE id = ${fx.draftVersionId}`);
    await db.owner.execute(
      sql`UPDATE "case" SET current_version_id = ${fx.draftVersionId}, draft_version_id = NULL, desk_status = 'in_review' WHERE id = ${fx.caseId}`,
    );
    const view = (await getCase(owner, fx.caseId)).json<CaseView>();
    assert.equal(view.status, 'in_review');
    assert.equal(view.draft, null);
    assert.equal(view.currentVersion?.versionId, fx.draftVersionId);
    assert.equal(
      (await list(owner)).json<CaseListResponse>().items.find((i) => i.caseId === fx.caseId)
        ?.currentVersionNumber,
      1,
    );
    const res = await patchCase(owner, fx.caseId, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'late edit' },
    });
    assert.equal(res.statusCode, 409, res.body);
    const err = staleOf(res);
    assert.equal(err?.reason, 'version_superseded');
    assert.equal(err?.guidanceKey, 'error.stale_version.guidance.version_superseded');
    assert.deepEqual(err?.current, {
      versionId: fx.draftVersionId,
      versionNumber: 1,
      revision: 1,
      state: 'submitted',
      ready: false,
    });
    assert.equal((await caseRow(fx.caseId))!.use_case_name, fx.useCaseName);
    await db.owner.execute(sql`UPDATE pack_version SET ready_at = ${now()} WHERE id = ${fx.draftVersionId}`);
    const closed = await patchCase(owner, fx.caseId, {
      expectedCaseRevision: 1,
      fields: { useCaseName: 'after ready' },
    });
    assert.equal(closed.statusCode, 409, closed.body);
    assert.equal(staleOf(closed)?.reason, 'version_closed');
    assert.equal(staleOf(closed)?.guidanceKey, 'error.stale_version.guidance.ready');
    assert.equal((await getCase(owner, fx.caseId)).json<CaseView>().status, 'ready_for_launch');
    assert.equal((await audit('draft.saved')).length, 0);
  });

  it("create replays the same Idempotency-Key + same body with the original 201 body and one row; a different body under the key is 422; a missing key is 422; another actor's key is its own", async () => {
    const owner = await signIn(OWNER_A);
    const key = randomUUID();
    const body = validCreate({ useCaseName: 'Replayed' });
    const first = await create(owner, body, key);
    assert.equal(first.statusCode, 201, first.body);
    clock += 5_000;
    const replay = await create(owner, body, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.deepEqual(replay.json(), first.json());
    assert.equal(await caseCount(), FIXTURE_CASES.length + 1);
    assert.equal((await audit('case.created')).length, 1);
    const reused = await create(owner, validCreate({ useCaseName: 'Different' }), key);
    assert.equal(reused.statusCode, 422, reused.body);
    assert.deepEqual(errorOf(reused).details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'error.invalid_input.idempotency_key_reused' }],
    });
    const missing = await create(owner, body, null);
    assert.equal(missing.statusCode, 422, missing.body);
    assert.deepEqual(errorOf(missing).details, {
      fields: [{ path: 'header.idempotency-key', messageKey: 'validation.required' }],
    });
    const other = await create(
      await signIn(OWNER_B),
      validCreate({ businessOwner: subjectOf(OWNER_B) }),
      key,
    );
    assert.equal(other.statusCode, 201, other.body);
    assert.equal(await caseCount(), FIXTURE_CASES.length + 2);
    // a failed create stores no key: the same key retried with a valid body succeeds
    const failKey = randomUUID();
    assert.equal((await create(owner, validCreate({ useCaseGroup: 'nope' }), failKey)).statusCode, 422);
    assert.equal((await create(owner, validCreate(), failKey)).statusCode, 201);
  });

  it('a malformed JSON body from an allowed actor never writes anything and answers an error envelope', async () => {
    const owner = await signIn(OWNER_A);
    const res = await create(owner, '{not json');
    assert.ok(res.statusCode >= 400, res.body);
    assert.equal(await caseCount(), FIXTURE_CASES.length);
    const view = (await getCase(owner, CASE_CM)).json<CaseView>();
    assert.equal(view.caseRevision, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The subject directory behind the server-written business_owner text
// ---------------------------------------------------------------------------------------------------------------

describe('W1-02 subject directory (W0-04 case.business_owner from owner_subject_id) — fx-user-owner-cm-2', () => {
  it('resolves a known identity, the acting principal, and any subject that has signed in (session table); an unknown subject is undefined', async () => {
    const bare = createSubjectDirectory(db.app); // no start-up table: only the actor and the session rows
    assert.equal(await bare.resolve(subjectOf(OWNER_B)), undefined);
    const ownerB = await signIn(OWNER_B); // writes a session row with the principal snapshot
    assert.deepEqual(await bare.resolve(subjectOf(OWNER_B)), {
      subjectId: subjectOf(OWNER_B),
      displayName: findFixtureUser(OWNER_B)!.displayName,
    });
    assert.deepEqual(await bare.resolve('fixture:never-signed-in', ownerB.session.principal), undefined);
    assert.deepEqual(
      await bare.resolve(subjectOf(OWNER_A), { subjectId: subjectOf(OWNER_A), displayName: 'Actor' }),
      {
        subjectId: subjectOf(OWNER_A),
        displayName: 'Actor',
      },
    );
    const known = createSubjectDirectory(db.app, { known: FIXTURE_USERS });
    assert.equal((await known.resolve(subjectOf(DPO)))?.displayName, findFixtureUser(DPO)!.displayName);
  });
});
