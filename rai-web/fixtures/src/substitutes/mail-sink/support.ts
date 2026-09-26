// Request builders for the W1-11 tests (W0-07 section 4.8). Synthetic values only: reserved domains, invented IDs.
// Not a test file; imported by the colocated *.test.ts files.

import type {
  AuthorizedRecipient,
  CaseMailEvent,
  CommittedDigestEvent,
  MailDeliveryEvent,
  DeliveryRequest,
  DigestCaseRef,
  SafeDeepLink,
} from '@rai/shared/mail/types';
import { buildDedupKey } from '@rai/shared/mail/dedup';

export const PUBLIC_BASE_URL = 'http://127.0.0.1:8787';

export const CASE_ID = '0192b3c4-0000-7000-8000-000000000101';
export const VERSION_ID = '0192b3c4-0000-7000-8000-000000000201';
export const AUDIT_EVENT_ID = '0192b3c4-0000-7000-8000-000000000301';
export const CORRELATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5';

export const AI_COE_RECIPIENT: AuthorizedRecipient = {
  recipientId: 'fixture:ai-coe',
  address: 'ai-coe@rai-desk.example',
  displayName: 'AI CoE reviewer (synthetic)',
  locale: 'th',
  basis: 'case_view_scope',
};

export const OPERATOR_RECIPIENT: AuthorizedRecipient = {
  recipientId: 'operator_recipients:1',
  address: 'operator-digest@rai-desk.example',
  displayName: null,
  locale: 'th',
  basis: 'operator_recipients',
};

export function laneOpenedEvent(overrides: Partial<CaseMailEvent> = {}): CaseMailEvent {
  return {
    kind: 'lane_opened',
    caseId: CASE_ID,
    versionId: VERSION_ID,
    versionNumber: 1,
    digestDay: null,
    lane: 'ai_coe',
    auditEventId: AUDIT_EVENT_ID,
    committedAt: '2026-09-21T03:00:00.000Z',
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

export function digestEvent(overrides: Partial<CommittedDigestEvent> = {}): CommittedDigestEvent {
  return {
    kind: 'sla_breach_digest',
    caseId: null,
    versionId: null,
    versionNumber: null,
    digestDay: '2026-09-21',
    lane: null,
    provenance: {
      kind: 'sla_digest_job',
      jobRunId: '0192b3c4-0000-7000-8000-000000000401',
      digestDay: overrides.digestDay ?? '2026-09-21',
      correlationId: overrides.correlationId ?? CORRELATION_ID,
    },
    committedAt: '2026-09-21T01:00:00.000Z',
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

export function caseLink(caseId: string, base: string = PUBLIC_BASE_URL): SafeDeepLink {
  return { url: `${base}/cases/${caseId}`, route: 'case', caseId, requiresSignIn: true };
}

export function caseVersionLink(caseId: string, versionId: string): SafeDeepLink {
  return {
    url: `${PUBLIC_BASE_URL}/cases/${caseId}/versions/${versionId}`,
    route: 'case_version',
    caseId,
    requiresSignIn: true,
  };
}

export function queueLink(): SafeDeepLink {
  return {
    url: `${PUBLIC_BASE_URL}/queue/sla-breach`,
    route: 'queue_sla_breach',
    caseId: null,
    requiresSignIn: true,
  };
}

export interface RequestOverrides {
  event?: MailDeliveryEvent;
  recipient?: AuthorizedRecipient;
  deepLinks?: SafeDeepLink[];
  digestCases?: DigestCaseRef[] | null;
  subject?: string;
  textBody?: string;
  attempt?: number;
  dedupKey?: string;
}

/** A valid lane_opened request: one case link, in the body, synthetic recipient, key from buildDedupKey. */
export function laneOpenedRequest(overrides: RequestOverrides = {}): DeliveryRequest {
  const event = overrides.event ?? laneOpenedEvent();
  const recipient = overrides.recipient ?? AI_COE_RECIPIENT;
  const deepLinks = overrides.deepLinks ?? [caseLink(event.caseId ?? CASE_ID)];
  const subject = overrides.subject ?? 'แจ้งเตือน: เลนเปิดแล้ว';
  const textBody =
    overrides.textBody ??
    `เลน AI CoE เปิดสำหรับการตรวจสอบ v${event.versionNumber ?? 1}\n\n${deepLinks.map((l) => l.url).join('\n')}\n`;
  return {
    dedupKey: overrides.dedupKey ?? safeDedupKey(event, recipient),
    event,
    recipient,
    deepLinks,
    digestCases: overrides.digestCases === undefined ? null : overrides.digestCases,
    mail: {
      subject,
      textBody,
      templateKey: 'mail.lane_opened',
      templateParams: {
        caseName: 'Synthetic case 101',
        laneLabel: 'AI CoE',
        findingCount: 2,
        dueDate: '2026-09-28',
      },
    },
    attempt: overrides.attempt ?? 1,
  };
}

/** A valid sla_breach_digest request with one case link per breached case, optionally plus one queue link. */
export function digestRequest(
  caseIds: string[],
  overrides: RequestOverrides & { withQueueLink?: boolean } = {},
): DeliveryRequest {
  const event = overrides.event ?? digestEvent();
  const recipient = overrides.recipient ?? OPERATOR_RECIPIENT;
  const links: SafeDeepLink[] = overrides.deepLinks ?? [
    ...caseIds.map((id) => caseLink(id)),
    ...(overrides.withQueueLink ? [queueLink()] : []),
  ];
  const digestCases: DigestCaseRef[] | null =
    overrides.digestCases !== undefined
      ? overrides.digestCases
      : caseIds.map((caseId, i) => ({ caseId, lane: 'dpo', deepLinkIndex: i }));
  const textBody =
    overrides.textBody ??
    `กรณีที่เกิน SLA วันนี้:\n${links.map((l, i) => `${i + 1}. ${l.url}`).join('\n')}\n`;
  return {
    dedupKey: overrides.dedupKey ?? safeDedupKey(event, recipient),
    event,
    recipient,
    deepLinks: links,
    digestCases,
    mail: {
      subject: overrides.subject ?? 'สรุปกรณีเกิน SLA ประจำวัน',
      textBody,
      templateKey: 'mail.sla_breach_digest',
      templateParams: { day: event.digestDay ?? '', count: caseIds.length },
    },
    attempt: overrides.attempt ?? 1,
  };
}

/** buildDedupKey when the event is complete; a stable placeholder when a test deliberately breaks the identity. */
function safeDedupKey(event: MailDeliveryEvent, recipient: AuthorizedRecipient): string {
  try {
    return buildDedupKey(event, recipient);
  } catch {
    return `broken:${event.kind}:${recipient.address}`;
  }
}

/** A string of exactly `bytes` UTF-8 bytes, ending with the given tail (so links stay intact). */
export function padToBytes(tail: string, bytes: number): string {
  const tailBytes = Buffer.byteLength(tail, 'utf8');
  if (tailBytes > bytes) throw new RangeError('tail longer than target');
  return `${'x'.repeat(bytes - tailBytes)}${tail}`;
}
