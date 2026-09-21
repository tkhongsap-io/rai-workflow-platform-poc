// W1-07 (Lane B): pure view-model functions for the case list (W0-02 section 8.1: web unit tests cover view
// models and i18n only). "Next action" and the scope line are display derived from what the server returned (the
// case status, the principal's (role, scope) pairs); neither is a permission decision.

import type { Principal } from '@rai/shared/schemas/auth';
import type { CaseStatus, CaseSummary } from '@rai/shared/schemas/cases';
import type { LocaleKey } from '@rai/shared/locales/keys';

export const NEXT_ACTION_KEY: Readonly<Record<CaseStatus, LocaleKey>> = Object.freeze({
  draft: 'next_action.draft',
  in_review: 'next_action.in_review',
  sent_back: 'next_action.sent_back',
  awaiting_disposition: 'next_action.awaiting_disposition',
  ready_for_launch: 'next_action.ready_for_launch',
});

export interface ScopeLine {
  key: LocaleKey;
  params?: Record<string, string>;
}

/** One line describing the widest scope the server granted; several BU grants list every BU. */
export function scopeLineFor(principal: Principal): ScopeLine {
  if (principal.roles.some((r) => r.scope.kind === 'all_cases')) return { key: 'scope.all_cases' };
  const units = principal.roles.flatMap((r) =>
    r.scope.kind === 'business_unit' ? [r.scope.businessUnit] : [],
  );
  if (units.length > 0) return { key: 'scope.business_unit', params: { businessUnit: units.join(', ') } };
  return { key: 'scope.own_cases' };
}

export interface CaseRowModel {
  caseId: string;
  registryId: string;
  useCaseName: string;
  businessUnitLabel: string;
  useCaseGroup: string;
  businessOwner: string;
  status: CaseStatus;
  versionNumber: number | null;
  nextActionKey: LocaleKey;
  updatedAt: string;
}

export function toRowModel(summary: CaseSummary): CaseRowModel {
  return {
    caseId: summary.caseId,
    registryId: summary.registryId,
    useCaseName: summary.useCaseName,
    businessUnitLabel: `${summary.businessUnit} (${summary.businessUnitId})`,
    useCaseGroup: summary.useCaseGroup,
    businessOwner: summary.businessOwner,
    status: summary.status,
    versionNumber: summary.currentVersionNumber,
    nextActionKey: NEXT_ACTION_KEY[summary.status],
    updatedAt: summary.updatedAt,
  };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
