// W3-01 / A06. Every population starts with the W0-05 scope predicate in SQL.
import {
  and,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias, type PgColumn } from 'drizzle-orm/pg-core';
import { LANES } from '@rai/shared/constants';
import type { CaseStatus, LaneProjectionStatus } from '@rai/shared/schemas/cases';
import {
  QUEUE_DEFAULTS,
  type QueueItem,
  type QueueQuery,
  type QueueResponse,
} from '@rai/shared/schemas/queue';
import type { Actor } from '../authz/policy.js';
import { caseScopeWhere } from '../cases/scope.js';
import { caseStatusSql } from '../cases/status.js';
import { fromStoredSourceRecordId } from '../cases/source-record-id.js';
import type { Db, Executor } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { qcFinding } from '../db/schema/qc-finding.js';
import { latestDisposition, undispositioned } from '../findings/repository.js';
import { dueDatesFor, type SlaCalendarMemo } from '../sla/due-dates.js';
import { pendingLaneStates } from '../sla/lane-states.js';
import { projectionColumnForLane } from '../workflow/repository.js';

export const NEXT_ACTION: Record<CaseStatus, QueueItem['nextAction']> = {
  draft: 'prepare_pack',
  sent_back: 'correct_pack',
  in_review: 'review_lanes',
  awaiting_disposition: 'resolve_findings',
  ready_for_launch: 'review_complete',
};

/** Explicit ! escape avoids SQL/backslash-string ambiguity, including a literal ! in user input. */
export function searchPattern(search: string): string | undefined {
  const term = search.trim().normalize('NFC');
  return term === '' ? undefined : `%${term.replace(/[!%_\\]/g, '!$&')}%`;
}

/**
 * W6-14 (W6 plan section 8.2): the dashboard drill-down predicates over `case` and its current version `current`, AND-ed
 * with the scope inside the `visible` sub-select, so they narrow the population before counts, options and pages. Each
 * lands on the dashboard's own number (W6-13): `laneStatus=pending` and `sla` use the open review target set
 * (`openReviewTargets`), `approved`/`sent_back` the projection on a current submitted version, and the finding keys
 * one undispositioned finding on the current version. Without a drill-down key the result is empty (no predicate).
 */
async function drilldownPredicates(
  tx: Executor,
  scope: SQL,
  query: QueueQuery,
  current: { readyAt: PgColumn; submittedAt: PgColumn },
  asOf: Date,
): Promise<SQL[]> {
  const predicates: SQL[] = [];
  const lanes = query.lane === undefined ? LANES : [query.lane];
  const column = (lane: (typeof LANES)[number]): PgColumn => cases[projectionColumnForLane(lane)];
  const hasSubmitted = isNotNull(cases.currentVersionId);
  // The `openReviewTargets` rule: a current submitted version with no successor draft that is not Ready.
  const reviewTarget = and(
    hasSubmitted,
    isNull(cases.draftVersionId),
    isNull(current.readyAt),
    isNotNull(current.submittedAt),
  )!;
  if (query.laneStatus !== undefined) {
    const status = query.laneStatus;
    predicates.push(
      and(
        status === 'pending' ? reviewTarget : hasSubmitted,
        or(...lanes.map((lane) => eq(column(lane), status))),
      )!,
    );
  } else if (query.lane !== undefined && query.sla === undefined) {
    // `lane` alone: every submitted version is reviewed in all three lanes.
    predicates.push(hasSubmitted);
  }
  if (query.sla !== undefined) {
    const matching = new Set(
      (await pendingLaneStates(tx, asOf, scope))
        .filter((state) => state.sla === query.sla && lanes.includes(state.lane))
        .map((state) => state.caseId),
    );
    predicates.push(matching.size === 0 ? sql`false` : inArray(cases.id, [...matching]));
  }
  if (
    query.findingLane !== undefined ||
    query.findingSeverity !== undefined ||
    query.findingKind !== undefined
  ) {
    const match: SQL[] = [eq(qcFinding.versionId, cases.currentVersionId), undispositioned];
    if (query.findingLane !== undefined) match.push(eq(qcFinding.owningLane, query.findingLane));
    if (query.findingSeverity !== undefined) match.push(eq(qcFinding.severity, query.findingSeverity));
    if (query.findingKind !== undefined) match.push(eq(qcFinding.kind, query.findingKind));
    // W6-09 adds the `qc_run.recheck = false` join here when the column exists (W6 plan section 5).
    predicates.push(
      exists(
        tx
          .select({ one: sql`1` })
          .from(qcFinding)
          .leftJoinLateral(latestDisposition, sql`true`)
          .where(and(...match)),
      ),
    );
  }
  return predicates;
}

/** `asOf` is the application clock; only the `sla` drill-down reads it (Asia/Bangkok `today` and the horizon). */
export async function readQueue(
  db: Db,
  actor: Actor,
  query: QueueQuery,
  asOf: Date = new Date(),
): Promise<QueueResponse> {
  const page = query.page ?? QUEUE_DEFAULTS.page;
  const pageSize = query.pageSize ?? QUEUE_DEFAULTS.pageSize;
  return db.transaction(
    async (tx) => {
      const current = alias(packVersion, 'queue_current');
      const draft = alias(packVersion, 'queue_draft');
      const scope = caseScopeWhere(actor);
      const drilldown = await drilldownPredicates(tx, scope, query, current, asOf);
      const visible = tx
        .select({
          ...getTableColumns(cases),
          status: caseStatusSql(current, draft).as('queue_status'),
          currentVersionNumber: current.versionNumber,
          currentSubmittedAt: current.submittedAt,
          currentFrozen: current.frozenConfiguration,
          latestVersionNumber: sql<number>`coalesce(${draft.versionNumber}, ${current.versionNumber})`.as(
            'latest_version_number',
          ),
        })
        .from(cases)
        .leftJoin(current, eq(current.id, cases.currentVersionId))
        .leftJoin(draft, eq(draft.id, cases.draftVersionId))
        .where(and(scope, ...drilldown))
        .as('visible');

      const predicates: SQL[] = [];
      if (query.status !== undefined) predicates.push(eq(visible.status, query.status));
      if (query.owner !== undefined) predicates.push(eq(visible.ownerSubjectId, query.owner));
      if (query.useCaseGroup !== undefined) predicates.push(eq(visible.useCaseGroup, query.useCaseGroup));
      const pattern = searchPattern(query.search ?? '');
      if (pattern !== undefined) {
        const fields = {
          sourceRecordId: [visible.sourceRecordId],
          status: [visible.status],
          owner: [visible.businessOwner, visible.ownerSubjectId],
          useCaseGroup: [visible.useCaseGroup],
          all: [
            visible.useCaseName,
            visible.registryId,
            visible.sourceRecordId,
            visible.status,
            visible.businessOwner,
            visible.ownerSubjectId,
            visible.useCaseGroup,
          ],
        };
        predicates.push(
          or(
            ...fields[query.searchBy ?? QUEUE_DEFAULTS.searchBy].map(
              (field) => sql`normalize(${field}, NFC) ILIKE ${pattern} ESCAPE '!'`,
            ),
          )!,
        );
      }
      const where = and(...predicates);
      const statusCounts: QueueResponse['statusCounts'] = {
        draft: 0,
        in_review: 0,
        sent_back: 0,
        awaiting_disposition: 0,
        ready_for_launch: 0,
      };
      const counts = await tx
        .select({ status: visible.status, n: count() })
        .from(visible)
        .groupBy(visible.status);
      for (const row of counts) statusCounts[row.status] = row.n;
      // One option per owner subject; the label is the owner name the cards show.
      const owners = await tx
        .select({ value: visible.ownerSubjectId, label: sql<string>`min(${visible.businessOwner})` })
        .from(visible)
        .groupBy(visible.ownerSubjectId)
        .orderBy(visible.ownerSubjectId);
      const groups = await tx
        .selectDistinct({ value: visible.useCaseGroup })
        .from(visible)
        .orderBy(visible.useCaseGroup);
      const [total] = await tx.select({ n: count() }).from(visible).where(where);
      const rows = await tx
        .select()
        .from(visible)
        .where(where)
        .orderBy(desc(visible.updatedAt), desc(visible.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const memo: SlaCalendarMemo = new Map();
      const items: QueueItem[] = [];
      for (const row of rows) {
        const dueDates =
          row.currentVersionId === null || row.currentSubmittedAt === null
            ? []
            : await dueDatesFor(
                tx,
                {
                  id: row.currentVersionId,
                  submittedAt: row.currentSubmittedAt,
                  frozenConfiguration: row.currentFrozen,
                },
                memo,
              );
        items.push({
          caseId: row.id,
          registryId: row.registryId,
          useCaseName: row.useCaseName,
          businessUnitId: row.businessUnitId,
          businessUnit: row.businessUnit,
          businessOwner: row.ownerSubjectId,
          ownerDisplayName: row.businessOwner,
          useCaseGroup: row.useCaseGroup,
          sourceRecordId: fromStoredSourceRecordId(row.sourceRecordId),
          status: row.status,
          currentVersionNumber: row.currentVersionNumber,
          latestVersionNumber: row.latestVersionNumber,
          updatedAt: row.updatedAt.toISOString(),
          lanes: dueDates.map((due) => ({
            lane: due.lane,
            due,
            status: row[projectionColumnForLane(due.lane)] as LaneProjectionStatus,
          })),
          nextAction: NEXT_ACTION[row.status],
        });
      }
      return {
        items,
        page,
        pageSize,
        total: total?.n ?? 0,
        statusCounts,
        filterOptions: {
          statuses: counts.map((row) => row.status).sort(),
          owners,
          useCaseGroups: groups.map((row) => row.value),
        },
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
