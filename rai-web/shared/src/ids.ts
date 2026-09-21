// W0-02 section 7.1. Identifiers are opaque, server-generated and non-guessable (W0-05 section 4).
// The branded types make a CaseId and a VersionId distinct at compile time while both remain strings at runtime.

declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]?: Name };

export type CaseId = Brand<string, 'CaseId'>; // UUID, server-generated
export type RegistryId = Brand<string, 'RegistryId'>; // desk-local, 'RAI-<yyyy>-<nnnn>', server-generated, unique
export type DraftId = Brand<string, 'DraftId'>; // UUID
export type VersionId = Brand<string, 'VersionId'>; // UUID; a submitted, immutable version
export type ArtifactId = Brand<string, 'ArtifactId'>; // UUID; metadata row keyed to a sha256 blob
export type SubjectId = Brand<string, 'SubjectId'>; // identity adapter subject (W0-03), '<issuerKey>:<subject>'; opaque, never the email
export type ConfigurationRevisionId = Brand<string, 'ConfigurationRevisionId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>; // UUID v4, server-minted (W0-10 section 2)
export type LocaleKey = string; // a key present in shared/src/locales/th.json and en.json; see locales/keys.ts for the typed union

/** `RAI-<yyyy>-<nnnn>` (W0-04 `case.registry_id`); fixtures use the reserved year 2000 (W0-02 section 8.3). */
export const REGISTRY_ID_PATTERN = /^RAI-\d{4}-\d{4}$/;

export function isRegistryId(value: string): value is RegistryId {
  return REGISTRY_ID_PATTERN.test(value);
}

/** Time-ordered UUID v7 for primary keys (W0-04 conventions: `crypto.randomUUID()` is v4; ids must sort by time). */
export function uuidv7(
  now: number = Date.now(),
  random: (bytes: number) => Uint8Array = randomBytes,
): string {
  const bytes = new Uint8Array(16);
  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  const rnd = random(10);
  bytes.set(rnd, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
