// W1-07 (Lane B): pure view-model functions for the case list (W0-02 section 8.1: web unit tests cover view
// models and i18n only). "Next action" and the scope line are display derived from what the server returned (the
// case status, the principal's (role, scope) pairs); neither is a permission decision.

import type { Principal } from '@rai/shared/schemas/auth';
import type { CaseStatus, CaseSummary, RiskTier } from '@rai/shared/schemas/cases';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { BadgeTone } from '../../components/status-badge.js';
import { RISK_TIER_KEY } from '../case/risk-questionnaire.view-model.js';

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
  /** W3-F1: the owner's display name when the read carries one, else the subject id. */
  ownerLabel: string;
  status: CaseStatus;
  versionNumber: number | null;
  nextActionKey: LocaleKey;
  updatedAt: string;
  /** W5-09: the proposed-tier chip, or null for no chip. */
  riskTier: RiskTierChip | null;
}

export function toRowModel(summary: CaseSummary): CaseRowModel {
  return {
    caseId: summary.caseId,
    registryId: summary.registryId,
    useCaseName: summary.useCaseName,
    businessUnitLabel: `${summary.businessUnit} (${summary.businessUnitId})`,
    useCaseGroup: summary.useCaseGroup,
    businessOwner: summary.businessOwner,
    ownerLabel: summary.ownerDisplayName ?? summary.businessOwner,
    status: summary.status,
    versionNumber: summary.currentVersionNumber,
    nextActionKey: NEXT_ACTION_KEY[summary.status],
    updatedAt: summary.updatedAt,
    riskTier: riskTierChipOf(summary.riskTier),
  };
}

/**
 * W5-09 (W5 plan section 7): tone per tier, the same as the pack editor's preview, so no two tiers share a tone and
 * Unknown is never styled as Low. The label (text plus glyph) always shows, so the tier never reads by colour alone.
 */
export const RISK_TIER_TONE: Readonly<Record<RiskTier, BadgeTone>> = Object.freeze({
  high: 'danger',
  medium: 'warn',
  low: 'ok',
  unknown: 'muted',
});

export interface RiskTierChip {
  tier: RiskTier;
  labelKey: LocaleKey;
  tone: BadgeTone;
}

/**
 * The card chip for a list item's `riskTier`. Absent (the frozen substitute omits the key) and null (no proposal yet,
 * or an unavailable one) give no chip (W5 plan section 6). The label is the `risk.tier.*` key: a list does not read
 * the rubric, whose `tierLabels` are the synthetic placeholder's.
 */
export function riskTierChipOf(riskTier: RiskTier | null | undefined): RiskTierChip | null {
  if (riskTier === undefined || riskTier === null) return null;
  return { tier: riskTier, labelKey: RISK_TIER_KEY[riskTier], tone: RISK_TIER_TONE[riskTier] };
}

/**
 * The placeholder rubric banner shows once above a list whose page shows at least one tier (W5 plan section 7: the
 * banner accompanies every tier while the rubric is the synthetic placeholder; the W5 schema admits no other
 * provenance, D07 open).
 */
export function showsPlaceholderBanner(items: ReadonlyArray<Pick<CaseSummary, 'riskTier'>>): boolean {
  return items.some((item) => riskTierChipOf(item.riskTier) !== null);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
