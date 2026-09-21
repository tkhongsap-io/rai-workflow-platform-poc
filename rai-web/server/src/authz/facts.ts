// The pre-authorization read (W0-05 "Middleware"): CaseScopeFacts by case id, or by artifact id joined through
// W0-04 `artifact.case_id`. Three columns, answers nothing by itself; the handler's own queries run after the
// decision. One module so the 403 and 404 paths read the same way.

import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { artifact } from '../db/schema/artifact.js';
import { cases } from '../db/schema/case.js';
import type { ScopeFactsSource } from './middleware.js';
import type { CaseScopeFacts } from './policy.js';

export function createScopeFactsSource(exec: Executor): ScopeFactsSource {
  return {
    async byCaseId(caseId) {
      const [row] = await exec
        .select({ id: cases.id, ownerSubjectId: cases.ownerSubjectId, businessUnitId: cases.businessUnitId })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      return row === undefined ? undefined : toFacts(row);
    },
    async byArtifactId(artifactId) {
      const [row] = await exec
        .select({ id: cases.id, ownerSubjectId: cases.ownerSubjectId, businessUnitId: cases.businessUnitId })
        .from(artifact)
        .innerJoin(cases, eq(artifact.caseId, cases.id))
        .where(eq(artifact.id, artifactId))
        .limit(1);
      return row === undefined ? undefined : toFacts(row);
    },
  };
}

function toFacts(row: { id: string; ownerSubjectId: string; businessUnitId: string }): CaseScopeFacts {
  return { caseId: row.id, ownerSubjectId: row.ownerSubjectId, businessUnitId: row.businessUnitId };
}
