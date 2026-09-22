// W2-06: ready notification outbox row (W0-04 Ready row; W0-06 4.9 / 4.11). Lane stored as '-' (dedup
// key). Recipients are data passed in (owner scope); this module never hard-codes addresses. Mail
// delivery is W3-03/W3-04 — do not send here.
import { uuidv7 } from '@rai/shared/ids';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { NOTIFICATION_EVENT_BY_KIND } from '@rai/shared/mail/types';
import type { Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';

const TEMPLATE_KEY = 'mail.ready_for_launch' satisfies LocaleKey;
const READY_EVENT = NOTIFICATION_EVENT_BY_KIND.ready_for_launch; // stored W0-04 value `ready`
const READY_LANE = '-';

export function readyDeepLinkPath(caseId: string, versionId: string): string {
  return `/cases/${caseId}/versions/${versionId}`;
}

export async function insertReadyNotifications(input: {
  tx: Tx;
  caseId: string;
  versionId: string;
  recipients: readonly string[];
  correlationId: string;
  occurredAt: Date;
}): Promise<void> {
  const deepLinkPath = readyDeepLinkPath(input.caseId, input.versionId);
  for (const recipient of input.recipients) {
    await input.tx.insert(notification).values({
      id: uuidv7(),
      event: READY_EVENT,
      versionId: input.versionId,
      caseId: input.caseId,
      lane: READY_LANE,
      recipient,
      deepLinkPath,
      templateKey: TEMPLATE_KEY,
      templateParams: { version_id: input.versionId },
      status: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      createdAt: input.occurredAt,
      correlationId: input.correlationId,
    });
  }
}
