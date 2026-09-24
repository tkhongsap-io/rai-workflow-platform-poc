// What every workflow action writes the same way: the audit before/after snapshot of the case, the idempotency key as
// an audit reference, the id format checked before a uuid cast, and the W0-06 8.2 `stale_version` details with the
// path a client refreshes to. One definition each, so a new case column or a new guidance rule changes one place.

import { createHash } from 'node:crypto';
import { StaleVersionError, type ErrorDetails } from '@rai/shared/errors';
import type { AuditRefValue } from '../audit/store.js';
import type { CaseRow, PackVersionRow } from '../cases/repository.js';
import { caseVersionPath } from '../notifications/outbox.js';

type StaleReason = ErrorDetails['stale_version']['reason'];
type StaleGuidance = ErrorDetails['stale_version']['guidanceKey'];
type VersionFacts = Pick<PackVersionRow, 'id' | 'versionNumber' | 'submittedAt' | 'readyAt'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_REF = /^[A-Za-z0-9_.:/@-]{1,64}$/;

/** A path id checked before it reaches a uuid column, so a malformed id is a 404 and never a cast error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The key as an audit reference: verbatim when it is one (a UUID is), else its SHA-256 (the audit store admits no free text). */
export function keyRef(key: string): string {
  return AUDIT_REF.test(key) ? key : createHash('sha256').update(key).digest('hex');
}

/** The case columns an action's audit event records before and after it. */
export function caseRef(row: CaseRow): Record<string, AuditRefValue> {
  return {
    draft_version_id: row.draftVersionId,
    current_version_id: row.currentVersionId,
    desk_status: row.deskStatus,
    row_version: row.rowVersion,
    privacy_status: row.privacyStatus,
    security_status: row.securityStatus,
    rai_status: row.raiStatus,
    ai_readiness_status: row.aiReadinessStatus,
  };
}

/** The SPA page that shows `version`: the case page for a draft, the version page once submitted. */
export function versionPath(caseId: string, version: Pick<PackVersionRow, 'id' | 'submittedAt'>): string {
  return version.submittedAt === null ? `/cases/${caseId}` : caseVersionPath(caseId, version.id);
}

/** The W0-06 8.2 `stale_version` details from a version row. */
export function staleDetails(
  reason: StaleReason,
  guidanceKey: StaleGuidance,
  version: VersionFacts,
  revision: number,
  refreshPath: string,
): ErrorDetails['stale_version'] {
  return {
    reason,
    guidanceKey,
    current: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      revision,
      state: version.submittedAt === null ? 'draft' : 'submitted',
      ready: version.readyAt != null,
    },
    refreshPath,
  };
}

/** The 409 for `version` as the locked case row stands, refreshing to the page that shows it. */
export function staleAt(
  reason: StaleReason,
  guidanceKey: StaleGuidance,
  version: VersionFacts,
  caseRow: CaseRow,
): StaleVersionError {
  return new StaleVersionError(
    staleDetails(reason, guidanceKey, version, caseRow.rowVersion, versionPath(caseRow.id, version)),
  );
}
