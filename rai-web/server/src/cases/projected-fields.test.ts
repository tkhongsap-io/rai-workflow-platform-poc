// W0-04 fields rule at the shape layer: each projected name, at the top level and under `fields`, is a 422 with
// the projected_field key and the request path; a clean body passes; a non-object body is left to schema validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidInputError } from '@rai/shared/errors';
import {
  PROJECTED_FIELDS,
  PROJECTED_FIELD_KEY,
  projectedFieldErrors,
  rejectProjectedFields,
} from './projected-fields.js';

test('every projected field name is rejected at the top level and under fields', () => {
  for (const name of PROJECTED_FIELDS) {
    assert.deepEqual(projectedFieldErrors({ useCaseName: 'x', [name]: 'approved' }), [
      { path: `body.${name}`, messageKey: PROJECTED_FIELD_KEY },
    ]);
    assert.deepEqual(projectedFieldErrors({ expectedCaseRevision: 1, fields: { [name]: 'approved' } }), [
      { path: `body.fields.${name}`, messageKey: PROJECTED_FIELD_KEY },
    ]);
  }
});

test('the four inherited status fields are all in the list (W0-04 fields), as are riskTier, registryId and status', () => {
  assert.deepEqual(
    [...PROJECTED_FIELDS],
    ['privacyStatus', 'securityStatus', 'raiStatus', 'aiReadinessStatus', 'riskTier', 'registryId', 'status'],
  );
});

test('a clean body and a non-object body produce no error; rejectProjectedFields throws InvalidInputError otherwise', () => {
  assert.deepEqual(projectedFieldErrors({ useCaseName: 'x', vendorInvolved: true, modelType: 'llm' }), []);
  assert.deepEqual(projectedFieldErrors(null), []);
  assert.deepEqual(projectedFieldErrors('privacyStatus'), []);
  assert.deepEqual(projectedFieldErrors([{ privacyStatus: 'approved' }]), []);
  assert.doesNotThrow(() => rejectProjectedFields({ fields: { useCaseName: 'y' } }));
  assert.throws(
    () => rejectProjectedFields({ privacyStatus: 'approved', securityStatus: 'approved' }),
    (err: unknown) =>
      err instanceof InvalidInputError &&
      err.details?.fields.length === 2 &&
      err.details.fields.every((f) => f.messageKey === PROJECTED_FIELD_KEY),
  );
});
