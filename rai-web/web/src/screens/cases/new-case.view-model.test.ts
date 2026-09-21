// W1-07: the new-case model shapes the W0-02 7.3 request and maps the server's field errors; it validates nothing
// the server owns and never decides scope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '@rai/shared/schemas/auth';
import {
  blankFields,
  fieldMessagesFrom,
  initialForm,
  suggestedBusinessUnits,
  toCreateRequest,
} from './new-case.view-model.js';

const owner: Principal = {
  subjectId: 'fixture:fx-user-owner-cm',
  displayName: 'ณัฐพร ส.',
  email: 'owner.cm@rai-desk.example',
  roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
};
const spoc: Principal = {
  subjectId: 'fixture:fx-user-spoc-cm',
  displayName: 'Suchada P.',
  email: 'spoc.cm@rai-desk.example',
  roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
};

test('the initial form defaults businessOwner to the actor and pre-fills the single BU grant of a SPOC', () => {
  assert.equal(initialForm(owner).businessOwner, 'fixture:fx-user-owner-cm');
  assert.equal(initialForm(owner).businessUnitId, '');
  assert.equal(initialForm(spoc).businessUnitId, 'CM');
  assert.deepEqual(suggestedBusinessUnits(owner), []);
  assert.deepEqual(suggestedBusinessUnits(spoc), ['CM']);
});

test('Unknown is a valid, permanent source record answer; a known id is sent verbatim (trimmed)', () => {
  const form = initialForm(owner);
  assert.deepEqual(toCreateRequest({ ...form, useCaseName: ' A ', businessUnitId: 'CM' }).sourceRecordId, {
    kind: 'unknown',
  });
  assert.deepEqual(
    toCreateRequest({ ...form, sourceKind: 'known', sourceValue: ' TPM-0001 ' }).sourceRecordId,
    { kind: 'known', value: 'TPM-0001' },
  );
  assert.equal(toCreateRequest({ ...form, useCaseName: ' A ' }).useCaseName, 'A');
  assert.equal(toCreateRequest({ ...form, vendorInvolved: 'yes' }).vendorInvolved, true);
  assert.equal(toCreateRequest(form).vendorInvolved, false);
});

test('server field errors map onto inputs by path, with or without the body. prefix; unknown paths are kept apart', () => {
  const { fields, other } = fieldMessagesFrom([
    { path: 'body.useCaseName', messageKey: 'validation.required' },
    { path: 'sourceRecordId.value', messageKey: 'validation.source_record_id_prefix' },
    { path: 'body.useCaseGroup', messageKey: 'validation.not_in_configured_list' },
    { path: 'body.businessUnitId', messageKey: 'validation.not_in_configured_list' },
    { path: 'header.idempotency-key', messageKey: 'validation.required' },
  ]);
  assert.equal(fields.useCaseName, 'validation.required');
  assert.equal(fields.sourceValue, 'validation.source_record_id_prefix');
  assert.equal(fields.useCaseGroup, 'validation.not_in_configured_list');
  assert.equal(fields.businessUnitId, 'validation.not_in_configured_list');
  assert.deepEqual(other, [{ path: 'header.idempotency-key', messageKey: 'validation.required' }]);
});

test('a field the form sent blank reads validation.required whatever length rule the server named', () => {
  const form = { ...initialForm(owner), businessUnitId: 'CM', sourceKind: 'known' as const, sourceValue: '' };
  const blank = blankFields(form);
  assert.deepEqual([...blank].sort(), [
    'businessUnit',
    'sourceValue',
    'technicalOwner',
    'useCaseGroup',
    'useCaseName',
  ]);
  const { fields } = fieldMessagesFrom(
    [
      { path: 'body.useCaseName', messageKey: 'validation.not_in_configured_list' },
      { path: 'body.businessUnitId', messageKey: 'validation.not_in_configured_list' },
      { path: 'body.sourceRecordId.value', messageKey: 'validation.not_in_configured_list' },
    ],
    blank,
  );
  assert.equal(fields.useCaseName, 'validation.required');
  assert.equal(fields.businessUnitId, 'validation.not_in_configured_list'); // sent 'CM': the server's key stands
  assert.equal(fields.sourceValue, 'validation.required');
  assert.equal(blankFields({ ...form, sourceKind: 'unknown' }).has('sourceValue'), false);
});
