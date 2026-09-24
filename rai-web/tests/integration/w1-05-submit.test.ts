// W1-05 Done when, against the real Postgres and the real routes through app.inject(): submit writes an immutable
// version that records the exact configuration revision id and the lane-mapping constant version (the 7.6 body
// and the W0-04 frozen columns: configuration_revision_id, frozen_configuration for every kind, lane_mapping_
// version 'lane-mapping/v1' with its content, checklist_template_version, stage_context (D11), manifest_hash,
// submit_correlation_id); a second write to that version's artifact ref is rejected by the W1-00 trigger as
// rai_app and as rai_owner (and every write path through the API is closed: no open draft after submit); the
// submit audit event `version.submitted` carries actor, version, correlation id and the idempotency key. Also every
// W0-02 7.6 error row (401; 403 role for reviewers and Admin, T10; 403 scope for an out-of-scope owner, T11; 404 /
// 403 on an unknown case; 409 stale_version revision_changed and version_superseded with nothing written; 422 for
// a missing Idempotency-Key, a bad shape and a reason-less N/A), idempotent replay under the same key (the same
// 201 body, one audit row, one version; another body under the same key → 422 idempotency_key_reused), the W0-05
// T3 / T9 rows on version.view, the three reads (ascending list, by id also across cases, latest, byte-identical
// bodies), missing documents never blocking (L7, A02), the projections untouched by submit, the SPOC-on-behalf
// actor, and the W0-04 audit rule of withWorkflowTransaction (no audit event → nothing commits; a failure after
// the writes leaves no row). The restart proof is tests/integration/w1-05-restart.test.ts. Fixture set
// slice1-synthetic@1 (W1-09) loaded per test; identities from W0-03 section 7 (fx-user-owner-cm = owner-a,
// fx-user-owner-cm-2 = owner-b, fx-user-spoc-cm = spoc-b1, fx-user-dpo = reviewer-dpo, fx-user-admin); B1 = CM.

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import type { ErrorDetails, ErrorResponse } from '@rai/shared/errors';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type {
  CaseCreateRequest,
  CaseListResponse,
  CaseView,
  ConfigurationView,
} from '@rai/shared/schemas/cases';
import type { PackDraft, SlotState } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';
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
import { manifestHash } from '@rai/server/versions/manifest';
import { laneOpenRecipientsFromIdentities } from '@rai/server/versions/open-lanes';
import { AuditEventMissing, withWorkflowTransaction } from '@rai/server/versions/transaction';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { RAISE_EXCEPTION, expectSqlError, openTestDatabase, type TestDatabase } from '../support/db.js';
import { asUser, signInAsFixture, type FixtureSession } from '../support/sign-in.js';
import { fixtureBaseDocuments, upload } from './w1-03-helpers.js';

const SET = fixtureSetLabel(readManifest());
const publicBaseUrl = new URL('http://127.0.0.1:8787');
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
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // owner-a, B1, vendorInvolved false, seven slots attached
const MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!; // owner-a, B1, a missing and a not-yet slot
const HR_CASE = findFixtureCase('fx-case-hr-dualrole')!; // owner-a, B2
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
let clock = Date.parse('2026-09-22T03:00:00Z');
const now = () => new Date(clock);

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-05-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-05-out-'));
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
  const logStream = new Writable({
    write(_chunk: Buffer, _enc, cb) {
      cb();
    },
  });
  const built = buildApp({
    db: db.app,
    now,
    config: { nodeEnv: 'test', log: { level: 'info', pretty: false }, trustProxy: false, publicBaseUrl },
    logStream,
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
    },
    cases: {
      businessUnits: createBusinessUnitDirectory(
        businessUnitsFromGrants(FIXTURE_USERS.flatMap((u) => [...u.roles])),
      ),
      subjects: createSubjectDirectory(db.app, { known: FIXTURE_USERS }),
    },
    artifacts: { store, limits: LIMITS },
    pack: { limits: { maxPackBytes: LIMITS.maxPackBytes } },
    versions: { laneOpenRecipients: laneOpenRecipientsFromIdentities(FIXTURE_USERS) },
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
  clock += 60_000; // every request runs after the seed's publish instant (W1-00 activation rule)
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
type Res = { statusCode: number; body: string; headers: Record<string, unknown>; json<T>(): T };

function submit(
  session: FixtureSession | undefined,
  caseId: string,
  body: unknown,
  key: string | null = randomUUID(), // null: send no Idempotency-Key header
): Promise<Res> {
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/draft/submit`,
    headers: {
      'content-type': 'application/json',
      ...(key === null ? {} : { 'idempotency-key': key }),
      ...(session === undefined ? {} : asUser(session)),
    },
    payload: body as object,
  });
}
function getDraft(session: FixtureSession, caseId: string): Promise<Res> {
  return app.inject({ method: 'GET', url: `/api/cases/${caseId}/draft`, headers: asUser(session) });
}
function putDraft(session: FixtureSession, caseId: string, body: unknown): Promise<Res> {
  return app.inject({
    method: 'PUT',
    url: `/api/cases/${caseId}/draft`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: body as object,
  });
}
function getCase(session: FixtureSession, caseId: string): Promise<Res> {
  return app.inject({ method: 'GET', url: `/api/cases/${caseId}`, headers: asUser(session) });
}
function listVersions(session: FixtureSession | undefined, caseId: string): Promise<Res> {
  return app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/versions`,
    headers: session === undefined ? {} : asUser(session),
  });
}
function getVersion(session: FixtureSession | undefined, caseId: string, versionId: string): Promise<Res> {
  return app.inject({
    method: 'GET',
    url: `/api/cases/${caseId}/versions/${versionId}`,
    headers: session === undefined ? {} : asUser(session),
  });
}
function latest(session: FixtureSession | undefined, caseId: string): Promise<Res> {
  return getVersion(session, caseId, 'latest');
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
/** The open draft plus the `expectedVersion` a client would send on submit. */
async function current(session: FixtureSession, caseId: string) {
  const res = await getDraft(session, caseId);
  assert.equal(res.statusCode, 200, res.body);
  const draft = res.json<PackDraft>();
  const body: SubmitRequest = {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  };
  return { draft, body };
}
async function uploadPdf(session: FixtureSession, caseId: string, name: string) {
  const res = await upload(app, session, caseId, name, fixtureBaseDocuments().pdf, 'application/pdf');
  assert.equal(res.statusCode, 201, res.body);
  return res.json<ArtifactRef>();
}
async function configuration(session: FixtureSession) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/configuration/current',
    headers: asUser(session),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<ConfigurationView>();
}
async function versionRow(versionId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM pack_version WHERE id = ${versionId}`);
  return r.rows[0] as Record<string, unknown>;
}
async function caseRow(caseId: string) {
  const r = await db.owner.execute(sql`SELECT * FROM "case" WHERE id = ${caseId}`);
  return r.rows[0] as Record<string, unknown>;
}
async function slotRows(versionId: string) {
  const r = await db.owner.execute(
    sql`SELECT s.slot, s.state, s.reason, s.artifact_id, a.content_hash, a.filename, a.media_type, a.size_bytes
        FROM artifact_slot s LEFT JOIN artifact a ON a.id = s.artifact_id WHERE s.version_id = ${versionId} ORDER BY s.slot`,
  );
  return r.rows as Array<{
    slot: number;
    state: string;
    reason: string | null;
    artifact_id: string | null;
    content_hash: string | null;
    filename: string | null;
    media_type: string | null;
    size_bytes: string | null;
  }>;
}
async function audit(action?: string) {
  const all = await auditStore.read(db.owner);
  return action === undefined ? all : all.filter((e) => e.action === action);
}
async function countVersions(caseId?: string): Promise<number> {
  const r = await db.owner.execute(
    caseId === undefined
      ? sql`SELECT count(*)::int AS n FROM pack_version WHERE submitted_at IS NOT NULL`
      : sql`SELECT count(*)::int AS n FROM pack_version WHERE submitted_at IS NOT NULL AND case_id = ${caseId}`,
  );
  return (r.rows[0] as { n: number }).n;
}
function errorOf(res: Res): ErrorResponse['error'] {
  return res.json<ErrorResponse>().error;
}
function invalidFields(res: Res) {
  return (errorOf(res).details as ErrorDetails['invalid_input'] | undefined)?.fields ?? [];
}
function staleOf(res: Res) {
  return errorOf(res).details as ErrorDetails['stale_version'] | undefined;
}
function assertPlainForbidden(res: Res): void {
  assert.equal(res.statusCode, 403, res.body);
  const err = errorOf(res);
  assert.deepEqual(Object.keys(err).sort(), ['code', 'correlationId', 'messageKey']);
  assert.equal(err.code, 'forbidden');
  assert.equal(err.messageKey, 'error.forbidden');
  for (const c of FIXTURE_CASES) {
    assert.doesNotMatch(res.body, new RegExp(c.registryId));
    assert.doesNotMatch(res.body, new RegExp(c.useCaseName.replaceAll(/[()]/g, '\\$&')));
  }
}
function lastDenied(): Record<string, unknown> {
  assert.equal(denied.length, 1, `expected one authz.denied line, got ${JSON.stringify(denied)}`);
  return denied.pop()!;
}
function assert422(res: Res, path: string, key: string) {
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(errorOf(res).code, 'invalid_input');
  const field = invalidFields(res).find((f) => f.path === path);
  assert.ok(field !== undefined, `no field error at ${path} in ${res.body}`);
  assert.equal(field.messageKey, key);
}
/** A submit that must succeed: the 201 body and the correlation id it was answered under. */
async function submitOk(session: FixtureSession, caseId: string, key = randomUUID()) {
  const { draft, body } = await current(session, caseId);
  const res = await submit(session, caseId, body, key);
  assert.equal(res.statusCode, 201, res.body);
  return {
    draft,
    body,
    key,
    res,
    version: res.json<SubmittedVersion>(),
    correlationId: res.headers['x-correlation-id'] as string,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A07: the frozen version
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 submit freezes an immutable version (A07) — ${SET}, fx-case-nonvendor`, () => {
  it('201 SubmittedVersion: the draft row becomes the version, the artifact references are embedded, the configuration revision id and the lane-mapping version are recorded, the stage context (D11) and the template are frozen', async () => {
    const owner = await signIn(OWNER_A);
    const config = await configuration(owner);
    const before = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
    const { draft, version, correlationId } = await submitOk(owner, NONVENDOR.caseId);

    assert.equal(version.versionId, draft.draftId); // W0-04: the draft row is frozen in place
    assert.equal(version.caseId, NONVENDOR.caseId);
    assert.equal(version.versionNumber, 1);
    assert.equal(version.parentVersionId, null);
    assert.equal(version.submittedBy, subjectOf(OWNER_A));
    assert.equal(version.submittedAt, now().toISOString());
    assert.equal(version.checklistTemplateVersion, NONVENDOR.checklistTemplateVersion);
    assert.equal(version.stageContext, NONVENDOR.stageContext);
    assert.equal(version.configurationRevisionId, config.revisionId); // the exact revision the submitter saw
    assert.equal(version.laneMappingVersion, CURRENT_LANE_MAPPING.version);
    assert.equal(version.laneMappingVersion, 'lane-mapping/v1'); // D02
    assert.equal(version.isLatest, true);
    assert.deepEqual(Object.keys(version.slots).map(Number).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const slot of [1, 2, 5, 6, 7, 8, 9] as const) {
      const frozen = version.slots[slot];
      assert.equal(frozen.state, 'attached');
      const stored = draft.slots[slot] as Extract<SlotState, { state: 'attached' }>;
      const ref = frozen.artifact;
      assert.equal(ref.artifactId, stored.artifactId);
      assert.equal(ref.caseId, NONVENDOR.caseId);
      assert.match(ref.sha256, /^[0-9a-f]{64}$/);
      const meta = await app.inject({
        method: 'GET',
        url: `/api/artifacts/${ref.artifactId}/meta`,
        headers: asUser(owner),
      });
      assert.deepEqual(ref, meta.json<ArtifactRef>()); // the embedded copy equals the artifact's own reference
    }
    assert.deepEqual(version.slots[3], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });
    assert.deepEqual(version.slots[4], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });

    // The W0-04 frozen columns, equal to the configuration and the mapping in force.
    const row = await versionRow(version.versionId);
    assert.equal(row.submitted_by, subjectOf(OWNER_A));
    assert.equal(row.submitted_role, 'owner');
    assert.equal(new Date(row.submitted_at as string).toISOString(), version.submittedAt);
    assert.equal(row.configuration_revision_id, config.revisionId);
    assert.equal(row.lane_mapping_version, 'lane-mapping/v1');
    assert.deepEqual(row.lane_mapping, {
      version: 'lane-mapping/v1',
      decision: 'D02',
      slotsByLane: { ai_coe: [1, 5], dpo: [2, 3, 4, 5], it_security: [5, 6, 7, 8] },
      noLaneGate: [9],
    });
    assert.equal(row.stage_context, NONVENDOR.stageContext);
    assert.equal(row.checklist_template_version, NONVENDOR.checklistTemplateVersion);
    assert.equal(row.submit_correlation_id, correlationId);
    assert.equal(row.ready_at, null);
    // frozen_configuration names every seeded kind's revision in force (W0-04: one FK, every kind in the jsonb).
    const revisions = (await db.owner.execute(sql`SELECT id, kind FROM configuration_revision ORDER BY kind`))
      .rows as Array<{ id: string; kind: string }>;
    assert.ok(revisions.length >= 5);
    assert.deepEqual(row.frozen_configuration, Object.fromEntries(revisions.map((r) => [r.kind, r.id])));
    assert.ok(Object.values(row.frozen_configuration as Record<string, string>).includes(config.revisionId));
    assert.ok('sla' in (row.frozen_configuration as object)); // W3-05 reads the SLA values from here
    // manifest_hash covers the nine slot rows (W0-04).
    const slots = await slotRows(version.versionId);
    assert.equal(
      row.manifest_hash,
      manifestHash(
        slots.map((s) => ({
          slot: s.slot,
          state: s.state,
          reason: s.reason,
          artifact:
            s.artifact_id === null
              ? null
              : {
                  sha256: s.content_hash!,
                  filename: s.filename!,
                  mediaType: s.media_type!,
                  sizeBytes: Number(s.size_bytes),
                },
        })),
      ),
    );

    // The case: current version set, no open draft, in review, the revision advanced by one.
    const c = await caseRow(NONVENDOR.caseId);
    assert.equal(c.current_version_id, version.versionId);
    assert.equal(c.draft_version_id, null);
    assert.equal(c.desk_status, 'in_review');
    assert.equal(c.row_version, before.caseRevision + 1);
    const view = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
    assert.equal(view.status, 'in_review');
    assert.equal(view.draft, null);
    assert.deepEqual(view.currentVersion, {
      versionId: version.versionId,
      versionNumber: 1,
      submittedBy: subjectOf(OWNER_A),
      submittedAt: version.submittedAt,
      isLatest: true,
    });
    assert.equal(view.businessOwner, before.businessOwner);
    const list = (
      await app.inject({ method: 'GET', url: '/api/cases', headers: asUser(owner) })
    ).json<CaseListResponse>();
    const summary = list.items.find((i) => i.caseId === NONVENDOR.caseId)!;
    assert.equal(summary.status, 'in_review');
    assert.equal(summary.currentVersionNumber, 1);
  });

  it('missing and not-yet documents do not block submit (L7, A02): the facts are frozen as they were', async () => {
    const owner = await signIn(OWNER_A);
    const { version } = await submitOk(owner, MISSING_SLOT.caseId);
    assert.deepEqual(version.slots[7], { state: 'missing' });
    assert.deepEqual(version.slots[8], { state: 'not_yet' });
    const fresh = await createCase(owner, { vendorInvolved: true });
    const all = await submitOk(owner, fresh.caseId);
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const)
      assert.deepEqual(all.version.slots[slot], { state: 'missing' });
  });

  it('a BU SPOC submitting on the owner behalf is recorded as itself; the case owner is unchanged (W0-05 case.submit, T4)', async () => {
    const spoc = await signIn(SPOC_B1);
    const before = await caseRow(NONVENDOR.caseId);
    const { version } = await submitOk(spoc, NONVENDOR.caseId);
    assert.equal(version.submittedBy, subjectOf(SPOC_B1));
    assert.equal((await versionRow(version.versionId)).submitted_role, 'bu_spoc');
    const after = await caseRow(NONVENDOR.caseId);
    assert.equal(after.owner_subject_id, before.owner_subject_id);
    assert.equal(after.owner_subject_id, subjectOf(OWNER_A));
    const [event] = await audit('version.submitted');
    assert.equal(event?.actorSubjectId, subjectOf(SPOC_B1));
    assert.equal(event?.actorRole, 'bu_spoc');
  });

  it('the projected status fields are untouched by submit: the three lane projections stay pending, readiness not_ready, risk tier null', async () => {
    const owner = await signIn(OWNER_A);
    const before = await caseRow(NONVENDOR.caseId);
    await submitOk(owner, NONVENDOR.caseId);
    const after = await caseRow(NONVENDOR.caseId);
    for (const column of PROJECTIONS) assert.equal(after[column], before[column], column);
    assert.equal(after.privacy_status, 'pending');
    assert.equal(after.security_status, 'pending');
    assert.equal(after.rai_status, 'pending');
    assert.equal(after.ai_readiness_status, 'not_ready');
    assert.equal(after.risk_tier, null);
    const view = (await getCase(owner, NONVENDOR.caseId)).json<CaseView>();
    assert.equal(view.privacyStatus, 'pending');
    assert.equal(view.aiReadinessStatus, 'not_ready');
    assert.equal(view.riskTier, null);
    assert.equal((await audit('lane.opened')).length, 3); // W2-01 (d): three lanes open with submit
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A07: immutability at the store and through the API
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 a second write to the frozen version is rejected (A07) — ${SET}, fx-case-nonvendor`, () => {
  it('UPDATE artifact_slot SET artifact_id = … WHERE version_id = <submitted> raises rai.frozen_version as rai_app and as rai_owner; so does every other slot or version write; the rows are unchanged', async () => {
    const owner = await signIn(OWNER_A);
    const other = await createCase(owner);
    const spare = await uploadPdf(owner, other.caseId, 'spare.pdf');
    const { version } = await submitOk(owner, NONVENDOR.caseId);
    const before = await slotRows(version.versionId);
    const beforeRow = await versionRow(version.versionId);

    const statements: Array<[string, unknown[]]> = [
      [
        'UPDATE artifact_slot SET artifact_id = $1 WHERE version_id = $2 AND slot = 1',
        [spare.artifactId, version.versionId],
      ],
      [
        "UPDATE artifact_slot SET state = 'missing', artifact_id = NULL WHERE version_id = $1 AND slot = 1",
        [version.versionId],
      ],
      ["UPDATE artifact_slot SET reason = 'edited' WHERE version_id = $1 AND slot = 3", [version.versionId]],
      ['DELETE FROM artifact_slot WHERE version_id = $1', [version.versionId]],
      ["UPDATE pack_version SET stage_context = 'pre_launch' WHERE id = $1", [version.versionId]],
      [
        'UPDATE pack_version SET lane_mapping_version = $1 WHERE id = $2',
        ['lane-mapping/v2', version.versionId],
      ],
      [
        'UPDATE pack_version SET configuration_revision_id = NULL, submitted_at = NULL WHERE id = $1',
        [version.versionId],
      ],
      ['DELETE FROM pack_version WHERE id = $1', [version.versionId]],
    ];
    for (const role of ['app', 'owner'] as const) {
      for (const [statement, params] of statements) {
        const err = await expectSqlError(db, role, statement, params);
        assert.ok(err !== undefined, `${role}: ${statement} unexpectedly succeeded`);
        // rai_app has no DELETE grant (42501); every UPDATE and the owner's DELETE reach the trigger (P0001).
        if (statement.startsWith('DELETE') && role === 'app') assert.equal(err.code, '42501', err.message);
        else {
          assert.equal(err.code, RAISE_EXCEPTION, `${role}: ${statement}: ${err.message}`);
          assert.equal(err.message, 'rai.frozen_version');
        }
      }
    }
    assert.deepEqual(await slotRows(version.versionId), before);
    assert.deepEqual(await versionRow(version.versionId), beforeRow);
    // The one permitted change (W0-06 9.2): ready_at from NULL to a value, every other column unchanged.
    const ready = await expectSqlError(
      db,
      'owner',
      'UPDATE pack_version SET ready_at = now() WHERE id = $1',
      [version.versionId],
    );
    assert.equal(ready, undefined);
    const twice = await expectSqlError(
      db,
      'owner',
      "UPDATE pack_version SET ready_at = now() + interval '1 day' WHERE id = $1",
      [version.versionId],
    );
    assert.equal(twice?.message, 'rai.frozen_version');
  });

  it('after submit the case has no open draft: GET /draft is 404, PUT /draft is 409 version_superseded pointing at the version, an upload is 422 no_open_draft, a second submit is 409 version_superseded', async () => {
    const owner = await signIn(OWNER_A);
    const { body, version } = await submitOk(owner, NONVENDOR.caseId);
    const draft = await getDraft(owner, NONVENDOR.caseId);
    assert.equal(draft.statusCode, 404, draft.body);
    assert.equal((errorOf(draft).details as ErrorDetails['not_found']).resource, 'version');
    const put = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: body.expectedVersion,
      stageContext: 'pre_build',
    });
    assert.equal(put.statusCode, 409, put.body);
    assert.equal(staleOf(put)?.reason, 'version_superseded');
    assert.equal(staleOf(put)?.current.versionId, version.versionId);
    assert.equal(staleOf(put)?.current.state, 'submitted');
    const up = await upload(
      app,
      owner,
      NONVENDOR.caseId,
      'late.pdf',
      fixtureBaseDocuments().pdf,
      'application/pdf',
    );
    assert422(up, 'caseId', 'validation.no_open_draft'); // the W1-03 path for check 3
    const again = await submit(owner, NONVENDOR.caseId, body, randomUUID());
    assert.equal(again.statusCode, 409, again.body);
    assert.equal(staleOf(again)?.reason, 'version_superseded');
    assert.equal(staleOf(again)?.guidanceKey, 'error.stale_version.guidance.version_superseded');
    assert.equal(staleOf(again)?.refreshPath, `/cases/${NONVENDOR.caseId}/versions/${version.versionId}`);
    assert.equal(await countVersions(NONVENDOR.caseId), 1);
    assert.equal((await audit('version.submitted')).length, 1);
    assert.equal((await versionRow(version.versionId)).stage_context, NONVENDOR.stageContext);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A11: the submit audit event; the workflow transaction rule
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 the submit audit event (A11) — ${SET}, fx-case-nonvendor`, () => {
  it('version.submitted carries actor, role, version, correlation id, the idempotency key and the frozen references; before/after hold the case pointers', async () => {
    const owner = await signIn(OWNER_A);
    const key = randomUUID();
    const { version, correlationId } = await submitOk(owner, NONVENDOR.caseId, key);
    const events = await audit('version.submitted');
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event!.actorSubjectId, subjectOf(OWNER_A));
    assert.equal(event!.actorRole, 'owner');
    assert.equal(event!.targetCaseId, NONVENDOR.caseId);
    assert.equal(event!.targetVersionId, version.versionId);
    assert.equal(event!.correlationId, correlationId);
    assert.equal(event!.occurredAt.toISOString(), version.submittedAt);
    const target = event!.targetRef as Record<string, unknown>;
    assert.equal(target.idempotency_key, key);
    assert.equal(target.version_number, 1);
    assert.equal(target.lane_mapping_version, 'lane-mapping/v1');
    assert.equal(target.configuration_revision_id, version.configurationRevisionId);
    assert.equal(target.stage_context, version.stageContext);
    assert.equal(target.manifest_hash, (await versionRow(version.versionId)).manifest_hash);
    const slots = target.slots as Array<Record<string, unknown>>;
    assert.equal(slots.length, 9);
    assert.equal(slots[0]?.slot, 1);
    assert.equal(slots[0]?.state, 'attached');
    assert.match(String(slots[0]?.content_hash), /^[0-9a-f]{64}$/);
    assert.deepEqual(event!.beforeRef, {
      draft_version_id: version.versionId,
      current_version_id: null,
      desk_status: 'draft',
      row_version: 1,
      privacy_status: 'pending',
      security_status: 'pending',
      rai_status: 'pending',
      ai_readiness_status: 'not_ready',
    });
    assert.deepEqual(event!.afterRef, {
      draft_version_id: null,
      current_version_id: version.versionId,
      desk_status: 'in_review',
      row_version: 2,
      privacy_status: 'pending',
      security_status: 'pending',
      rai_status: 'pending',
      ai_readiness_status: 'not_ready',
    });
    assert.doesNotMatch(JSON.stringify(event), /\.pdf|\.docx/); // references only, never filenames
  });

  it('withWorkflowTransaction refuses to commit an action that wrote no audit event and rolls back an action that fails after its writes', async () => {
    const actor = { subjectId: subjectOf(OWNER_A), displayName: 'x', roles: [] } as never;
    const ctx = (key: string) => ({
      actor,
      role: 'owner' as const,
      correlationId: randomUUID(),
      action: 'test.action',
      idempotencyKey: key,
      requestDigest: 'd'.repeat(64),
      now: now(),
    });
    const before = await caseRow(NONVENDOR.caseId);
    await assert.rejects(
      withWorkflowTransaction(db.app, NONVENDOR.caseId, ctx(randomUUID()), {
        async apply({ tx }) {
          await tx.execute(sql`UPDATE "case" SET desk_status = 'in_review' WHERE id = ${NONVENDOR.caseId}`);
          return { status: 200, body: {} };
        },
      }),
      (e: unknown) => e instanceof AuditEventMissing,
    );
    await assert.rejects(
      withWorkflowTransaction(db.app, NONVENDOR.caseId, ctx(randomUUID()), {
        async apply({ tx, audit: append }) {
          await tx.execute(sql`UPDATE "case" SET desk_status = 'in_review' WHERE id = ${NONVENDOR.caseId}`);
          await append({ action: 'draft.saved', targetCaseId: NONVENDOR.caseId, targetRef: { probe: true } });
          throw new Error('forced failure after the writes');
        },
      }),
      /forced failure/,
    );
    assert.deepEqual(await caseRow(NONVENDOR.caseId), before);
    assert.equal((await audit('draft.saved')).length, 0);
    assert.equal(
      ((await db.owner.execute(sql`SELECT count(*)::int AS n FROM idempotency_key`)).rows[0] as { n: number })
        .n,
      0,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
// A07: idempotent replay
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 idempotent replay (A07) — ${SET}, fx-case-nonvendor`, () => {
  it('the same key and body returns the original 201 body byte for byte; one version, one audit row, no second write; the same key with another body is 422 idempotency_key_reused', async () => {
    const owner = await signIn(OWNER_A);
    const { body, key, res } = await submitOk(owner, NONVENDOR.caseId);
    clock += 5_000;
    const replay = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.body, res.body);
    assert.notEqual(replay.headers['x-correlation-id'], res.headers['x-correlation-id']);
    assert.equal(await countVersions(NONVENDOR.caseId), 1);
    assert.equal((await audit('version.submitted')).length, 1);
    assert.equal(
      (await audit()).filter((e) => e.correlationId === replay.headers['x-correlation-id']).length,
      0,
    );
    const reused = await submit(
      owner,
      NONVENDOR.caseId,
      { expectedVersion: { ...body.expectedVersion, revision: body.expectedVersion.revision + 1 } },
      key,
    );
    assert422(reused, 'header.idempotency-key', 'error.invalid_input.idempotency_key_reused');
    // Another actor's use of the same key string is that actor's own key (scoped to the actor).
    const spoc = await signIn(SPOC_B1);
    const otherActor = await submit(spoc, NONVENDOR.caseId, body, key);
    assert.equal(otherActor.statusCode, 409, otherActor.body);
    assert.equal(staleOf(otherActor)?.reason, 'version_superseded');
  });

  it('a key is stored only on success: a failed submit can be retried under the same key', async () => {
    const owner = await signIn(OWNER_A);
    const { body } = await current(owner, NONVENDOR.caseId);
    const key = randomUUID();
    const stale = await submit(
      owner,
      NONVENDOR.caseId,
      { expectedVersion: { ...body.expectedVersion, revision: 99 } },
      key,
    );
    assert.equal(stale.statusCode, 409, stale.body);
    const retry = await submit(owner, NONVENDOR.caseId, body, key);
    assert.equal(retry.statusCode, 201, retry.body);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The 7.6 error rows on submit
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 submit error rows (W0-02 7.6, W0-06 4.3) — ${SET}`, () => {
  it('401 without a session; nothing written', async () => {
    const res = await submit(undefined, NONVENDOR.caseId, {
      expectedVersion: { versionId: NONVENDOR.draftVersionId, revision: 1 },
    });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(errorOf(res).code, 'unauthenticated');
    assert.equal(await countVersions(), 0);
    assert.equal(denied.length, 0);
  });

  it('403 role for reviewer-dpo and admin (T10): plain envelope, one authz.denied line each, no version, no audit row', async () => {
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      const res = await submit(session, NONVENDOR.caseId, {
        expectedVersion: { versionId: NONVENDOR.draftVersionId, revision: 1 },
      });
      assertPlainForbidden(res);
      const line = lastDenied();
      assert.equal(line.action, 'case.submit');
      assert.equal(line.reason, 'role');
      assert.equal(line.correlationId ?? res.headers['x-correlation-id'], res.headers['x-correlation-id']);
    }
    assert.equal(await countVersions(), 0);
    assert.equal((await audit('version.submitted')).length, 0);
  });

  it('403 scope for owner-b on owner-a draft (T11) and on an unknown case id: the same envelope; no version submitted', async () => {
    const ownerB = await signIn(OWNER_B);
    const res = await submit(ownerB, NONVENDOR.caseId, {
      expectedVersion: { versionId: NONVENDOR.draftVersionId, revision: 1 },
    });
    assertPlainForbidden(res);
    assert.equal(lastDenied().reason, 'scope');
    const unknown = await submit(ownerB, randomUUID(), {
      expectedVersion: { versionId: NONVENDOR.draftVersionId, revision: 1 },
    });
    assertPlainForbidden(unknown);
    assert.equal(lastDenied().reason, 'scope');
    assert.equal(await countVersions(), 0);
    assert.equal((await caseRow(NONVENDOR.caseId)).draft_version_id, NONVENDOR.draftVersionId);
  });

  it('422 invalid_input without the Idempotency-Key header (header.idempotency-key), on a body without expectedVersion, and on a stored N/A slot without a reason (slots[n].reason); nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const { body } = await current(owner, NONVENDOR.caseId);
    assert422(
      await submit(owner, NONVENDOR.caseId, body, null),
      'header.idempotency-key',
      'validation.required',
    );
    assert422(await submit(owner, NONVENDOR.caseId, {}), 'body.expectedVersion', 'validation.required');
    assert422(
      await submit(owner, NONVENDOR.caseId, {
        expectedVersion: { versionId: body.expectedVersion.versionId },
      }),
      'body.expectedVersion.revision',
      'validation.required',
    );
    // A blank reason cannot be saved through the API (W1-04); written directly on the draft row to exercise the precondition.
    await db.owner.execute(
      sql`UPDATE artifact_slot SET reason = '  ' WHERE version_id = ${NONVENDOR.draftVersionId} AND slot = 3`,
    );
    const blank = await submit(owner, NONVENDOR.caseId, body);
    assert422(blank, 'slots[3].reason', 'validation.reason_required');
    assert.equal(await countVersions(), 0);
    assert.equal((await audit('version.submitted')).length, 0);
    assert.equal((await caseRow(NONVENDOR.caseId)).row_version, body.expectedVersion.revision);
  });

  it('409 stale_version revision_changed when the revision differs, version_superseded when the named version is not the open draft; the W0-06 8.2 details; nothing written', async () => {
    const owner = await signIn(OWNER_A);
    const { body } = await current(owner, NONVENDOR.caseId);
    const stale = await submit(owner, NONVENDOR.caseId, {
      expectedVersion: { ...body.expectedVersion, revision: body.expectedVersion.revision + 1 },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(errorOf(stale).code, 'stale_version');
    assert.equal(errorOf(stale).messageKey, 'error.stale_version');
    assert.deepEqual(staleOf(stale), {
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: {
        versionId: body.expectedVersion.versionId,
        versionNumber: 1,
        revision: body.expectedVersion.revision,
        state: 'draft',
        ready: false,
      },
      refreshPath: `/cases/${NONVENDOR.caseId}`,
    });
    // Someone else saved meanwhile: the client's revision is behind by one.
    const saved = await putDraft(owner, NONVENDOR.caseId, {
      expectedVersion: body.expectedVersion,
      stageContext: 'pre_build',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const behind = await submit(owner, NONVENDOR.caseId, body);
    assert.equal(behind.statusCode, 409, behind.body);
    assert.equal(staleOf(behind)?.reason, 'revision_changed');
    assert.equal(staleOf(behind)?.current.revision, body.expectedVersion.revision + 1);
    const superseded = await submit(owner, NONVENDOR.caseId, {
      expectedVersion: { versionId: randomUUID(), revision: body.expectedVersion.revision + 1 },
    });
    assert.equal(superseded.statusCode, 409, superseded.body);
    assert.equal(staleOf(superseded)?.reason, 'version_superseded');
    assert.equal(staleOf(superseded)?.current.versionId, body.expectedVersion.versionId);
    assert.equal(await countVersions(), 0);
    assert.equal((await audit('version.submitted')).length, 0);
    assert.equal((await caseRow(NONVENDOR.caseId)).draft_version_id, NONVENDOR.draftVersionId);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Version navigation (7.6 reads; W0-05 version.view: T3, T9)
// ---------------------------------------------------------------------------------------------------------------

describe(`W1-05 version navigation (A07) — ${SET}, fx-case-nonvendor, fx-case-missing-slot, fx-case-hr-dualrole`, () => {
  it('list is empty before submit, latest is 404 version; after submit the list holds the summary, latest and by-id return the same body, byte-identical on every read', async () => {
    const owner = await signIn(OWNER_A);
    const empty = await listVersions(owner, NONVENDOR.caseId);
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json<VersionListResponse>(), { items: [] });
    const none = await latest(owner, NONVENDOR.caseId);
    assert.equal(none.statusCode, 404, none.body);
    assert.equal((errorOf(none).details as ErrorDetails['not_found']).resource, 'version');

    const { version, res } = await submitOk(owner, NONVENDOR.caseId);
    const list = await listVersions(owner, NONVENDOR.caseId);
    assert.deepEqual(list.json<VersionListResponse>(), {
      items: [
        {
          versionId: version.versionId,
          versionNumber: 1,
          submittedBy: subjectOf(OWNER_A),
          submittedAt: version.submittedAt,
          isLatest: true,
        },
      ],
    });
    const byId = await getVersion(owner, NONVENDOR.caseId, version.versionId);
    assert.equal(byId.statusCode, 200, byId.body);
    assert.equal(byId.body, res.body);
    const late = await latest(owner, NONVENDOR.caseId);
    assert.equal(late.statusCode, 200, late.body);
    assert.equal(late.body, res.body);
    clock += 3_600_000;
    assert.equal((await getVersion(owner, NONVENDOR.caseId, version.versionId)).body, res.body);
    assert.equal((await latest(owner, NONVENDOR.caseId)).body, res.body);
  });

  it('404 version for an id that belongs to another case, an unknown id and a non-uuid; 404 case only for an all_cases holder on an unknown case, 403 for an owner', async () => {
    const owner = await signIn(OWNER_A);
    const a = await submitOk(owner, NONVENDOR.caseId);
    await submitOk(owner, MISSING_SLOT.caseId);
    // The other case's version (in scope for the owner), an unknown uuid, a non-uuid: all 404 version, never a leak.
    for (const id of [a.version.versionId, randomUUID(), 'not-a-uuid']) {
      const res = await getVersion(owner, MISSING_SLOT.caseId, id);
      assert.equal(res.statusCode, 404, `${id}: ${res.body}`);
      assert.equal((errorOf(res).details as ErrorDetails['not_found']).resource, 'version');
    }
    const dpo = await signIn(DPO);
    const unknownCase = randomUUID();
    for (const res of [
      await listVersions(dpo, unknownCase),
      await latest(dpo, unknownCase),
      await getVersion(dpo, unknownCase, a.version.versionId),
    ]) {
      assert.equal(res.statusCode, 404, res.body);
      assert.equal((errorOf(res).details as ErrorDetails['not_found']).resource, 'case');
    }
    assert.equal(denied.length, 0);
    const forOwner = await listVersions(owner, unknownCase);
    assertPlainForbidden(forOwner);
    assert.equal(lastDenied().reason, 'scope');
  });

  it('T9: reviewer-dpo and admin read every version under all_cases; T3: owner-b gets 403 scope on owner-a versions with a body carrying no case field; 401 without a session', async () => {
    const owner = await signIn(OWNER_A);
    const { version, res } = await submitOk(owner, NONVENDOR.caseId);
    const hr = await submitOk(owner, HR_CASE.caseId);
    for (const id of [DPO, ADMIN]) {
      const session = await signIn(id);
      assert.equal((await getVersion(session, NONVENDOR.caseId, version.versionId)).body, res.body);
      assert.equal((await latest(session, HR_CASE.caseId)).body, hr.res.body);
      assert.equal((await listVersions(session, NONVENDOR.caseId)).statusCode, 200);
    }
    const ownerB = await signIn(OWNER_B);
    const reads = [
      () => listVersions(ownerB, NONVENDOR.caseId),
      () => latest(ownerB, NONVENDOR.caseId),
      () => getVersion(ownerB, NONVENDOR.caseId, version.versionId),
    ];
    for (const read of reads) {
      assertPlainForbidden(await read());
      const line = lastDenied();
      assert.equal(line.action, 'version.view');
      assert.equal(line.reason, 'scope');
    }
    const spoc = await signIn(SPOC_B1); // B1 SPOC: in scope on the CM case, out of scope on the HR case
    assert.equal((await latest(spoc, NONVENDOR.caseId)).statusCode, 200);
    assertPlainForbidden(await latest(spoc, HR_CASE.caseId));
    denied.length = 0;
    for (const res of [
      await listVersions(undefined, NONVENDOR.caseId),
      await latest(undefined, NONVENDOR.caseId),
      await getVersion(undefined, NONVENDOR.caseId, version.versionId),
    ]) {
      assert.equal(res.statusCode, 401, res.body);
    }
    assert.equal(
      (await audit()).filter(
        (e) =>
          !['version.submitted', 'lane.opened', 'identity.signed_in', 'configuration.published'].includes(
            e.action,
          ),
      ).length,
      0, // reads write no audit row; the seed, the sign-ins and the submit lanes are the only other events
    );
  });
});
