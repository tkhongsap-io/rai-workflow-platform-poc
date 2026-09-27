// W3-07a prerequisite contract under W0-10. No routes or collectors are implemented here.
import { Type, type Static } from 'typebox';
import { LaneSchema } from './review.js';
import { UNSAFE_UPLOAD_REASONS } from '../errors.js';
import { QC_UNAVAILABLE_DETAIL_PATTERN } from '../qc/types.js';

const values = Type.Enum;
const object = <T extends Parameters<typeof Type.Object>[0]>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });
const timestamp = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$' });
const id = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' });
const count = Type.Integer({ minimum: 0 });
// A QC runner name or version (QcRunner.identity): an identifier, never free text such as an exception message.
const runnerLabel = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$' });
// W4-11b: qc_run.unavailable_detail, a bounded code (the runner's detail or 'unspecified'), never free text.
const unavailableDetail = Type.String({ pattern: QC_UNAVAILABLE_DETAIL_PATTERN });
export const QcUnavailableReasonSchema = values([
  'timeout',
  'runner_error',
  'not_configured',
  'artifact_unreadable',
] as const);
export const DigestErrorCodeSchema = values([
  'query_failed',
  'render_failed',
  'enqueue_failed',
  'internal_error',
] as const);
export const DigestStageSchema = values(['query', 'render', 'enqueue'] as const);
export const ErrorCategorySchema = values([
  'unauthenticated',
  'forbidden',
  'stale_version',
  'invalid_input',
  'unsafe_upload',
  'qc_unavailable',
  'mail_delivery_failed',
  'not_found',
  'internal_error',
  'desk_frozen', // W6-01: a write refused while the desk is frozen (an operator choice, logged at info)
] as const);
export type ErrorCategory = Static<typeof ErrorCategorySchema>;
const deliveryError = values([
  'malformed_request',
  'sink_failure',
  'rejected_recipient',
  'unsafe_link',
  'duplicate',
] as const);
const startupReason = Type.Union([
  values([
    'mode_unknown',
    'bind_not_loopback',
    'base_url_not_loopback',
    'base_url_not_https',
    'proxy_forbidden_in_mode',
    'network_source_unknown',
    'allow_list_invalid',
    'google_forbidden_in_mode',
    'issuer_not_entra',
    'group_mapping_missing',
    'fixture_outside_test',
    'discovery_failed',
  ] as const),
  values([
    'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID',
    'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
    'secret_missing:RAI_IDENTITY_OIDC_ISSUER_URL',
    'secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID',
    'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET',
    'secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON',
    'secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID',
    'secret_missing:RAI_SESSION_ABSOLUTE_HOURS',
  ] as const),
]);
export const ReadinessReportSchema = object({
  status: values(['ready', 'not_ready'] as const),
  checkedAt: timestamp,
  identity: object({
    mode: values(['fixture', 'local-google', 'network', 'production', 'unset'] as const),
    loopbackBind: Type.Boolean(),
    status: values(['ok', 'misconfigured'] as const),
    reason: Type.Optional(startupReason),
  }),
  store: object({
    db: values(['ok', 'unreachable', 'timeout'] as const),
    migrations: values(['current', 'pending', 'ahead', 'unknown'] as const), // ahead: W7-03, additive only
    blob: values(['ok', 'unreachable', 'not_writable'] as const),
  }),
  mailSink: object({
    kind: values(['memory', 'file', 'smtp'] as const),
    status: values(['ok', 'unavailable'] as const),
  }),
  qc: object({
    kind: values(['substitute', 'deterministic', 'model'] as const),
    status: values(['ok', 'unavailable', 'disabled'] as const),
  }),
  build: object({
    commit: Type.String({ pattern: '^(dev|[0-9a-f]{7,40})$' }),
    schemaVersion: Type.String({ pattern: '^(unknown|[0-9]+)$' }),
  }),
});
export type ReadinessReport = Static<typeof ReadinessReportSchema>;

const trigger = values(['upload', 'submit', 'approve_attempt'] as const);
export const LateQcSchema = object({
  lateResultId: id,
  qcRunId: id,
  caseId: id,
  versionId: id,
  trigger,
  lane: Type.Optional(LaneSchema),
  status: values(['completed', 'unavailable'] as const),
  refusedFindingCount: count,
  recordedAt: timestamp,
  correlationId: id,
});
const mailIdentity = {
  notificationId: id,
  eventType: values(['lane_open', 'send_back', 'ready', 'sla_breach_digest'] as const),
  caseId: Type.Optional(id),
  versionId: Type.Optional(id),
  lane: Type.Optional(LaneSchema),
  recipient: Type.String({ minLength: 1 }),
  correlationId: id,
};
export const FailureReportSchema = Type.Union([
  object({
    ...mailIdentity,
    status: Type.Literal('queued'),
    attempts: Type.Integer({ minimum: 1, maximum: 3 }),
    nextAttemptAt: Type.Optional(timestamp),
    lastErrorCode: deliveryError,
  }),
  object({
    ...mailIdentity,
    status: Type.Literal('failed'),
    attempts: Type.Literal(4),
    lastErrorCode: deliveryError,
    failureCategory: Type.Literal('mail_delivery_failed'),
  }),
]);
export type FailureReport = Static<typeof FailureReportSchema>;

export const DeskHealthReportSchema = object({
  generatedAt: timestamp,
  readiness: ReadinessReportSchema,
  failedMail: Type.Array(FailureReportSchema, { maxItems: 100 }),
  unavailableQc: Type.Array(
    object({
      qcRunId: id,
      caseId: id,
      versionId: id,
      trigger,
      reason: Type.Union([QcUnavailableReasonSchema, Type.Literal('unknown')]),
      owningLane: Type.Optional(LaneSchema),
      // W4-11a: the runner label, qc_run.engine_id and runner_version ('unrecorded' on rows before migration 0009).
      runner: runnerLabel,
      runnerVersion: runnerLabel,
      // W4-11b: the stored detail; null when the run gave none and on rows written before migration 0014.
      unavailableDetail: Type.Union([unavailableDetail, Type.Null()]),
      requestedAt: timestamp,
      correlationId: id,
    }),
    { maxItems: 100 },
  ),
  lateQc: Type.Array(LateQcSchema, { maxItems: 100 }),
  slaDigest: object({
    lastRun: Type.Optional(
      object({
        jobRunId: id,
        digestDay: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        startedAt: timestamp,
        finishedAt: Type.Optional(timestamp),
        status: values(['running', 'completed', 'failed'] as const),
        breachCount: Type.Optional(count),
        notificationIds: Type.Array(id),
        errorCode: Type.Optional(DigestErrorCodeSchema),
        correlationId: id,
      }),
    ),
    recentFailures: Type.Array(
      object({
        jobRunId: id,
        digestDay: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        startedAt: timestamp,
        stage: DigestStageSchema,
        errorCode: DigestErrorCodeSchema,
        correlationId: id,
      }),
      { maxItems: 100 },
    ),
  }),
  errorCounters: Type.Array(object({ code: ErrorCategorySchema, count, lastAt: timestamp })),
});
export type DeskHealthReport = Static<typeof DeskHealthReportSchema>;

// Only W3-03b may create this provenance after loading the persisted run. Sinks must validate
// the discriminant in a coordinated mail contract; a UUID alone does not prove authorization.
export const DigestJobProvenanceSchema = object({
  kind: Type.Literal('sla_digest_job'),
  jobRunId: id,
  digestDay: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  correlationId: id,
});
export type DigestJobProvenance = Static<typeof DigestJobProvenanceSchema>;

// Safe log payloads: callers normalize to schema-owned paths, never unknown request keys/values.
// These paths identify the input surface; detailed paths stay in the HTTP response only.
export const SafeErrorFieldsSchema = Type.Union([
  object({ category: Type.Literal('unauthenticated') }),
  object({
    category: Type.Literal('forbidden'),
    reason: Type.Optional(values(['role', 'scope', 'lane', 'self_approval'] as const)),
  }),
  object({
    category: Type.Literal('stale_version'),
    caseId: Type.Optional(id),
    expectedVersionId: Type.Optional(id),
    currentVersionId: Type.Optional(id),
  }),
  object({
    category: Type.Literal('invalid_input'),
    fieldPaths: Type.Array(values(['body', 'querystring', 'params', 'headers'] as const), {
      maxItems: 4,
      uniqueItems: true,
    }),
  }),
  object({
    category: Type.Literal('unsafe_upload'),
    reason: values(UNSAFE_UPLOAD_REASONS),
    caseId: Type.Optional(id),
    slot: Type.Optional(Type.Integer({ minimum: 1, maximum: 9 })),
    sizeBytes: Type.Optional(count),
  }),
  object({
    category: Type.Literal('qc_unavailable'),
    qcRunId: id,
    caseId: id,
    versionId: id,
    reason: QcUnavailableReasonSchema,
  }),
  object({
    category: Type.Literal('mail_delivery_failed'),
    notificationId: id,
    attempts: Type.Literal(4),
    errorCode: deliveryError,
  }),
  object({
    category: Type.Literal('not_found'),
    targetType: Type.Optional(
      // W5-02 adds risk_rubric (no risk_rubric revision in force; W5 plan section 6).
      values([
        'case',
        'version',
        'finding',
        'artifact',
        'notification',
        'configuration',
        'risk_rubric',
        'route',
      ] as const),
    ),
  }),
  object({ category: Type.Literal('desk_frozen') }), // W6-01: nothing about the refused route's target
  object({
    category: Type.Literal('internal_error'),
    stackHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    stack: Type.Array(
      object({
        module: Type.String({ pattern: '^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*\\.[cm]?[jt]s$' }),
        line: Type.Integer({ minimum: 1 }),
        column: Type.Integer({ minimum: 1 }),
      }),
      { maxItems: 30 },
    ),
  }),
]);
export type SafeErrorFields = Static<typeof SafeErrorFieldsSchema>;
