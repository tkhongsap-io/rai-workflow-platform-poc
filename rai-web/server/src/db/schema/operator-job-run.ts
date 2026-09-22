// W3-07a contract: operational records, never business audit or approval authority.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { notification } from './notification.js';
import { packVersion } from './pack-version.js';

export const operatorJobRun = pgTable(
  'operator_job_run',
  {
    id: uuid('id').primaryKey(),
    job: text('job').notNull(),
    digestDay: date('digest_day').notNull(),
    correlationId: text('correlation_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(),
    breachCount: integer('breach_count'),
    errorStage: text('error_stage'),
    errorCode: text('error_code'),
  },
  (t) => [
    index('operator_job_run_started_idx').on(t.startedAt, t.id),
    check('operator_job_kind_check', sql`${t.job} = 'sla_digest'`),
    check('operator_job_count_check', sql`${t.breachCount} IS NULL OR ${t.breachCount} >= 0`),
    check('operator_job_time_check', sql`${t.finishedAt} IS NULL OR ${t.finishedAt} >= ${t.startedAt}`),
    check(
      'operator_job_state_check',
      sql`(${t.status} = 'running' AND ${t.finishedAt} IS NULL AND ${t.errorStage} IS NULL AND ${t.errorCode} IS NULL) OR (${t.status} = 'completed' AND ${t.finishedAt} IS NOT NULL AND ${t.breachCount} IS NOT NULL AND ${t.errorStage} IS NULL AND ${t.errorCode} IS NULL) OR (${t.status} = 'failed' AND ${t.finishedAt} IS NOT NULL AND ${t.errorStage} IS NOT NULL AND ${t.errorCode} IS NOT NULL AND ${t.errorStage} IN ('query', 'render', 'enqueue') AND ${t.errorCode} IN ('query_failed', 'render_failed', 'enqueue_failed', 'internal_error'))`,
    ),
  ],
);

export const operatorJobNotification = pgTable(
  'operator_job_notification',
  {
    jobRunId: uuid('job_run_id')
      .notNull()
      .references(() => operatorJobRun.id),
    notificationId: uuid('notification_id')
      .notNull()
      .unique()
      .references(() => notification.id),
    digestDay: date('digest_day').notNull(),
    recipient: text('recipient').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.jobRunId, t.notificationId] }),
    uniqueIndex('operator_digest_day_recipient_key').on(t.digestDay, t.recipient),
  ],
);

// qcRunId identifies the refused attempt; intentionally NOT an FK to qc_run (no run was appended).
export const qcLateResult = pgTable(
  'qc_late_result',
  {
    id: uuid('id').primaryKey(),
    qcRunId: uuid('qc_run_id').notNull().unique(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => packVersion.id),
    trigger: text('trigger').notNull(),
    lane: text('lane'),
    status: text('status').notNull(),
    refusedFindingCount: integer('refused_finding_count').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
  },
  (t) => [
    index('qc_late_recorded_idx').on(t.recordedAt, t.id),
    check('qc_late_trigger_check', sql`${t.trigger} IN ('upload', 'submit', 'approve_attempt')`),
    check('qc_late_lane_check', sql`${t.lane} IS NULL OR ${t.lane} IN ('ai_coe', 'dpo', 'it_security')`),
    check('qc_late_status_check', sql`${t.status} IN ('completed', 'unavailable')`),
    check('qc_late_count_check', sql`${t.refusedFindingCount} >= 0`),
  ],
);
