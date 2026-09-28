// W0-07 section 4.7 file naming, shared by the fixture `FileMailSink` and the server's in-product file drop (W7-07,
// W7 plan section 5.3): `${sha256(dedupKey).hex.slice(0, 16)}-${attempt}`. The dedup key contains the recipient
// address (personal data under W0-10), so it is hashed before it becomes a name. Uses node:crypto: imported by the
// server and the fixtures only, never by web/.

import { createHash } from 'node:crypto';

export function mailFileStem(dedupKey: string, attempt: number): string {
  return `${createHash('sha256').update(dedupKey, 'utf8').digest('hex').slice(0, 16)}-${attempt}`;
}
