// W6-03 (W6 plan section 2.4): the cross-kind and registry checks run on the Admin paths only. `publishDraft` and
// `restoreRevision` refuse what `publishProblems` refuses (nothing is written, the draft is kept); `publishRevision`,
// which the seed, fixtures and the w4-02 and w3-03b suites call directly, keeps exactly its W6-02 checks.
// Synthetic values only.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyConfigurationSeed, CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import {
  ConfigurationBodyInvalid,
  listRevisions,
  publishDraft,
  publishRevision,
  readDraft,
  restoreRevision,
  saveDraft,
  type ConfigurationRevisionRow,
} from '@rai/server/configuration/store';
import type { ConfigurationKind } from '@rai/shared/schemas/cases';
import { withTransaction } from '@rai/server/db/transaction';
import { openTestDatabase, type TestDatabase } from '../support/db.js';

let db: TestDatabase;
const T0 = new Date('2026-09-27T03:00:00.000Z');
const ADMIN = { subjectId: 'fixture:fx-user-admin', role: 'admin' } as const;
let clock = T0.getTime();
const tick = () => new Date((clock += 1000));

before(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await db.reset();
  clock = T0.getTime();
});
after(async () => {
  await db.close();
});

const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(db.app, fn);
const base = () => ({ actor: ADMIN, correlationId: randomUUID(), at: tick() });
const seed = (): Promise<Record<string, ConfigurationRevisionRow>> =>
  inTx((tx) => applyConfigurationSeed(tx, { correlationId: randomUUID(), publishedAt: T0 }));

async function refused(promise: Promise<unknown>): Promise<string[]> {
  let caught: unknown;
  await promise.catch((err: unknown) => {
    caught = err;
  });
  assert.ok(
    caught instanceof ConfigurationBodyInvalid,
    `expected ConfigurationBodyInvalid, got ${String(caught)}`,
  );
  return caught.problems;
}

/** Saves a draft of `kind` on the current revision and publishes it through the Admin path. */
async function adminPublish(kind: ConfigurationKind, body: object, current: string) {
  const expectedDraftVersion = (await readDraft(db.app, kind))?.draftVersion ?? null;
  const draft = await inTx((tx) =>
    saveDraft(tx, {
      kind,
      baseRevisionId: current,
      expectedDraftVersion,
      body: body as Record<string, unknown>,
      ...base(),
    }),
  );
  return inTx((tx) =>
    publishDraft(tx, {
      kind,
      expectedDraftVersion: draft.draftVersion,
      expectedCurrentRevisionId: current,
      changeNote: `synthetic ${kind} change`,
      ...base(),
    }),
  );
}

test('publishDraft refuses an unimplemented rule, an isolated band rule and an uncovered template; the draft is kept', async () => {
  const seeded = await seed();
  const catalogue = structuredClone(CONFIGURATION_SEED.qc_rules);
  catalogue.templates['v2.0']!.rules.push(
    { ruleId: 'ACC-NOT-BUILT', engine: 'content', triggers: ['approve_attempt'], severity: 'low' },
    { ruleId: 'ACC-BAND-V1-SHEET3', engine: 'content', triggers: ['approve_attempt'], severity: 'high' },
  );
  const problems = await refused(adminPublish('qc_rules', catalogue, seeded.qc_rules!.id));
  assert.deepEqual(
    problems.map((p) => / ([a-z_]+): /.exec(p)?.[1]),
    ['rule_not_implemented', 'rule_template_isolated'],
  );
  assert.equal((await listRevisions(db.app, 'qc_rules')).length, 1, 'nothing published');
  assert.equal((await readDraft(db.app, 'qc_rules'))?.draftVersion, 1, 'the draft is kept');

  const templates = await refused(
    adminPublish(
      'checklist_templates',
      { versions: ['v1.0 Sheet3', 'v2.0', 'v3.0'] },
      seeded.checklist_templates!.id,
    ),
  );
  assert.equal(templates.length, 1);
  assert.match(templates[0]!, /^\/versions\/2 template_not_in_catalogue: v3\.0/);
  assert.equal((await listRevisions(db.app, 'checklist_templates')).length, 1);
});

test('adding a template publishes in the order qc_rules first, then checklist_templates', async () => {
  const seeded = await seed();
  const catalogue = structuredClone(CONFIGURATION_SEED.qc_rules);
  catalogue.label = 'w6-03.synthetic';
  catalogue.templates['v3.0'] = structuredClone(catalogue.templates['v2.0']!);
  const rules = await adminPublish('qc_rules', catalogue, seeded.qc_rules!.id);
  assert.equal(rules.revisionNumber, 2);
  const templates = await adminPublish(
    'checklist_templates',
    { versions: ['v1.0 Sheet3', 'v2.0', 'v3.0'] },
    seeded.checklist_templates!.id,
  );
  assert.equal(templates.revisionNumber, 2);
  // Now the catalogue may not drop v3.0 again while checklist_templates lists it.
  const dropped = structuredClone(catalogue);
  delete dropped.templates['v3.0'];
  const problems = await refused(adminPublish('qc_rules', dropped, rules.id));
  assert.match(problems[0]!, /^\/templates catalogue_missing_template: .*v3\.0/);
});

test('restoreRevision refuses a revision whose body fails the cross-kind checks today', async () => {
  const seeded = await seed();
  // The seed's checklist_templates (rev 1) is restorable while the catalogue covers it ...
  const extended = structuredClone(CONFIGURATION_SEED.qc_rules);
  extended.templates['v3.0'] = structuredClone(extended.templates['v2.0']!);
  const rules2 = await adminPublish('qc_rules', extended, seeded.qc_rules!.id);
  const templates2 = await adminPublish(
    'checklist_templates',
    { versions: ['v1.0 Sheet3', 'v2.0', 'v3.0'] },
    seeded.checklist_templates!.id,
  );
  // ... but restoring the seed catalogue (rev 1, no v3.0) would leave v3.0 uncovered, so it is refused.
  const problems = await refused(
    inTx((tx) =>
      restoreRevision(tx, {
        kind: 'qc_rules',
        revisionId: seeded.qc_rules!.id,
        expectedCurrentRevisionId: rules2.id,
        changeNote: 'back to w4a.1',
        ...base(),
      }),
    ),
  );
  assert.match(problems[0]!, /catalogue_missing_template/);
  assert.equal((await listRevisions(db.app, 'qc_rules')).length, 2, 'nothing written');
  // Restoring the templates first, then the catalogue, is accepted.
  const templates3 = await inTx((tx) =>
    restoreRevision(tx, {
      kind: 'checklist_templates',
      revisionId: seeded.checklist_templates!.id,
      expectedCurrentRevisionId: templates2.id,
      changeNote: 'drop v3.0',
      ...base(),
    }),
  );
  assert.equal(templates3.restoresId, seeded.checklist_templates!.id);
  const rules3 = await inTx((tx) =>
    restoreRevision(tx, {
      kind: 'qc_rules',
      revisionId: seeded.qc_rules!.id,
      expectedCurrentRevisionId: rules2.id,
      changeNote: 'back to w4a.1',
      ...base(),
    }),
  );
  assert.deepEqual(rules3.body, CONFIGURATION_SEED.qc_rules);
});

test('an Admin publish of a real recipient is refused while mail is a sink; publishRevision keeps accepting it', async () => {
  const seeded = await seed();
  for (const mailMode of [undefined, 'sink-file', 'sink-memory'] as const) {
    const draft = await readDraft(db.app, 'operator_recipients');
    const saved = await inTx((tx) =>
      saveDraft(tx, {
        kind: 'operator_recipients',
        baseRevisionId: seeded.operator_recipients!.id,
        expectedDraftVersion: draft?.draftVersion ?? null,
        body: { addresses: ['external@real.com'] },
        ...base(),
      }),
    );
    const problems = await refused(
      inTx((tx) =>
        publishDraft(tx, {
          kind: 'operator_recipients',
          expectedDraftVersion: saved.draftVersion,
          expectedCurrentRevisionId: seeded.operator_recipients!.id,
          changeNote: 'real address (refused)',
          ...(mailMode === undefined ? {} : { mailMode }),
          ...base(),
        }),
      ),
    );
    assert.deepEqual(
      problems.map((p) => p.split(':')[0]),
      ['/addresses/0 recipient_not_synthetic'],
    );
  }
  assert.equal((await listRevisions(db.app, 'operator_recipients')).length, 1);
  // The store path the w3-03b digest suite uses on purpose is unchanged (section 2.4, round 3).
  const direct = await inTx((tx) =>
    publishRevision(tx, {
      kind: 'operator_recipients',
      body: { addresses: ['external@real.com'] },
      publishedBy: 'system',
      publishedRole: 'system',
      correlationId: randomUUID(),
      publishedAt: tick(),
    }),
  );
  assert.equal(direct.revisionNumber, 2);
});

test('publishRevision still takes a partial catalogue and templates before qc_rules (seed and w4-02 paths)', async () => {
  await inTx(async (tx) => {
    await publishRevision(tx, {
      kind: 'checklist_templates',
      body: { versions: ['v1.0 Sheet3', 'v2.0'] },
      publishedBy: 'system',
      publishedRole: 'system',
      correlationId: randomUUID(),
      publishedAt: tick(),
    });
    const partial = structuredClone(CONFIGURATION_SEED.qc_rules);
    partial.label = 'w4a.partial';
    delete partial.templates['v2.0'];
    await publishRevision(tx, {
      kind: 'qc_rules',
      body: partial,
      publishedBy: 'system',
      publishedRole: 'system',
      correlationId: randomUUID(),
      publishedAt: tick(),
    });
  });
  assert.equal((await listRevisions(db.app, 'qc_rules')).length, 1);
});

test('concurrent Admin publishes of qc_rules and checklist_templates are serialized, so no version is left uncovered', async () => {
  const seeded = await seed();
  // qc_rules revision 2 covers v3.0; checklist_templates still lists v1.0 Sheet3 and v2.0.
  const extended = structuredClone(CONFIGURATION_SEED.qc_rules);
  extended.templates['v3.0'] = structuredClone(extended.templates['v2.0']!);
  const rules2 = await adminPublish('qc_rules', extended, seeded.qc_rules!.id);
  // Two drafts, each valid against what is in force now: A adds v3.0 to the templates, B drops v3.0 from the catalogue.
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'checklist_templates',
      baseRevisionId: seeded.checklist_templates!.id,
      expectedDraftVersion: null,
      body: { versions: ['v1.0 Sheet3', 'v2.0', 'v3.0'] },
      ...base(),
    }),
  );
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'qc_rules',
      baseRevisionId: rules2.id,
      expectedDraftVersion: null,
      body: structuredClone(CONFIGURATION_SEED.qc_rules),
      ...base(),
    }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let published!: () => void;
  const aPublished = new Promise<void>((resolve) => (published = resolve));
  const a = inTx(async (tx) => {
    const row = await publishDraft(tx, {
      kind: 'checklist_templates',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: seeded.checklist_templates!.id,
      changeNote: 'add v3.0',
      ...base(),
    });
    published();
    await gate; // A holds its locks, uncommitted, until released
    return row;
  });
  await aPublished;
  let bSettled = false;
  const b = inTx((tx) =>
    publishDraft(tx, {
      kind: 'qc_rules',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: rules2.id,
      changeNote: 'drop v3.0',
      ...base(),
    }),
  ).finally(() => {
    bSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(bSettled, false, 'B waits on the coverage lock while A is uncommitted');
  } finally {
    release(); // never leave A's transaction open, even when the assertion fails
    await a;
  }
  const problems = await refused(b);
  assert.match(problems[0]!, /^\/templates catalogue_missing_template: .*v3\.0/);
  assert.equal((await listRevisions(db.app, 'qc_rules')).length, 2);
});
