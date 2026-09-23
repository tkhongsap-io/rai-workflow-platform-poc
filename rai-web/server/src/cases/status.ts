// W0-06 2.4 derived case status: computed from rows, never stored; first match wins. awaiting_disposition uses the
// workflow/ready.ts definition of an open finding: the latest disposition is absent or fixed_proposed.

import { sql, type SQL } from 'drizzle-orm';
import type { alias } from 'drizzle-orm/pg-core';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import { cases } from '../db/schema/case.js';
import type { packVersion } from '../db/schema/pack-version.js';

type VersionAlias = ReturnType<typeof alias<typeof packVersion, string>>;

/** The status of `case`, left-joined to its current submitted version and its open draft under these aliases. */
export function caseStatusSql(current: VersionAlias, draft: VersionAlias): SQL<CaseStatus> {
  return sql<CaseStatus>`CASE
    WHEN ${current.readyAt} IS NOT NULL THEN 'ready_for_launch'
    WHEN ${draft.id} IS NOT NULL THEN CASE WHEN ${draft.parentVersionId} IS NULL THEN 'draft' ELSE 'sent_back' END
    WHEN ${current.submittedAt} IS NOT NULL
      AND ${cases.raiStatus} = 'approved' AND ${cases.privacyStatus} = 'approved' AND ${cases.securityStatus} = 'approved'
      AND EXISTS (
        SELECT 1 FROM qc_finding f
        LEFT JOIN LATERAL (
          SELECT kind FROM disposition_event d WHERE d.finding_id = f.id
          ORDER BY d.created_at DESC, d.id DESC LIMIT 1
        ) latest ON true
        WHERE f.version_id = ${current.id} AND (latest.kind IS NULL OR latest.kind = 'fixed_proposed')
      ) THEN 'awaiting_disposition'
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
