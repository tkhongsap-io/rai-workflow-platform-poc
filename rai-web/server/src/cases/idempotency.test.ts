import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidInputError } from '@rai/shared/errors';
import { IDEMPOTENCY_HEADER_PATH, requestDigest, requireIdempotencyKey } from './idempotency.js';

test('the digest covers the action and the body, independent of key order; a different body or action differs', () => {
  const a = requestDigest('case.create', {
    useCaseName: 'x',
    vendorInvolved: true,
    sourceRecordId: { kind: 'unknown' },
  });
  const b = requestDigest('case.create', {
    sourceRecordId: { kind: 'unknown' },
    vendorInvolved: true,
    useCaseName: 'x',
  });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(
    a,
    requestDigest('case.create', {
      useCaseName: 'y',
      vendorInvolved: true,
      sourceRecordId: { kind: 'unknown' },
    }),
  );
  assert.notEqual(
    a,
    requestDigest('case.submit', {
      useCaseName: 'x',
      vendorInvolved: true,
      sourceRecordId: { kind: 'unknown' },
    }),
  );
});

test('a missing, blank, padded or overlong Idempotency-Key is 422 at header.idempotency-key; a UUID passes', () => {
  for (const header of [undefined, '', '  ', ' abc', 'x'.repeat(129)]) {
    assert.throws(
      () => requireIdempotencyKey(header),
      (err: unknown) =>
        err instanceof InvalidInputError && err.details?.fields[0]?.path === IDEMPOTENCY_HEADER_PATH,
    );
  }
  assert.equal(
    requireIdempotencyKey('5f1c0d0e-0000-4000-8000-000000000001'),
    '5f1c0d0e-0000-4000-8000-000000000001',
  );
  assert.equal(requireIdempotencyKey(['first', 'second']), 'first');
});
