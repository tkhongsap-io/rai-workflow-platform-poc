import { Value } from 'typebox/value';
import {
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  StaleVersionError,
  UnauthenticatedError,
  UnsafeUploadError,
  HTTP_STATUS_BY_CODE,
} from '@rai/shared/errors';
import {
  SafeErrorFieldsSchema,
  type SafeErrorFields,
  type ErrorCategory,
  type DeskHealthReport,
} from '@rai/shared/schemas/observability';
import type { Emitter, LogLevel } from './log.js';
import { inputSurfaces, sanitizeStack } from './redact.js';

const levels: Record<ErrorCategory, LogLevel> = {
  unauthenticated: 'info',
  forbidden: 'warn',
  stale_version: 'info',
  invalid_input: 'info',
  unsafe_upload: 'warn',
  qc_unavailable: 'error',
  mail_delivery_failed: 'error',
  not_found: 'info',
  internal_error: 'error',
};
type JobFields = Extract<SafeErrorFields, { category: 'qc_unavailable' | 'mail_delivery_failed' }>;

/** One instance per app. Only nine bounded categories are retained; no raw errors or unbounded stack groups. */
export function createErrorCapture(emitter: Emitter, now: () => Date = () => new Date()) {
  const counters = new Map<ErrorCategory, { count: number; lastAt: string }>();
  function capture(fields: SafeErrorFields, route?: string) {
    // Typed callers are still runtime inputs; fail safely if a provider or cast violates the shared contract.
    const safe = Value.Check(SafeErrorFieldsSchema, fields) ? fields : sanitizeStack(undefined);
    const httpStatus = safe.category === 'internal_error' ? 500 : HTTP_STATUS_BY_CODE[safe.category];
    const previous = counters.get(safe.category);
    counters.set(safe.category, {
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
      lastAt: now().toISOString(),
    });
    emitter.log(
      'error.captured',
      { ...safe, code: safe.category, httpStatus, ...(route === undefined ? {} : { route }) },
      levels[safe.category],
    );
    return { category: safe.category, httpStatus };
  }
  return {
    internal(error: unknown, route?: string) {
      return capture(sanitizeStack(error), route);
    },
    notFound() {
      return capture({ category: 'not_found', targetType: 'route' });
    },
    /** Route is supplied only from the framework's registered pattern inventory, never request.url. */
    http(error: unknown, route?: string) {
      let fields: SafeErrorFields;
      if (error instanceof UnauthenticatedError) fields = { category: 'unauthenticated' };
      else if (error instanceof ForbiddenError) fields = { category: 'forbidden' };
      else if (error instanceof InvalidInputError)
        fields = {
          category: 'invalid_input',
          fieldPaths: inputSurfaces(error.details?.fields.map((field) => field.path) ?? []),
        };
      else if (error instanceof StaleVersionError)
        fields = {
          category: 'stale_version',
          ...(error.details === undefined ? {} : { currentVersionId: error.details.current.versionId }),
        };
      else if (error instanceof UnsafeUploadError)
        fields = {
          category: 'unsafe_upload',
          reason: error.details!.reasonKey.slice('error.unsafe_upload.'.length) as Extract<
            SafeErrorFields,
            { category: 'unsafe_upload' }
          >['reason'],
        };
      else if (error instanceof NotFoundError)
        fields = { category: 'not_found', targetType: error.details!.resource };
      else fields = sanitizeStack(error);
      return capture(fields, route);
    },
    /** 502/503 classify job failures only; this helper never sends an HTTP response or domain event. */
    job(fields: JobFields) {
      return capture(fields);
    },
    counters(): DeskHealthReport['errorCounters'] {
      return [...counters]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, counter]) => ({ code, ...counter }));
    },
  };
}
export type ErrorCapture = ReturnType<typeof createErrorCapture>;
