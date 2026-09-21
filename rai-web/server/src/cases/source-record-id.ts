// W0-02 section 7.3 `SourceRecordId` ↔ W0-04 `case.source_record_id`: `{ kind: 'unknown' }` is stored as the literal
// `Unknown` of the source spec (L10); `{ kind: 'known', value }` must carry the `TPM-` or `VRO-` prefix (7.3 error
// column) and is stored and read back unchanged. It is never validated against, or looked up in, any external
// register: no client exists in this module or anywhere in the server (L3, L6; A02 "the register is never called").

import type { FieldError } from '@rai/shared/errors';
import type { SourceRecordId } from '@rai/shared/schemas/cases';

/** The stored text for `{ kind: 'unknown' }` (source spec: the literal Unknown). */
export const UNKNOWN_SOURCE_RECORD = 'Unknown' as const;

/** The two register prefixes 7.3 accepts. Checked as a prefix only: no format beyond it is assumed (L10). */
export const SOURCE_RECORD_PREFIXES = ['TPM-', 'VRO-'] as const;
export const SOURCE_RECORD_MAX_LENGTH = 100;

export const SOURCE_RECORD_PREFIX_KEY = 'validation.source_record_id_prefix' as const;

/** Returns the field error for a request `sourceRecordId`, or undefined when it is acceptable. */
export function validateSourceRecordId(
  value: SourceRecordId,
  path = 'sourceRecordId',
): FieldError | undefined {
  if (value.kind === 'unknown') return undefined;
  const text = value.value;
  if (
    text.length > SOURCE_RECORD_MAX_LENGTH ||
    text.trim() !== text ||
    !SOURCE_RECORD_PREFIXES.some((p) => text.startsWith(p) && text.length > p.length)
  ) {
    return { path: `${path}.value`, messageKey: SOURCE_RECORD_PREFIX_KEY };
  }
  return undefined;
}

/** Request shape → stored column. Throws on an invalid value; callers validate first. */
export function toStoredSourceRecordId(value: SourceRecordId): string {
  const problem = validateSourceRecordId(value);
  if (problem !== undefined) throw new RangeError(`sourceRecordId rejected at ${problem.path}`);
  return value.kind === 'unknown' ? UNKNOWN_SOURCE_RECORD : value.value;
}

/** Stored column → response shape. Anything but the literal Unknown is a known value, returned unchanged. */
export function fromStoredSourceRecordId(stored: string): SourceRecordId {
  return stored === UNKNOWN_SOURCE_RECORD ? { kind: 'unknown' } : { kind: 'known', value: stored };
}
