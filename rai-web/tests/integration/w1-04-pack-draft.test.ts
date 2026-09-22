// W1-04 Done when, against the real Postgres and the real routes through app.inject(): all four slot states save;
// a missing reason on N/A is rejected; slots 3 and 4 default to N/A only when vendor_involved is false (create with
// both values, and the two fixture cases); checklist_template_version is recorded on the draft. Also every W0-02
// 7.5 error row (401, 403, 404, 409 revision_changed / version_superseded / version_closed with the W0-06 8.2
// details, 422 reason_required / artifact_case_mismatch / template not configured / unknown slot / projected
// field, 422 unsafe_upload pack_total_exceeded), the W0-05 rows for case.edit_draft on the PUT (T10 reviewer and
// Admin → 403 role; T11 out-of-scope owner and BU SPOC → 403 scope; T33 shape on an unresolvable id), the W0-04
// case-binding clause, the W0-06 4.2 audit event, stage_context storage (D11) that nothing else reads, the 7.5
// vendor flip rule through PATCH, the projections a draft save never touches, and the W0-07 upload hook point
// (fires after commit, once per changed artifact reference, never on a failed save). Fixture set slice1-synthetic@1
// (W1-09) loaded per test; identities from W0-03 section 7 (fx-user-owner-cm = owner-a, fx-user-owner-cm-2 =
// owner-b, fx-user-spoc-cm = spoc-b1, fx-user-dpo = reviewer-dpo, fx-user-admin); B1 = CM, B2 = HR.

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { assertNoLeak } from '../support/log-capture.js';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseCreateRequest, CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import {
  NON_VENDOR_DEFAULT_REASON_KEY,
  type PackDraft,
  type PackDraftUpdateRequest,
  type SlotState,
} from '@rai/shared/schemas/pack';
import { buildApp } from '../support/observed-app.js';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { auditStore } from '@rai/server/audit/store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { businessUnitsFromGrants, createBusinessUnitDirectory } from '@rai/server/cases/business-units';
import { createSubjectDirectory } from '@rai/server/cases/subject-directory';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import type { UploadTriggerEvent } from '@rai/server/pack/qc-trigger';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';
import { fixtureBaseDocuments, pdfOfExactSize, upload } from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
const KIB = 1024;
const MIB = 1024 * KIB;
/** The pack limit the pack routes are built with here: small enough to cross with two synthetic PDFs. */
const PACK_LIMIT_BYTES = 256 * KIB;
const LIMITS = {
  maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
  maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
  maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
};

const OWNER_A = 'fx-user-owner-cm';
const OWNER_B = 'fx-user-owner-cm-2';
const SPOC_B1 = 'fx-user-spoc-cm';
const DPO = 'fx-user-dpo';
const ADMIN = 'fx-user-admin';
const subjectOf = (id: string) => findFixtureUser(id)!.subjectId;
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // owner-a, B1, vendorInvolved false
const VENDOR = findFixtureCase('fx-case-vendor')!; // owner-a, B2, vendorInvolved true
const NA_REASONS = findFixtureCase('fx-case-na-reasons')!; // owner-a, B2, explicit text reasons
const MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!; // owner-a, B1
const PROJECTIONS = [
  'privacy_status',
  'security_status',
  'rai_status',
  'ai_readiness_status',
  'risk_tier',
] as const;

let db: TestDatabase;
let app: FastifyInstance;
let store: FilesystemBlobStore;
let blobDir: string;
let outputDir: string;
const denied: Array<Record<string, unknown>> = [];
const captured: Array<Record<string, unknown>> = [];
afterEach(() => {
  assertNoLeak({ text: () => JSON.stringify(captured) });
});
const fired: UploadTriggerEvent[] = [];
let triggerBehaviour: 'record' | 'throw' = 'record';
let clock = Date.parse('2026-09-22T03:00:00Z');
const now = () => new Date(clock);

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-04-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-04-out-'));
  store = createFilesystemBlobStore(blobDir);
  await store.init();
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
    now,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl, trustProxy: false });
  let pending = '';
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      pending += chunk.toString('utf8');
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        const raw = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (raw.trim() !== '') {
          try {
            captured.push(JSON.parse(raw) as Record<string, unknown>);
          } catch {
            /* not JSON */
          }
        }
        nl = pending.indexOf('\n');
      }
      cb();
    },
  });
  const built = buildApp({
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream,
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
    artifacts: { store, db: db.app, limits: LIMITS },
    pack: {
      db: db.app,
      limits: { maxPackBytes: PACK_LIMIT_BYTES },
      uploadTrigger: (event) => {
        if (triggerBehaviour === 'throw') throw new Error('substitute exploded');
        fired.push(event);
      },
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
  await rm(path.join(blobDir, 'sha256'), { recursive: true, force: true });
  await store.init();
  await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now: now(),
  });
  denied.length = 0;
  captured.length = 0;
  fired.length = 0;
  triggerBehaviour = 'record';
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

function getDraft(session: FixtureSession | undefined, caseId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/draft`,
    headers: session === undefined ? {} : asUser(session),
  });
}
function putDraft(session: FixtureSession | undefined, caseId: string, body: unknown) {
  return app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...(session === undefined ? {} : asUser(session)) },
    payload: body as object,
  });
}
function getCase(session: FixtureSession, caseId: string) {
  return app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: asUser(session) });
}
function patchCase(session: FixtureSession, caseId: string, body: unknown) {
  return app.inject({
    method: 'PATCH',
    url: `/api/cases/${caseId}`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: body as object,
  });
}
async function createCase(session: FixtureSession, overrides: Partial<CaseCreateRequest> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/cases',
    headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...asUser(session) },
    payload: {
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
    } satisfies CaseCreateRequest,
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json<CaseView>();
}
/** A current draft read plus the `expectedVersion` a client would send back. */
async function current(session: FixtureSession, caseId: string) {
  const res = await getDraft(session, caseId);
  assert.equal(res.statusCode, 200, res.body);
  const draft = res.json<PackDraft>();
  return { draft, expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision } };
}
async function uploadPdf(session: FixtureSession, caseId: string, name: string, bytes?: Buffer) {
  const res = await upload(
    app,
    session,
    caseId,
    name,
    bytes ?? fixtureBaseDocuments().pdf,
    'application/pdf',
  );
  assert.equal(res.statusCode, 201, res.body);
  return res.json<ArtifactRef>();
}
async function slotRows(versionId: string) {
  const r = await db.owner.execute(
    sql`SELECT slot, state, reason, artifact_id, updated_by FROM artifact_slot WHERE version_id = ${versionId} ORDER BY slot`,
  );
  return r.rows as Array<{
    slot: number;
    state: string;
    reason: string | null;
    artifact_id: string | null;
    updated_by: string;
  }>;
}
async function caseRow(caseId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM "case" WHERE id = ${caseId}`);
  return r.rows[0] as Record<string, unknown>;
}
async function versionRow(versionId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM pack_version WHERE id = ${versionId}`);
  return r.rows[0] as Record<string, unknown>;
}
async function audit(action: 'draft.saved' | 'case.created') {
  return (await auditStore.read(db.owner)).filter((e) => e.action === action);
}
function errorOf(res: { json<T>(): T }): ErrorResponse['error'] {
  return res.json<ErrorResponse>().error;
}
function invalidFields(res: { json<T>(): T }) {
  return (errorOf(res).details as ErrorDetails['invalid_input'] | undefined)?.fields ?? [];
}
function staleOf(res: { json<T>(): T }) {
  return errorOf(res).details as ErrorDetails['stale_version'] | undefined;
}
function assertPlainForbidden(res: { statusCode: number; body: string; json<T>(): T }): void {
  assert.equal(res.statusCode, 403, res.body);
  const err = errorOf(res);
  assert.deepEqual(Object.keys(err).sort(), ['code', 'correlationId', 'messageKey']);
  assert.equal(err.code, 'forbidden');
  for (const c of FIXTURE_CASES) {
    assert.doesNotMatch(res.body, new RegExp(c.registryId));
    assert.doesNotMatch(res.body, new RegExp(c.useCaseName.replaceAll(/[()]/g, '\\$&')));
  }
}
function lastDenied(): Record<string, unknown> {
  assert.equal(denied.length, 1, `expected one authz.denied line, got ${JSON.stringify(denied)}`);
  return denied.pop()!;
}
function assert422(res: { statusCode: number; body: string; json<T>(): T }, path: string, key: string) {
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(errorOf(res).code, 'invalid_input');
  const field = invalidFields(res).find((f) => f.path === path);
  assert.ok(field !== undefined, `no field error at ${path} in ${res.body}`);
  assert.equal(field.messageKey, key);
}
const naText = (text: string): SlotState => ({ state: 'not_applicable', reason: { kind: 'text', text } });
const NA_DEFAULT: SlotState = { state: 'not_applicable', reason: { kind: 'default_non_vendor' } };
/** Writes the rows a submit leaves behind, as rai_owner (W1-05 owns submit; the branch needs the state). */
async function simulateSubmitted(fx: { caseId: string; draftVersionId: string }) {
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
}

// ---------------------------------------------------------------------------------------------------------------
// A02: the nine slots, the four states, the defaults, the recorded template and stage context
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-04 read the draft (A02) — ${SET}`, () => {
  it('GET returns the 7.5 PackDraft: nine slots, the fixture dispositions, the default reason on the non-vendor case, the explicit text reason distinct from it', async () => {
    const owner = await signIn(OWNER_A);
    const res = await getDraft(owner, NONVENDOR.caseId);
    assert.equal(res.statusCode, 200, res.body);
    const draft = res.json<PackDraft>();
    assert.equal(draft.draftId, NONVENDOR.draftVersionId);
    assert.equal(draft.caseId, NONVENDOR.caseId);
    assert.equal(draft.versionNumber, 1);
    assert.equal(draft.parentVersionId, null);
    assert.equal(draft.checklistTemplateVersion, NONVENDOR.checklistTemplateVersion);
    assert.equal(draft.stageContext, NONVENDOR.stageContext);
    assert.deepEqual(Object.keys(draft.slots).map(Number).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(draft.slots[3], NA_DEFAULT);
    assert.deepEqual(draft.slots[4], NA_DEFAULT);
    for (const slot of [1, 2, 5, 6, 7, 8, 9] as const) assert.equal(draft.slots[slot].state, 'attached');
    const view = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
    assert.equal(draft.draftRevision, view.caseRevision); // one counter per case
    assert.equal(draft.updatedAt, view.updatedAt);
    // The default is the D12 locale key in the column, so it stays visible and translatable.
    assert.equal(
      (await slotRows(draft.draftId)).find((r) => r.slot === 3)?.reason,
      NON_VENDOR_DEFAULT_REASON_KEY,
    );
    // fx-case-na-reasons slot 4 carries a user reason: distinct from the default (W0-08 8.3).
    const na = (await getDraft(owner, NA_REASONS.caseId)).json<PackDraft>();
    const fixtureSlot4 = NA_REASONS.slots[4];
    assert.equal(fixtureSlot4.state, 'not_applicable');
    assert.deepEqual(na.slots[4], fixtureSlot4);
    assert.notDeepEqual(na.slots[4], NA_DEFAULT);
    // The missing-slot case reads back `missing` and `not_yet` as distinct facts.
    const missing = (await getDraft(owner, MISSING_SLOT.caseId)).json<PackDraft>();
    assert.deepEqual(missing.slots[7], { state: 'missing' });
    assert.deepEqual(missing.slots[8], { state: 'not_yet' });
  });

  it('slots 3 and 4 are never N/A by default on the vendor fixture case', async () => {
    const owner = await signIn(OWNER_A);
    const draft = (await getDraft(owner, VENDOR.caseId)).json<PackDraft>();
    assert.equal(draft.slots[3].state, 'attached');
    assert.equal(draft.slots[4].state, 'attached');
    assert.equal(draft.checklistTemplateVersion, 'v2.0');
  });

  it('create with vendorInvolved false defaults slots 3 and 4 to N/A default_non_vendor; with true every slot is missing; the first configured template and stage idea are recorded', async () => {
    const owner = await signIn(OWNER_A);
    const configuration = (
      await app.inject({ method: 'GET', url: '/api/configuration/current', headers: asUser(owner) })
    ).json<ConfigurationView>();
    const nonVendor = await createCase(owner, { vendorInvolved: false });
    const a = (await getDraft(owner, nonVendor.caseId)).json<PackDraft>();
    for (const slot of [1, 2, 5, 6, 7, 8, 9] as const) assert.deepEqual(a.slots[slot], { state: 'missing' });
    assert.deepEqual(a.slots[3], NA_DEFAULT);
    assert.deepEqual(a.slots[4], NA_DEFAULT);
    assert.equal(a.checklistTemplateVersion, configuration.checklistTemplateVersions[0]);
    assert.equal(a.stageContext, 'idea');
    assert.equal(a.draftRevision, 1);
    assert.equal(
      (await versionRow(a.draftId)).checklist_template_version,
      configuration.checklistTemplateVersions[0],
    );
    const vendor = await createCase(owner, { vendorInvolved: true });
    const b = (await getDraft(owner, vendor.caseId)).json<PackDraft>();
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const)
      assert.deepEqual(b.slots[slot], { state: 'missing' });
  });
});

describe(`W1-04 save the draft (A02) — ${SET}, fx-user-owner-cm`, () => {
  it('all four slot states save in one PUT and read back; draftRevision + 1; the rows, the draft.saved event and the hook carry the references', async () => {
    const owner = await signIn(OWNER_A);
    const view = await createCase(owner, { vendorInvolved: true });
    const ref = await uploadPdf(owner, view.caseId, 'brd.pdf');
    const { expectedVersion } = await current(owner, view.caseId);
    const body: PackDraftUpdateRequest = {
      expectedVersion,
      slots: {
        1: { state: 'attached', artifactId: ref.artifactId },
        2: { state: 'not_yet' },
        3: naText('ไม่มีผู้ให้บริการภายนอกในโครงการนี้ (synthetic)'),
        5: { state: 'missing' },
      },
    };
    const res = await putDraft(owner, view.caseId, body);
    assert.equal(res.statusCode, 200, res.body);
    const draft = res.json<PackDraft>();
    assert.equal(draft.draftRevision, expectedVersion.revision + 1);
    assert.deepEqual(draft.slots[1], { state: 'attached', artifactId: ref.artifactId });
    assert.deepEqual(draft.slots[2], { state: 'not_yet' });
    assert.deepEqual(draft.slots[3], body.slots![3]);
    assert.deepEqual(draft.slots[5], { state: 'missing' });
    assert.deepEqual(draft.slots[4], { state: 'missing' }); // untouched
    assert.equal(draft.updatedAt, now().toISOString());
    // Read back and stored rows.
    const again = (await getDraft(owner, view.caseId)).json<PackDraft>();
    assert.deepEqual(again, draft);
    const rows = await slotRows(draft.draftId);
    assert.deepEqual(
      rows
        .filter((r) => [1, 2, 3, 5].includes(r.slot))
        .map((r) => [r.state, r.reason, r.artifact_id, r.updated_by]),
      [
        ['attached', null, ref.artifactId, subjectOf(OWNER_A)],
        ['not_yet', null, null, subjectOf(OWNER_A)],
        ['not_applicable', 'ไม่มีผู้ให้บริการภายนอกในโครงการนี้ (synthetic)', null, subjectOf(OWNER_A)],
        ['missing', null, null, subjectOf(OWNER_A)],
      ],
    );
    assert.equal((await caseRow(view.caseId)).row_version, draft.draftRevision);
    assert.equal((await getCase(owner, view.caseId)).json<CaseView>().caseRevision, draft.draftRevision);
    // W0-06 4.2 / 9.4 audit: actor, version, revision before/after, slot numbers with the new dispositions and the
    // blob hash reference for the attach; never the reason text.
    const events = await audit('draft.saved');
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(event.actorSubjectId, subjectOf(OWNER_A));
    assert.equal(event.actorRole, 'owner');
    assert.equal(event.targetCaseId, view.caseId);
    assert.equal(event.targetVersionId, draft.draftId);
    assert.equal(event.correlationId, res.headers['x-correlation-id']);
    assert.deepEqual(event.targetRef, {
      changed_fields: ['slots'],
      slots: [
        { slot: 1, state: 'attached', artifact_id: ref.artifactId, content_hash: ref.sha256 },
        { slot: 2, state: 'not_yet' },
        { slot: 3, state: 'not_applicable' },
        { slot: 5, state: 'missing' },
      ],
    });
    assert.deepEqual(event.beforeRef, { row_version: expectedVersion.revision });
    assert.deepEqual(event.afterRef, { row_version: draft.draftRevision });
    assert.doesNotMatch(JSON.stringify(event), /synthetic\)/);
    // W0-07 3.2: the upload hook fired once, after commit, for the one slot whose reference changed.
    assert.deepEqual(fired, [
      {
        caseId: view.caseId,
        draftId: draft.draftId,
        versionNumber: 1,
        slot: 1,
        artifactId: ref.artifactId,
        checklistTemplateVersion: draft.checklistTemplateVersion,
        correlationId: res.headers['x-correlation-id'],
      },
    ]);
  });

  it('a missing, empty or blank reason on N/A is 422 validation.reason_required at body.slots[n].reason; nothing is written, no audit event', async () => {
    const owner = await signIn(OWNER_A);
    const { draft, expectedVersion } = await current(owner, NONVENDOR.caseId);
    const bodies: unknown[] = [
      { expectedVersion, slots: { 5: { state: 'not_applicable' } } },
      { expectedVersion, slots: { 5: { state: 'not_applicable', reason: null } } },
      { expectedVersion, slots: { 5: { state: 'not_applicable', reason: { kind: 'text' } } } },
      { expectedVersion, slots: { 5: { state: 'not_applicable', reason: { kind: 'text', text: '' } } } },
      { expectedVersion, slots: { 5: { state: 'not_applicable', reason: { kind: 'text', text: ' \t ' } } } },
      { expectedVersion, slots: { 5: { state: 'not_applicable', reason: 'a string, not the shape' } } },
    ];
    for (const body of bodies) {
      const res = await putDraft(owner, NONVENDOR.caseId, body);
      assert422(res, 'body.slots[5].reason', 'validation.reason_required');
    }
    // A reason of 501 characters is over the shape's maximum, also 422; one of 500 saves.
    const tooLong = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 5: naText('ก'.repeat(501)) },
    });
    assert.equal(tooLong.statusCode, 422, tooLong.body);
    assert.deepEqual(await slotRows(draft.draftId), await slotRows(draft.draftId));
    assert.equal((await current(owner, NONVENDOR.caseId)).draft.draftRevision, expectedVersion.revision);
    assert.equal((await current(owner, NONVENDOR.caseId)).draft.slots[5].state, 'attached');
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal(denied.length, 0); // a 422 is not a denial
    const ok = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 5: naText('ก'.repeat(500)) },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(fired.length, 0);
  });

  it('default_non_vendor is accepted only on slot 3 or 4 of a non-vendor case: sent back unchanged there; 422 on another slot; 422 on the vendor case', async () => {
    const owner = await signIn(OWNER_A);
    const nonVendor = await current(owner, NONVENDOR.caseId);
    const same = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: nonVendor.expectedVersion,
      slots: { 3: NA_DEFAULT, 4: NA_DEFAULT },
    });
    assert.equal(same.statusCode, 200, same.body);
    assert.deepEqual(same.json<PackDraft>().slots[3], NA_DEFAULT);
    const other = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { ...nonVendor.expectedVersion, revision: nonVendor.expectedVersion.revision + 1 },
      slots: { 5: NA_DEFAULT },
    });
    assert422(other, 'body.slots[5].reason', 'validation.reason_required');
    const vendor = await current(owner, VENDOR.caseId);
    const onVendor = await putDraft(owner, VENDOR.caseId, {
      expectedVersion: vendor.expectedVersion,
      slots: { 3: NA_DEFAULT },
    });
    assert422(onVendor, 'body.slots[3].reason', 'validation.reason_required');
    assert.equal((await current(owner, VENDOR.caseId)).draft.slots[3].state, 'attached');
    // A typed reason on slot 3 of the vendor case is the way to say N/A there.
    const typed = await putDraft(owner, VENDOR.caseId, {
      expectedVersion: vendor.expectedVersion,
      slots: { 3: naText('DPA covered by the master agreement (synthetic)') },
    });
    assert.equal(typed.statusCode, 200, typed.body);
  });

  it('checklist_template_version is recorded on the draft from the configuration list; a value outside the list is 422 not_in_configured_list', async () => {
    const owner = await signIn(OWNER_A);
    const configuration = (
      await app.inject({ method: 'GET', url: '/api/configuration/current', headers: asUser(owner) })
    ).json<ConfigurationView>();
    assert.ok(configuration.checklistTemplateVersions.includes('v2.0'));
    const { expectedVersion } = await current(owner, NONVENDOR.caseId);
    const res = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      checklistTemplateVersion: 'v2.0',
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<PackDraft>().checklistTemplateVersion, 'v2.0');
    assert.equal((await versionRow(NONVENDOR.draftVersionId)).checklist_template_version, 'v2.0');
    assert.deepEqual((await audit('draft.saved'))[0]!.targetRef, {
      changed_fields: ['checklist_template_version'],
      slots: [],
    });
    const bad = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { ...expectedVersion, revision: expectedVersion.revision + 1 },
      checklistTemplateVersion: 'v9.9',
    });
    assert422(bad, 'body.checklistTemplateVersion', 'validation.not_in_configured_list');
    assert.equal((await versionRow(NONVENDOR.draftVersionId)).checklist_template_version, 'v2.0');
    const empty = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { ...expectedVersion, revision: expectedVersion.revision + 1 },
      checklistTemplateVersion: '',
    });
    assert.equal(empty.statusCode, 422, empty.body);
  });

  it('stage_context (D11) stores idea / pre_build / pre_launch on the draft and nothing else reads it: status and projections are unchanged; another value is 422', async () => {
    const owner = await signIn(OWNER_A);
    const before = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
    for (const stageContext of ['idea', 'pre_build', 'pre_launch'] as const) {
      const { expectedVersion } = await current(owner, NONVENDOR.caseId);
      const res = await putDraft(owner, NONVENDOR.caseId, { expectedVersion, stageContext });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json<PackDraft>().stageContext, stageContext);
      assert.equal((await versionRow(NONVENDOR.draftVersionId)).stage_context, stageContext);
      const view = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
      assert.equal(view.status, before.status);
      assert.equal(view.privacyStatus, before.privacyStatus);
      assert.equal(view.securityStatus, before.securityStatus);
      assert.equal(view.raiStatus, before.raiStatus);
      assert.equal(view.aiReadinessStatus, before.aiReadinessStatus);
      assert.equal(view.riskTier, null);
      assert.equal((await caseRow(NONVENDOR.caseId)).desk_status, 'draft');
    }
    const events = await audit('draft.saved');
    assert.equal(events.length, 3);
    assert.deepEqual(events[0]!.targetRef, { changed_fields: ['stage_context'], slots: [] });
    let { expectedVersion } = await current(owner, NONVENDOR.caseId);
    const same = await putDraft(owner, NONVENDOR.caseId, { expectedVersion, stageContext: 'pre_launch' });
    assert.equal(same.statusCode, 200, same.body); // an unchanged value still saves (revision + 1) and lists no field
    assert.deepEqual((await audit('draft.saved')).at(-1)!.targetRef, { changed_fields: [], slots: [] });
    ({ expectedVersion } = await current(owner, NONVENDOR.caseId));
    for (const bad of ['launched', 'pre-build', '', 1]) {
      const res = await putDraft(owner, NONVENDOR.caseId, { expectedVersion, stageContext: bad });
      assert.equal(res.statusCode, 422, res.body);
      assert.equal(errorOf(res).code, 'invalid_input');
    }
    assert.equal((await versionRow(NONVENDOR.draftVersionId)).stage_context, 'pre_launch');
  });

  it('an unknown slot number, a slot value outside the four states, a missing expectedVersion and an unknown top-level key are 422', async () => {
    const owner = await signIn(OWNER_A);
    const { expectedVersion } = await current(owner, NONVENDOR.caseId);
    for (const slots of [
      { 0: { state: 'missing' } },
      { 10: { state: 'missing' } },
      { x: { state: 'missing' } },
    ]) {
      const res = await putDraft(owner, NONVENDOR.caseId, { expectedVersion, slots });
      assert.equal(res.statusCode, 422, res.body);
      assert.equal(errorOf(res).code, 'invalid_input');
      assert.match(invalidFields(res)[0]!.path, /^body\.slots/);
    }
    const state = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 1: { state: 'pending' } },
    });
    assert.equal(state.statusCode, 422, state.body);
    const noVersion = await putDraft(owner, NONVENDOR.caseId, { slots: { 1: { state: 'missing' } } });
    assert422(noVersion, 'body.expectedVersion', 'validation.required');
    const notJson = await app.inject({
      method: 'PUT',
      url: `/api/cases/${NONVENDOR.caseId}/draft`,
      headers: { 'content-type': 'application/json', ...asUser(owner) },
      payload: '{not json',
    });
    assert.equal(notJson.statusCode, 422, notJson.body);
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal((await current(owner, NONVENDOR.caseId)).draft.draftRevision, expectedVersion.revision);
  });

  it('W0-04 case binding: attaching an artifact uploaded under another case, or an unknown id, is 422 error.artifact_case_mismatch; the slot row is unchanged and no draft.saved is written; the same artifact attaches to another slot of its own case', async () => {
    const owner = await signIn(OWNER_A);
    const otherCase = await createCase(owner, { vendorInvolved: true }); // owner-a owns both cases
    const foreign = await uploadPdf(owner, otherCase.caseId, 'other-case.pdf');
    const { draft, expectedVersion } = await current(owner, NONVENDOR.caseId);
    const before = await slotRows(draft.draftId);
    for (const artifactId of [foreign.artifactId, randomUUID(), 'not-a-uuid']) {
      const res = await putDraft(owner, NONVENDOR.caseId, {
        expectedVersion,
        slots: { 7: { state: 'attached', artifactId } },
      });
      assert422(res, 'body.slots[7].artifactId', 'error.artifact_case_mismatch');
      assert.doesNotMatch(res.body, /other-case\.pdf/); // nothing about the other case's upload leaks
    }
    assert.deepEqual(await slotRows(draft.draftId), before);
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal(fired.length, 0);
    // The same artifact attaches to another slot of its own case.
    const vendor = await current(owner, otherCase.caseId);
    const ok = await putDraft(owner, otherCase.caseId, {
      expectedVersion: vendor.expectedVersion,
      slots: { 7: { state: 'attached', artifactId: foreign.artifactId } },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual(ok.json<PackDraft>().slots[7], { state: 'attached', artifactId: foreign.artifactId });
    // Several errors in one body are collected into one 422.
    const both = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      checklistTemplateVersion: 'v9.9',
      slots: {
        7: { state: 'attached', artifactId: foreign.artifactId },
        8: { state: 'not_applicable', reason: { kind: 'text', text: 'x' } },
        5: NA_DEFAULT,
      },
    });
    assert.equal(both.statusCode, 422, both.body);
    assert.deepEqual(
      invalidFields(both)
        .map((f) => f.path)
        .sort(),
      ['body.checklistTemplateVersion', 'body.slots[5].reason', 'body.slots[7].artifactId'],
    );
  });

  it('W0-08 check 10 at attach: an attach that would take the draft over the pack limit is 422 unsafe_upload pack_total_exceeded with max_pack_mb; replacing a slot nets out; detaching frees the budget', async () => {
    const owner = await signIn(OWNER_A);
    const view = await createCase(owner, { vendorInvolved: true });
    const big = await uploadPdf(owner, view.caseId, 'a.pdf', pdfOfExactSize(160 * KIB, 'a'));
    const small = await uploadPdf(owner, view.caseId, 'b.pdf', pdfOfExactSize(100 * KIB, 'b'));
    let { expectedVersion } = await current(owner, view.caseId);
    const first = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 1: { state: 'attached', artifactId: big.artifactId } },
    });
    assert.equal(first.statusCode, 200, first.body);
    ({ expectedVersion } = await current(owner, view.caseId));
    const over = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 2: { state: 'attached', artifactId: small.artifactId } },
    });
    assert.equal(over.statusCode, 422, over.body);
    assert.equal(errorOf(over).code, 'unsafe_upload');
    assert.deepEqual(errorOf(over).details, {
      reasonKey: 'error.unsafe_upload.pack_total_exceeded',
      params: { max_pack_mb: PACK_LIMIT_BYTES / MIB },
    });
    assert.equal((await current(owner, view.caseId)).draft.slots[2].state, 'missing');
    assert.equal((await audit('draft.saved')).length, 1);
    assert.equal(fired.length, 1);
    // Replacing slot 1 with the smaller file nets the old bytes out (160 → 100 KiB).
    const replace = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 1: { state: 'attached', artifactId: small.artifactId } },
    });
    assert.equal(replace.statusCode, 200, replace.body);
    ({ expectedVersion } = await current(owner, view.caseId));
    // 100 + 160 > 256: over again; after detaching slot 1 in the same body the total is 160.
    const overAgain = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 2: { state: 'attached', artifactId: big.artifactId } },
    });
    assert.equal(overAgain.statusCode, 422, overAgain.body);
    const netted = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 1: { state: 'not_yet' }, 2: { state: 'attached', artifactId: big.artifactId } },
    });
    assert.equal(netted.statusCode, 200, netted.body);
    assert.equal(fired.length, 3); // slot 1 big, slot 1 small, slot 2 big
  });

  it('the 7.5 flip rule through PATCH: vendorInvolved false → true reverts a slot 3/4 that still carries the default to missing and keeps a typed reason; the event lists the reverted slot', async () => {
    const owner = await signIn(OWNER_A);
    const view = await createCase(owner, { vendorInvolved: false });
    let { expectedVersion } = await current(owner, view.caseId);
    const typed = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 3: naText('no personal data reaches the vendor (synthetic)') },
    });
    assert.equal(typed.statusCode, 200, typed.body);
    ({ expectedVersion } = await current(owner, view.caseId));
    const flipped = await patchCase(owner, view.caseId, {
      expectedCaseRevision: expectedVersion.revision,
      fields: { vendorInvolved: true },
    });
    assert.equal(flipped.statusCode, 200, flipped.body);
    const draft = (await getDraft(owner, view.caseId)).json<PackDraft>();
    assert.deepEqual(draft.slots[3], naText('no personal data reaches the vendor (synthetic)'));
    assert.deepEqual(draft.slots[4], { state: 'missing' });
    assert.equal(draft.draftRevision, expectedVersion.revision + 1);
    const events = await audit('draft.saved');
    assert.deepEqual(events.at(-1)!.targetRef, {
      changed_fields: ['vendorInvolved'],
      slots: [{ slot: 4, state: 'missing' }],
    });
    // Flipping back to false applies no default to a slot the owner may have set since (7.5: defaults at creation).
    const back = await patchCase(owner, view.caseId, {
      expectedCaseRevision: draft.draftRevision,
      fields: { vendorInvolved: false },
    });
    assert.equal(back.statusCode, 200, back.body);
    assert.deepEqual((await getDraft(owner, view.caseId)).json<PackDraft>().slots[4], { state: 'missing' });
    // A flip that changes nothing else about the vendor field touches no slot.
    const again = await patchCase(owner, view.caseId, {
      expectedCaseRevision: draft.draftRevision + 1,
      fields: { vendorInvolved: false, useCaseName: 'renamed' },
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.deepEqual((await audit('draft.saved')).at(-1)!.targetRef, { changed_fields: ['useCaseName'] });
  });

  it("the upload hook fires only when a slot's artifact reference changes: not on a re-save of the same artifact, not on a detach, not on a failed save; a throwing hook never reaches the response", async () => {
    const owner = await signIn(OWNER_A);
    const view = await createCase(owner, { vendorInvolved: true });
    const ref = await uploadPdf(owner, view.caseId, 'x.pdf');
    let { expectedVersion } = await current(owner, view.caseId);
    assert.equal(
      (
        await putDraft(owner, view.caseId, {
          expectedVersion,
          slots: { 6: { state: 'attached', artifactId: ref.artifactId } },
        })
      ).statusCode,
      200,
    );
    assert.equal(fired.length, 1);
    ({ expectedVersion } = await current(owner, view.caseId));
    assert.equal(
      (
        await putDraft(owner, view.caseId, {
          expectedVersion,
          slots: { 6: { state: 'attached', artifactId: ref.artifactId } },
          stageContext: 'pre_build',
        })
      ).statusCode,
      200,
    );
    assert.equal(fired.length, 1); // same reference: no second run (W0-07 3.2)
    ({ expectedVersion } = await current(owner, view.caseId));
    assert.equal(
      (await putDraft(owner, view.caseId, { expectedVersion, slots: { 6: { state: 'not_yet' } } }))
        .statusCode,
      200,
    );
    assert.equal(fired.length, 1);
    ({ expectedVersion } = await current(owner, view.caseId));
    const stale = await putDraft(owner, view.caseId, {
      expectedVersion: { ...expectedVersion, revision: 99 },
      slots: { 6: { state: 'attached', artifactId: ref.artifactId } },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(fired.length, 1);
    triggerBehaviour = 'throw';
    const res = await putDraft(owner, view.caseId, {
      expectedVersion,
      slots: { 6: { state: 'attached', artifactId: ref.artifactId } },
    });
    assert.equal(res.statusCode, 200, res.body);
    await new Promise((r) => setImmediate(r));
    const lines = captured.filter(
      (l) => l.event === 'error.captured' && l.correlationId === res.headers['x-correlation-id'],
    );
    assert.equal(lines.length, 1);
    const line = lines[0];
    assert.ok(line !== undefined, 'a failing hook is reported as error.captured');
    assert.equal((line.fields as Record<string, unknown>).category, 'internal_error');
    assert.deepEqual((await getDraft(owner, view.caseId)).json<PackDraft>().slots[6], {
      state: 'attached',
      artifactId: ref.artifactId,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// W0-06 5.1 / 5.2 stale draft; 4.2 order; projections
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-04 expected version (A07) — ${SET}`, () => {
  it('a stale revision is 409 stale_version revision_changed with the W0-06 8.2 details and nothing written; a second identical save fails closed the same way', async () => {
    const owner = await signIn(OWNER_A);
    const { draft, expectedVersion } = await current(owner, NONVENDOR.caseId);
    const body = { expectedVersion, slots: { 5: { state: 'not_yet' } } };
    const first = await putDraft(owner, NONVENDOR.caseId, body);
    assert.equal(first.statusCode, 200, first.body);
    const replay = await putDraft(owner, NONVENDOR.caseId, body);
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(errorOf(replay).code, 'stale_version');
    assert.equal(errorOf(replay).messageKey, 'error.stale_version');
    assert.deepEqual(staleOf(replay), {
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: {
        versionId: draft.draftId,
        versionNumber: 1,
        revision: expectedVersion.revision + 1,
        state: 'draft',
        ready: false,
      },
      refreshPath: `/cases/${NONVENDOR.caseId}`,
    });
    const future = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { ...expectedVersion, revision: 42 },
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(future.statusCode, 409, future.body);
    assert.equal(staleOf(future)?.reason, 'revision_changed');
    assert.equal((await current(owner, NONVENDOR.caseId)).draft.slots[5].state, 'not_yet');
    assert.equal((await audit('draft.saved')).length, 1);
  });

  it('naming a version that is not the open draft is 409 version_superseded pointing at the open draft; after a submit it points at the submitted version; a Ready case is version_closed', async () => {
    const owner = await signIn(OWNER_A);
    const { expectedVersion } = await current(owner, NONVENDOR.caseId);
    const wrong = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { versionId: randomUUID(), revision: expectedVersion.revision },
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(wrong.statusCode, 409, wrong.body);
    assert.deepEqual(staleOf(wrong), {
      reason: 'version_superseded',
      guidanceKey: 'error.stale_version.guidance.version_superseded',
      current: {
        versionId: expectedVersion.versionId,
        versionNumber: 1,
        revision: 1,
        state: 'draft',
        ready: false,
      },
      refreshPath: `/cases/${NONVENDOR.caseId}`,
    });
    // Another case's open draft id is not this case's draft either.
    const other = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: { versionId: VENDOR.draftVersionId, revision: expectedVersion.revision },
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(staleOf(other)?.reason, 'version_superseded');
    await simulateSubmitted(NONVENDOR);
    const late = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(late.statusCode, 409, late.body);
    assert.deepEqual(staleOf(late)?.current, {
      versionId: NONVENDOR.draftVersionId,
      versionNumber: 1,
      revision: 1,
      state: 'submitted',
      ready: false,
    });
    assert.equal(staleOf(late)?.reason, 'version_superseded');
    const gone = await getDraft(owner, NONVENDOR.caseId);
    assert.equal(gone.statusCode, 404, gone.body); // no open draft (7.5 GET row)
    assert.deepEqual(errorOf(gone).details, { resource: 'version' });
    await db.owner.execute(
      sql`UPDATE pack_version SET ready_at = ${now()} WHERE id = ${NONVENDOR.draftVersionId}`,
    );
    const closed = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(closed.statusCode, 409, closed.body);
    assert.equal(staleOf(closed)?.reason, 'version_closed');
    assert.equal(staleOf(closed)?.guidanceKey, 'error.stale_version.guidance.ready');
    assert.equal((await slotRows(NONVENDOR.draftVersionId)).find((r) => r.slot === 5)?.state, 'attached');
    assert.equal((await audit('draft.saved')).length, 0);
  });

  it('W0-06 order: a stale save with an invalid body is 422 (step 4 before step 6); a stale save with a valid body is 409', async () => {
    const owner = await signIn(OWNER_A);
    const { expectedVersion } = await current(owner, NONVENDOR.caseId);
    const stale = { ...expectedVersion, revision: expectedVersion.revision + 1 };
    const invalid = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: stale,
      slots: { 5: { state: 'not_applicable' } },
    });
    assert.equal(invalid.statusCode, 422, invalid.body);
    const valid = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: stale,
      slots: { 5: { state: 'missing' } },
    });
    assert.equal(valid.statusCode, 409, valid.body);
  });

  it('a draft save never touches a projection: the four status fields, risk_tier and desk_status are unchanged after every kind of save, and a body carrying one is 422 projected_field', async () => {
    const owner = await signIn(OWNER_A);
    const ref = await uploadPdf(owner, NONVENDOR.caseId, 'p.pdf');
    const before = await caseRow(NONVENDOR.caseId);
    let { expectedVersion } = await current(owner, NONVENDOR.caseId);
    const res = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion,
      stageContext: 'pre_build',
      checklistTemplateVersion: 'v2.0',
      slots: {
        1: { state: 'attached', artifactId: ref.artifactId },
        2: { state: 'not_yet' },
        5: naText('x'),
        6: { state: 'missing' },
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const after = await caseRow(NONVENDOR.caseId);
    for (const column of [
      ...PROJECTIONS,
      'desk_status',
      'registry_id',
      'owner_subject_id',
      'business_unit_id',
    ])
      assert.equal(after[column], before[column], column);
    assert.equal(after.row_version, (before.row_version as number) + 1);
    ({ expectedVersion } = await current(owner, NONVENDOR.caseId));
    for (const field of [
      'privacyStatus',
      'securityStatus',
      'raiStatus',
      'aiReadinessStatus',
      'riskTier',
      'status',
      'registryId',
    ]) {
      const bad = await putDraft(owner, NONVENDOR.caseId, {
        expectedVersion,
        [field]: 'approved',
        slots: { 7: { state: 'not_yet' } },
      });
      assert422(bad, `body.${field}`, 'error.invalid_input.projected_field');
    }
    assert.deepEqual(await caseRow(NONVENDOR.caseId), after);
    assert.equal(denied.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// W0-05: T10, T11, T33 shape, 401
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-04 authorization (A01) — ${SET}`, () => {
  it('no session: GET and PUT are 401 unauthenticated before anything else; no authz.denied line', async () => {
    for (const res of [
      await getDraft(undefined, NONVENDOR.caseId),
      await putDraft(undefined, NONVENDOR.caseId, { slots: { 5: { state: 'not_applicable' } } }),
      await putDraft(undefined, NONVENDOR.caseId, '{not json'),
    ]) {
      assert.equal(res.statusCode, 401, res.body);
      assert.equal(errorOf(res).code, 'unauthenticated');
      assert.equal(errorOf(res).details, undefined);
    }
    assert.equal(denied.length, 0);
  });

  it('T10: reviewer-dpo and admin may read the draft but never save it: 403 role on every body variant, one authz.denied line each, zero audit rows, nothing written', async () => {
    const { expectedVersion } = await current(await signIn(OWNER_A), NONVENDOR.caseId);
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      const read = await getDraft(session, NONVENDOR.caseId);
      assert.equal(read.statusCode, 200, read.body);
      for (const body of [
        { expectedVersion, slots: { 5: { state: 'not_yet' } } },
        { expectedVersion, privacyStatus: 'approved', slots: { 5: { state: 'not_yet' } } },
        { expectedVersion, slots: { 5: { state: 'not_applicable' } } },
        '{not json',
      ]) {
        const res = await putDraft(session, NONVENDOR.caseId, body);
        assertPlainForbidden(res);
        const line = lastDenied();
        assert.equal(line.action, 'case.edit_draft');
        assert.equal(line.reason, 'role');
        assert.equal(line.targetId, NONVENDOR.caseId);
        assert.equal(line.actorSubjectId, subjectOf(id));
      }
    }
    assert.equal((await slotRows(NONVENDOR.draftVersionId)).find((r) => r.slot === 5)?.state, 'attached');
    assert.equal((await audit('draft.saved')).length, 0);
  });

  it("T11: owner-b on owner-a's case and spoc-cm on an HR case: 403 scope on GET and PUT whatever the body, nothing written", async () => {
    const { expectedVersion } = await current(await signIn(OWNER_A), NONVENDOR.caseId);
    const hr = await current(await signIn(OWNER_A), VENDOR.caseId);
    const rows = [
      { id: OWNER_B, caseId: NONVENDOR.caseId, expectedVersion },
      { id: SPOC_B1, caseId: VENDOR.caseId, expectedVersion: hr.expectedVersion },
    ];
    for (const row of rows) {
      const session = await signIn(row.id);
      const read = await getDraft(session, row.caseId);
      assertPlainForbidden(read);
      assert.equal(lastDenied().reason, 'scope');
      for (const body of [
        { expectedVersion: row.expectedVersion, slots: { 5: { state: 'not_yet' } } },
        { expectedVersion: row.expectedVersion, privacyStatus: 'approved' },
        { expectedVersion: row.expectedVersion, slots: { 5: { state: 'not_applicable' } } },
      ]) {
        const res = await putDraft(session, row.caseId, body);
        assertPlainForbidden(res);
        const line = lastDenied();
        assert.equal(line.action, 'case.edit_draft');
        assert.equal(line.reason, 'scope');
        assert.equal(line.actorSubjectId, subjectOf(row.id));
      }
    }
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal((await caseRow(NONVENDOR.caseId)).row_version, 1);
    assert.equal((await caseRow(VENDOR.caseId)).row_version, 1);
    // The positive counterpart: the BU SPOC of CM saves owner-a's CM draft (T4 shape); the event names the SPOC.
    const spoc = await signIn(SPOC_B1);
    const ok = await putDraft(spoc, NONVENDOR.caseId, {
      expectedVersion,
      slots: { 5: { state: 'not_yet' } },
    });
    assert.equal(ok.statusCode, 200, ok.body);
    const event = (await audit('draft.saved'))[0]!;
    assert.equal(event.actorSubjectId, subjectOf(SPOC_B1));
    assert.equal(event.actorRole, 'bu_spoc');
    assert.equal((await caseRow(NONVENDOR.caseId)).owner_subject_id, subjectOf(OWNER_A));
  });

  it('T33 shape: an unresolvable case id is 403 scope for owner-b and spoc-cm on GET and PUT, 404 case for reviewer-dpo and admin on GET, 403 role on PUT', async () => {
    const unknown = randomUUID();
    for (const id of [OWNER_B, SPOC_B1]) {
      const session = await signIn(id);
      assertPlainForbidden(await getDraft(session, unknown));
      assert.equal(lastDenied().reason, 'scope');
      assertPlainForbidden(
        await putDraft(session, unknown, { expectedVersion: { versionId: unknown, revision: 1 } }),
      );
      assert.equal(lastDenied().reason, 'scope');
    }
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      const res = await getDraft(session, unknown);
      assert.equal(res.statusCode, 404, res.body);
      assert.deepEqual(errorOf(res).details, { resource: 'case' });
      assert.equal(denied.length, 0);
      assertPlainForbidden(
        await putDraft(session, unknown, { expectedVersion: { versionId: unknown, revision: 1 } }),
      );
      assert.equal(lastDenied().reason, 'role');
    }
    // A non-UUID id is unresolvable too, never a 500.
    const owner = await signIn(OWNER_A);
    assertPlainForbidden(await getDraft(owner, 'RAI-2000-0001'));
    assert.equal(lastDenied().reason, 'scope');
    assert.equal((await audit('draft.saved')).length, 0);
  });
});
