// W0-10 section 3: structured event logging with an allow-list emitter (section 4.2, layer 1) and pino redaction
// paths (layer 2). `log(event, fields)` copies only the keys the catalogue registers for that event; anything else
// is dropped and, in test and CI, throws OBS_UNREGISTERED_FIELD so the suite fails rather than the redaction
// silently doing its job. Renaming an event is a contract change.
import type { FastifyBaseLogger, FastifyServerOptions } from 'fastify';
import { PROCESS_ID, maybeContext, type CorrelationId } from './context.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** The W0-10 section 3.3 catalogue: event → permitted fields. Optional fields are listed without the `?`. */
export const EVENT_CATALOGUE = Object.freeze({
  'process.started': { level: 'info', fields: ['identityMode', 'loopback', 'schemaVersion', 'commit'] },
  'process.refused': { level: 'error', fields: ['reason'] },
  'process.stopping': { level: 'info', fields: ['signal'] },
  'request.completed': {
    level: 'info',
    fields: ['method', 'route', 'status', 'durationMs', 'actorSubjectId', 'actorRole', 'errorCode'],
  },
  'auth.signin.succeeded': { level: 'info', fields: ['identityMode', 'actorSubjectId', 'roles'] },
  'auth.signin.failed': { level: 'warn', fields: ['identityMode', 'reason'] },
  'authz.denied': {
    level: 'warn',
    fields: ['action', 'targetType', 'targetId', 'actorSubjectId', 'actorRole', 'reason'],
  },
  'workflow.transition': {
    level: 'info',
    fields: ['caseId', 'fromVersionId', 'toVersionId', 'transition', 'lane', 'auditEventId'],
  },
  'workflow.stale_version': { level: 'info', fields: ['caseId', 'expectedVersionId', 'currentVersionId'] },
  'workflow.idempotent_replay': { level: 'info', fields: ['caseId', 'idempotencyKeyHash'] },
  'upload.rejected': {
    level: 'warn',
    fields: ['caseId', 'reason', 'sniffedMediaType', 'declaredMediaType', 'sizeBytes', 'slot'],
  },
  'upload.stored': {
    level: 'info',
    fields: ['caseId', 'artifactId', 'contentHash', 'sizeBytes', 'mediaType'],
  },
  'qc.run.started': {
    level: 'info',
    fields: [
      'qcRunId',
      'caseId',
      'versionId',
      'trigger',
      'lane',
      'qcKind',
      'runner',
      'runnerVersion',
      'ruleRevision',
    ],
  },
  'qc.run.completed': {
    level: 'info',
    fields: [
      'qcRunId',
      'runner',
      'runnerVersion',
      'ruleRevision',
      'rulesEvaluated',
      'findingCount',
      'durationMs',
    ],
  },
  'qc.run.unavailable': {
    level: 'error',
    fields: [
      'qcRunId',
      'caseId',
      'versionId',
      'reason',
      'owningLane',
      'runner',
      'runnerVersion',
      'ruleRevision',
    ],
  },
  'qc.run.late': {
    level: 'warn',
    fields: ['qcRunId', 'caseId', 'versionId', 'trigger', 'lane', 'status', 'refusedFindingCount'],
  },
  'mail.enqueued': {
    level: 'info',
    fields: ['notificationId', 'eventType', 'caseId', 'versionId', 'lane', 'recipientCount'],
  },
  'mail.deduplicated': {
    level: 'info',
    fields: ['eventType', 'caseId', 'versionId', 'lane', 'existingNotificationId'],
  },
  'mail.sent': { level: 'info', fields: ['notificationId', 'attempt', 'sinkKind'] },
  'mail.attempt_failed': {
    level: 'warn',
    fields: ['notificationId', 'attempt', 'nextAttemptAt', 'errorCode'],
  },
  'mail.failed': { level: 'error', fields: ['notificationId', 'attempts', 'errorCode'] },
  'sla.digest.completed': { level: 'info', fields: ['jobRunId', 'breachCount', 'notificationIds'] },
  'sla.digest.failed': { level: 'error', fields: ['jobRunId', 'stage', 'errorCode'] },
  'health.readiness': { level: 'info', fields: ['status', 'report'] },
  // W7-01 (W7 plan section 8): operator command lines, printed through buildLogLine by `npm run backup`.
  'operator.backup.completed': {
    level: 'info',
    fields: ['backupId', 'blobCount', 'tableCount', 'durationMs'],
  },
  'operator.backup.failed': { level: 'error', fields: ['stage', 'reason'] },
  // W7-03 (W7 plan sections 3.3 and 8): `npm run release:check-rollback`. Tags and backup IDs only, never a path.
  'operator.rollback_check.completed': {
    level: 'info',
    fields: ['verdict', 'extraMigrations', 'blockingMigration', 'matchingBackups'],
  },
  'operator.rollback_check.failed': { level: 'error', fields: ['stage', 'reason'] },
  'error.captured': {
    level: 'error',
    fields: [
      'category',
      'code',
      'httpStatus',
      'route',
      'stackHash',
      'stack',
      'fieldPaths',
      'reason',
      'caseId',
      'expectedVersionId',
      'currentVersionId',
      'qcRunId',
      'versionId',
      'notificationId',
      'attempts',
      'errorCode',
      'targetType',
      'slot',
      'sizeBytes',
    ],
  },
} as const satisfies Record<string, { level: LogLevel; fields: readonly string[] }>);

export type EventName = keyof typeof EVENT_CATALOGUE;
export type EventFields<E extends EventName> = Partial<
  Record<(typeof EVENT_CATALOGUE)[E]['fields'][number], unknown>
>;

export interface LogLine {
  time: string; // ISO 8601 UTC; render in Asia/Bangkok only in the UI (D06)
  level: LogLevel;
  event: EventName;
  correlationId: CorrelationId | null; // null only for process-level lines, which then carry processId
  processId: string;
  fields: Record<string, unknown>;
}

export class UnregisteredFieldError extends Error {
  readonly code = 'OBS_UNREGISTERED_FIELD';
  constructor(event: string, field: string) {
    super(`OBS_UNREGISTERED_FIELD: ${field} is not registered for ${event}`);
    this.name = 'UnregisteredFieldError';
  }
}

export interface EmitterOptions {
  strict: boolean; // true in test and CI: an unregistered field throws instead of being dropped
  level?: LogLevel; // override the catalogue level for one line (request.completed uses warn/error by status)
}

/** Builds the line for `event`, keeping only registered fields. Pure apart from the clock and the context lookup. */
export function buildLogLine<E extends EventName>(
  event: E,
  fields: EventFields<E>,
  options: { strict: boolean; level?: LogLevel; now?: Date; correlationId?: CorrelationId | null },
): LogLine {
  const entry = EVENT_CATALOGUE[event];
  const allowed: ReadonlySet<string> = new Set(entry.fields);
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) {
      if (options.strict) throw new UnregisteredFieldError(event, key);
      continue;
    }
    if (value !== undefined) kept[key] = value;
  }
  const correlationId =
    options.correlationId === undefined ? (maybeContext()?.correlationId ?? null) : options.correlationId;
  return {
    time: (options.now ?? new Date()).toISOString(),
    level: options.level ?? entry.level,
    event,
    correlationId,
    processId: PROCESS_ID,
    fields: kept,
  };
}

export interface Emitter {
  log<E extends EventName>(event: E, fields: EventFields<E>, level?: LogLevel): LogLine;
}

/** The allow-list emitter over a pino-compatible logger (Fastify's). One JSON object per line on stdout. */
export function createEmitter(logger: FastifyBaseLogger, options: EmitterOptions): Emitter {
  return {
    log(event, fields, level) {
      const line = buildLogLine(
        event,
        fields,
        level === undefined ? { strict: options.strict } : { strict: options.strict, level },
      );
      const { level: lineLevel, time: _time, ...rest } = line; // pino writes level and time itself (loggerOptions)
      logger[lineLevel](rest);
      return line;
    },
  };
}

/** Fastify logger options (W0-10 sections 3.1 and 4.2 layer 2): level, redaction backstop, minimal serializers. */
export function loggerOptions(config: {
  level: LogLevel;
  pretty: boolean;
}): NonNullable<FastifyServerOptions['logger']> {
  const base = {
    base: null, // The W0-10 processId replaces Pino's pid/hostname; never expose the host account name.
    level: config.level,
    // The W0-10 section 3.2 line: one ISO `time` key and the level as its label, never pino's epoch and number.
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-forwarded-for"]',
        'res.headers["set-cookie"]',
        'err.config',
        '*.access_token',
        '*.id_token',
        '*.refresh_token',
        '*.client_secret',
        '*.password',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (req: { method: string; routeOptions?: { url?: string | undefined } | undefined }) => ({
        method: req.method,
        route: req.routeOptions?.url ?? null,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  };
  if (!config.pretty) return base;
  return {
    ...base,
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
  };
}
