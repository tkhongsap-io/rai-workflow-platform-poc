// W2-01: open the three review lanes inside the submit transaction (W0-06 4.3 (d)+(f)). Resolves slots from the
// version's recorded lane_mapping_version via LANE_MAPPINGS_BY_VERSION (D02); never reads risk_tier. One
// lane.opened audit per lane, then one lane_open notification per (lane, recipient). Recipients are data passed
// in (fixture identities that hold the lane in slice 1); this module never hard-codes addresses. W3-03/W3-04
// deliver mail later; AD resolution is W8.
import {
  LANES,
  LANE_MAPPINGS_BY_VERSION,
  slotsForLane,
  type Lane,
  type LaneMapping,
} from '@rai/shared/constants';
import { uuidv7 } from '@rai/shared/ids';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { NOTIFICATION_EVENT_BY_KIND } from '@rai/shared/mail/types';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { AuditEventInput, AuditRefValue } from '../audit/store.js';
import type { Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';

const TEMPLATE_KEY = 'mail.lane_opened' satisfies LocaleKey;
const LANE_OPEN_EVENT = NOTIFICATION_EVENT_BY_KIND.lane_opened; // stored W0-04 value `lane_open`
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
  /**
   * Test-only: throws after the first notification insert has been attempted, so a rollback assertion
   * fails if notification writes were outside the transaction. Ignored unless NODE_ENV is `test`.
   */
  failAfterFirstLaneOpenNotification?: () => void;
}

/** Deep link path the SPA already serves for a frozen submitted version (no token). */
export function laneOpenDeepLinkPath(caseId: string, versionId: string): string {
  return `/cases/${caseId}/versions/${versionId}`;
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
    failAfterFirstLaneOpenNotification,
  } = input;
  const mapping = mappingForVersion(laneMappingVersion);
  const deepLinkPath = laneOpenDeepLinkPath(caseId, versionId);
  const injectFailure =
    process.env.NODE_ENV === 'test' && failAfterFirstLaneOpenNotification !== undefined
      ? failAfterFirstLaneOpenNotification
      : undefined;

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

  let notificationsAttempted = 0;
  for (const lane of LANES) {
    for (const recipient of recipients[lane]) {
      await tx.insert(notification).values({
        id: uuidv7(),
        event: LANE_OPEN_EVENT,
        versionId,
        caseId,
        lane,
        recipient,
        deepLinkPath,
        templateKey: TEMPLATE_KEY,
        templateParams: { lane, version_id: versionId },
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        lastErrorCode: null,
        createdAt: occurredAt,
        correlationId,
      });
      notificationsAttempted += 1;
      if (notificationsAttempted === 1 && injectFailure !== undefined) injectFailure();
    }
  }
}
