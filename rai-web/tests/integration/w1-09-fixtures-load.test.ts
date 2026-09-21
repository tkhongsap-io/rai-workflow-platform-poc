// W1-09 done-when: the fixture set loads into a clean database with one command (`npm run fixtures:load`), and
// what it writes is exactly W0-08 section 8: five cases (fx-case-nonvendor, fx-case-vendor, fx-case-missing-slot,
// fx-case-na-reasons, fx-case-hr-dualrole), one open draft each, 45 slot rows, 33 artifact rows whose objects sit
// under BLOB_DIR in the W0-04 layout, the fixture_set row, and nothing that fakes a transition (8.1 rule 4).
// The loader refuses outside development/test, outside local-google/fixture and on a non-empty database.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import { auditStore } from '@rai/server/audit/store';
import { FixturesRefused, LOADER_IDENTITY_MODES, loadFixtures } from '@rai/fixtures/load';
import { readManifest, fixtureSetLabel } from '@rai/fixtures/manifest';
import { blobKeyPath } from '@rai/fixtures/generate/blob-layout';
import { FIXTURE_CASES, storedReason } from '@rai/fixtures/data/cases/index';
import { FIXTURE_DOCUMENTS, MEDIA_TYPE_BY_KIND } from '@rai/fixtures/data/documents/index';
import { DUAL_ROLE_FIXTURE_USER_ID, FIXTURE_USERS, findFixtureUser } from '@rai/fixtures/data/users';
import { openTestDatabase, type TestDatabase } from '../support/db.js';

const RAI_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = readManifest();
const SET = fixtureSetLabel(manifest);

let db: TestDatabase;
let blobDir: string;
let outputDir: string;

before(async () => {
  db = await openTestDatabase();
  blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-09-blobs-'));
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-09-out-'));
});
beforeEach(async () => {
  await db.reset();
});
after(async () => {
  await db.close();
  await rm(blobDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
});

async function count(table: string, where = ''): Promise<number> {
  const r = await db.owner.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}" ${where}`));
  return (r.rows[0] as { n: number }).n;
}

test(`${SET}: one command (npm run fixtures:load) loads a clean database and prints the set identity`, () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--conditions=rai-source', 'fixtures/src/load.ts'],
    {
      cwd: RAI_WEB_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        RAI_IDENTITY_MODE: 'fixture',
        DATABASE_URL: db.urls.app,
        DATABASE_MIGRATE_URL: db.urls.owner,
        DATABASE_OPERATOR_URL: db.urls.operator,
        BLOB_DIR: blobDir,
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes(`fixtures:load: ${SET}`), result.stdout);
  assert.ok(result.stdout.includes('5 cases, 5 open drafts, 45 slot rows, 33 artifacts'), result.stdout);
});

test(`${SET}: the rows are W0-08 8.3/8.4 exactly, objects sit under BLOB_DIR in the W0-04 layout, the fixture_set row names the set`, async () => {
  const now = new Date('2026-09-21T04:00:00.000Z');
  const result = await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
    now,
  });
  assert.equal(result.fixtureSet, SET);
  assert.deepEqual(
    [
      result.cases,
      result.drafts,
      result.slots,
      result.artifacts,
      result.blobsWritten + result.blobsDeduplicated,
    ],
    [5, 5, 45, 33, 33],
  );

  // cases
  const cases = await db.app.query.cases.findMany({ orderBy: (c, { asc }) => asc(c.registryId) });
  assert.deepEqual(
    cases.map((c) => c.registryId),
    ['RAI-2000-0001', 'RAI-2000-0002', 'RAI-2000-0003', 'RAI-2000-0004', 'RAI-2000-0005'],
  );
  const owner = findFixtureUser('fx-user-owner-cm')!;
  for (const fixtureCase of FIXTURE_CASES) {
    const row = cases.find((c) => c.id === fixtureCase.caseId);
    assert.ok(row, fixtureCase.fixtureCaseId);
    assert.equal(row.registryId, fixtureCase.registryId);
    assert.equal(row.ownerSubjectId, owner.subjectId);
    assert.equal(row.businessOwner, owner.displayName);
    assert.equal(row.createdBy, owner.subjectId);
    assert.equal(row.businessUnitId, fixtureCase.businessUnitId);
    assert.equal(row.businessUnit, fixtureCase.businessUnit);
    assert.equal(row.useCaseName, fixtureCase.useCaseName);
    assert.equal(row.vendorInvolved, fixtureCase.vendorInvolved);
    assert.equal(row.modelType, fixtureCase.modelType);
    assert.equal(row.useCaseGroup, fixtureCase.useCaseGroup);
    assert.equal(
      row.sourceRecordId,
      fixtureCase.sourceRecordId.kind === 'known' ? fixtureCase.sourceRecordId.value : 'Unknown',
    );
    assert.equal(row.draftVersionId, fixtureCase.draftVersionId);
    assert.equal(row.currentVersionId, null, 'never a submitted version');
    assert.equal(row.deskStatus, 'draft');
    assert.deepEqual(
      [row.privacyStatus, row.securityStatus, row.raiStatus, row.aiReadinessStatus, row.riskTier],
      ['pending', 'pending', 'pending', 'not_ready', null],
      'projections untouched',
    );
  }
  // the BU whose SPOC is the dual-role identity holds three cases; the dual-role user is bu_spoc of exactly that BU
  const dual = FIXTURE_USERS.find((u) => u.fixtureUserId === DUAL_ROLE_FIXTURE_USER_ID)!;
  const dualBu = dual.roles.find((r) => r.role === 'bu_spoc')!.scope;
  assert.equal(dualBu.kind, 'business_unit');
  const inDualBu = cases.filter(
    (c) => dualBu.kind === 'business_unit' && c.businessUnitId === dualBu.businessUnit,
  );
  assert.deepEqual(
    inDualBu.map((c) => c.registryId),
    ['RAI-2000-0002', 'RAI-2000-0004', 'RAI-2000-0005'],
  );

  // drafts: version 1, open, nothing submit-only set
  const versions = await db.app.query.packVersion.findMany();
  assert.equal(versions.length, 5);
  for (const v of versions) {
    const fixtureCase = FIXTURE_CASES.find((c) => c.draftVersionId === v.id);
    assert.ok(fixtureCase);
    assert.equal(v.caseId, fixtureCase.caseId);
    assert.equal(v.versionNumber, 1);
    assert.equal(v.parentVersionId, null);
    assert.equal(v.stageContext, fixtureCase.stageContext);
    assert.equal(v.checklistTemplateVersion, fixtureCase.checklistTemplateVersion);
    assert.equal(v.createdBy, owner.subjectId);
    for (const field of [
      v.submittedAt,
      v.submittedBy,
      v.submittedRole,
      v.configurationRevisionId,
      v.frozenConfiguration,
      v.laneMappingVersion,
      v.laneMapping,
      v.manifestHash,
      v.readyAt,
    ])
      assert.equal(field, null);
  }

  // slots: 45 rows, states and reasons as the table says, artifact only when attached
  const slots = await db.app.query.artifactSlot.findMany();
  assert.equal(slots.length, 45);
  const artifacts = await db.app.query.artifact.findMany();
  assert.equal(artifacts.length, 33);
  for (const fixtureCase of FIXTURE_CASES) {
    for (const [slotKey, disposition] of Object.entries(fixtureCase.slots)) {
      const slot = Number(slotKey);
      const row = slots.find((s) => s.versionId === fixtureCase.draftVersionId && s.slot === slot);
      assert.ok(row, `${fixtureCase.fixtureCaseId} slot ${slot}`);
      assert.equal(row.state, disposition.state);
      assert.equal(row.reason, storedReason(disposition));
      assert.equal(row.updatedBy, owner.subjectId);
      if (disposition.state === 'attached') {
        const document = FIXTURE_DOCUMENTS.find(
          (d) => d.fixtureDocumentId === disposition.fixtureDocumentId,
        )!;
        assert.equal(row.artifactId, document.artifactId);
        const artifact = artifacts.find((a) => a.id === document.artifactId);
        assert.ok(artifact);
        assert.equal(artifact.caseId, fixtureCase.caseId, 'case binding');
        assert.equal(artifact.filename, document.filename);
        assert.equal(artifact.mediaType, MEDIA_TYPE_BY_KIND[document.kind]);
        assert.equal(artifact.contentHash, manifest.documents[document.fixtureDocumentId]!.sha256);
        assert.equal(artifact.sizeBytes, manifest.documents[document.fixtureDocumentId]!.sizeBytes);
        assert.equal(artifact.uploadedBy, owner.subjectId);
        assert.equal(artifact.uploadedRole, 'owner');
        assert.equal(artifact.correlationId, result.correlationId);
        assert.equal(artifact.bytesState, 'present');
      } else assert.equal(row.artifactId, null);
    }
  }
  const nonVendorDefaults = slots.filter((s) => s.reason === NON_VENDOR_DEFAULT_REASON_KEY);
  assert.equal(nonVendorDefaults.length, 6, 'slots 3 and 4 of the three non-vendor cases');
  assert.ok(nonVendorDefaults.every((s) => s.slot === 3 || s.slot === 4));
  assert.equal(slots.filter((s) => s.state === 'missing').length, 1);
  assert.equal(slots.filter((s) => s.state === 'not_yet').length, 3);
  const thai = artifacts.find((a) => a.filename === 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf');
  assert.ok(thai, 'the Thai-named file is an artifact row, NFC');
  assert.equal(thai.filename, thai.filename.normalize('NFC'));

  // objects: every artifact's bytes are at sha256/<h[0:2]>/<h[2:4]>/<h>, hash to their key, are 0600
  for (const artifact of artifacts) {
    const file = blobKeyPath(blobDir, artifact.contentHash);
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.contentHash);
    assert.equal(bytes.length, artifact.sizeBytes);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  assert.equal((await stat(path.join(blobDir, 'sha256'))).mode & 0o777, 0o700);
  const medium = artifacts.find((a) => a.filename === 'DPA_PartnerVendor_signed.pdf')!;
  assert.ok(medium.sizeBytes > 2 * 1024 * 1024 - 1024, 'the medium document is about 2 MiB');

  // the generated output was written when absent
  assert.ok(
    (await stat(path.join(outputDir, 'fx-doc-0002-09', 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf'))).isFile(),
  );

  // fixture_set: the set identity, once
  const sets = await db.app.query.fixtureSet.findMany();
  assert.equal(sets.length, 1);
  assert.deepEqual(
    [sets[0]!.name, sets[0]!.version, sets[0]!.sha256, sets[0]!.correlationId],
    [manifest.name, manifest.version, manifest.sha256, result.correlationId],
  );
  assert.equal(sets[0]!.loadedAt.toISOString(), now.toISOString());

  // no fabricated trail: the only audit events are the seed's, and nothing else exists
  const events = await auditStore.read(db.app, {});
  assert.deepEqual([...new Set(events.map((e) => e.action))], ['configuration.published']);
  assert.ok(events.every((e) => e.correlationId === result.correlationId));
  assert.equal(await count('idempotency_key'), 0);
  assert.equal(await count('pack_version', 'WHERE submitted_at IS NOT NULL'), 0);
});

test(`${SET}: the loader refuses outside development/test, outside local-google/fixture and on a non-empty database; --reset is the way back`, async () => {
  const base = { blobDir, outputDir };
  await assert.rejects(
    loadFixtures(db.operator, { ...base, nodeEnv: 'production', identityMode: 'fixture' }),
    (err: unknown) => err instanceof FixturesRefused && /NODE_ENV=production/.test(err.message),
  );
  for (const mode of ['network', 'production', '']) {
    await assert.rejects(
      loadFixtures(db.operator, { ...base, nodeEnv: 'test', identityMode: mode }),
      (err: unknown) => err instanceof FixturesRefused && /RAI_IDENTITY_MODE=/.test(err.message),
    );
  }
  assert.deepEqual([...LOADER_IDENTITY_MODES], ['local-google', 'fixture']);
  assert.equal(await count('case'), 0, 'a refused load writes nothing');
  assert.equal(await count('configuration_revision'), 0);

  await loadFixtures(db.operator, { ...base, nodeEnv: 'test', identityMode: 'fixture' });
  await assert.rejects(
    loadFixtures(db.operator, { ...base, nodeEnv: 'development', identityMode: 'local-google' }),
    (err: unknown) => err instanceof FixturesRefused && /not empty/.test(err.message),
  );
  assert.equal(await count('case'), 5, 'the first load is untouched');
  assert.equal(await count('fixture_set'), 1);
});

test(`${SET}: loading again into a reset database against the same BLOB_DIR deduplicates every object by hash`, async () => {
  const first = await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
  });
  await db.reset();
  const second = await loadFixtures(db.operator, {
    nodeEnv: 'test',
    identityMode: 'fixture',
    blobDir,
    outputDir,
  });
  assert.equal(first.blobsWritten + first.blobsDeduplicated, 33);
  assert.deepEqual([second.blobsWritten, second.blobsDeduplicated], [0, 33]);
  assert.notEqual(first.correlationId, second.correlationId);
  assert.equal(await count('artifact'), 33);
});

test('rai_app cannot update or delete the fixture_set row (SELECT and INSERT only, like every business table)', async () => {
  await loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir, outputDir });
  const update = await db.raw('app', async (c) => {
    try {
      await c.query(`UPDATE fixture_set SET version = '99'`);
      return undefined;
    } catch (err) {
      return err as { code?: string };
    }
  });
  assert.equal(update?.code, '42501');
  const del = await db.raw('app', async (c) => {
    try {
      await c.query(`DELETE FROM fixture_set`);
      return undefined;
    } catch (err) {
      return err as { code?: string };
    }
  });
  assert.equal(del?.code, '42501');
});
