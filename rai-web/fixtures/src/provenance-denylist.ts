// The provenance denylist (W1-09 done-when clause 2, W0-08 8.1 rule 1), moved here unchanged by W4-09a so the
// slice1-synthetic test (data/provenance.test.ts) and the evaluation-set test (evaluation/provenance.test.ts) grep
// with one list. It lives outside data/ so the slice1-synthetic set hash (manifest.ts) is unchanged. The list holds
// PATTERNS on purpose: a list of real names or addresses would itself put real data into the repository.

/** Each entry: what it catches and the pattern. Case-sensitive unless the flag says otherwise. */
export const PROVENANCE_DENYLIST: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'the operating company name as a word', pattern: /\bTrue\b/ },
  { name: 'company domain or brand strings', pattern: /truecorp|true\.th|truedigital|@true\b/i },
  { name: 'the source system name', pattern: /\bLife-?OS\b/i },
  { name: 'a real-looking TPM record id', pattern: /\bTPM-\s?\d/ },
  { name: 'a real-looking VRO record id', pattern: /\bVRO-\s?\d/ },
  {
    name: 'a real-looking AI Reporting id (only AIR-FX-nnnn is synthetic)',
    pattern: /\bAIR-(?!FX-\d{4}\b)[A-Z0-9-]*\d/,
  },
  { name: 'a registry id outside the reserved year 2000', pattern: /\bRAI-(?!2000-)\d{4}-\d{4}\b/ },
  {
    name: 'an email address outside the reserved domain',
    pattern: /[A-Za-z0-9._%+-]+@(?!rai-desk\.example\b)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
  },
  {
    name: 'a Thai national id number (13 digits, plain or dashed)',
    pattern: /\b\d{13}\b|\b\d-\d{4}-\d{5}-\d{2}-\d\b/,
  },
  { name: 'a Thai mobile or +66 number', pattern: /\b0[689]\d{8}\b|\b0[689]\d-\d{3}-\d{4}\b|\+66\s?\d/ },
  { name: 'a .co.th or .th host', pattern: /\b[a-z0-9-]+\.(co\.th|in\.th|or\.th|ac\.th|go\.th)\b/i },
  { name: 'a street address', pattern: /\b\d+\s+(Soi|Thanon|Road|Rd\.|Sukhumvit|Silom|Ratchada)\b/i },
];

export function scanProvenance(label: string, text: string): string[] {
  const hits: string[] = [];
  for (const { name, pattern } of PROVENANCE_DENYLIST) {
    const m = pattern.exec(text);
    if (m !== null) hits.push(`${label}: ${name} ("${m[0]}")`);
  }
  return hits;
}
