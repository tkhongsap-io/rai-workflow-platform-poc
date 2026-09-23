// W3-01 / A06. Every population starts with the W0-05 scope predicate in SQL.
import { and, count, desc, eq, getTableColumns, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
import type { Db } from '../db/client.js';
import { cases } from '../db/schema/case.js';
import { packVersion } from '../db/schema/pack-version.js';
import { dueDatesFor, type SlaCalendarMemo } from '../sla/due-dates.js';
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

export async function readQueue(db: Db, actor: Actor, query: QueueQuery): Promise<QueueResponse> {
  const page = query.page ?? QUEUE_DEFAULTS.page;
  const pageSize = query.pageSize ?? QUEUE_DEFAULTS.pageSize;
  return db.transaction(
    async (tx) => {
      const current = alias(packVersion, 'queue_current');
      const draft = alias(packVersion, 'queue_draft');
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
        .where(caseScopeWhere(actor))
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
