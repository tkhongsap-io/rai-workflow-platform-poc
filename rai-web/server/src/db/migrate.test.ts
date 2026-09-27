// W7-03: the class writer maps hash → tag by pairing Drizzle's migration files with meta/_journal.json by index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_FOLDER, pairMigrationJournal, readMigrationJournal } from './migrate.js';
import { MigrationClassError } from './migration-classes.js';

test('pairMigrationJournal pairs files and journal entries by index', () => {
  assert.deepEqual(
    pairMigrationJournal(
      [
        { hash: 'h0', folderMillis: 10 },
        { hash: 'h1', folderMillis: 20 },
      ],
      [{ tag: '0000_a' }, { tag: '0001_b' }],
    ),
    [
      { tag: '0000_a', hash: 'h0', folderMillis: 10 },
      { tag: '0001_b', hash: 'h1', folderMillis: 20 },
    ],
  );
  assert.deepEqual(pairMigrationJournal([], []), []);
});

test('a count mismatch between files and journal fails with migration_journal_mismatch', () => {
  for (const [files, entries] of [
    [[{ hash: 'h0', folderMillis: 10 }], []],
    [[], [{ tag: '0000_a' }]],
  ] as const)
    assert.throws(
      () => pairMigrationJournal(files, entries),
      (err: unknown) => err instanceof MigrationClassError && err.code === 'migration_journal_mismatch',
    );
});

test('readMigrationJournal on the real folder names each hash by the tag of the file it hashes', () => {
  const journal = readMigrationJournal(MIGRATIONS_FOLDER);
  assert.ok(journal.length >= 11);
  for (const { tag, hash } of journal) {
    const file = readFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
    assert.equal(createHash('sha256').update(file).digest('hex'), hash, tag);
  }
  assert.deepEqual(
    journal.map((entry) => entry.folderMillis),
    [...journal.map((entry) => entry.folderMillis)].sort((a, b) => a - b),
  );
});
