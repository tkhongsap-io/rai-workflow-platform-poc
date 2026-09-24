// A send-back notice goes to the case owner only (W0-05 3.3) and names the deciding lane and decision.
import type { Lane } from '@rai/shared/constants';
import type { Tx } from '../db/client.js';
import { enqueueCaseNotifications } from '../notifications/outbox.js';

/** Looks up the owner's address in identity data by subject ID. */
export function sendBackRecipientsFromIdentities(
  users: readonly { subjectId: string; email: string }[],
  ownerSubjectId: string,
): readonly string[] {
  const owner = users.find((u) => u.subjectId === ownerSubjectId);
  return owner === undefined ? [] : [owner.email];
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
  const { tx, decisionId, ...rest } = input;
  await enqueueCaseNotifications(tx, {
    ...rest,
    event: 'send_back',
    templateKey: 'mail.sent_back',
    templateParams: { lane: input.lane, version_id: input.versionId, decision_id: decisionId },
  });
}
