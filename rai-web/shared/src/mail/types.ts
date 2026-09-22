// W0-07 section 4.2, transcribed (W1-00 creates; W1-11 and W3-03/W3-04 consume). The sink is handed committed
// events only; a deep link carries no token and grants nothing (A05).

import type { DigestJobProvenance } from '../schemas/observability.js';
import type { Lane } from '../constants.js';

export type MailEventKind = 'lane_opened' | 'sent_back' | 'ready_for_launch' | 'sla_breach_digest';
export type Locale = 'th' | 'en'; // D12; 'th' is the default

/** The W0-04 `notification.event` column value for each kind, 1:1; the first component of the dedup key (4.4). */
export const NOTIFICATION_EVENT_BY_KIND = {
  lane_opened: 'lane_open',
  sent_back: 'send_back',
  ready_for_launch: 'ready',
  sla_breach_digest: 'sla_breach_digest',
} as const satisfies Record<MailEventKind, string>;
export type NotificationEvent = (typeof NOTIFICATION_EVENT_BY_KIND)[MailEventKind];

/** A business event that has already committed. The sink cannot be handed an uncommitted one. */
export interface CommittedEvent {
  kind: MailEventKind;
  caseId: string | null; // null only for sla_breach_digest
  versionId: string | null; // null only for sla_breach_digest
  versionNumber: number | null;
  digestDay: string | null; // sla_breach_digest only: `YYYY-MM-DD` in Asia/Bangkok (D06); null otherwise
  lane: Lane | null; // lane_opened: the opened lane; sent_back: the deciding lane (W0-04); ready_for_launch, digest: null
  auditEventId: string; // the audit event written with the state change (W0-04); proof it committed
  committedAt: string; // ISO-8601 UTC
  correlationId: string; // W0-10; shared with the audit event, the notification row and the log line
}

/** Case delivery always retains business audit provenance. */
export type CaseMailEvent = CommittedEvent & {
  kind: Exclude<MailEventKind, 'sla_breach_digest'>;
  provenance?: never;
};
/** Persisted job evidence, never a fabricated human/business audit. */
export interface CommittedDigestEvent {
  kind: 'sla_breach_digest';
  caseId: null;
  versionId: null;
  versionNumber: null;
  lane: null;
  digestDay: string;
  committedAt: string;
  correlationId: string;
  provenance: DigestJobProvenance;
  auditEventId?: never;
}
export type MailDeliveryEvent = CaseMailEvent | CommittedDigestEvent;

export interface AuthorizedRecipient {
  recipientId: string; // subject ID for a person; `operator_recipients:<n>` for a configured address. Not part of the dedup key
  address: string; // the W0-04 `notification.recipient` value and the fourth dedup-key component (4.4)
  displayName: string | null;
  locale: Locale;
  basis: 'case_view_scope' | 'operator_recipients'; // W0-05 recipient rows
}

/** Built by the server, never by a template or a document. Carries no secret and grants nothing. */
export interface SafeDeepLink {
  url: string; // `${PUBLIC_BASE_URL}${path}`; canonical case route; no query string, no fragment, no token
  route: 'case' | 'case_version' | 'queue_sla_breach';
  caseId: string | null; // null only for queue_sla_breach
  requiresSignIn: true; // the recipient must sign in and be in scope (A05)
}

/** One breached case in the operator digest. */
export interface DigestCaseRef {
  caseId: string;
  lane: Lane; // the lane past its SLA (W3-05 breach query)
  deepLinkIndex: number; // index into DeliveryRequest.deepLinks
}

export interface RenderedMail {
  subject: string; // rendered from the locale template for recipient.locale; UTF-8; Thai-safe
  textBody: string; // plain text; contains every deep link; never document contents or finding evidence
  templateKey: string; // e.g. 'mail.lane_opened'; the D12 locale key
  templateParams: Record<string, string | number>;
}

export interface DeliveryRequest {
  dedupKey: string; // W0-07 section 4.4; the W0-04 `notification` unique index (event, version_id, lane, recipient) as one string
  event: MailDeliveryEvent;
  recipient: AuthorizedRecipient;
  deepLinks: SafeDeepLink[]; // at least one
  digestCases: DigestCaseRef[] | null; // non-empty for sla_breach_digest; null for every other kind
  mail: RenderedMail;
  attempt: number; // 1..4 (D06: three retries)
}

export type DeliveryStatus = 'delivered' | 'failed' | 'duplicate';

export type DeliveryErrorCode =
  'malformed_request' | 'sink_failure' | 'rejected_recipient' | 'unsafe_link' | 'duplicate';

export interface DeliveryReceipt {
  dedupKey: string;
  status: DeliveryStatus;
  attempt: number;
  at: string; // ISO-8601 UTC
  sinkMessageId: string | null; // set when delivered; the sink's own handle
  error: { code: DeliveryErrorCode; message: string } | null; // message: no address, no case content
}

export interface MailSink {
  readonly identity: { sink: 'memory' | 'file'; version: string }; // the W0-10 ReadinessReport.mailSink.kind values
  deliver(request: DeliveryRequest): Promise<DeliveryReceipt>;
}
