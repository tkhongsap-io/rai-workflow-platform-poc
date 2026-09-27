// W1-00 Done when: each error type has a test. W0-06 section 10: each of the eight codes maps to its HTTP status;
// the envelope has code, messageKey, correlationId; forbidden/unauthenticated carry no details.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  DeskFrozenError,
  ERROR_CODES,
  ForbiddenError,
  HTTP_STATUS_BY_CODE,
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_STATUS,
  InvalidInputError,
  MailDeliveryFailedError,
  NotFoundError,
  QcUnavailableError,
  STALE_REASONS,
  StaleVersionError,
  UNSAFE_UPLOAD_REASONS,
  UnauthenticatedError,
  UnsafeUploadError,
  errorResponse,
  internalErrorResponse,
  isContractError,
  isErrorCode,
  messageKeyFor,
  type ErrorCode,
} from './errors.js';
import type { CorrelationId } from './ids.js';
import { LOCALE_CATALOGUES, isLocaleKey } from './locales/keys.js';

const correlationId = '11111111-2222-4333-8444-555555555555' as CorrelationId;

const EXPECTED_STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  stale_version: 409,
  invalid_input: 422,
  unsafe_upload: 422,
  qc_unavailable: 503,
  mail_delivery_failed: 502,
  not_found: 404,
  desk_frozen: 503, // W6-01 (W6 plan section 4.2): writes refused while an Admin has frozen the desk
};

test('exactly the nine W0-06 codes exist, each mapped to its HTTP status (W0-06 8.1, 8.2)', () => {
  assert.deepEqual([...ERROR_CODES].sort(), Object.keys(EXPECTED_STATUS).sort());
  for (const code of ERROR_CODES) {
    assert.equal(HTTP_STATUS_BY_CODE[code], EXPECTED_STATUS[code], `status of ${code}`);
    assert.ok(isErrorCode(code));
  }
  assert.equal(isErrorCode('internal_error'), false, 'internal_error is outside the contract types');
  assert.equal(INTERNAL_ERROR_CODE, 'internal_error');
  assert.equal(INTERNAL_ERROR_STATUS, 500);
  assert.ok(Object.isFrozen(HTTP_STATUS_BY_CODE));
});

test('every code has its error.<code> message key in both locale catalogues (W0-06 8.5, D12)', () => {
  for (const code of [...ERROR_CODES, INTERNAL_ERROR_CODE]) {
    const key = `error.${code}`;
    assert.ok(isLocaleKey(key), `${key} is a locale key`);
    for (const locale of ['th', 'en'] as const) {
      const catalogue = LOCALE_CATALOGUES[locale] as Record<string, string>;
      assert.ok(catalogue[key] && catalogue[key].length > 0, `${locale} has ${key}`);
    }
  }
  for (const reason of [...STALE_REASONS, 'ready']) {
    assert.ok(isLocaleKey(`error.stale_version.guidance.${reason}`), `guidance key for ${reason}`);
  }
  for (const reason of UNSAFE_UPLOAD_REASONS) {
    assert.ok(isLocaleKey(`error.unsafe_upload.${reason}`), `unsafe_upload key for ${reason}`);
  }
  // W6-01: the two keys the W6 plan (section 4.2) names, in both catalogues
  for (const key of ['error.desk_frozen', 'error.stale_version.guidance.configuration_changed']) {
    for (const locale of ['th', 'en'] as const) {
      const catalogue = LOCALE_CATALOGUES[locale] as Record<string, string>;
      assert.ok(catalogue[key] && catalogue[key].length > 0, `${locale} has ${key}`);
    }
  }
  assert.ok((STALE_REASONS as readonly string[]).includes('configuration_changed'));
});

test('the envelope carries code, messageKey and correlationId; forbidden and unauthenticated never carry details', () => {
  const body = errorResponse('not_found', correlationId, { resource: 'case' });
  assert.deepEqual(body, {
    error: { code: 'not_found', messageKey: 'error.not_found', correlationId, details: { resource: 'case' } },
  });
  for (const code of ['forbidden', 'unauthenticated'] as const) {
    // details are typed `never`; a caller that forces one through is still stripped at runtime (W0-06 8.2)
    const forced = errorResponse(code, correlationId, { leaked: true } as never);
    assert.deepEqual(forced, { error: { code, messageKey: `error.${code}`, correlationId } });
    assert.equal('details' in forced.error, false);
  }
  assert.deepEqual(internalErrorResponse(correlationId), {
    error: { code: 'internal_error', messageKey: 'error.internal_error', correlationId },
  });
  assert.equal(messageKeyFor('stale_version'), 'error.stale_version');
});

// One test per contract type: the class carries its code, status, message key and details, and renders the envelope.

test('UnauthenticatedError → 401, no details', () => {
  const err = new UnauthenticatedError();
  assert.ok(err instanceof ContractError && isContractError(err));
  assert.equal(err.code, 'unauthenticated');
  assert.equal(err.status, 401);
  assert.equal(err.messageKey, 'error.unauthenticated');
  assert.equal(err.details, undefined);
  assert.deepEqual(err.toResponse(correlationId), {
    error: { code: 'unauthenticated', messageKey: 'error.unauthenticated', correlationId },
  });
});

test('ForbiddenError → 403, no details, nothing about the resource leaks', () => {
  const err = new ForbiddenError();
  assert.equal(err.code, 'forbidden');
  assert.equal(err.status, 403);
  assert.equal(err.message, '', 'no English text on the error; the locale key is the message');
  assert.deepEqual(err.toResponse(correlationId), {
    error: { code: 'forbidden', messageKey: 'error.forbidden', correlationId },
  });
});

test('StaleVersionError → 409 with reason, guidance key, current reference and refresh path (W0-06 8.2)', () => {
  const details = {
    reason: 'revision_changed',
    guidanceKey: 'error.stale_version.guidance.revision_changed',
    current: { versionId: 'v-1', versionNumber: 1, revision: 3, state: 'draft', ready: false },
    refreshPath: '/cases/c-1/draft',
  } as const;
  const err = new StaleVersionError(details);
  assert.equal(err.status, 409);
  assert.deepEqual(err.toResponse(correlationId).error.details, details);
  assert.ok(isLocaleKey(details.guidanceKey));
});

test('InvalidInputError → 422 with field-level message keys, never rendered text', () => {
  const err = new InvalidInputError([{ path: 'header.idempotency-key', messageKey: 'validation.required' }]);
  assert.equal(err.status, 422);
  assert.deepEqual(err.details, {
    fields: [{ path: 'header.idempotency-key', messageKey: 'validation.required' }],
  });
});

test('UnsafeUploadError → 422 with the W0-08 reason key and optional params', () => {
  const plain = new UnsafeUploadError('active_content');
  assert.equal(plain.status, 422);
  assert.deepEqual(plain.details, { reasonKey: 'error.unsafe_upload.active_content' });
  const sized = new UnsafeUploadError('too_large', { max_file_mb: 25 });
  assert.deepEqual(sized.details, {
    reasonKey: 'error.unsafe_upload.too_large',
    params: { max_file_mb: 25 },
  });
});

test('QcUnavailableError → 503 with an optional run id', () => {
  assert.equal(new QcUnavailableError().status, 503);
  assert.deepEqual(new QcUnavailableError().details, {});
  assert.deepEqual(new QcUnavailableError('run-1').details, { qcRunId: 'run-1' });
});

test('MailDeliveryFailedError → 502 with notification id, attempts and next retry', () => {
  const err = new MailDeliveryFailedError({ notificationId: 'n-1', attempts: 4 });
  assert.equal(err.status, 502);
  assert.deepEqual(err.details, { notificationId: 'n-1', attempts: 4 });
});

test('NotFoundError → 404 naming the resource', () => {
  const err = new NotFoundError('artifact');
  assert.equal(err.status, 404);
  assert.deepEqual(err.toResponse(correlationId).error.details, { resource: 'artifact' });
});

test('isContractError rejects plain errors and non-errors', () => {
  assert.equal(isContractError(new Error('x')), false);
  assert.equal(isContractError({ code: 'forbidden' }), false);
});

// W6-01 (W6 plan section 4.2): the W6 additions to the contract.

test('DeskFrozenError → 503 desk_frozen with no details', () => {
  const err = new DeskFrozenError();
  assert.ok(isContractError(err));
  assert.equal(err.code, 'desk_frozen');
  assert.equal(err.status, 503);
  assert.equal(err.messageKey, 'error.desk_frozen');
  assert.equal(err.details, undefined);
  assert.equal(err.message, '');
  assert.deepEqual(err.toResponse(correlationId), {
    error: { code: 'desk_frozen', messageKey: 'error.desk_frozen', correlationId },
  });
});

test('StaleVersionError configuration_changed carries the configuration reference, not a version', () => {
  const details = {
    reason: 'configuration_changed',
    guidanceKey: 'error.stale_version.guidance.configuration_changed',
    current: { kind: 'sla', revisionId: 'r-2', draftVersion: 3 },
    refreshPath: '/admin/configuration/sla',
  } as const;
  const err = new StaleVersionError(details);
  assert.equal(err.status, 409);
  assert.deepEqual(err.toResponse(correlationId).error.details, details);
  assert.ok(isLocaleKey(details.guidanceKey));
});

test('NotFoundError names the configuration resource', () => {
  assert.deepEqual(new NotFoundError('configuration').details, { resource: 'configuration' });
});
