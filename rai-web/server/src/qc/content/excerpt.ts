// W4-06a (W4b plan section 3.1; decision 30): a claim is cited by the sha256 of its NFC-normalised UTF-8 text. The text
// itself stays in the content runner's memory for the run; only the hash and its 16-character prefix, the claim key,
// reach a finding.
import { createHash } from 'node:crypto';

/** sha256 hex of the NFC-normalised UTF-8 text of a matched claim segment. */
export function excerptHashOf(text: string): string {
  return createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');
}

/** The claim discriminator of `findingKey` (decision 30): the first 16 hex characters of the excerpt hash. */
export function claimKeyOf(excerptHash: string): string {
  return excerptHash.slice(0, 16);
}
