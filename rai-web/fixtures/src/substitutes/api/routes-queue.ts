// W3-08: development substitute only; authoritative A06 evidence comes from W3-INT.
import { LANES } from '@rai/shared/constants';
import { CASE_STATUSES, type CaseStatus } from '@rai/shared/schemas/cases';
import {
  QueueQuerySchema,
  QUEUE_DEFAULTS,
  type QueueQuery,
  type QueueItem,
  type QueueResponse,
} from '@rai/shared/schemas/queue';
import type { RouteContext, RouteDefinition } from './handler.js';
import { assertValid, json } from './support.js';
import { actorOf, caseSummary, inListScope } from './workflow.js';

const ACTIONS: Record<CaseStatus, QueueItem['nextAction']> = {
  draft: 'prepare_pack',
  sent_back: 'correct_pack',
  in_review: 'review_lanes',
  awaiting_disposition: 'resolve_findings',
  ready_for_launch: 'review_complete',
};
const normalized = (value: string) => value.normalize('NFC').toLowerCase();
function readQuery(ctx: RouteContext): QueueQuery {
  const raw: Record<string, unknown> = Object.fromEntries(ctx.query);
  for (const [key, value] of ctx.query) {
    raw[key] = (key === 'page' || key === 'pageSize') && /^-?\d+$/.test(value) ? Number(value) : value;
  }
  assertValid(QueueQuerySchema, raw, 'query');
  return raw;
}

export function queueRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/api/queue',
      auth: { kind: 'action', action: 'case.list', target: 'none' },
      handler: (ctx) => {
        const query = readQuery(ctx);
        const actor = actorOf(ctx.principal!);
        const population: QueueItem[] = [...ctx.store.cases.values()]
          .filter((stored) => inListScope(actor, stored))
          .map((stored) => {
            const current = stored.versions.at(-1);
            const pendingFindings =
              current === undefined
                ? []
                : [...ctx.store.findings.values()].filter((finding) => {
                    if (finding.versionId !== current.versionId) return false;
                    const latest = ctx.store.dispositions.get(finding.findingId)?.at(-1);
                    return latest === undefined || latest.kind === 'fixed_proposed';
                  });
            const allApproved =
              current !== undefined &&
              LANES.every(
                (lane) => ctx.store.decisions.get(`${current.versionId}\0${lane}`)?.decision === 'approve',
              );
            const status =
              stored.status === 'in_review' && allApproved && pendingFindings.length > 0
                ? 'awaiting_disposition'
                : stored.status;

            const ownerDisplayName =
              ctx.store.users.find((user) => user.subjectId === stored.fields.businessOwner)?.displayName ??
              stored.fields.businessOwner;
            return {
              ...caseSummary(stored),
              status,
              sourceRecordId: stored.fields.sourceRecordId,
              ownerDisplayName,
              latestVersionNumber: stored.draft?.versionNumber ?? current?.versionNumber ?? 1,
              lanes:
                current === undefined
                  ? []
                  : LANES.map((lane) => {
                      const decision = ctx.store.decisions.get(`${current.versionId}\0${lane}`);
                      return {
                        lane,
                        status:
                          decision?.decision === 'approve'
                            ? ('approved' as const)
                            : decision?.decision === 'send_back'
                              ? ('sent_back' as const)
                              : ('pending' as const),
                        due: structuredClone(
                          ctx.store.laneDueByVersion
                            .get(current.versionId)!
                            .find((due) => due.lane === lane)!,
                        ),
                      };
                    }),
              nextAction: ACTIONS[status],
            };
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.caseId.localeCompare(a.caseId));
        const term = normalized(query.search?.trim() ?? '');
        const searchBy = query.searchBy ?? QUEUE_DEFAULTS.searchBy;
        const matching = population.filter((item) => {
          if (query.status !== undefined && item.status !== query.status) return false;
          if (query.owner !== undefined && item.businessOwner !== query.owner) return false;
          if (query.useCaseGroup !== undefined && item.useCaseGroup !== query.useCaseGroup) return false;
          const fields = {
            sourceRecordId: item.sourceRecordId.kind === 'known' ? item.sourceRecordId.value : 'Unknown',
            status: item.status,
            owner: `${item.ownerDisplayName}\0${item.businessOwner}`,
            useCaseGroup: item.useCaseGroup,
          };
          const text =
            searchBy === 'all'
              ? [item.useCaseName, item.registryId, ...Object.values(fields)].join('\0')
              : fields[searchBy];
          return normalized(text).includes(term);
        });
        const page = query.page ?? QUEUE_DEFAULTS.page;
        const pageSize = query.pageSize ?? QUEUE_DEFAULTS.pageSize;
        const statusCounts = Object.fromEntries(
          CASE_STATUSES.map((status) => [status, population.filter((item) => item.status === status).length]),
        ) as Record<CaseStatus, number>;
        const body: QueueResponse = {
          items: matching.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: matching.length,
          statusCounts,
          filterOptions: {
            statuses: CASE_STATUSES.filter((status) => statusCounts[status] > 0),
            owners: [...new Set(population.map((item) => item.businessOwner))].sort(),
            useCaseGroups: [...new Set(population.map((item) => item.useCaseGroup))].sort(),
          },
        };
        return json(200, ctx.correlationId, body);
      },
    },
  ];
}
