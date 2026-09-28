// W6-15 (W6 plan sections 8.2 and 9): pure presentation rules of the dashboard. The server counts, inside the actor's
// scope (W6-13); this module only decides which W6-14 queue drill-down a number opens and how wide its bar is. The
// links are built by the queue's own `queueParams`, so every URL parses back on the queue screen.

import type { Lane } from '@rai/shared/constants';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import type { DashboardResponse } from '@rai/shared/schemas/dashboard';
import type { QueueQuery } from '@rai/shared/schemas/queue';
import { ROUTES } from '../../routes.js';
import { queueParams } from '../queue/view-model.js';

export type Severity = DashboardResponse['findings']['open'][number]['severity'];
export type LaneState = 'pending' | 'approved' | 'sent_back';
export type SlaState = 'due_soon' | 'breached';

/** A 0, or a number the queue cannot list (runs, weeks, tiers before W6-16), is text; any other count is a link. */
export type CountCell = { kind: 'text'; count: number } | { kind: 'link'; count: number; to: string };

export function queueLink(query: QueueQuery): string {
  const search = queueParams(query).toString();
  return search === '' ? ROUTES.queue : `${ROUTES.queue}?${search}`;
}

export function countCell(count: number, query: QueueQuery | undefined): CountCell {
  if (count === 0 || query === undefined) return { kind: 'text', count };
  return { kind: 'link', count, to: queueLink(query) };
}

export const statusQuery = (status: CaseStatus): QueueQuery => ({ status });
export const laneStateQuery = (lane: Lane, laneStatus: LaneState): QueueQuery => ({ lane, laneStatus });
export const laneSlaQuery = (lane: Lane, sla: SlaState): QueueQuery => ({ lane, sla });
/** Defects only: a severity alone would also list QC-unavailable findings of that severity (W6-14). */
export const defectQuery = (lane: Lane, severity: Severity): QueueQuery => ({
  findingLane: lane,
  findingSeverity: severity,
  findingKind: 'defect',
});
export const unavailableQuery = (lane: Lane): QueueQuery => ({
  findingLane: lane,
  findingKind: 'unavailable',
});

export function findingCount(data: DashboardResponse, lane: Lane, severity: Severity): number {
  return data.findings.open.find((row) => row.lane === lane && row.severity === severity)?.count ?? 0;
}

/** Open QC-unavailable findings of a lane, outage and operator pause together (the queue filter lists both). */
export function unavailableTotal(data: DashboardResponse, lane: Lane): number {
  const { outage, paused } = data.findings.unavailableOpen[lane];
  return outage + paused;
}

/** The width of a decorative bar, as a percentage of the tile's largest count. */
export function barPercent(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.min(100, Math.round((count / max) * 100));
}

export function isEmptyDashboard(data: DashboardResponse): boolean {
  return data.cases.total === 0;
}
