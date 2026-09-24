// The Ready notice goes to the owner only; it has no deciding lane, so the row stores '-'.
import type { Tx } from '../db/client.js';
import { enqueueCaseNotifications } from '../notifications/outbox.js';

export async function insertReadyNotifications(input: {
  tx: Tx;
  caseId: string;
  versionId: string;
  recipients: readonly string[];
  correlationId: string;
  occurredAt: Date;
}): Promise<void> {
  const { tx, ...rest } = input;
  await enqueueCaseNotifications(tx, {
    ...rest,
    event: 'ready',
    lane: '-',
    templateKey: 'mail.ready_for_launch',
    templateParams: { version_id: input.versionId },
  });
}
