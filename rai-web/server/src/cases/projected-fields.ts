// W0-04 fields rule, layer 1 (shape): the four projections, `risk_tier`, `registry_id` and `status` are not in any
// request type, and a write body that carries one is 422 invalid_input with `error.invalid_input.projected_field`
// (W0-02 7.3 error column; W0-05 section 5). The check runs as a route `preValidation` hook: after the policy hook
// (a reviewer or Admin is 403 role, an out-of-scope owner or SPOC 403 scope, whatever the body carries) and before
// schema validation, so the specific key wins over the generic additionalProperties error. Case-level and nested
// (`fields.privacyStatus` on PATCH) positions are both checked.

import { InvalidInputError, type FieldError } from '@rai/shared/errors';

/** Names 7.3 lists for the PATCH rejection, plus `registryId` and `status`, in the JSON field spelling. */
export const PROJECTED_FIELDS = [
  'privacyStatus',
  'securityStatus',
  'raiStatus',
  'aiReadinessStatus',
  'riskTier',
  'registryId',
  'status',
] as const;
export type ProjectedField = (typeof PROJECTED_FIELDS)[number];

export const PROJECTED_FIELD_KEY = 'error.invalid_input.projected_field' as const;

const PROJECTED_SET: ReadonlySet<string> = new Set(PROJECTED_FIELDS);

/** Field errors for every projected name present at the top level of `body` or under `body.fields`. */
export function projectedFieldErrors(body: unknown, prefix = 'body'): FieldError[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  const errors: FieldError[] = [];
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PROJECTED_SET.has(key)) errors.push({ path: `${prefix}.${key}`, messageKey: PROJECTED_FIELD_KEY });
  }
  const nested = record.fields;
  if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const key of Object.keys(nested)) {
      if (PROJECTED_SET.has(key))
        errors.push({ path: `${prefix}.fields.${key}`, messageKey: PROJECTED_FIELD_KEY });
    }
  }
  return errors;
}

/** Throws the 422 for a body that carries a projected field; returns silently otherwise. */
export function rejectProjectedFields(body: unknown): void {
  const errors = projectedFieldErrors(body);
  if (errors.length > 0) throw new InvalidInputError(errors);
}
