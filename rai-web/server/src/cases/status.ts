// W0-06 2.4 derived case status: computed from rows, never stored; first match wins. awaiting_disposition uses the
// Ready rule's open finding (findings/repository.ts).

import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder, type alias } from 'drizzle-orm/pg-core';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import { cases } from '../db/schema/case.js';
import type { packVersion } from '../db/schema/pack-version.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { latestDisposition, undispositioned } from '../findings/repository.js';

type VersionAlias = ReturnType<typeof alias<typeof packVersion, string>>;

/** The status of `case`, left-joined to its current submitted version and its open draft under these aliases. */
export function caseStatusSql(current: VersionAlias, draft: VersionAlias): SQL<CaseStatus> {
  return sql<CaseStatus>`CASE
    WHEN ${current.readyAt} IS NOT NULL THEN 'ready_for_launch'
    WHEN ${draft.id} IS NOT NULL THEN CASE WHEN ${draft.parentVersionId} IS NULL THEN 'draft' ELSE 'sent_back' END
    WHEN ${current.submittedAt} IS NOT NULL
      AND ${cases.raiStatus} = 'approved' AND ${cases.privacyStatus} = 'approved' AND ${cases.securityStatus} = 'approved'
      AND ${exists(
        new QueryBuilder()
          .select({ id: qcFinding.id })
          .from(qcFinding)
          .leftJoinLateral(latestDisposition, sql`true`)
          .where(and(eq(qcFinding.versionId, current.id), undispositioned)),
      )} THEN 'awaiting_disposition'
    ELSE 'in_review' END`;
}

/** W0-04 `case.desk_status`, the coarse stored mirror of the derived status (never returned as the status value). */
export function deskStatusFor(status: CaseStatus): 'draft' | 'in_review' | 'ready' {
  switch (status) {
    case 'draft':
    case 'sent_back':
      return 'draft';
    case 'in_review':
    case 'awaiting_disposition':
      return 'in_review';
    case 'ready_for_launch':
      return 'ready';
  }
}
