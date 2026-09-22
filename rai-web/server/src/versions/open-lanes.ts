// W2-01: open the three review lanes inside the submit transaction (W0-06 4.3 (d)+(f)). Uses the recorded
// CURRENT_LANE_MAPPING / slotsForLane (D02); never reads risk_tier. One lane.opened audit and one lane_open
// notification per lane; failure on any rolls back the whole submit. W3-03/W3-04 deliver mail later.
import { CURRENT_LANE_MAPPING, LANES, slotsForLane, type Lane } from '@rai/shared/constants';
import { uuidv7 } from '@rai/shared/ids';
import { NOTIFICATION_EVENT_BY_KIND } from '@rai/shared/mail/types';
import type { AuditEventInput, AuditRefValue } from '../audit/store.js';
import type { Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';

/** Single-role fixture reviewers only (W2-01 ruling); dual-role, owners, SPOC and admin are not notified here. */
export const LANE_OPEN_RECIPIENTS: Readonly<Record<Lane, string>> = Object.freeze({
  ai_coe: 'ai-coe@rai-desk.example',
  dpo: 'dpo@rai-desk.example',
  it_security: 'it-security@rai-desk.example',
});

const TEMPLATE_KEY = 'mail.lane_opened' as const;
const LANE_OPEN_EVENT = NOTIFICATION_EVENT_BY_KIND.lane_opened; // stored W0-04 value `lane_open`

export type AuditWriter = (
  event: Omit<AuditEventInput, 'correlationId' | 'actorSubjectId' | 'actorRole'>,
) => Promise<void>;

export interface OpenLanesInput {
  tx: Tx;
  audit: AuditWriter;
  caseId: string;
  versionId: string;
  correlationId: string;
  idempotencyKeyRef: string;
  occurredAt: Date;
  /** Test-only: throws when the third lane (it_security) is about to be written; unset in production. */
  failBeforeThirdLaneOpen?: () => void;
}

/** Deep link path the SPA already serves for a frozen submitted version (no token). */
export function laneOpenDeepLinkPath(caseId: string, versionId: string): string {
  return `/cases/${caseId}/versions/${versionId}`;
}

/**
 * After `version.submitted`: write `lane.opened` × 3 (ai_coe, dpo, it_security) then three `lane_open`
 * notification rows. Same correlation id as the submit; actor/role come from the surrounding `audit` wrapper.
 */
export async function openLanesOnSubmit(input: OpenLanesInput): Promise<void> {
  const {
    tx,
    audit,
    caseId,
    versionId,
    correlationId,
    idempotencyKeyRef,
    occurredAt,
    failBeforeThirdLaneOpen,
  } = input;
  const deepLinkPath = laneOpenDeepLinkPath(caseId, versionId);

  for (let i = 0; i < LANES.length; i += 1) {
    const lane = LANES[i]!;
    if (i === 2 && failBeforeThirdLaneOpen !== undefined) failBeforeThirdLaneOpen();
    const slots = slotsForLane(lane, CURRENT_LANE_MAPPING);
    const targetRef: Record<string, AuditRefValue> = {
      idempotency_key: idempotencyKeyRef,
      lane,
      slots: [...slots],
      lane_mapping_version: CURRENT_LANE_MAPPING.version,
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
    await tx.insert(notification).values({
      id: uuidv7(),
      event: LANE_OPEN_EVENT,
      versionId,
      caseId,
      lane,
      recipient: LANE_OPEN_RECIPIENTS[lane],
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
  }
}
