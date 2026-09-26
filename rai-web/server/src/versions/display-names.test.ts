import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaticSubjectDirectory, readNames } from '../cases/subject-directory.js';
import { withDeciderName, withSubmitterName } from './display-names.js';

const known = [{ subjectId: 'fixture:a', displayName: 'Name A' }];

test('readNames: a known subject is named, an unknown one is not, and no directory names nobody', async () => {
  const names = readNames(createStaticSubjectDirectory(known));
  assert.equal(await names('fixture:a'), 'Name A');
  assert.equal(await names('fixture:unknown'), undefined);
  assert.equal(await readNames(undefined)('fixture:a'), undefined);
});

test('readNames resolves each subject once per read', async () => {
  let calls = 0;
  const names = readNames({
    resolve: (subjectId) => {
      calls += 1;
      return Promise.resolve({ subjectId, displayName: 'N' });
    },
  });
  await Promise.all([names('s'), names('s'), names('t')]);
  assert.equal(calls, 2);
});

test('withSubmitterName puts the name right after submittedBy and leaves the body alone when unknown', () => {
  const body = { versionId: 'v', submittedBy: 's', submittedAt: 't' };
  assert.deepEqual(Object.keys(withSubmitterName(body, 'N')), [
    'versionId',
    'submittedBy',
    'submittedByDisplayName',
    'submittedAt',
  ]);
  assert.equal(withSubmitterName(body, undefined), body);
});

test('withDeciderName keeps the LaneDecision key order and leaves the decision alone when unknown', () => {
  const d = { lane: 'dpo', decision: 'approve', decidedBy: 's', decidedAt: 't', feedback: null } as const;
  assert.deepEqual(Object.keys(withDeciderName(d, 'N')), [
    'lane',
    'decision',
    'decidedBy',
    'decidedByDisplayName',
    'decidedAt',
    'feedback',
  ]);
  assert.equal(withDeciderName(d, undefined), d);
});
