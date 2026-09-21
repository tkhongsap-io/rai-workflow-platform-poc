// W0-07 section 4.4, transcribed. D06: deduplicated by (event, version, lane, recipient). The key is the W0-04
// `notification` unique index `UNIQUE (event, version_id, lane, recipient)` as one string, so the sink's `duplicate`
// answer and the database constraint name one identity. Pure; every component comes from the two typed inputs.
// (W0-07 section 9 places this file with W1-00; it lands as the W1-00 contract amendment codex/w1-00-mail-dedup.
// W3-03 builds the key with it; W1-11 tests assert on it.)

import { NOTIFICATION_EVENT_BY_KIND, type AuthorizedRecipient, type CommittedEvent } from './types.js';

export function buildDedupKey(event: CommittedEvent, recipient: AuthorizedRecipient): string {
  const version = event.kind === 'sla_breach_digest' ? event.digestDay : event.versionId;
  if (version === null || version === '') {
    // never emit a key containing 'null': the sink's 4.3 check is the defensive copy of this rule
    throw new RangeError(event.kind === 'sla_breach_digest' ? 'event.digestDay' : 'event.versionId');
  }
  return `${NOTIFICATION_EVENT_BY_KIND[event.kind]}:${version}:${event.lane ?? '-'}:${recipient.address}`;
}
