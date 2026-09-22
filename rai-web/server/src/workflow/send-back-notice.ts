// W2-02: send_back notification outbox row (W0-04 Decide row; W0-05 3.3: owner only). Recipients are data
// passed in (fixture identities); this module never hard-codes addresses. Mail delivery is W3-03/W3-04.
import { uuidv7 } from '@rai/shared/ids';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { NOTIFICATION_EVENT_BY_KIND } from '@rai/shared/mail/types';
import type { Lane } from '@rai/shared/constants';
import type { Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';

const TEMPLATE_KEY = 'mail.sent_back' satisfies LocaleKey;
const SEND_BACK_EVENT = NOTIFICATION_EVENT_BY_KIND.sent_back; // stored W0-04 value `send_back`

/** Slice-1: look up the owner's email from identity data by subject id. */
export function sendBackRecipientsFromIdentities(
  users: readonly { subjectId: string; email: string }[],
  ownerSubjectId: string,
): readonly string[] {
  const owner = users.find((u) => u.subjectId === ownerSubjectId);
  return owner === undefined ? [] : [owner.email];
}

export function sendBackDeepLinkPath(caseId: string, versionId: string): string {
  return `/cases/${caseId}/versions/${versionId}`;
}

export async function insertSendBackNotifications(input: {
  tx: Tx;
  caseId: string;
  versionId: string;
  lane: Lane;
  recipients: readonly string[];
  correlationId: string;
  occurredAt: Date;
  decisionId: string;
}): Promise<void> {
  const deepLinkPath = sendBackDeepLinkPath(input.caseId, input.versionId);
  for (const recipient of input.recipients) {
    await input.tx.insert(notification).values({
      id: uuidv7(),
      event: SEND_BACK_EVENT,
      versionId: input.versionId,
      caseId: input.caseId,
      lane: input.lane,
      recipient,
      deepLinkPath,
      templateKey: TEMPLATE_KEY,
      templateParams: {
        lane: input.lane,
        version_id: input.versionId,
        decision_id: input.decisionId,
      },
      status: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      createdAt: input.occurredAt,
      correlationId: input.correlationId,
    });
  }
}
