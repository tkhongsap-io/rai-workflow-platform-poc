// W6-02 (W6 plan sections 2.3 and 3): Admin configuration drafts, publish with a change note, and restore, on a real
// Postgres. A draft is a mutable working copy (`configuration_draft`, Q1) and never evidence; publishing copies it
// into an immutable `configuration_revision` (the W0-04 trigger still refuses every UPDATE); restore publishes a copy
// of an older body as N+1 with `restores_id` (Q3). Every draft write and publish is optimistic (Q5): a moved draft or
// a moved current revision is `ConfigurationChanged` (409 `configuration_changed` once W6-04 serves it).
// Synthetic values only.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { CONFIGURATION_DRAFT_MAX_BYTES } from '@rai/shared/schemas/configuration-admin';
import { auditStore } from '@rai/server/audit/store';
import { applyConfigurationSeed, CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import {
  ConfigurationBodyInvalid,
  ConfigurationChangeNoteInvalid,
  ConfigurationChanged,
  ConfigurationDraftRejected,
  ConfigurationRestoreCurrent,
  ConfigurationRevisionNotFound,
  discardDraft,
  latestRevision,
  listRevisions,
  publishDraft,
  publishRevision,
  readDraft,
  readRevisionById,
  restoreRevision,
  saveDraft,
  type ConfigurationRevisionRow,
} from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import {
  INSUFFICIENT_PRIVILEGE,
  RAISE_EXCEPTION,
  expectSqlError,
  openTestDatabase,
  type TestDatabase,
} from '../support/db.js';

let db: TestDatabase;
const T0 = new Date('2026-09-27T03:00:00.000Z');
const ADMIN = { subjectId: 'fixture:fx-user-admin', role: 'admin' } as const;
const CHECK_VIOLATION = '23514';

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

async function seed(): Promise<Record<string, ConfigurationRevisionRow>> {
  return withTransaction(db.app, (tx) =>
    applyConfigurationSeed(tx, { correlationId: randomUUID(), publishedAt: T0 }),
  );
}

const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(db.app, fn);
const base = () => ({ actor: ADMIN, correlationId: randomUUID(), at: tick() });

async function rejectsWith<E extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => E,
): Promise<E> {
  let caught: unknown;
  await promise.catch((err: unknown) => {
    caught = err;
  });
  assert.ok(caught instanceof type, `expected ${type.name}, got ${String(caught)}`);
  return caught;
}

test('saveDraft creates a draft (version 1) on the current revision, then updates it with an optimistic version', async () => {
  const seeded = await seed();
  const first = await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: seeded.sla!.id,
      expectedDraftVersion: null,
      body: { dpo: 4, ai_coe: 5, it_security: 5 },
      changeNote: 'DPO needs one more working day',
      ...base(),
    }),
  );
  assert.equal(first.kind, 'sla');
  assert.equal(first.draftVersion, 1);
  assert.equal(first.baseRevisionId, seeded.sla!.id);
  assert.equal(first.changeNote, 'DPO needs one more working day');
  assert.equal(first.updatedBy, ADMIN.subjectId);
  assert.equal(first.updatedRole, 'admin');

  const second = await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: seeded.sla!.id,
      expectedDraftVersion: 1,
      body: { dpo: 4, ai_coe: 6, it_security: 5 },
      ...base(),
    }),
  );
  assert.equal(second.draftVersion, 2);
  assert.equal(second.changeNote, null, 'a save without a note clears it');
  assert.deepEqual((await readDraft(db.app, 'sla'))?.body, { dpo: 4, ai_coe: 6, it_security: 5 });
  assert.equal(await readDraft(db.app, 'calendar'), undefined, 'one draft per kind');

  // Creating again, or updating from a stale version, is refused and names the state the server holds.
  for (const expectedDraftVersion of [null, 1]) {
    const err = await rejectsWith(
      inTx((tx) =>
        saveDraft(tx, {
          kind: 'sla',
          baseRevisionId: seeded.sla!.id,
          expectedDraftVersion,
          body: { dpo: 9, ai_coe: 9, it_security: 9 },
          ...base(),
        }),
      ),
      ConfigurationChanged,
    );
    assert.deepEqual(err.current, { revisionId: seeded.sla!.id, draftVersion: 2 });
  }
  // Updating a draft that does not exist is refused the same way.
  const missing = await rejectsWith(
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'calendar',
        baseRevisionId: seeded.calendar!.id,
        expectedDraftVersion: 3,
        body: {},
        ...base(),
      }),
    ),
    ConfigurationChanged,
  );
  assert.deepEqual(missing.current, { revisionId: seeded.calendar!.id, draftVersion: null });
  assert.equal((await readDraft(db.app, 'sla'))?.draftVersion, 2, 'refused saves changed nothing');

  const events = (await auditStore.read(db.app, {})).filter((e) => e.action === 'configuration.draft_saved');
  assert.equal(events.length, 2);
  assert.deepEqual(events[1]!.targetRef, { kind: 'sla', draft_version: 2 });
  assert.deepEqual(events[1]!.beforeRef, { draft_version: 1 });
  assert.deepEqual(events[1]!.afterRef, { draft_version: 2, base_configuration_revision_id: seeded.sla!.id });
  assert.equal(events[0]!.beforeRef, null);
  assert.equal(events[1]!.actorSubjectId, ADMIN.subjectId);
  assert.ok(
    !JSON.stringify(events).includes('working day'),
    'the change note is never in an audit ref (audit refs hold IDs only)',
  );
});

test('a draft saves any JSON object up to 64 KiB (Q18); a non-object, a larger body or a foreign base is refused', async () => {
  const seeded = await seed();
  const halfDone = await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: seeded.sla!.id,
      expectedDraftVersion: null,
      body: { dpo: 0 }, // invalid for publish; a draft keeps it
      ...base(),
    }),
  );
  assert.deepEqual(halfDone.body, { dpo: 0 });

  for (const body of [[], null, 'text', 3] as unknown[]) {
    const err = await rejectsWith(
      inTx((tx) =>
        saveDraft(tx, {
          kind: 'calendar',
          baseRevisionId: seeded.calendar!.id,
          expectedDraftVersion: null,
          body: body as Record<string, unknown>,
          ...base(),
        }),
      ),
      ConfigurationDraftRejected,
    );
    assert.equal(err.reason, 'not_an_object');
  }
  const big = { holidays: ['x'.repeat(CONFIGURATION_DRAFT_MAX_BYTES)] };
  const tooLarge = await rejectsWith(
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'calendar',
        baseRevisionId: seeded.calendar!.id,
        expectedDraftVersion: null,
        body: big,
        ...base(),
      }),
    ),
    ConfigurationDraftRejected,
  );
  assert.equal(tooLarge.reason, 'too_large');
  const foreign = await rejectsWith(
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'calendar',
        baseRevisionId: seeded.sla!.id, // a revision of another kind
        expectedDraftVersion: null,
        body: {},
        ...base(),
      }),
    ),
    ConfigurationDraftRejected,
  );
  assert.equal(foreign.reason, 'base_revision_unknown');
  const badNote = await rejectsWith(
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'calendar',
        baseRevisionId: seeded.calendar!.id,
        expectedDraftVersion: null,
        body: {},
        changeNote: 'x'.repeat(501),
        ...base(),
      }),
    ),
    ConfigurationChangeNoteInvalid,
  );
  assert.ok(badNote);
  assert.equal(await readDraft(db.app, 'calendar'), undefined);
});

test('discardDraft deletes the draft on the matching version only, and audits it', async () => {
  const seeded = await seed();
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'use_case_groups',
      baseRevisionId: seeded.use_case_groups!.id,
      expectedDraftVersion: null,
      body: { groups: ['customer-analytics'] },
      ...base(),
    }),
  );
  const stale = await rejectsWith(
    inTx((tx) => discardDraft(tx, { kind: 'use_case_groups', expectedDraftVersion: 2, ...base() })),
    ConfigurationChanged,
  );
  assert.deepEqual(stale.current, { revisionId: seeded.use_case_groups!.id, draftVersion: 1 });
  await inTx((tx) => discardDraft(tx, { kind: 'use_case_groups', expectedDraftVersion: 1, ...base() }));
  assert.equal(await readDraft(db.app, 'use_case_groups'), undefined);
  await rejectsWith(
    inTx((tx) => discardDraft(tx, { kind: 'use_case_groups', expectedDraftVersion: 1, ...base() })),
    ConfigurationChanged,
  );
  const events = (await auditStore.read(db.app, {})).filter(
    (e) => e.action === 'configuration.draft_discarded',
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]!.targetRef, { kind: 'use_case_groups', draft_version: 1 });
  assert.deepEqual(await listRevisions(db.app, 'use_case_groups').then((r) => r.length), 1, 'no revision');
});

test('publishDraft publishes N+1 with the change note, consumes the draft and audits configuration.published', async () => {
  const seeded = await seed();
  const rev1 = seeded.sla!;
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: rev1.id,
      expectedDraftVersion: null,
      body: { dpo: 4, ai_coe: 5, it_security: 5 },
      changeNote: 'draft note',
      ...base(),
    }),
  );
  const published = await inTx((tx) =>
    publishDraft(tx, {
      kind: 'sla',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: rev1.id,
      changeNote: 'DPO SLA to four working days (synthetic)',
      ...base(),
    }),
  );
  assert.equal(published.revisionNumber, 2);
  assert.equal(published.supersedesId, rev1.id);
  assert.equal(published.changeNote, 'DPO SLA to four working days (synthetic)', "the request's note wins");
  assert.equal(published.restoresId, null);
  assert.equal(published.publishedBy, ADMIN.subjectId);
  assert.deepEqual(published.body, { dpo: 4, ai_coe: 5, it_security: 5 });
  assert.equal(await readDraft(db.app, 'sla'), undefined, 'the draft is consumed');
  assert.equal((await latestRevision(db.app, 'sla'))?.id, published.id);
  assert.equal(rev1.changeNote, null, 'seed rows keep no note');

  const audit = (await auditStore.read(db.app, {})).filter(
    (e) => e.action === 'configuration.published' && e.afterRef !== null,
  );
  const last = audit.at(-1)!;
  assert.deepEqual(last.afterRef, { configuration_revision_id: published.id });
  assert.deepEqual(last.beforeRef, { configuration_revision_id: rev1.id });
  assert.equal(last.actorRole, 'admin');

  // A replayed publish finds the draft consumed (Q5).
  const replay = await rejectsWith(
    inTx((tx) =>
      publishDraft(tx, {
        kind: 'sla',
        expectedDraftVersion: 1,
        expectedCurrentRevisionId: rev1.id,
        changeNote: 'again',
        ...base(),
      }),
    ),
    ConfigurationChanged,
  );
  assert.deepEqual(replay.current, { revisionId: published.id, draftVersion: null });
  assert.equal((await listRevisions(db.app, 'sla')).length, 2);

  // Without a request note, the draft's note is used.
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'desk_controls',
      baseRevisionId: seeded.desk_controls!.id,
      expectedDraftVersion: null,
      body: { writesFrozen: true, mailPaused: false, qcPaused: false },
      changeNote: 'freeze writes for the synthetic drill',
      ...base(),
    }),
  );
  const desk = await inTx((tx) =>
    publishDraft(tx, {
      kind: 'desk_controls',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: seeded.desk_controls!.id,
      ...base(),
    }),
  );
  assert.equal(desk.changeNote, 'freeze writes for the synthetic drill');
  assert.deepEqual(desk.body, { writesFrozen: true, mailPaused: false, qcPaused: false });
});

test('publishDraft refuses a stale draft, a moved current revision, a moved base, a missing note and an invalid body', async () => {
  const seeded = await seed();
  const rev1 = seeded.sla!;
  const draft = () =>
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'sla',
        baseRevisionId: rev1.id,
        expectedDraftVersion: null,
        body: { dpo: 4, ai_coe: 5, it_security: 5 },
        ...base(),
      }),
    );
  await draft();
  const publish = (
    over: Partial<Parameters<typeof publishDraft>[1]> = {},
    note: string | null = 'synthetic change',
  ) =>
    inTx((tx) =>
      publishDraft(tx, {
        kind: 'sla',
        expectedDraftVersion: 1,
        expectedCurrentRevisionId: rev1.id,
        ...(note === null ? {} : { changeNote: note }),
        ...base(),
        ...over,
      }),
    );

  await rejectsWith(publish({ expectedDraftVersion: 2 }), ConfigurationChanged);
  await rejectsWith(publish({ expectedCurrentRevisionId: null }), ConfigurationChanged);
  await rejectsWith(publish({ expectedCurrentRevisionId: seeded.calendar!.id }), ConfigurationChanged);
  const noNote = await rejectsWith(publish({}, null), ConfigurationChangeNoteInvalid);
  assert.ok(noNote);
  await rejectsWith(publish({ changeNote: '   ' }), ConfigurationChangeNoteInvalid);
  assert.equal((await listRevisions(db.app, 'sla')).length, 1, 'nothing published');
  assert.equal((await readDraft(db.app, 'sla'))?.draftVersion, 1, 'the draft is kept');

  // An invalid body is refused on publish only (Q18) and the draft is kept.
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: rev1.id,
      expectedDraftVersion: 1,
      body: { dpo: 0, ai_coe: 5, it_security: 5 },
      ...base(),
    }),
  );
  await rejectsWith(publish({ expectedDraftVersion: 2 }), ConfigurationBodyInvalid);
  assert.equal((await listRevisions(db.app, 'sla')).length, 1);
  assert.equal((await readDraft(db.app, 'sla'))?.draftVersion, 2);

  // The base moved underneath the draft: another publish landed (here, directly through the store).
  const other = await inTx((tx) =>
    publishRevision(tx, {
      kind: 'sla',
      body: { dpo: 3, ai_coe: 4, it_security: 5 },
      publishedBy: ADMIN.subjectId,
      publishedRole: 'admin',
      correlationId: randomUUID(),
      publishedAt: tick(),
      changeNote: 'someone else',
    }),
  );
  const moved = await rejectsWith(
    publish({ expectedDraftVersion: 2, expectedCurrentRevisionId: other.id }),
    ConfigurationChanged,
  );
  assert.deepEqual(moved.current, { revisionId: other.id, draftVersion: 2 });

  // A registered kind without a body schema (group_role_mapping until W6-11) can be drafted but not published.
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'group_role_mapping',
      baseRevisionId: null,
      expectedDraftVersion: null,
      body: { kind: 'identity.group_role_mapping' },
      ...base(),
    }),
  );
  await rejectsWith(
    inTx((tx) =>
      publishDraft(tx, {
        kind: 'group_role_mapping',
        expectedDraftVersion: 1,
        expectedCurrentRevisionId: null,
        changeNote: 'synthetic mapping',
        ...base(),
      }),
    ),
    ConfigurationBodyInvalid,
  );
  assert.equal((await listRevisions(db.app, 'group_role_mapping')).length, 0);
});

test('restoreRevision publishes a copy of revision K as N+1 with restores_id; the draft is kept; K in force is refused', async () => {
  const seeded = await seed();
  const rev1 = seeded.sla!;
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: rev1.id,
      expectedDraftVersion: null,
      body: { dpo: 4, ai_coe: 5, it_security: 5 },
      ...base(),
    }),
  );
  const rev2 = await inTx((tx) =>
    publishDraft(tx, {
      kind: 'sla',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: rev1.id,
      changeNote: 'four days',
      ...base(),
    }),
  );
  // A draft started on revision 2 exists while the restore runs.
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: rev2.id,
      expectedDraftVersion: null,
      body: { dpo: 5, ai_coe: 5, it_security: 5 },
      ...base(),
    }),
  );

  const restore = (over: Partial<Parameters<typeof restoreRevision>[1]> = {}) =>
    inTx((tx) =>
      restoreRevision(tx, {
        kind: 'sla',
        revisionId: rev1.id,
        expectedCurrentRevisionId: rev2.id,
        changeNote: 'back to the D01 values',
        ...base(),
        ...over,
      }),
    );
  await rejectsWith(restore({ expectedCurrentRevisionId: rev1.id }), ConfigurationChanged);
  await rejectsWith(restore({ changeNote: '' }), ConfigurationChangeNoteInvalid);
  await rejectsWith(restore({ revisionId: seeded.calendar!.id }), ConfigurationRevisionNotFound);
  await rejectsWith(restore({ revisionId: randomUUID() }), ConfigurationRevisionNotFound);
  await rejectsWith(restore({ revisionId: rev2.id }), ConfigurationRestoreCurrent);
  assert.equal((await listRevisions(db.app, 'sla')).length, 2, 'refusals wrote nothing');

  const rev3 = await restore();
  assert.equal(rev3.revisionNumber, 3);
  assert.equal(rev3.restoresId, rev1.id);
  assert.equal(rev3.supersedesId, rev2.id);
  assert.equal(rev3.changeNote, 'back to the D01 values');
  assert.deepEqual(rev3.body, rev1.body);
  assert.deepEqual(rev3.body, CONFIGURATION_SEED.sla);
  assert.deepEqual(await readRevisionById(db.app, rev1.id), rev1, 'revision K is untouched');

  const audit = (await auditStore.read(db.app, {})).filter((e) => e.action === 'configuration.published');
  assert.deepEqual(audit.at(-1)!.afterRef, {
    configuration_revision_id: rev3.id,
    restores_configuration_revision_id: rev1.id,
  });

  // The draft is kept; its base (revision 2) is now stale, so publishing it is refused until it is rebased.
  const kept = await readDraft(db.app, 'sla');
  assert.equal(kept?.baseRevisionId, rev2.id);
  await rejectsWith(
    inTx((tx) =>
      publishDraft(tx, {
        kind: 'sla',
        expectedDraftVersion: 1,
        expectedCurrentRevisionId: rev3.id,
        changeNote: 'stale base',
        ...base(),
      }),
    ),
    ConfigurationChanged,
  );
  // Restoring revision 3 (now in force) is refused; restoring revision 2 again is allowed and is N+1.
  await rejectsWith(
    restore({ revisionId: rev3.id, expectedCurrentRevisionId: rev3.id }),
    ConfigurationRestoreCurrent,
  );
  const rev4 = await restore({ revisionId: rev2.id, expectedCurrentRevisionId: rev3.id });
  assert.equal(rev4.revisionNumber, 4);
  assert.equal(rev4.restoresId, rev2.id);
});

test('after the migration the trigger still refuses UPDATE of a revision; rai_app may delete a draft and nothing else', async () => {
  const seeded = await seed();
  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: seeded.sla!.id,
      expectedDraftVersion: null,
      body: { dpo: 4, ai_coe: 5, it_security: 5 },
      ...base(),
    }),
  );
  const rev2 = await inTx((tx) =>
    publishDraft(tx, {
      kind: 'sla',
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: seeded.sla!.id,
      changeNote: 'note',
      ...base(),
    }),
  );
  const ownerUpdate = await expectSqlError(
    db,
    'owner',
    `UPDATE configuration_revision SET change_note = 'rewritten' WHERE id = $1`,
    [rev2.id],
  );
  assert.equal(ownerUpdate?.code, RAISE_EXCEPTION);
  assert.equal(ownerUpdate?.message, 'rai.frozen_revision');
  const appUpdate = await expectSqlError(
    db,
    'app',
    `UPDATE configuration_revision SET change_note = 'rewritten' WHERE id = $1`,
    [rev2.id],
  );
  assert.equal(appUpdate?.code, INSUFFICIENT_PRIVILEGE);
  const appDelete = await expectSqlError(db, 'app', `DELETE FROM configuration_revision WHERE id = $1`, [
    rev2.id,
  ]);
  assert.equal(appDelete?.code, INSUFFICIENT_PRIVILEGE);
  assert.equal((await readRevisionById(db.app, rev2.id))?.changeNote, 'note');

  // The change-note CHECK holds below the store too (1-500 characters, or NULL on seed rows).
  const tooLong = await expectSqlError(
    db,
    'owner',
    `INSERT INTO configuration_revision (id, kind, revision_number, body, published_by, published_at, activation_rule, change_note)
     VALUES ($1, 'sla', 99, '{}'::jsonb, 'system', now(), 'after_publish', $2)`,
    [randomUUID(), 'x'.repeat(501)],
  );
  assert.equal(tooLong?.code, CHECK_VIOLATION);
  const unknownKind = await expectSqlError(
    db,
    'owner',
    `INSERT INTO configuration_draft (kind, body, draft_version, updated_by, updated_role, updated_at)
     VALUES ('lane_mapping', '{}'::jsonb, 1, 'system', 'system', now())`,
  );
  assert.equal(unknownKind?.code, CHECK_VIOLATION, 'the lane mapping is never configuration (D02)');

  await inTx((tx) =>
    saveDraft(tx, {
      kind: 'calendar',
      baseRevisionId: seeded.calendar!.id,
      expectedDraftVersion: null,
      body: {},
      ...base(),
    }),
  );
  await db.raw('app', (c) => c.query(`DELETE FROM configuration_draft WHERE kind = 'calendar'`));
  assert.equal(await readDraft(db.app, 'calendar'), undefined, 'rai_app holds DELETE on configuration_draft');
  const count = await db.owner.execute(sql`SELECT count(*)::int AS n FROM configuration_revision`);
  assert.ok((count.rows[0] as { n: number }).n >= 8);
});

test('a change note is measured in characters, as the CHECK measures it (char_length), not UTF-16 units', async () => {
  // Round-1 review note: 500 astral characters (1000 UTF-16 units) are 500 characters to Postgres, so the store
  // accepts and publishes them; 501 are refused by the store before the CHECK would refuse them.
  const seeded = await seed();
  const astral = '\u{1F4DD}';
  const draft = await inTx((tx) =>
    saveDraft(tx, {
      kind: 'sla',
      baseRevisionId: seeded.sla!.id,
      expectedDraftVersion: null,
      body: CONFIGURATION_SEED.sla,
      changeNote: astral.repeat(500),
      ...base(),
    }),
  );
  const published = await inTx((tx) =>
    publishDraft(tx, {
      kind: 'sla',
      expectedDraftVersion: draft.draftVersion,
      expectedCurrentRevisionId: seeded.sla!.id,
      ...base(),
    }),
  );
  assert.equal(published.changeNote, astral.repeat(500));
  await rejectsWith(
    inTx((tx) =>
      saveDraft(tx, {
        kind: 'calendar',
        baseRevisionId: seeded.calendar!.id,
        expectedDraftVersion: null,
        body: {},
        changeNote: astral.repeat(501),
        ...base(),
      }),
    ),
    ConfigurationChangeNoteInvalid,
  );
});
