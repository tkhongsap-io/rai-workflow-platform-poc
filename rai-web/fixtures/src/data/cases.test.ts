// The W1-09 tables match W0-08 sections 8.3 and 8.4 row for row, reference only W1-00 identities and seed values,
// and state the identity evidence records cite (done-when clause 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRegistryId } from '@rai/shared/ids';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { FIXTURE_CASES, findFixtureCase, fixtureCaseOwner, storedReason } from './cases/index.js';
import { FIXTURE_DOCUMENTS, THAI_NAMED_FIXTURE_DOCUMENT_ID, findFixtureDocument } from './documents/index.js';
import { fixtureUuid } from './ids.js';
import {
  DUAL_ROLE_FIXTURE_USER_ID,
  FIXTURE_BUSINESS_UNITS,
  FIXTURE_USERS,
  findFixtureUser,
} from './users.js';

test('five cases with the W0-08 8.3 ids, registry ids in the reserved year and one purpose each', () => {
  assert.deepEqual(
    FIXTURE_CASES.map((c) => [c.fixtureCaseId, c.registryId]),
    [
      ['fx-case-nonvendor', 'RAI-2000-0001'],
      ['fx-case-vendor', 'RAI-2000-0002'],
      ['fx-case-missing-slot', 'RAI-2000-0003'],
      ['fx-case-na-reasons', 'RAI-2000-0004'],
      ['fx-case-hr-dualrole', 'RAI-2000-0005'],
    ],
  );
  for (const c of FIXTURE_CASES) {
    assert.ok(isRegistryId(c.registryId));
    assert.equal(c.registryId, `RAI-2000-${c.caseNumber}`);
    assert.equal(c.caseId, fixtureUuid(c.fixtureCaseId));
    assert.match(c.caseId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(c.caseId, c.draftVersionId);
  }
  assert.equal(new Set(FIXTURE_CASES.flatMap((c) => [c.caseId, c.draftVersionId])).size, 10, 'distinct ids');
  assert.ok(Object.isFrozen(FIXTURE_CASES));
});

test('every case is owned by fx-user-owner-cm, lives in a fixture BU, and its stated SPOC is the user holding bu_spoc on that BU', () => {
  for (const c of FIXTURE_CASES) {
    assert.equal(c.ownerFixtureUserId, 'fx-user-owner-cm');
    assert.equal(fixtureCaseOwner(c).subjectId, 'fixture:fx-user-owner-cm');
    const bu = FIXTURE_BUSINESS_UNITS.find((b) => b.businessUnitId === c.businessUnitId);
    assert.ok(bu, c.businessUnitId);
    assert.equal(c.businessUnit, bu.displayName);
    const spocs = FIXTURE_USERS.filter((u) =>
      u.roles.some(
        (r) =>
          r.role === 'bu_spoc' &&
          r.scope.kind === 'business_unit' &&
          r.scope.businessUnit === c.businessUnitId,
      ),
    );
    assert.deepEqual(
      spocs.map((u) => u.fixtureUserId),
      [c.buSpocFixtureUserId],
      `${c.fixtureCaseId}: SPOC of ${c.businessUnitId}`,
    );
    assert.ok(
      findFixtureUser(c.evidence.owner) &&
        findFixtureUser(c.evidence.buSpoc) &&
        findFixtureUser(c.evidence.submittedBy),
    );
    assert.equal(c.evidence.owner, c.ownerFixtureUserId);
    assert.equal(c.evidence.buSpoc, c.buSpocFixtureUserId);
    assert.ok(c.evidence.journey.length > 0);
  }
});

test('the HR cases (vendor, N/A reasons, D05) are in the BU whose SPOC is the dual-role identity; the CM cases are not', () => {
  const hr = FIXTURE_CASES.filter((c) => c.businessUnitId === 'HR').map((c) => c.fixtureCaseId);
  assert.deepEqual(hr, ['fx-case-vendor', 'fx-case-na-reasons', 'fx-case-hr-dualrole']);
  for (const id of hr) assert.equal(findFixtureCase(id)!.buSpocFixtureUserId, DUAL_ROLE_FIXTURE_USER_ID);
  for (const c of FIXTURE_CASES.filter((c) => c.businessUnitId === 'CM'))
    assert.equal(c.buSpocFixtureUserId, 'fx-user-spoc-cm');
  assert.equal(findFixtureCase('fx-case-na-reasons')!.evidence.submittedBy, DUAL_ROLE_FIXTURE_USER_ID);
});

test('use-case groups and template versions are the W1-00 seed values; source record ids are synthetic AIR-FX-nnnn or Unknown', () => {
  for (const c of FIXTURE_CASES) {
    assert.ok(CONFIGURATION_SEED.use_case_groups.groups.includes(c.useCaseGroup), c.useCaseGroup);
    assert.ok(CONFIGURATION_SEED.checklist_templates.versions.includes(c.checklistTemplateVersion));
    if (c.sourceRecordId.kind === 'known') assert.match(c.sourceRecordId.value, /^AIR-FX-\d{4}$/);
  }
  assert.equal(findFixtureCase('fx-case-vendor')!.checklistTemplateVersion, 'v2.0');
  assert.deepEqual(
    FIXTURE_CASES.map((c) => [c.vendorInvolved, c.modelType, c.stageContext]),
    [
      [false, 'classic_ml', 'pre_launch'],
      [true, 'llm', 'pre_launch'],
      [false, 'classic_ml', 'pre_build'],
      [true, 'llm', 'idea'],
      [false, 'classic_ml', 'pre_launch'],
    ],
  );
  assert.equal(
    findFixtureCase('fx-case-na-reasons')!.useCaseName,
    'ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)',
  );
});

test('slot dispositions are exactly W0-08 8.3: non-vendor default, all attached, missing slot, N/A with reasons, D05', () => {
  const states = (id: string) =>
    Object.entries(findFixtureCase(id)!.slots)
      .map(([slot, d]) => `${slot}:${d.state}`)
      .join(' ');
  assert.equal(
    states('fx-case-nonvendor'),
    '1:attached 2:attached 3:not_applicable 4:not_applicable 5:attached 6:attached 7:attached 8:attached 9:attached',
  );
  assert.equal(
    states('fx-case-vendor'),
    '1:attached 2:attached 3:attached 4:attached 5:attached 6:attached 7:attached 8:attached 9:attached',
  );
  assert.equal(
    states('fx-case-missing-slot'),
    '1:attached 2:attached 3:not_applicable 4:not_applicable 5:attached 6:attached 7:missing 8:not_yet 9:attached',
  );
  assert.equal(
    states('fx-case-na-reasons'),
    '1:attached 2:attached 3:attached 4:not_applicable 5:attached 6:attached 7:attached 8:not_yet 9:not_applicable',
  );
  assert.equal(
    states('fx-case-hr-dualrole'),
    '1:attached 2:attached 3:not_applicable 4:not_applicable 5:attached 6:attached 7:attached 8:attached 9:not_yet',
  );

  // The default N/A fires only on slots 3 and 4 of non-vendor cases and stores the D12 locale key; explicit N/A
  // stores the written reason; nothing else has a reason.
  for (const c of FIXTURE_CASES) {
    for (const [slot, d] of Object.entries(c.slots)) {
      if (d.state === 'not_applicable' && d.reason.kind === 'default_non_vendor') {
        assert.equal(c.vendorInvolved, false, `${c.fixtureCaseId} slot ${slot}`);
        assert.ok(slot === '3' || slot === '4');
        assert.equal(storedReason(d), NON_VENDOR_DEFAULT_REASON_KEY);
      } else if (d.state === 'not_applicable' && d.reason.kind === 'text') {
        assert.equal(c.fixtureCaseId, 'fx-case-na-reasons');
        assert.equal(storedReason(d), d.reason.text);
        assert.ok(d.reason.text.length >= 1 && d.reason.text.length <= 500);
      } else assert.equal(storedReason(d), null);
    }
  }
  const na = findFixtureCase('fx-case-na-reasons')!.slots;
  assert.deepEqual(na[4], {
    state: 'not_applicable',
    reason: {
      kind: 'text',
      text: 'Vendor engaged under synthetic master agreement MSA-FX-0042; no separate statement of work',
    },
  });
  assert.deepEqual(na[9], {
    state: 'not_applicable',
    reason: { kind: 'text', text: 'No supporting documents beyond the eight gated artefacts' },
  });
});

test('33 documents (W0-08 8.4), each attached by exactly one slot of its own case, ids fx-doc-<case>-<slot>', () => {
  assert.equal(FIXTURE_DOCUMENTS.length, 33);
  assert.equal(new Set(FIXTURE_DOCUMENTS.map((d) => d.fixtureDocumentId)).size, 33);
  assert.equal(new Set(FIXTURE_DOCUMENTS.map((d) => d.artifactId)).size, 33);
  const attached = new Map<string, string>();
  for (const c of FIXTURE_CASES)
    for (const [slot, d] of Object.entries(c.slots))
      if (d.state === 'attached') {
        assert.ok(!attached.has(d.fixtureDocumentId), `${d.fixtureDocumentId} attached twice`);
        attached.set(d.fixtureDocumentId, `${c.caseNumber}-${slot.padStart(2, '0')}`);
      }
  assert.equal(attached.size, 33);
  for (const d of FIXTURE_DOCUMENTS) {
    assert.equal(d.fixtureDocumentId, `fx-doc-${d.caseNumber}-${String(d.slot).padStart(2, '0')}`);
    assert.equal(attached.get(d.fixtureDocumentId), `${d.caseNumber}-${String(d.slot).padStart(2, '0')}`);
    assert.equal(d.artifactId, fixtureUuid(d.fixtureDocumentId));
  }
  assert.deepEqual(
    FIXTURE_DOCUMENTS.filter((d) => d.caseNumber === '0002').map((d) => d.slot),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(findFixtureDocument(THAI_NAMED_FIXTURE_DOCUMENT_ID)!.caseNumber, '0002');
  assert.equal(findFixtureDocument('fx-doc-0002-03')!.sizeClass, 'medium');
  assert.equal(findFixtureDocument('fx-doc-0001-09')!.kind, 'png');
  assert.equal(findFixtureDocument('fx-doc-0003-09')!.kind, 'jpeg');
  assert.equal(findFixtureDocument('fx-doc-0004-06')!.kind, 'png');
});
