// W1-07: the list view model derives display only from what the API returned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Principal } from '@rai/shared/schemas/auth';
import type { CaseSummary } from '@rai/shared/schemas/cases';
import { LOCALE_CATALOGUES } from '@rai/shared/locales/keys';
import {
  pageCount,
  riskTierChipOf,
  scopeLineFor,
  showsPlaceholderBanner,
  toRowModel,
} from './case-list.view-model.js';

const base: Omit<Principal, 'roles'> = {
  subjectId: 'fixture:x',
  displayName: 'X',
  email: 'x@rai-desk.example',
};

test('scope line: owner → own cases; SPOC → its BU(s); any all_cases grant → every case', () => {
  assert.deepEqual(scopeLineFor({ ...base, roles: [{ role: 'owner', scope: { kind: 'own_cases' } }] }), {
    key: 'scope.own_cases',
  });
  assert.deepEqual(
    scopeLineFor({
      ...base,
      roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
    }),
    { key: 'scope.business_unit', params: { businessUnit: 'CM' } },
  );
  // The dual-role identity (DPO + BU SPOC HR): the server lists every case, so the line says so.
  assert.deepEqual(
    scopeLineFor({
      ...base,
      roles: [
        { role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } },
        { role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'HR' } },
      ],
    }),
    { key: 'scope.all_cases' },
  );
});

test('a list row carries identity, version and the next-action key for its status', () => {
  const row = toRowModel({
    caseId: 'c1',
    registryId: 'RAI-2000-0001',
    useCaseName: 'Churn Propensity Scoring',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    businessOwner: 'fixture:fx-user-owner-cm',
    useCaseGroup: 'customer-analytics',
    status: 'draft',
    currentVersionNumber: null,
    updatedAt: '2026-09-21T00:00:00.000Z',
  });
  assert.equal(row.businessUnitLabel, 'Consumer Mobile (CM)');
  // W3-F1: a read without a name still shows the subject id, never an empty cell
  assert.equal(row.ownerLabel, 'fixture:fx-user-owner-cm');
  assert.equal(row.versionNumber, null);
  assert.equal(row.nextActionKey, 'next_action.draft');
  assert.equal(
    toRowModel({
      caseId: 'c2',
      registryId: 'RAI-2000-0002',
      useCaseName: 'x',
      businessUnitId: 'HR',
      businessUnit: 'Human Resources',
      businessOwner: 'fixture:fx-user-owner-cm',
      useCaseGroup: 'customer-service',
      status: 'in_review',
      currentVersionNumber: 1,
      updatedAt: '2026-09-21T00:00:00.000Z',
    }).nextActionKey,
    'next_action.in_review',
  );
});

test('W3-F1: the owner cell shows the display name when the read carries one', () => {
  const row = toRowModel({
    caseId: 'c3',
    registryId: 'RAI-2000-0003',
    useCaseName: 'x',
    businessUnitId: 'CM',
    businessUnit: 'Consumer Mobile',
    businessOwner: 'fixture:fx-user-owner-cm',
    ownerDisplayName: 'ณัฐพร ส. (Nattaporn S.)',
    useCaseGroup: 'field-operations',
    status: 'draft',
    currentVersionNumber: null,
    updatedAt: '2026-09-26T00:00:00.000Z',
  });
  assert.equal(row.ownerLabel, 'ณัฐพร ส. (Nattaporn S.)');
});

test('page count never drops below one', () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageCount(5, 0), 5);
});

// W5-09 (W5 plan sections 6 and 7): the tier chip on each card. The shared type declares `riskTier` optional (the
// frozen substitute omits it); the web reads absent as null, and null shows no chip.
const summary: CaseSummary = {
  caseId: 'c1',
  registryId: 'RAI-2000-0001',
  useCaseName: 'Churn Propensity Scoring',
  businessUnitId: 'CM',
  businessUnit: 'Consumer Mobile',
  businessOwner: 'fixture:fx-user-owner-cm',
  useCaseGroup: 'customer-analytics',
  status: 'in_review',
  currentVersionNumber: 1,
  updatedAt: '2026-09-21T00:00:00.000Z',
};

test('tier chip: each tier has its th/en label and a distinct tone; Unknown is never styled as Low', () => {
  assert.deepEqual(riskTierChipOf('high'), { tier: 'high', labelKey: 'risk.tier.high', tone: 'danger' });
  assert.deepEqual(riskTierChipOf('medium'), { tier: 'medium', labelKey: 'risk.tier.medium', tone: 'warn' });
  assert.deepEqual(riskTierChipOf('low'), { tier: 'low', labelKey: 'risk.tier.low', tone: 'ok' });
  assert.deepEqual(riskTierChipOf('unknown'), {
    tier: 'unknown',
    labelKey: 'risk.tier.unknown',
    tone: 'muted',
  });
  const tones = (['high', 'medium', 'low', 'unknown'] as const).map((tier) => riskTierChipOf(tier)!.tone);
  assert.equal(new Set(tones).size, tones.length, 'no two tiers share a tone');
  for (const locale of ['th', 'en'] as const) {
    assert.ok(LOCALE_CATALOGUES[locale]['risk.list.tier'].length > 0);
    for (const tier of ['high', 'medium', 'low', 'unknown'] as const)
      assert.ok(LOCALE_CATALOGUES[locale][riskTierChipOf(tier)!.labelKey].length > 0);
  }
});

test('tier chip: absent (the substitute) and null (no proposal, or unavailable) show no chip', () => {
  assert.equal(riskTierChipOf(undefined), null);
  assert.equal(riskTierChipOf(null), null);
  assert.equal(toRowModel(summary).riskTier, null);
  assert.equal(toRowModel({ ...summary, riskTier: null }).riskTier, null);
  assert.deepEqual(toRowModel({ ...summary, riskTier: 'unknown' }).riskTier, riskTierChipOf('unknown'));
});

test('the placeholder banner shows once a card on the page shows a tier, never for a page without one', () => {
  assert.equal(showsPlaceholderBanner([]), false);
  assert.equal(showsPlaceholderBanner([summary, { ...summary, riskTier: null }]), false);
  assert.equal(showsPlaceholderBanner([summary, { ...summary, riskTier: 'low' }]), true);
});
