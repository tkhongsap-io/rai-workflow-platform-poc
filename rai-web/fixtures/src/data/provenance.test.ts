// Provenance guard (W1-09 done-when clause 2, W0-08 8.1 rule 1): nothing in the fixture data, the README or the
// generated document bytes resembles a real name, address or identifier, or names the source systems. The denylist
// holds PATTERNS on purpose: a list of real names or addresses would itself put real data into the repository.
// A human reviewer still confirms the text against the real cases and Life-OS evidence; this test keeps the
// mechanical part honest on every run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateAll } from '../generate.js';
import { FIXTURES_DATA_DIR, listDataFiles } from '../manifest.js';
import { FIXTURE_CASES } from './cases/index.js';
import { FIXTURE_DOCUMENTS } from './documents/index.js';
import { FIXTURE_EMAIL_DOMAIN, FIXTURE_USERS } from './users.js';
import { PROVENANCE_DENYLIST, scanProvenance } from '../provenance-denylist.js';

export { PROVENANCE_DENYLIST } from '../provenance-denylist.js';

const scan = scanProvenance;

test('no fixture data file (users, cases, documents, README) matches the provenance denylist', () => {
  const files = listDataFiles();
  assert.ok(
    files.includes('users.ts') && files.includes('cases/index.ts') && files.includes('documents/index.ts'),
  );
  assert.ok(files.includes('README.md'), 'the provenance README is part of the set');
  const hits = files.flatMap((rel) => scan(rel, readFileSync(path.join(FIXTURES_DATA_DIR, rel), 'utf8')));
  assert.deepEqual(hits, []);
});

test('no generated document byte sequence matches the denylist (text scanned as UTF-8 and as Latin-1)', () => {
  const hits = generateAll().flatMap((g) => [
    ...scan(`${g.document.fixtureDocumentId} (utf8)`, g.bytes.toString('utf8')),
    ...scan(`${g.document.fixtureDocumentId} (latin1)`, g.bytes.toString('latin1')),
  ]);
  assert.deepEqual(hits, []);
});

test('every address is at the reserved domain and every displayed value in the tables is one the tables define', () => {
  for (const u of FIXTURE_USERS) assert.ok(u.email.endsWith(`@${FIXTURE_EMAIL_DOMAIN}`));
  const text = [
    ...FIXTURE_CASES.flatMap((c) => [c.useCaseName, c.businessUnit, c.technicalOwner, c.purpose]),
    ...FIXTURE_DOCUMENTS.map((d) => d.filename),
  ].join('\n');
  assert.deepEqual(scan('tables', text), []);
});

test('the denylist itself catches what it claims (so a silent regex typo cannot pass everything)', () => {
  const samples: Array<[string, string]> = [
    ['the operating company name as a word', 'submitted to True in 2025'],
    ['the source system name', 'copied from LifeOS'],
    ['a real-looking TPM record id', 'TPM-104'],
    ['a real-looking VRO record id', 'VRO-2211'],
    ['a real-looking AI Reporting id (only AIR-FX-nnnn is synthetic)', 'AIR-0042'],
    ['a registry id outside the reserved year 2000', 'RAI-2026-0007'],
    ['an email address outside the reserved domain', 'someone@example.org'],
    ['a Thai national id number (13 digits, plain or dashed)', 'id 1234567890123'],
    ['a Thai mobile or +66 number', 'call 0812345678'],
  ];
  for (const [name, sample] of samples) {
    const rule = PROVENANCE_DENYLIST.find((r) => r.name === name);
    assert.ok(rule, name);
    assert.match(sample, rule.pattern, name);
  }
  assert.doesNotMatch(
    'AIR-FX-2291 RAI-2000-0001 owner.cm@rai-desk.example true',
    new RegExp(PROVENANCE_DENYLIST.map((r) => r.pattern.source).join('|')),
  );
});
