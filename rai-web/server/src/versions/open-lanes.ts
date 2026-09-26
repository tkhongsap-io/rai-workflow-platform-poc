// Opens the three review lanes inside the submit transaction (W0-06 4.3 (d)+(f)), so a failure rolls back the
// whole submit. Slots resolve from the version's recorded lane_mapping_version (D02); risk_tier never routes.
// Recipients are data passed in; this module never hard-codes addresses.
import {
  LANES,
  LANE_MAPPINGS_BY_VERSION,
  slotsForLane,
  type Lane,
  type LaneMapping,
} from '@rai/shared/constants';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { AuditEventInput, AuditRefValue } from '../audit/store.js';
import type { Tx } from '../db/client.js';
import { enqueueCaseNotifications } from '../notifications/outbox.js';

const LANE_ROLES = new Set<string>(LANES);

export type LaneOpenRecipients = Readonly<Record<Lane, readonly string[]>>;

/** Empty recipient map (non-fixture / pre-W8); every lane has zero addresses. */
export const EMPTY_LANE_OPEN_RECIPIENTS: LaneOpenRecipients = Object.freeze({
  ai_coe: Object.freeze([] as const),
  dpo: Object.freeze([] as const),
  it_security: Object.freeze([] as const),
});

/**
 * Slice-1: every identity whose roles include a lane role is a recipient of that lane's open notice
 * (including the dual-role DPO). Addresses come from the identity table, never from literals here.
 */
export function laneOpenRecipientsFromIdentities(
  users: readonly { email: string; roles: readonly RoleScope[] }[],
): LaneOpenRecipients {
  const buckets: Record<Lane, string[]> = { ai_coe: [], dpo: [], it_security: [] };
  for (const user of users) {
    for (const pair of user.roles) {
      if (!LANE_ROLES.has(pair.role)) continue;
      const lane = pair.role as Lane;
      if (!buckets[lane].includes(user.email)) buckets[lane].push(user.email);
    }
  }
  return Object.freeze({
    ai_coe: Object.freeze(buckets.ai_coe),
    dpo: Object.freeze(buckets.dpo),
    it_security: Object.freeze(buckets.it_security),
  });
}

/** W3-F2: each lane reviewer's address, mapped to the business units where that reviewer holds a bu_spoc grant. */
export type LaneReviewerSpocUnits = Readonly<Record<string, readonly string[]>>;

export function laneReviewerSpocUnits(
  users: readonly { email: string; roles: readonly RoleScope[] }[],
): LaneReviewerSpocUnits {
  const out: Record<string, string[]> = {};
  for (const user of users) {
    if (!user.roles.some((grant) => LANE_ROLES.has(grant.role))) continue;
    const units = user.roles.flatMap((grant) =>
      grant.role === 'bu_spoc' && grant.scope.kind === 'business_unit' ? [grant.scope.businessUnit] : [],
    );
    if (units.length > 0) out[user.email] = units;
  }
  return Object.freeze(out);
}

/**
 * W3-F2 (register row "W3 deferred rulings", item 10; W0-05 3.3): a lane reviewer who is BU SPOC of the case's
 * business unit cannot decide that lane (D05), so gets no lane-opened mail for it. A reviewer who is the case owner
 * is not covered by the ruling. Without the SPOC map nobody is excluded.
 */
export function laneOpenRecipientsForCase(
  all: LaneOpenRecipients,
  spocUnits: LaneReviewerSpocUnits | undefined,
  businessUnitId: string,
): LaneOpenRecipients {
  if (spocUnits === undefined) return all;
  const keep = (email: string) => !(spocUnits[email] ?? []).includes(businessUnitId);
  return Object.freeze({
    ai_coe: Object.freeze(all.ai_coe.filter(keep)),
    dpo: Object.freeze(all.dpo.filter(keep)),
    it_security: Object.freeze(all.it_security.filter(keep)),
  });
}

export type AuditWriter = (
  event: Omit<AuditEventInput, 'correlationId' | 'actorSubjectId' | 'actorRole'>,
) => Promise<void>;

export interface OpenLanesInput {
  tx: Tx;
  audit: AuditWriter;
  caseId: string;
  versionId: string;
  /** The frozen pack_version.lane_mapping_version; slots resolve through LANE_MAPPINGS_BY_VERSION. */
  laneMappingVersion: string;
  correlationId: string;
  idempotencyKeyRef: string;
  occurredAt: Date;
  recipients: LaneOpenRecipients;
}

function mappingForVersion(laneMappingVersion: string): LaneMapping {
  const mapping = LANE_MAPPINGS_BY_VERSION[laneMappingVersion];
  if (mapping === undefined) {
    throw new Error(`unknown lane_mapping_version ${laneMappingVersion}`);
  }
  return mapping;
}

/**
 * After `version.submitted`: write `lane.opened` × 3 (ai_coe, dpo, it_security) then one `lane_open`
 * notification per recipient of each lane. Same correlation id as the submit.
 */
export async function openLanesOnSubmit(input: OpenLanesInput): Promise<void> {
  const {
    tx,
    audit,
    caseId,
    versionId,
    laneMappingVersion,
    correlationId,
    idempotencyKeyRef,
    occurredAt,
    recipients,
  } = input;
  const mapping = mappingForVersion(laneMappingVersion);

  for (const lane of LANES) {
    const slots = slotsForLane(lane, mapping);
    const targetRef: Record<string, AuditRefValue> = {
      idempotency_key: idempotencyKeyRef,
      lane,
      slots: [...slots],
      lane_mapping_version: laneMappingVersion,
    };
    await audit({
      action: 'lane.opened',
      targetCaseId: caseId,
      targetVersionId: versionId,
      targetRef,
      occurredAt,
    });
  }

  for (const lane of LANES) {
    await enqueueCaseNotifications(tx, {
      event: 'lane_open',
      caseId,
      versionId,
      lane,
      recipients: recipients[lane],
      templateKey: 'mail.lane_opened',
      templateParams: { lane, version_id: versionId },
      correlationId,
      occurredAt,
    });
  }
}
