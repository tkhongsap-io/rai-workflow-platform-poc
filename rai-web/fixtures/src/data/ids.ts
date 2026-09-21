// Deterministic UUIDs for fixture rows (W1-09). A fixture id such as `fx-case-vendor` always maps to the same
// UUID, so the QC substitute (W1-10), the UI substitute (W1-13) and journey tests can key on a case, draft or
// artifact without reading the database first. Real rows use server-generated, non-guessable ids (W0-05 section 4);
// these exist only in the fixture set, which never leaves development and test (W0-08 8.1 rule 5).

import { createHash } from 'node:crypto';

const FIXTURE_UUID_NAMESPACE = 'rai-desk/slice1-synthetic';

/** SHA-256 of the namespace and the fixture id, laid out as an RFC 9562 version-8 (custom) UUID. */
export function fixtureUuid(fixtureId: string): string {
  const digest = createHash('sha256').update(`${FIXTURE_UUID_NAMESPACE}\0${fixtureId}`).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8: custom, vendor-defined layout
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
