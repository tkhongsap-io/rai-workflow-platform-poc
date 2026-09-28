// W1-00 Done when: a published configuration revision cannot be updated or deleted and is read back by ID unchanged
// after a later revision is published (W0-04 configuration_revision; L12). Also: the seed values, the provisional
// activation rule against the real store, body validation on write, and the fixture loader's refusals.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as configurationStore from '@rai/server/configuration/store';
import {
  ConfigurationBodyInvalid,
  currentBody,
  currentRevision,
  effectiveConfiguration,
  listRevisions,
  publishRevision,
  readRevisionById,
  type ConfigurationRevisionRow,
} from '@rai/server/configuration/store';
import { CONFIGURATION_SEED, SEED_KINDS, applyConfigurationSeed } from '@rai/server/configuration/seed';
import { auditStore } from '@rai/server/audit/store';
import { withTransaction } from '@rai/server/db/transaction';
import { FixturesRefused, loadFixtures } from '@rai/fixtures/load';
import { FIXTURE_OPERATOR_RECIPIENT } from '@rai/fixtures/data/users';
import {
  INSUFFICIENT_PRIVILEGE,
  RAISE_EXCEPTION,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';

let db: TestDatabase;
const T0 = new Date('2026-09-21T03:00:00.000Z');

before(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await db.reset();
});
after(async () => {
  await db.close();
});

async function seed(publishedAt: Date = T0): Promise<Record<string, ConfigurationRevisionRow>> {
  return withTransaction(db.app, (tx) =>
    applyConfigurationSeed(tx, { correlationId: randomUUID(), publishedAt }),
  );
}

test('the seed publishes one revision per kind with the recorded values (D01, D06, D11, W0-08) as rai_app', async () => {
  const published = await seed();
  assert.deepEqual(Object.keys(published).sort(), [...SEED_KINDS].sort());
  for (const kind of SEED_KINDS) {
    const row = published[kind]!;
    assert.equal(row.revisionNumber, 1);
    assert.equal(row.activationRule, 'after_publish');
    assert.equal(row.supersedesId, null);
    assert.equal(row.publishedBy, 'system');
    assert.deepEqual(row.body, CONFIGURATION_SEED[kind]);
  }
  assert.deepEqual(await currentBody(db.app, 'sla', new Date(T0.getTime() + 1)), {
    dpo: 3,
    ai_coe: 5,
    it_security: 5,
  });
  assert.deepEqual(await currentBody(db.app, 'operator_recipients', new Date(T0.getTime() + 1)), {
    addresses: [FIXTURE_OPERATOR_RECIPIENT],
  });
  const calendar = await currentBody(db.app, 'calendar', new Date(T0.getTime() + 1));
  assert.equal(calendar?.timezone, 'Asia/Bangkok');
  assert.deepEqual(await currentBody(db.app, 'checklist_templates', new Date(T0.getTime() + 1)), {
    versions: ['v1.0 Sheet3', 'v2.0'],
  });
  // W5-02: the risk_rubric placeholder (a SYNTHETIC PLACEHOLDER for D07, never the approved instrument).
  const rubric = await currentBody(db.app, 'risk_rubric', new Date(T0.getTime() + 1));
  assert.equal(rubric?.label, 'synthetic-placeholder.1');
  assert.equal(rubric?.provenance, 'synthetic_placeholder');
  // one configuration.published audit event per kind, written in the same transaction
  const events = await auditStore.read(db.app, {});
  assert.deepEqual(
    events.map((e) => e.action),
    SEED_KINDS.map(() => 'configuration.published'),
  );
  assert.ok(events.every((e) => e.actorSubjectId === 'system' && e.actorRole === 'system'));
});

test('a published revision reads back by ID unchanged after a later revision of the same kind is published', async () => {
  const published = await seed();
  const first = published.sla!;
  const snapshot = structuredClone(await readRevisionById(db.app, first.id));
  assert.ok(snapshot);

  const second = await withTransaction(db.app, (tx) =>
    publishRevision(tx, {
      kind: 'sla',
      body: { dpo: 2, ai_coe: 4, it_security: 4 },
      publishedBy: 'fixture:fx-user-admin',
      publishedRole: 'admin',
      correlationId: randomUUID(),
      publishedAt: new Date(T0.getTime() + 60_000),
    }),
  );
  assert.equal(second.revisionNumber, 2);
  assert.equal(second.supersedesId, first.id);

  const again = await readRevisionById(db.app, first.id);
  assert.deepEqual(again, snapshot, 'revision 1 is byte-for-byte what it was before revision 2 existed');
  const history = await listRevisions(db.app, 'sla');
  assert.deepEqual(
    history.map((r) => r.revisionNumber),
    [2, 1],
  );

  // Provisional activation rule: revision 2 applies to submissions after its publish time; revision 1 before that.
  assert.equal((await currentRevision(db.app, 'sla', new Date(T0.getTime() + 30_000)))?.id, first.id);
  assert.equal(
    (await currentRevision(db.app, 'sla', new Date(T0.getTime() + 60_000)))?.id,
    first.id,
    'not at the exact instant',
  );
  assert.equal((await currentRevision(db.app, 'sla', new Date(T0.getTime() + 60_001)))?.id, second.id);
  assert.equal(
    await currentRevision(db.app, 'sla', T0),
    undefined,
    'nothing applies before the seed instant',
  );
});

test('a published revision cannot be updated or deleted: rai_app lacks the grant, rai_owner hits the trigger', async () => {
  const published = await seed();
  const id = published.calendar!.id;
  const before = await readRevisionById(db.app, id);

  const appUpdate = await expectSqlError(
    db,
    'app',
    `UPDATE configuration_revision SET body = '{"timezone":"Asia/Bangkok","holidays":[]}' WHERE id = $1`,
    [id],
  );
  assert.equal(appUpdate?.code, INSUFFICIENT_PRIVILEGE, 'rai_app has no UPDATE grant');
  const appDelete = await expectSqlError(db, 'app', `DELETE FROM configuration_revision WHERE id = $1`, [id]);
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE, 'rai_app has no DELETE grant');
  const appTruncate = await expectSqlError(db, 'app', `TRUNCATE configuration_revision`);
  assert.equal(appTruncate?.code, INSUFFICIENT_PRIVILEGE, 'rai_app has no TRUNCATE grant');

  const ownerUpdate = await expectSqlError(
    db,
    'owner',
    `UPDATE configuration_revision SET revision_number = 99 WHERE id = $1`,
    [id],
  );
  assert.equal(ownerUpdate?.code, RAISE_EXCEPTION);
  assert.equal(ownerUpdate?.message, 'rai.frozen_revision');
  const ownerDelete = await expectSqlError(db, 'owner', `DELETE FROM configuration_revision WHERE id = $1`, [
    id,
  ]);
  assert.equal(ownerDelete?.code, RAISE_EXCEPTION);
  assert.equal(ownerDelete?.message, 'rai.frozen_revision');

  assert.deepEqual(await readRevisionById(db.app, id), before, 'nothing changed');
});

test('the configuration module exports publish and read functions only; no update or delete path exists', () => {
  const exported = Object.entries(configurationStore)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name);
  for (const name of exported)
    assert.doesNotMatch(name, /update|delete|remove|purge|truncate|unpublish/i, name);
  assert.ok(exported.includes('publishRevision') && exported.includes('readRevisionById'));
});

test('bodies are validated on write against the shared schema; a kind without a schema cannot be published', async () => {
  await assert.rejects(
    withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'sla',
        body: { dpo: 0, ai_coe: 5, it_security: 5 },
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
      }),
    ),
    ConfigurationBodyInvalid,
  );
  await assert.rejects(
    withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'group_role_mapping' as never, // W6-11 registered the mapping (never seeded): an empty body is invalid
        body: {} as never,
        publishedBy: 'system',
        publishedRole: 'system',
        correlationId: randomUUID(),
      }),
    ),
    ConfigurationBodyInvalid,
  );
  // W5-02: risk_rubric is validated by its schema and by riskRubricBodyProblems (W5 plan section 2).
  const duplicate = structuredClone(CONFIGURATION_SEED.risk_rubric);
  duplicate.questions[1] = { ...duplicate.questions[1]!, questionId: 'RQ1' };
  for (const body of [duplicate, { ...CONFIGURATION_SEED.risk_rubric, provenance: 'd07_recorded' }])
    await assert.rejects(
      withTransaction(db.app, (tx) =>
        publishRevision(tx, {
          kind: 'risk_rubric',
          body: body as never,
          publishedBy: 'system',
          publishedRole: 'system',
          correlationId: randomUUID(),
        }),
      ),
      ConfigurationBodyInvalid,
    );
  assert.deepEqual(await listRevisions(db.app, 'sla'), [], 'a rejected publish writes nothing');
  assert.deepEqual(await listRevisions(db.app, 'risk_rubric'), []);
  assert.deepEqual(await auditStore.read(db.app, {}), [], 'and no audit event');
});

test('effectiveConfiguration is the W0-02 7.3 ConfigurationView built from the revisions in force', async () => {
  await seed();
  const view = await effectiveConfiguration(db.app, new Date(T0.getTime() + 1));
  assert.deepEqual(view.useCaseGroups, ['customer-analytics', 'customer-service', 'field-operations']);
  assert.deepEqual(view.checklistTemplateVersions, ['v1.0 Sheet3', 'v2.0']);
  assert.deepEqual(view.slaWorkingDays, { ai_coe: 5, dpo: 3, it_security: 5 });
  assert.equal(view.timezone, 'Asia/Bangkok');
  assert.equal(view.publishedAt, T0.toISOString());
  await assert.rejects(effectiveConfiguration(db.app, T0), /no published use_case_groups/);
});

test('fixtures:load seeds an empty database in test/development and refuses otherwise', async () => {
  // W1-09 extended the loader with cases and objects; it now also needs the identity mode and a BLOB_DIR.
  const blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-00-blobs-'));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-00-fixtures-'));
  const base = { identityMode: 'fixture', blobDir, outputDir };
  await assert.rejects(loadFixtures(db.operator, { ...base, nodeEnv: 'production' }), FixturesRefused);
  const result = await loadFixtures(db.operator, {
    ...base,
    nodeEnv: 'test',
    now: new Date(T0.getTime() + 1000),
  });
  assert.deepEqual([...result.publishedKinds].sort(), [...SEED_KINDS].sort());
  assert.equal(
    (await currentRevision(db.app, 'sla', new Date(T0.getTime() + 1000)))?.revisionNumber,
    1,
    'published one second in the past',
  );
  await assert.rejects(loadFixtures(db.operator, { ...base, nodeEnv: 'test' }), /not empty/);
});
