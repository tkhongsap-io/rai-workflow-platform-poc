// W0-08 section 8.3, verbatim: the five synthetic cases of fixture set slice1-synthetic (W1-09 owns this table;
// W0-02 section 8.3 owns the id convention). Every value is invented. Registry ids use the reserved year 2000 so
// they never collide with a server-generated `RAI-<yyyy>-<nnnn>`. `sourceRecordId` is a synthetic `AIR-FX-nnnn`
// or the literal `Unknown` (L10); it is never an official record id. Use-case groups are the W1-00 seed values.
//
// Slot dispositions are the W0-04 artifact_slot states. Slots not listed as attached, not_yet or missing are
// not_applicable: `default_non_vendor` (slots 3 and 4 when vendorInvolved is false; stored as the D12 locale key
// NON_VENDOR_DEFAULT_REASON_KEY) or `text` (the user-given reason, stored as given). The loader inserts exactly
// these rows; it never fakes a submission (W0-08 8.1 rule 4).

import { NON_VENDOR_DEFAULT_REASON_KEY, type SlotNumber, type StageContext } from '@rai/shared/schemas/pack';
import type { ModelType } from '@rai/shared/schemas/cases';
import { DUAL_ROLE_FIXTURE_USER_ID, FIXTURE_USERS, type FixtureUser } from '../users.js';
import { fixtureUuid } from '../ids.js';

export type FixtureCaseId =
  | 'fx-case-nonvendor'
  | 'fx-case-vendor'
  | 'fx-case-missing-slot'
  | 'fx-case-na-reasons'
  | 'fx-case-hr-dualrole';

export type FixtureSlotDisposition =
  | { state: 'attached'; fixtureDocumentId: string }
  | { state: 'not_yet' }
  | { state: 'missing' }
  | { state: 'not_applicable'; reason: { kind: 'default_non_vendor' } | { kind: 'text'; text: string } };

export interface FixtureCase {
  fixtureCaseId: FixtureCaseId;
  /** The UUID the loader writes as case.id (deterministic; fixtureUuid). */
  caseId: string;
  /** The UUID of the single open draft, pack_version.id. */
  draftVersionId: string;
  registryId: `RAI-2000-${string}`;
  /** The four-digit registry number; documents reference their case by it (W0-08 8.4 "Case" column). */
  caseNumber: '0001' | '0002' | '0003' | '0004' | '0005';
  useCaseName: string;
  businessUnitId: 'CM' | 'HR';
  businessUnit: string; // the BU display name; descriptive only, never read for access
  /** The fixture user id of the BU SPOC in scope on this case (a fact of the users table, restated for readers). */
  buSpocFixtureUserId: string;
  ownerFixtureUserId: 'fx-user-owner-cm';
  technicalOwner: string; // free text, invented
  vendorInvolved: boolean;
  modelType: ModelType;
  stageContext: StageContext;
  sourceRecordId: { kind: 'known'; value: `AIR-FX-${string}` } | { kind: 'unknown' };
  useCaseGroup: 'customer-analytics' | 'customer-service' | 'field-operations';
  checklistTemplateVersion: 'v1.0 Sheet3' | 'v2.0';
  slots: Readonly<Record<SlotNumber, FixtureSlotDisposition>>;
  purpose: string;
  /**
   * The identity evidence records cite for this case (done-when clause 3): who owns it, who is BU SPOC on it and
   * who submits it in the journey that uses it. Evidence also cites the set string from manifest.json.
   */
  evidence: {
    owner: string; // fixture user id
    buSpoc: string; // fixture user id
    submittedBy: string; // fixture user id of the journey submitter
    journey: string; // the ticket whose journey submits it
  };
}

const NA_DEFAULT: FixtureSlotDisposition = {
  state: 'not_applicable',
  reason: { kind: 'default_non_vendor' },
};
const NOT_YET: FixtureSlotDisposition = { state: 'not_yet' };
const MISSING: FixtureSlotDisposition = { state: 'missing' };
function attached(fixtureDocumentId: string): FixtureSlotDisposition {
  return { state: 'attached', fixtureDocumentId };
}
function naText(text: string): FixtureSlotDisposition {
  return { state: 'not_applicable', reason: { kind: 'text', text } };
}

export const FIXTURE_CASES: readonly FixtureCase[] = Object.freeze([
  {
    fixtureCaseId: 'fx-case-nonvendor',
    caseId: fixtureUuid('fx-case-nonvendor'),
    draftVersionId: fixtureUuid('fx-case-nonvendor/draft/1'),
    registryId: 'RAI-2000-0001',
    caseNumber: '0001',
    useCaseName: 'Churn Propensity Scoring',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    buSpocFixtureUserId: 'fx-user-spoc-cm',
    ownerFixtureUserId: 'fx-user-owner-cm',
    technicalOwner: 'Anucha M.',
    vendorInvolved: false,
    modelType: 'classic_ml',
    stageContext: 'pre_launch',
    sourceRecordId: { kind: 'known', value: 'AIR-FX-2291' },
    useCaseGroup: 'customer-analytics',
    checklistTemplateVersion: 'v1.0 Sheet3',
    slots: {
      1: attached('fx-doc-0001-01'),
      2: attached('fx-doc-0001-02'),
      3: NA_DEFAULT,
      4: NA_DEFAULT,
      5: attached('fx-doc-0001-05'),
      6: attached('fx-doc-0001-06'),
      7: attached('fx-doc-0001-07'),
      8: attached('fx-doc-0001-08'),
      9: attached('fx-doc-0001-09'),
    },
    purpose:
      'Non-vendor case. Slots 3 and 4 N/A by the non-vendor default (W1-04) with the default reason key; every other slot attached; slot 9 holds a PNG. The W1-INT journey case.',
    evidence: {
      owner: 'fx-user-owner-cm',
      buSpoc: 'fx-user-spoc-cm',
      submittedBy: 'fx-user-owner-cm',
      journey: 'W1-INT',
    },
  },
  {
    fixtureCaseId: 'fx-case-vendor',
    caseId: fixtureUuid('fx-case-vendor'),
    draftVersionId: fixtureUuid('fx-case-vendor/draft/1'),
    registryId: 'RAI-2000-0002',
    caseNumber: '0002',
    useCaseName: 'Retail Store Assistant',
    businessUnitId: 'HR',
    businessUnit: 'Human Resources',
    buSpocFixtureUserId: DUAL_ROLE_FIXTURE_USER_ID,
    ownerFixtureUserId: 'fx-user-owner-cm',
    technicalOwner: 'Benjamas L.',
    vendorInvolved: true,
    modelType: 'llm',
    stageContext: 'pre_launch',
    sourceRecordId: { kind: 'unknown' },
    useCaseGroup: 'customer-service',
    checklistTemplateVersion: 'v2.0',
    slots: {
      1: attached('fx-doc-0002-01'),
      2: attached('fx-doc-0002-02'),
      3: attached('fx-doc-0002-03'),
      4: attached('fx-doc-0002-04'),
      5: attached('fx-doc-0002-05'),
      6: attached('fx-doc-0002-06'),
      7: attached('fx-doc-0002-07'),
      8: attached('fx-doc-0002-08'),
      9: attached('fx-doc-0002-09'),
    },
    purpose:
      'Vendor case. All nine slots attached including DPA and SOW; checklist template v2.0 (so the v1.0 bands never apply, A08 later); slot 9 holds the Thai-named file.',
    evidence: {
      owner: 'fx-user-owner-cm',
      buSpoc: DUAL_ROLE_FIXTURE_USER_ID,
      submittedBy: 'fx-user-owner-cm',
      journey: 'W1-03 / W1-INT',
    },
  },
  {
    fixtureCaseId: 'fx-case-missing-slot',
    caseId: fixtureUuid('fx-case-missing-slot'),
    draftVersionId: fixtureUuid('fx-case-missing-slot/draft/1'),
    registryId: 'RAI-2000-0003',
    caseNumber: '0003',
    useCaseName: 'Field Technician Dispatch Optimiser',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    buSpocFixtureUserId: 'fx-user-spoc-cm',
    ownerFixtureUserId: 'fx-user-owner-cm',
    technicalOwner: 'Chaiwat N.',
    vendorInvolved: false,
    modelType: 'classic_ml',
    stageContext: 'pre_build',
    sourceRecordId: { kind: 'known', value: 'AIR-FX-2304' },
    useCaseGroup: 'field-operations',
    checklistTemplateVersion: 'v1.0 Sheet3',
    slots: {
      1: attached('fx-doc-0003-01'),
      2: attached('fx-doc-0003-02'),
      3: NA_DEFAULT,
      4: NA_DEFAULT,
      5: attached('fx-doc-0003-05'),
      6: attached('fx-doc-0003-06'),
      7: MISSING,
      8: NOT_YET,
      9: attached('fx-doc-0003-09'),
    },
    purpose:
      'Missing slot. Slot 7 (security assessment) missing; slot 8 not yet; 3 and 4 N/A by default; the rest attached. Submitted by fx-user-spoc-cm in the W1-INT SPOC test; submit succeeds and the missing slot raises a finding (A02).',
    evidence: {
      owner: 'fx-user-owner-cm',
      buSpoc: 'fx-user-spoc-cm',
      submittedBy: 'fx-user-spoc-cm',
      journey: 'W1-INT',
    },
  },
  {
    fixtureCaseId: 'fx-case-na-reasons',
    caseId: fixtureUuid('fx-case-na-reasons'),
    draftVersionId: fixtureUuid('fx-case-na-reasons/draft/1'),
    registryId: 'RAI-2000-0004',
    caseNumber: '0004',
    useCaseName: 'ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant)',
    businessUnitId: 'HR',
    businessUnit: 'Human Resources',
    buSpocFixtureUserId: DUAL_ROLE_FIXTURE_USER_ID,
    ownerFixtureUserId: 'fx-user-owner-cm',
    technicalOwner: 'Duangjai K.',
    vendorInvolved: true,
    modelType: 'llm',
    stageContext: 'idea',
    sourceRecordId: { kind: 'unknown' },
    useCaseGroup: 'customer-service',
    checklistTemplateVersion: 'v1.0 Sheet3',
    slots: {
      1: attached('fx-doc-0004-01'),
      2: attached('fx-doc-0004-02'),
      3: attached('fx-doc-0004-03'),
      4: naText('Vendor engaged under synthetic master agreement MSA-FX-0042; no separate statement of work'),
      5: attached('fx-doc-0004-05'),
      6: attached('fx-doc-0004-06'),
      7: attached('fx-doc-0004-07'),
      8: NOT_YET,
      9: naText('No supporting documents beyond the eight gated artefacts'),
    },
    purpose:
      'N/A with reasons. Slot 4 (SOW) and slot 9 N/A with a written reason; slot 8 not yet (idea stage); slots 1, 2, 3, 5, 6, 7 attached; Thai use-case name exercises W3-01 search and W3-03 subjects; submitted by the dual-role identity as SPOC in the W2 journey.',
    evidence: {
      owner: 'fx-user-owner-cm',
      buSpoc: DUAL_ROLE_FIXTURE_USER_ID,
      submittedBy: DUAL_ROLE_FIXTURE_USER_ID,
      journey: 'W2-INT',
    },
  },
  {
    fixtureCaseId: 'fx-case-hr-dualrole',
    caseId: fixtureUuid('fx-case-hr-dualrole'),
    draftVersionId: fixtureUuid('fx-case-hr-dualrole/draft/1'),
    registryId: 'RAI-2000-0005',
    caseNumber: '0005',
    useCaseName: 'Recruitment Screening Assistant',
    businessUnitId: 'HR',
    businessUnit: 'Human Resources',
    buSpocFixtureUserId: DUAL_ROLE_FIXTURE_USER_ID,
    ownerFixtureUserId: 'fx-user-owner-cm',
    technicalOwner: 'Ekachai P.',
    vendorInvolved: false,
    modelType: 'classic_ml',
    stageContext: 'pre_launch',
    sourceRecordId: { kind: 'known', value: 'AIR-FX-2317' },
    useCaseGroup: 'field-operations',
    checklistTemplateVersion: 'v1.0 Sheet3',
    slots: {
      1: attached('fx-doc-0005-01'),
      2: attached('fx-doc-0005-02'),
      3: NA_DEFAULT,
      4: NA_DEFAULT,
      5: attached('fx-doc-0005-05'),
      6: attached('fx-doc-0005-06'),
      7: attached('fx-doc-0005-07'),
      8: attached('fx-doc-0005-08'),
      9: NOT_YET,
    },
    purpose:
      'D05 self-approval case. Slots 3 and 4 N/A by the non-vendor default; slots 1, 2, 5, 6, 7, 8 attached; slot 9 not yet. Submitted by fx-user-owner-cm in W2-02; the dual-role identity is refused the DPO lane on it and permitted on a CM case.',
    evidence: {
      owner: 'fx-user-owner-cm',
      buSpoc: DUAL_ROLE_FIXTURE_USER_ID,
      submittedBy: 'fx-user-owner-cm',
      journey: 'W2-02',
    },
  },
]);

export function findFixtureCase(fixtureCaseId: string): FixtureCase | undefined {
  return FIXTURE_CASES.find((c) => c.fixtureCaseId === fixtureCaseId);
}

export function fixtureCaseByNumber(caseNumber: string): FixtureCase | undefined {
  return FIXTURE_CASES.find((c) => c.caseNumber === caseNumber);
}

/** The owner user of a fixture case (every fixture case is owned by fx-user-owner-cm). */
export function fixtureCaseOwner(fixtureCase: FixtureCase): FixtureUser {
  const owner = FIXTURE_USERS.find((u) => u.fixtureUserId === fixtureCase.ownerFixtureUserId);
  if (owner === undefined)
    throw new Error(`fixture owner ${fixtureCase.ownerFixtureUserId} is not a fixture user`);
  return owner;
}

/** The artifact_slot.reason value the loader stores for a not_applicable disposition. */
export function storedReason(disposition: FixtureSlotDisposition): string | null {
  if (disposition.state !== 'not_applicable') return null;
  return disposition.reason.kind === 'default_non_vendor'
    ? NON_VENDOR_DEFAULT_REASON_KEY
    : disposition.reason.text;
}
