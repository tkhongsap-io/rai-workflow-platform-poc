// W0-07 section 4.3: the checks a sink performs before accepting a request, in the listed order; the first failure
// is the receipt's `error`. Defensive: the W3-03 notifier already guarantees them. No message ever carries an
// address, a URL, a subject or a body (W0-10 redaction); it names a field or an index.

import { isDigestJobProvenance } from '@rai/shared/mail/provenance';
import type { DeliveryErrorCode, DeliveryRequest, SafeDeepLink } from '@rai/shared/mail/types';

export interface DeliveryError {
  code: Exclude<DeliveryErrorCode, 'duplicate'>;
  message: string;
}

/** RFC 5322 line limit for the subject; W0-07 section 4.3 leaves encoded-word folding to a real transport. */
export const MAX_SUBJECT_BYTES = 998;
/** 64 KiB for the plain-text body (W0-07 section 4.3). */
export const MAX_BODY_BYTES = 65_536;

/** W0-07 section 4.6 synthetic-domain rule: RFC 2606 reserved names only, while slice 1 runs. */
const SYNTHETIC_TLDS = ['test', 'example', 'invalid'] as const;
const SYNTHETIC_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

export function isSyntheticAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();
  if (/[\s@<>,;:"()[\]\\/]/.test(local) || /[\s@<>,;:"()[\]\\/]/.test(domain)) return false;
  const labels = domain.split('.');
  if (labels.some((label) => label === '' || !/^[a-z0-9-]+$/.test(label))) return false;
  if (labels.length >= 2 && (SYNTHETIC_TLDS as readonly string[]).includes(labels.at(-1)!)) return true;
  return SYNTHETIC_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * The canonical SPA routes a deep link may point at (W0-05 section 6: `<origin>/cases/:caseId[...]`, opaque IDs, no
 * token). The SPA owns the path strings; this is the sink's defensive copy, and a later route change updates it here.
 */
const ID_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._~-]{0,127}';
export const CANONICAL_ROUTE_PATTERNS: Readonly<Record<SafeDeepLink['route'], RegExp>> = Object.freeze({
  case: new RegExp(`^/cases/(${ID_SEGMENT})$`),
  case_version: new RegExp(`^/cases/(${ID_SEGMENT})/versions/(${ID_SEGMENT})$`),
  queue_sla_breach: /^\/queue(\/[a-z][a-z0-9-]{0,63})?$/,
});

/** A path segment that looks like a credential: key=value, a JWT prefix, or a long opaque blob (UUIDs are 36). */
const CREDENTIAL_SEGMENT = /[=:@]|^eyJ[A-Za-z0-9_-]{8,}|^[A-Za-z0-9_-]{40,}$/;

const DIGEST_DAY = /^\d{4}-\d{2}-\d{2}$/;

function linkError(index: number, why: string): DeliveryError {
  return { code: 'unsafe_link', message: `deepLinks[${index}]: ${why}` };
}

/** Returns the first failing check's error, or null when the request may be delivered. */
export function validateDeliveryRequest(request: DeliveryRequest, origin: string): DeliveryError | null {
  return (
    checkLinks(request, origin) ??
    checkLinkCorrespondence(request) ??
    checkRecipient(request) ??
    checkBodyLinks(request) ??
    checkCommitted(request) ??
    checkDedupIdentity(request) ??
    checkSize(request)
  );
}

function checkLinks(request: DeliveryRequest, origin: string): DeliveryError | null {
  const links = request.deepLinks;
  if (!Array.isArray(links) || links.length === 0)
    return { code: 'unsafe_link', message: 'deepLinks: empty' };
  for (const [index, link] of links.entries()) {
    if (typeof link.url !== 'string' || link.url === '') return linkError(index, 'missing url');
    if (link.url.includes('?')) return linkError(index, 'query string');
    if (link.url.includes('#')) return linkError(index, 'fragment');
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      return linkError(index, 'not a URL');
    }
    if (url.origin !== origin) return linkError(index, 'origin differs from PUBLIC_BASE_URL');
    if (url.username !== '' || url.password !== '') return linkError(index, 'credential in URL');
    if (!link.url.startsWith(`${origin}/`)) return linkError(index, 'does not start with PUBLIC_BASE_URL');
    const segments = url.pathname.split('/').slice(1);
    if (segments.some((segment) => CREDENTIAL_SEGMENT.test(segment)))
      return linkError(index, 'credential-looking segment');
    const pattern = CANONICAL_ROUTE_PATTERNS[link.route];
    if (pattern === undefined) return linkError(index, 'unknown route');
    const match = pattern.exec(url.pathname);
    if (match === null) return linkError(index, `path is not the canonical ${link.route} route`);
    if (link.route === 'queue_sla_breach') {
      if (link.caseId !== null) return linkError(index, 'queue link carries a caseId');
    } else if (link.caseId === null || match[1] !== link.caseId) {
      return linkError(index, 'path caseId differs from link.caseId');
    }
    if (link.requiresSignIn !== true) return linkError(index, 'requiresSignIn is not true');
  }
  return null;
}

function checkLinkCorrespondence(request: DeliveryRequest): DeliveryError | null {
  const { event, deepLinks, digestCases } = request;
  if (event.kind !== 'sla_breach_digest') {
    if (deepLinks.length !== 1)
      return { code: 'unsafe_link', message: 'deepLinks: exactly one link expected' };
    const link = deepLinks[0]!;
    if (link.route !== 'case' && link.route !== 'case_version')
      return linkError(0, 'route must be case or case_version');
    if (event.caseId === null || link.caseId !== event.caseId)
      return linkError(0, 'caseId differs from event.caseId');
    if (digestCases !== null)
      return { code: 'unsafe_link', message: 'digestCases: must be null for this kind' };
    return null;
  }
  if (!Array.isArray(digestCases) || digestCases.length === 0)
    return { code: 'unsafe_link', message: 'digestCases: empty' };
  const referenced = new Map<number, number>();
  for (const [entryIndex, entry] of digestCases.entries()) {
    const i = entry.deepLinkIndex;
    if (!Number.isInteger(i) || i < 0 || i >= deepLinks.length)
      return { code: 'unsafe_link', message: `digestCases[${entryIndex}]: deepLinkIndex out of range` };
    const link = deepLinks[i]!;
    if (link.route !== 'case') return linkError(i, 'digest entry must reference a case link');
    if (link.caseId !== entry.caseId) return linkError(i, `caseId differs from digestCases[${entryIndex}]`);
    referenced.set(i, (referenced.get(i) ?? 0) + 1);
  }
  let queueLinks = 0;
  for (const [index, link] of deepLinks.entries()) {
    if (link.route === 'case') {
      const count = referenced.get(index) ?? 0;
      if (count !== 1) return linkError(index, `referenced by ${count} digest entries, expected 1`);
    } else if (link.route === 'queue_sla_breach') {
      queueLinks += 1;
      if (queueLinks > 1) return linkError(index, 'more than one queue link');
    } else {
      return linkError(index, 'route not allowed in a digest');
    }
  }
  return null;
}

function checkRecipient(request: DeliveryRequest): DeliveryError | null {
  const address = request.recipient.address;
  if (typeof address !== 'string' || !isSyntheticAddress(address))
    return {
      code: 'rejected_recipient',
      message: 'recipient.address: not under a reserved synthetic domain',
    };
  return null;
}

function checkBodyLinks(request: DeliveryRequest): DeliveryError | null {
  const body = request.mail.textBody;
  if (typeof body !== 'string') return linkError(0, 'mail.textBody missing');
  for (const [index, link] of request.deepLinks.entries()) {
    if (!body.includes(link.url)) return linkError(index, 'url missing from mail.textBody');
  }
  return null;
}

function checkCommitted(request: DeliveryRequest): DeliveryError | null {
  const event = request.event;
  if (event.kind === 'sla_breach_digest') {
    if (!realDay(event.digestDay))
      return { code: 'malformed_request', message: 'event.digestDay: invalid calendar day' };
    // Shape only: the server must resolve the committed SQL job/link before invoking a sink.
    if (
      'auditEventId' in event ||
      !isDigestJobProvenance(event.provenance) ||
      event.provenance.digestDay !== event.digestDay ||
      event.provenance.correlationId !== event.correlationId ||
      event.caseId !== null ||
      event.versionId !== null ||
      event.versionNumber !== null ||
      event.lane !== null ||
      request.recipient.basis !== 'operator_recipients'
    )
      return { code: 'malformed_request', message: 'event: invalid digest job provenance' };
  } else {
    if (
      !['lane_opened', 'sent_back', 'ready_for_launch'].includes(event.kind) ||
      'provenance' in event ||
      typeof event.auditEventId !== 'string' ||
      event.auditEventId === ''
    )
      return {
        code: 'malformed_request',
        message: 'event.auditEventId/provenance: invalid business audit provenance',
      };
  }
  return null;
}

function checkDedupIdentity(request: DeliveryRequest): DeliveryError | null {
  const { event } = request;
  if (event.kind === 'sla_breach_digest') {
    if (typeof event.digestDay !== 'string' || !DIGEST_DAY.test(event.digestDay))
      return { code: 'malformed_request', message: 'event.digestDay: expected YYYY-MM-DD' };
    if (event.versionId !== null)
      return { code: 'malformed_request', message: 'event.versionId: expected null' };
    return null;
  }
  if (typeof event.versionId !== 'string' || event.versionId === '')
    return { code: 'malformed_request', message: 'event.versionId: expected a non-empty string' };
  if (event.digestDay !== null)
    return { code: 'malformed_request', message: 'event.digestDay: expected null' };
  return null;
}

function checkSize(request: DeliveryRequest): DeliveryError | null {
  const subjectBytes = Buffer.byteLength(request.mail.subject, 'utf8');
  if (subjectBytes > MAX_SUBJECT_BYTES)
    return {
      code: 'sink_failure',
      message: `mail.subject: ${subjectBytes} bytes exceeds ${MAX_SUBJECT_BYTES}`,
    };
  const bodyBytes = Buffer.byteLength(request.mail.textBody, 'utf8');
  if (bodyBytes > MAX_BODY_BYTES)
    return { code: 'sink_failure', message: `mail.textBody: ${bodyBytes} bytes exceeds ${MAX_BODY_BYTES}` };
  return null;
}

/** Reject normalized impossible dates, including non-leap February 29. */
function realDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DIGEST_DAY.test(day) || day.startsWith('0000')) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
