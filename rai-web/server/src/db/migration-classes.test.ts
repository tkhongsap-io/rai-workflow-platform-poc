// W7-03 (W7 plan section 3.3; W0-04 "Schema evolution"): every migration in server/drizzle/ has a rollback class,
// and every migration from W7-03's own on carries a header `-- rollback expectation: <class>;` equal to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_FOLDER } from './migrate.js';
import {
  MIGRATION_CLASSES,
  ROLLBACK_CLASSES,
  headerRollbackClass,
  isRollbackClass,
} from './migration-classes.js';

const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
};
const tags = journal.entries.map((entry) => entry.tag);

test('the three W0-04 rollback classes, and nothing else, are classes', () => {
  assert.deepEqual([...ROLLBACK_CLASSES], ['additive', 'restore-required', 'copy-forward']);
  for (const value of ROLLBACK_CLASSES) assert.equal(isRollbackClass(value), true);
  for (const value of ['forward repair only', 'forward', '', 'Additive', 'additive;'])
    assert.equal(isRollbackClass(value), false);
});

test('every migration in the folder has a class, and every class names a migration in the folder', () => {
  for (const tag of tags) assert.ok(isRollbackClass(MIGRATION_CLASSES[tag]), `no class for ${tag}`);
  assert.deepEqual(Object.keys(MIGRATION_CLASSES).sort(), [...tags].sort());
});

test('W7-D9: 0000-0006 and 0008 additive, 0007 and 0009 restore-required, the W7-03 migration additive', () => {
  const byNumber = (n: string) => MIGRATION_CLASSES[tags.find((tag) => tag.startsWith(`${n}_`))!];
  for (const n of ['0000', '0001', '0002', '0003', '0004', '0005', '0006', '0008'])
    assert.equal(byNumber(n), 'additive', n);
  assert.equal(byNumber('0007'), 'restore-required');
  assert.equal(byNumber('0009'), 'restore-required');
  assert.equal(MIGRATION_CLASSES['0010_w5_03_risk'], 'restore-required', 'W5-03, as its header says');
  const w703 = tags.find((tag) => tag.endsWith('_w7_03_migration_class'));
  assert.ok(w703, 'the W7-03 migration is in the folder');
  assert.equal(MIGRATION_CLASSES[w703], 'additive');
  // W4-11b (0012 after W7-03, 0013 after W6-02): nine nullable columns and five CHECKs, no trigger, grant or default.
  const w411b = tags.find((tag) => tag.endsWith('_w4_11b_run_extraction_identity'));
  assert.ok(w411b, 'the W4-11b migration is in the folder');
  assert.equal(MIGRATION_CLASSES[w411b], 'additive');
});

test('from W7-03 on, a migration header states its class with one of the three values', () => {
  const first = tags.findIndex((tag) => tag.endsWith('_w7_03_migration_class'));
  assert.ok(first >= 0);
  for (const tag of tags.slice(first)) {
    const sql = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    const header = headerRollbackClass(sql);
    assert.ok(header !== undefined, `${tag} has no rollback expectation header`);
    assert.ok(isRollbackClass(header), `${tag} header "${header}" is not a W0-04 class`);
    assert.equal(header, MIGRATION_CLASSES[tag], `${tag} header disagrees with MIGRATION_CLASSES`);
  }
  // Before W7-03, headers keep whatever they said; the map is authoritative (0007 and 0009 say "forward repair only").
  assert.equal(
    headerRollbackClass(readFileSync(path.join(MIGRATIONS_FOLDER, `${tags[9]}.sql`), 'utf8')),
    'forward repair only',
  );
});

test('headerRollbackClass reads the first header line only', () => {
  assert.equal(
    headerRollbackClass('-- migration: x\n-- rollback expectation: additive; one table\n'),
    'additive',
  );
  assert.equal(
    headerRollbackClass(
      '-- rollback expectation: restore-required; drops a column\n-- rollback expectation: additive;',
    ),
    'restore-required',
  );
  assert.equal(headerRollbackClass('-- rollback: forward repair only; x\nCREATE TABLE t ();'), undefined);
  assert.equal(headerRollbackClass('CREATE TABLE t (); -- rollback expectation: additive;'), undefined);
  assert.equal(
    headerRollbackClass('-- rollback expectation: additive\n'),
    undefined,
    'the semicolon is required',
  );
});
