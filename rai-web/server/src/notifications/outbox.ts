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
  const deepLinkPath = caseVersionPath(row.caseId, row.versionId);
  for (const recipient of recipients)
    await tx
      .insert(notification)
      .values({ ...row, id: uuidv7(), recipient, deepLinkPath, createdAt: occurredAt });
}
