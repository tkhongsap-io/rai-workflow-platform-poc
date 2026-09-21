import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliesAt, revisionInForce } from './activation.js';

const at = (iso: string) => new Date(iso);

test('after_publish: a revision applies to submissions strictly after its publish time', () => {
  const rev = { activationRule: 'after_publish' as const, publishedAt: at('2026-09-21T03:00:00Z') };
  assert.equal(appliesAt(rev, at('2026-09-21T03:00:00.001Z')), true);
  assert.equal(appliesAt(rev, at('2026-09-21T03:00:00Z')), false, 'the publish instant itself is not after');
  assert.equal(appliesAt(rev, at('2026-09-21T02:59:59Z')), false);
});

test('revisionInForce picks the latest applicable revision and ignores later ones', () => {
  const r1 = { id: 'r1', activationRule: 'after_publish' as const, publishedAt: at('2026-09-01T00:00:00Z') };
  const r2 = { id: 'r2', activationRule: 'after_publish' as const, publishedAt: at('2026-09-15T00:00:00Z') };
  const r3 = { id: 'r3', activationRule: 'after_publish' as const, publishedAt: at('2026-10-01T00:00:00Z') };
  assert.equal(revisionInForce([r3, r1, r2], at('2026-09-21T00:00:00Z'))?.id, 'r2');
  assert.equal(revisionInForce([r1, r2, r3], at('2026-09-02T00:00:00Z'))?.id, 'r1');
  assert.equal(revisionInForce([r1, r2, r3], at('2026-08-01T00:00:00Z')), undefined);
});
