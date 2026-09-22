import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagePaths, validatePages, type PagePlan } from './page-measure.js';

const caseId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const selection = (kind: PagePlan['pages'][number]['kind']): PagePlan['pages'][number] => ({
  kind,
  actor: 'fixture-actor',
  ids: { caseId, versionId },
  visible: ['.loaded'],
  absent: ['.notice-error'],
});
const pages = () => (['queue', 'overview', 'editor', 'reviewer', 'history'] as const).map(selection);

test('Ready overview times entry navigation including redirect to its bound version', () => {
  assert.deepEqual(pagePaths(selection('overview')), {
    entry: `/cases/${caseId}`,
    final: `/cases/${caseId}/versions/${versionId}`,
  });
});
test('Ready overview rejects missing or malformed final version before navigation', () => {
  for (const ids of [{ caseId }, { caseId, versionId: '../other' }, { versionId }]) {
    assert.throws(() => pagePaths({ ...selection('overview'), ids }));
    assert.throws(() => validatePages(pages().map((p) => (p.kind === 'overview' ? { ...p, ids } : p))));
  }
});
test('queue and editor do not redirect; reviewer/history preserve their selected version', () => {
  for (const [kind, path] of [
    ['queue', '/queue'],
    ['editor', `/cases/${caseId}`],
    ['reviewer', `/cases/${caseId}/versions/${versionId}`],
    ['history', `/cases/${caseId}/versions/${versionId}`],
  ] as const) {
    assert.deepEqual(pagePaths(selection(kind)), { entry: path, final: path });
  }
});
test('exact five-page guard rejects omissions and duplicate replacement even at count five', () => {
  assert.doesNotThrow(() => validatePages(pages()));
  assert.doesNotThrow(() => validatePages(pages().reverse()));
  for (let i = 0; i < 5; i++) {
    assert.throws(() => validatePages(pages().filter((_, index) => index !== i)));
    const duplicate = pages();
    duplicate[i] = selection(i === 0 ? 'overview' : 'queue');
    assert.throws(() => validatePages(duplicate));
  }
  assert.throws(() => validatePages([...pages(), selection('queue')]));
});
test('page guard requires loaded and error-state assertions for every selected screen', () => {
  for (const field of ['visible', 'absent'] as const) {
    assert.throws(() => validatePages(pages().map((p) => ({ ...p, [field]: [] }))));
  }
});
