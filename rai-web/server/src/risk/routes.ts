// W5-06 (W5 plan section 6, R-14): GET /api/cases/{caseId}/versions/{versionId}/risk-proposal → 200
// `{ proposal: RiskProposalView | null }`, the risk proposal W5-05 recorded for that version at submit. Authorized
// exactly like the version's qc-runs read (findings/routes.ts): W0-05 `version.view` on the case (the middleware
// answers 401, 403 and the unknown-case 404), then 404 `version` for a malformed, unknown or other-case version, and
// also for a draft, which has no proposal by construction. `null` is a submitted version with no proposal (submitted
// before W5). Reads only: no row, audit entry or policy row; the tier routes, skips and grants nothing.

import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { NotFoundError } from '@rai/shared/errors';
import { RiskProposalResponseSchema, type RiskProposalResponse } from '@rai/shared/schemas/risk';
import { readNames, type SubjectDirectory } from '../cases/subject-directory.js';
import { readVersionRow } from '../cases/repository.js';
import { readRevisionById } from '../configuration/store.js';
import type { Db } from '../db/client.js';
import { isUuid } from '../workflow/refs.js';
import { readSubmitProposal } from './repository.js';
import { answererIds, riskProposalView } from './view.js';

export interface RiskRouteDeps {
  db: Db;
  /** W3-F1: names the answerers for display; absent, `answeredByName` is omitted. */
  subjects?: SubjectDirectory;
}

const VersionParamsSchema = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
});

export function registerRiskRoutes(fastify: FastifyInstance, deps: RiskRouteDeps): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    '/api/cases/:caseId/versions/:versionId/risk-proposal',
    {
      config: { auth: { kind: 'action', action: 'version.view', target: 'case' } },
      schema: { params: VersionParamsSchema, response: { 200: RiskProposalResponseSchema } },
    },
    async (request): Promise<RiskProposalResponse> => {
      const { caseId, versionId } = request.params;
      if (!isUuid(versionId)) throw new NotFoundError('version');
      const version = await readVersionRow(deps.db, versionId);
      if (version === undefined || version.caseId !== caseId || version.submittedAt === null)
        throw new NotFoundError('version');
      const row = await readSubmitProposal(deps.db, versionId);
      if (row === undefined) return { proposal: null };
      const revision =
        row.rubricRevisionId === null ? undefined : await readRevisionById(deps.db, row.rubricRevisionId);
      const nameOf = readNames(deps.subjects);
      const names = new Map<string, string>();
      for (const id of answererIds(version.riskAnswers)) {
        const name = await nameOf(id);
        if (name !== undefined) names.set(id, name);
      }
      return {
        proposal: riskProposalView({
          row,
          rubric: revision === undefined ? undefined : { id: revision.id, body: revision.body },
          riskAnswers: version.riskAnswers,
          names,
        }),
      };
    },
  );
}
