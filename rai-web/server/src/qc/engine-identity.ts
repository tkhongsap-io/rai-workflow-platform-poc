// W4-11b (W4b plan sections 7 and 8): a run's extractor and model identity and its unavailable detail, as the
// qc_run columns and the qc.run.* log fields record them. Identifiers and numbers only (W0-10 redaction): no filename,
// document text, excerpt, model input or output, or message param ever passes through here.
import type { QcEngineIdentity, QcRunResult } from '@rai/shared/qc/types';

/** The qc_run.unavailable_detail CHECK pattern (migration 0011). */
export const UNAVAILABLE_DETAIL_PATTERN = /^[a-z0-9_]{1,64}$/;
/** Stored in place of a detail that is not a bounded code, so free text never reaches the row. */
export const UNSPECIFIED_DETAIL = 'unspecified';
/** The detail of a run refused because its `engine` identity failed `QcEngineIdentitySchema`. */
export const ENGINE_IDENTITY_INVALID = 'engine_identity_invalid';

export interface EngineColumns {
  extractorVersion: string | null;
  modelProvider: string | null;
  modelId: string | null;
  promptRevision: string | null;
  modelInputTokens: number | null;
  modelOutputTokens: number | null;
  modelLatencyMs: number | null;
  modelCostUsdMicros: number | null;
}

/** The identity columns of a run; all NULL when the run used no extraction and no model. */
export function engineColumnsOf(engine: QcEngineIdentity | undefined): EngineColumns {
  const model = engine?.model;
  return {
    extractorVersion: engine?.extractorVersion ?? null,
    modelProvider: model?.provider ?? null,
    modelId: model?.modelId ?? null,
    promptRevision: model?.promptRevision ?? null,
    modelInputTokens: model?.inputTokens ?? null,
    modelOutputTokens: model?.outputTokens ?? null,
    modelLatencyMs: model?.latencyMs ?? null,
    modelCostUsdMicros: model?.costUsdMicros ?? null,
  };
}

export type EngineLogFields = Partial<{
  extractorVersion: string;
  modelProvider: string;
  modelId: string;
  promptRevision: string;
  modelInputTokens: number;
  modelOutputTokens: number;
  modelLatencyMs: number;
}>;

/** The W0-10 fields of qc.run.completed / qc.run.unavailable: only what was recorded; the cost stays on the row. */
export function engineLogFields(columns: EngineColumns): EngineLogFields {
  const fields: EngineLogFields = {};
  if (columns.extractorVersion !== null) fields.extractorVersion = columns.extractorVersion;
  if (columns.modelProvider !== null) fields.modelProvider = columns.modelProvider;
  if (columns.modelId !== null) fields.modelId = columns.modelId;
  if (columns.promptRevision !== null) fields.promptRevision = columns.promptRevision;
  if (columns.modelInputTokens !== null) fields.modelInputTokens = columns.modelInputTokens;
  if (columns.modelOutputTokens !== null) fields.modelOutputTokens = columns.modelOutputTokens;
  if (columns.modelLatencyMs !== null) fields.modelLatencyMs = columns.modelLatencyMs;
  return fields;
}

/**
 * qc_run.unavailable_detail: the detail when it is a bounded code, `unspecified` when a detail was given that is not,
 * NULL when none was given or the run completed (plan section 7).
 */
export function storedUnavailableDetail(result: QcRunResult): string | null {
  if (result.status !== 'unavailable' || result.detail === null) return null;
  return UNAVAILABLE_DETAIL_PATTERN.test(result.detail) ? result.detail : UNSPECIFIED_DETAIL;
}
