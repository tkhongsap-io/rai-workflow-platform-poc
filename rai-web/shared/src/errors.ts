// The error contract: W0-06 section 8 is authoritative (codes 8.1, envelope 8.2, guarantees 8.3, locale keys 8.5);
// W0-02 section 7.1 reproduces it; the codes are the ones ADR-0003 (W0-01) chose. Nine codes: the seven W0-06
// contract types, `not_found`, and `desk_frozen` (W6-01, W6 plan section 4.2). `internal_error` (HTTP 500) is the
// catch-all outside the contract types. Every user-facing message is a locale key (D12), never rendered text.

import type { CorrelationId, LocaleKey } from './ids.js';
import type { ConfigurationKind } from './schemas/cases.js';

export const ERROR_CODES = [
  'unauthenticated', // 401
  'forbidden', // 403
  'stale_version', // 409
  'invalid_input', // 422
  'unsafe_upload', // 422
  'qc_unavailable', // 503 (only from a synchronous QC endpoint; none in slice 1)
  'mail_delivery_failed', // 502 (on the notification record, never on the actor's business action)
  'not_found', // 404, in-scope reference that does not exist (W0-06 8.1, W0-05 section 4)
  'desk_frozen', // 503, W6-01: a write refused while an Admin has frozen the desk (W6 plan section 7, desk_controls)
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = Object.freeze({
  unauthenticated: 401,
  forbidden: 403,
  stale_version: 409,
  invalid_input: 422,
  unsafe_upload: 422,
  qc_unavailable: 503,
  mail_delivery_failed: 502,
  not_found: 404,
  desk_frozen: 503,
});

/** Outside the contract types (W0-06 8.1): HTTP 500, body = code + `error.internal_error` + correlationId only. */
export const INTERNAL_ERROR_CODE = 'internal_error' as const;
export const INTERNAL_ERROR_STATUS = 500;

export interface FieldError {
  path: string; // request JSON path: 'sourceRecordId.value', 'slots[3].reason', 'header.idempotency-key'
  messageKey: LocaleKey; // 'validation.required', 'validation.not_in_configured_list', 'error.invalid_input.projected_field', ...
  params?: Record<string, string | number>;
}

export const STALE_REASONS = [
  'version_superseded', // a newer version (draft or submitted) exists
  'revision_changed', // the draft was saved by someone else
  'version_closed', // successor draft exists after a send-back, or the version is Ready
  'lane_already_decided', // this lane already decided this version
  'qc_run_superseded', // a newer lane-QC run exists; findings must be seen first
  'configuration_changed', // W6-01: an Admin configuration draft moved, or the revision in force is not its base
] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

/** W0-08 section 5 reason vocabulary (W0-08 owns it; W0-06 8.2 and W0-02 7.1 reference it). */
export const UNSAFE_UPLOAD_REASONS = [
  'empty_file',
  'too_large',
  'pack_total_exceeded',
  'filename_invalid',
  'extension_not_allowed',
  'type_not_allowed',
  'type_mismatch',
  'container_invalid',
  'macro_enabled',
  'nested_archive',
  'encrypted_entry',
  'active_content',
  'image_too_large',
] as const;
export type UnsafeUploadReason = (typeof UNSAFE_UPLOAD_REASONS)[number];

// W5-02 adds risk_rubric: no risk_rubric revision in force (GET /api/configuration/risk-rubric/current).
export type NotFoundResource =
  'case' | 'version' | 'finding' | 'artifact' | 'notification' | 'configuration' | 'risk_rubric';

/** The W0-06 8.2 details of a 409 about a case version: the current reference of that version. */
export interface VersionStaleDetails {
  reason: StaleReason;
  guidanceKey: `error.stale_version.guidance.${StaleReason | 'ready'}`;
  current: {
    versionId: string;
    versionNumber: number;
    revision: number;
    state: 'draft' | 'submitted';
    ready: boolean;
  };
  refreshPath: string; // relative SPA path of the current version; never an absolute host
}

/**
 * W6-01 (W6 plan section 4.2, Q5): the 409 about an Admin configuration draft or publish. `current` is the kind's
 * state as the server now holds it: the revision in force (null before any publish) and the draft's version (null
 * when no draft exists). The SPA reloads the kind page at `refreshPath`.
 */
export interface ConfigurationStaleDetails {
  reason: 'configuration_changed';
  guidanceKey: 'error.stale_version.guidance.configuration_changed';
  current: { kind: ConfigurationKind; revisionId: string | null; draftVersion: number | null };
  refreshPath: string;
}

export interface ErrorDetails {
  invalid_input: { fields: FieldError[] };
  stale_version: VersionStaleDetails | ConfigurationStaleDetails;
  unsafe_upload: {
    reasonKey: `error.unsafe_upload.${UnsafeUploadReason}`;
    params?: Record<string, string | number>;
  };
  qc_unavailable: { qcRunId?: string };
  mail_delivery_failed: { notificationId: string; attempts: number; nextRetryAt?: string };
  not_found: { resource: NotFoundResource };
  unauthenticated: never; // nothing about the resource leaks
  forbidden: never;
  desk_frozen: never; // W6-01: the SPA banner reads readiness (W6-17); the refusal names nothing about the target
}

export type ErrorMessageKey<C extends ErrorCode = ErrorCode> = `error.${C}`;

export interface ErrorResponse<C extends ErrorCode = ErrorCode> {
  error: {
    code: C;
    messageKey: ErrorMessageKey<C>; // Thai default (D12)
    correlationId: CorrelationId;
    details?: ErrorDetails[C];
  };
}

export interface InternalErrorResponse {
  error: {
    code: typeof INTERNAL_ERROR_CODE;
    messageKey: 'error.internal_error';
    correlationId: CorrelationId;
  };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export function messageKeyFor<C extends ErrorCode>(code: C): ErrorMessageKey<C> {
  return `error.${code}`;
}

/** Builds the W0-06 8.2 envelope. `forbidden` and `unauthenticated` never carry details (8.2 rules). */
export function errorResponse<C extends ErrorCode>(
  code: C,
  correlationId: CorrelationId,
  details?: ErrorDetails[C],
): ErrorResponse<C> {
  const error: ErrorResponse<C>['error'] = { code, messageKey: messageKeyFor(code), correlationId };
  if (details !== undefined && code !== 'forbidden' && code !== 'unauthenticated') {
    error.details = details;
  }
  return { error };
}

export function internalErrorResponse(correlationId: CorrelationId): InternalErrorResponse {
  return { error: { code: INTERNAL_ERROR_CODE, messageKey: 'error.internal_error', correlationId } };
}

/**
 * The typed error the server throws and the Fastify error handler (W1-01) maps once to the envelope.
 * One subclass per contract code so each type has a test and a stable `instanceof`.
 */
export abstract class ContractError<C extends ErrorCode = ErrorCode> extends Error {
  abstract readonly code: C;
  readonly details: ErrorDetails[C] | undefined;

  protected constructor(details?: ErrorDetails[C]) {
    super();
    this.details = details;
    this.name = new.target.name;
    this.message = ''; // the user message is the locale key; never English text on the error itself
  }

  get status(): number {
    return HTTP_STATUS_BY_CODE[this.code];
  }

  get messageKey(): ErrorMessageKey<C> {
    return messageKeyFor(this.code);
  }

  toResponse(correlationId: CorrelationId): ErrorResponse<C> {
    return errorResponse(this.code, correlationId, this.details);
  }
}

export class UnauthenticatedError extends ContractError<'unauthenticated'> {
  readonly code = 'unauthenticated' as const;
  constructor() {
    super();
  }
}

export class ForbiddenError extends ContractError<'forbidden'> {
  readonly code = 'forbidden' as const;
  constructor() {
    super();
  }
}

export class StaleVersionError extends ContractError<'stale_version'> {
  readonly code = 'stale_version' as const;
  constructor(details: ErrorDetails['stale_version']) {
    super(details);
  }
}

export class InvalidInputError extends ContractError<'invalid_input'> {
  readonly code = 'invalid_input' as const;
  constructor(fields: FieldError[]) {
    super({ fields });
  }
}

export class UnsafeUploadError extends ContractError<'unsafe_upload'> {
  readonly code = 'unsafe_upload' as const;
  constructor(reason: UnsafeUploadReason, params?: Record<string, string | number>) {
    super(
      params === undefined
        ? { reasonKey: `error.unsafe_upload.${reason}` }
        : { reasonKey: `error.unsafe_upload.${reason}`, params },
    );
  }
}

export class QcUnavailableError extends ContractError<'qc_unavailable'> {
  readonly code = 'qc_unavailable' as const;
  constructor(qcRunId?: string) {
    super(qcRunId === undefined ? {} : { qcRunId });
  }
}

export class MailDeliveryFailedError extends ContractError<'mail_delivery_failed'> {
  readonly code = 'mail_delivery_failed' as const;
  constructor(details: ErrorDetails['mail_delivery_failed']) {
    super(details);
  }
}

export class NotFoundError extends ContractError<'not_found'> {
  readonly code = 'not_found' as const;
  constructor(resource: NotFoundResource) {
    super({ resource });
  }
}

/** W6-01 (W6 plan section 7): a write refused while `desk_controls.writesFrozen` is on, or a recheck while QC is paused. */
export class DeskFrozenError extends ContractError<'desk_frozen'> {
  readonly code = 'desk_frozen' as const;
  constructor() {
    super();
  }
}

export function isContractError(value: unknown): value is ContractError {
  return value instanceof ContractError;
}
