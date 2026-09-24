// Pure composition of committed case events: no transport, scheduling or workflow writes.
import { LANES, type Lane } from '@rai/shared/constants';
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import { buildDedupKey } from '@rai/shared/mail/dedup';
import type {
  AuthorizedRecipient,
  CommittedEvent,
  DeliveryRequest,
  Locale,
  SafeDeepLink,
} from '@rai/shared/mail/types';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { SendBackFeedback } from '@rai/shared/schemas/review';
import { authorize, type CaseScopeFacts } from '../authz/policy.js';

export type CaseMailKind = 'lane_opened' | 'sent_back' | 'ready_for_launch';
export interface MailIdentity {
  subjectId: string;
  email: string;
  displayName: string;
  roles: readonly RoleScope[];
  locale?: Locale;
}
export interface CaseMailContent {
  caseName: string;
  defectCount?: number;
  dueOn?: string;
  feedback?: SendBackFeedback;
}

export class CompositionError extends Error {
  constructor(readonly code: 'malformed_request' | 'unsafe_link' | 'rejected_recipient') {
    super(code); // never place message contents, addresses or URLs in errors
  }
}

export function syntheticAddress(address: string): boolean {
  return (
    /^[^\s@<>,;:"()[\]\\/]+@(?:[a-z0-9-]+\.)+(?:test|example|invalid)$/i.test(address) ||
    /^[^\s@<>,;:"()[\]\\/]+@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$/i.test(address)
  );
}

export function resolveRecipient(
  identities: readonly MailIdentity[],
  address: string,
  event: CommittedEvent,
  facts: CaseScopeFacts,
): AuthorizedRecipient {
  const identity = identities.find(
    (u) =>
      u.email === address &&
      (event.kind === 'lane_opened'
        ? u.roles.some((r) => r.role === event.lane)
        : u.subjectId === facts.ownerSubjectId) &&
      authorize({ subjectId: u.subjectId, roles: [...u.roles] }, 'case.view', { kind: 'case', facts }).allow,
  );
  if (identity === undefined || !syntheticAddress(address)) throw new CompositionError('rejected_recipient');
  return {
    recipientId: identity.subjectId,
    address,
    displayName: identity.displayName,
    locale: identity.locale ?? 'th',
    basis: 'case_view_scope',
  };
}

/** An opaque ID that is safe as one deep-link path segment. */
export const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,127}$/;

/** A bare http(s) origin: links carry no path prefix, query, fragment or credentials. */
export function safeBaseUrl(base: URL): boolean {
  return (
    ['http:', 'https:'].includes(base.protocol) &&
    base.pathname === '/' &&
    !base.search &&
    !base.hash &&
    !base.username &&
    !base.password
  );
}

export function versionLink(baseUrl: URL, caseId: string, versionId: string): SafeDeepLink {
  if (!safeBaseUrl(baseUrl) || !SAFE_ID.test(caseId) || !SAFE_ID.test(versionId))
    throw new CompositionError('unsafe_link');
  return {
    url: `${baseUrl.origin}/cases/${caseId}/versions/${versionId}`,
    route: 'case_version',
    caseId,
    requiresSignIn: true,
  };
}

const SUBJECT: Record<CaseMailKind, LocaleKey> = {
  lane_opened: 'mail.lane_opened',
  sent_back: 'mail.sent_back',
  ready_for_launch: 'mail.ready_for_launch',
};
const BODY: Record<CaseMailKind, LocaleKey> = {
  lane_opened: 'mail.lane_opened.body',
  sent_back: 'mail.sent_back.body',
  ready_for_launch: 'mail.ready_for_launch.body',
};
const LANE_LABEL: Record<Lane, LocaleKey> = {
  ai_coe: 'lane.ai_coe',
  dpo: 'lane.dpo',
  it_security: 'lane.it_security',
};

export function composeCaseMail(
  event: CommittedEvent,
  recipient: AuthorizedRecipient,
  content: CaseMailContent,
  publicBaseUrl: URL,
): DeliveryRequest {
  if (
    event.kind === 'sla_breach_digest' ||
    !event.caseId ||
    !event.versionId ||
    !event.auditEventId ||
    event.digestDay !== null ||
    !event.versionNumber ||
    !syntheticAddress(recipient.address)
  )
    throw new CompositionError('malformed_request');
  if (event.kind === 'ready_for_launch' ? event.lane !== null : !LANES.includes(event.lane as Lane))
    throw new CompositionError('malformed_request');
  const link = versionLink(publicBaseUrl, event.caseId, event.versionId);
  const params: Record<string, string | number> = { caseName: content.caseName, caseLink: link.url };
  if (event.lane !== null) params.laneLabel = t(recipient.locale, LANE_LABEL[event.lane]);
  if (event.kind === 'lane_opened') {
    if (
      !Number.isInteger(content.defectCount) ||
      content.defectCount! < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(content.dueOn ?? '')
    )
      throw new CompositionError('malformed_request');
    params.defectCount = content.defectCount!;
    // A date-only Bangkok SLA day; do not reinterpret it as the server's local timezone.
    params.dueDate = new Intl.DateTimeFormat(recipient.locale === 'th' ? 'th-TH' : 'en-GB', {
      timeZone: 'Asia/Bangkok',
      calendar: 'gregory',
      dateStyle: 'long',
    }).format(new Date(`${content.dueOn}T00:00:00+07:00`));
  }
  if (event.kind === 'sent_back') {
    if (!content.feedback?.items.length) throw new CompositionError('malformed_request');
    params.feedback = (
      content.feedback.summary?.trim() ||
      content.feedback.items.map((item) => `${String(item.slot)}: ${item.deficiency}`).join('; ')
    ).slice(0, 500);
  }
  // Preserve the validated case-event kind at the typed delivery boundary.
  const caseEvent = { ...event, kind: event.kind };
  return {
    dedupKey: buildDedupKey(caseEvent, recipient),
    event: caseEvent,
    recipient,
    deepLinks: [link],
    digestCases: null,
    attempt: 1,
    mail: {
      subject: t(recipient.locale, SUBJECT[event.kind]),
      textBody: t(recipient.locale, BODY[event.kind], params),
      templateKey: SUBJECT[event.kind],
      templateParams: params,
    },
  };
}
