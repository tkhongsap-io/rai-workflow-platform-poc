// Outbox rows for committed case events. Callers insert them inside the business transaction, so a rollback
// leaves no row; the dispatcher in service.ts sends only after commit. Delivery columns take their defaults.
import type { Lane } from '@rai/shared/constants';
import { uuidv7 } from '@rai/shared/ids';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { NotificationEvent } from '@rai/shared/mail/types';
import type { Tx } from '../db/client.js';
import { notification } from '../db/schema/notification.js';

/** The SPA route of a submitted version; opaque IDs only, never a token. */
export function caseVersionPath(caseId: string, versionId: string): string {
  return `/cases/${caseId}/versions/${versionId}`;
}

/** The case page, where the owner edits the successor draft after a send-back (W3-F4). */
export function casePath(caseId: string): string {
  return `/cases/${caseId}`;
}

/** One queued row per recipient. Recipients are data from the caller; no address is chosen here. */
export async function enqueueCaseNotifications(
  tx: Tx,
  input: {
    event: Exclude<NotificationEvent, 'sla_breach_digest'>;
    caseId: string;
    versionId: string;
    lane: Lane | '-';
    recipients: readonly string[];
    templateKey: LocaleKey;
    templateParams: Record<string, string>;
    correlationId: string;
    occurredAt: Date;
  },
): Promise<void> {
  const { recipients, occurredAt, ...row } = input;
  // W3-F4 (ruling item 12): a send-back opens the case, where the successor draft and its feedback are; the
  // worker refuses to send a mail whose composed link differs from this committed path.
  const deepLinkPath =
    row.event === 'send_back' ? casePath(row.caseId) : caseVersionPath(row.caseId, row.versionId);
  for (const recipient of recipients)
    await tx
      .insert(notification)
      .values({ ...row, id: uuidv7(), recipient, deepLinkPath, createdAt: occurredAt });
}
