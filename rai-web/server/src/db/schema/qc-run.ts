// W0-04 `qc_run`: immutable once inserted with final status. Written by the W2-05 orchestrator on behalf of QC.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { packVersion } from './pack-version.js';

export const QC_RUN_TRIGGERS = ['upload', 'submit', 'approve_attempt'] as const;
export const QC_RUN_STATUSES = ['completed', 'unavailable'] as const;

export const qcRun = pgTable(
  'qc_run',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references((): AnyPgColumn => packVersion.id),
    trigger: text('trigger').notNull(),
    slot: smallint('slot'),
    lane: text('lane'),
    engineId: text('engine_id').notNull(), // the runner name (QcRunner.identity.runner)
    // W4-11a: the runner's version; 'unrecorded' on rows written before migration 0009, which dropped the default.
    runnerVersion: text('runner_version').notNull(),
    ruleRevision: text('rule_revision').notNull(),
    status: text('status').notNull(),
    // NULL preserves historical uncertainty; new unavailable writers supply the bounded reason.
    unavailableReason: text('unavailable_reason'),
    // W4-11a: rules the runner executed; 0 on an unavailable run, NULL on rows written before migration 0009.
    rulesEvaluated: integer('rules_evaluated'),
    // W4-11b: the extractor and model identity and usage the runner reported (QcRunResult.engine); NULL on rows
    // written before migration 0012 and on runs without extraction or model use.
    extractorVersion: text('extractor_version'),
    modelProvider: text('model_provider'),
    modelId: text('model_id'),
    promptRevision: text('prompt_revision'),
    modelInputTokens: integer('model_input_tokens'),
    modelOutputTokens: integer('model_output_tokens'),
    modelLatencyMs: integer('model_latency_ms'),
    modelCostUsdMicros: bigint('model_cost_usd_micros', { mode: 'number' }),
    // W4-11b: the unavailable result's detail when it is a bounded code, 'unspecified' otherwise; NULL when none.
    unavailableDetail: text('unavailable_detail'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    correlationId: text('correlation_id').notNull(),
  },
  (t) => [
    index('qc_run_version_id_trigger_idx').on(t.versionId, t.trigger),
    index('qc_run_correlation_id_idx').on(t.correlationId),
    index('qc_run_status_requested_idx').on(t.status, t.requestedAt),
    check(
      'qc_run_unavailable_reason_check',
      sql`${t.unavailableReason} IS NULL OR (${t.status} = 'unavailable' AND ${t.unavailableReason} IN ('timeout', 'runner_error', 'not_configured', 'artifact_unreadable'))`,
    ),
    check('qc_run_trigger_check', sql`${t.trigger} IN ('upload', 'submit', 'approve_attempt')`),
    check('qc_run_lane_check', sql`${t.lane} IS NULL OR ${t.lane} IN ('ai_coe', 'dpo', 'it_security')`),
    check('qc_run_status_check', sql`${t.status} IN ('completed', 'unavailable')`),
    check('qc_run_rules_evaluated_check', sql`${t.rulesEvaluated} IS NULL OR ${t.rulesEvaluated} >= 0`),
    check(
      'qc_run_model_input_tokens_check',
      sql`${t.modelInputTokens} IS NULL OR ${t.modelInputTokens} >= 0`,
    ),
    check(
      'qc_run_model_output_tokens_check',
      sql`${t.modelOutputTokens} IS NULL OR ${t.modelOutputTokens} >= 0`,
    ),
    check('qc_run_model_latency_ms_check', sql`${t.modelLatencyMs} IS NULL OR ${t.modelLatencyMs} >= 0`),
    check(
      'qc_run_model_cost_usd_micros_check',
      sql`${t.modelCostUsdMicros} IS NULL OR ${t.modelCostUsdMicros} >= 0`,
    ),
    check(
      'qc_run_unavailable_detail_check',
      sql`${t.unavailableDetail} IS NULL OR (${t.status} = 'unavailable' AND ${t.unavailableDetail} ~ '^[a-z0-9_]{1,64}$')`,
    ),
    check('qc_run_slot_check', sql`${t.slot} IS NULL OR (${t.slot} >= 1 AND ${t.slot} <= 9)`),
  ],
);
