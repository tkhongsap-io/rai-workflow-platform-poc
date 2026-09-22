// Shape validation only. The server must prove the persisted job/link in its own transaction.
import { Value } from 'typebox/value';
import { DigestJobProvenanceSchema, type DigestJobProvenance } from '../schemas/observability.js';

export function isDigestJobProvenance(value: unknown): value is DigestJobProvenance {
  return Value.Check(DigestJobProvenanceSchema, value);
}
