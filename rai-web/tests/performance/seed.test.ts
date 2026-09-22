import { validateSourceRecordId } from '@rai/server/cases/source-record-id';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recipe } from './queue-seed.js';

test('995-case recipe interleaves scope/status and creates only 200 successors', () => {
  const rows = Array.from({ length: 995 }, (_, i) => recipe(i));
  assert.equal(new Set(rows.map((r) => r.rank)).size, 995);
  assert(rows.every((r) => validateSourceRecordId(r.sourceRecordId) === undefined));
  assert.deepEqual(
    ['draft', 'in_review', 'sent_back', 'ready_for_launch'].map(
      (s) => rows.filter((r) => r.status === s).length,
    ),
    [195, 500, 150, 150],
  );
  assert.equal(rows.filter((r) => r.resubmit).length, 50);
  assert(rows.some((r) => r.name.includes('%_!\\')) && rows.some((r) => r.name.includes('cafe\u0301')));
  assert.equal(new Set(rows.map((r) => `${r.bu}/${r.owner}`)).size, 4);
  assert.equal(new Set(rows.slice(-25).map((r) => r.status)).size, 4);
  assert.throws(() => recipe(995));
});
