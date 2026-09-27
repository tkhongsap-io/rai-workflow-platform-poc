// W0-02 section 5: every variable parsed and validated at start, exposed as a typed object. This is the only file
// that reads process.env (W0-02 section 1.1 rule); everything else receives the typed config. A misconfiguration
// is a start-up failure with a reason code and exit 78 (EX_CONFIG), never a default.
//
// Identity variables (RAI_IDENTITY_*, RAI_SECRET_*, RAI_SESSION_*) belong to W0-03: this file parses the rows a
// pure read of the environment can decide that W1-00 needs (S1 mode, S13 fixture outside test, S14 fixture bind)
// and hands the rest to the W1-01a adapter as `identityEnv`. The adapter's full table (S1-S18) is W1-01a's.

import { IDENTITY_MODES, type IdentityMode } from '@rai/shared/schemas/auth';

export const EXIT_CONFIG = 78;

export type NodeEnv = 'development' | 'test' | 'production';
export type MailMode = 'sink-file' | 'sink-memory';
// `deterministic` is accepted only under NODE_ENV=test until W4-13 makes it the runner of every environment (W4a
// plan section 2); W4-03 introduces it for the real-server evidence test (plan section 8, issue #186).
export type QcMode = 'substitute' | 'deterministic';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DatabaseConfig {
  url: string; // rai_app
  migrateUrl: string; // rai_owner; the only connection that runs DDL
  operatorUrl: string; // rai_operator; defaults to migrateUrl locally when DATABASE_OPERATOR_URL is empty
}

export interface AppConfig {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  publicBaseUrl: URL;
  trustProxy: boolean;
  database: DatabaseConfig;
  blobDir: string;
  upload: { maxFileBytes: number; maxPackBytes: number; maxImagePixels: number };
  idempotencyTtlHours: number;
  blobOrphanMinAgeHours: number;
  blobTmpMaxAgeHours: number;
  identity: { mode: IdentityMode; env: Readonly<Record<string, string>> }; // env: the RAI_IDENTITY_*/RAI_SECRET_*/RAI_SESSION_* rows for W1-01a
  mail: { mode: MailMode; sinkDir: string };
  qc: { mode: QcMode };
  log: { level: LogLevel; pretty: boolean };
  buildCommit: string;
}

export type ConfigReasonCode =
  | `missing:${string}`
  | `invalid:${string}`
  | 'mode_unknown' // W0-03 S1
  | 'fixture_outside_test' // W0-03 S13
  | 'bind_not_loopback' // W0-03 S2 (local-google) and S14 (fixture); W0-02 section 5 HOST row
  | 'log_pretty_in_production'; // W0-10 section 3.1

export class ConfigError extends Error {
  readonly exitCode = EXIT_CONFIG;
  constructor(readonly reason: ConfigReasonCode) {
    super(reason); // the reason code names a variable at most, never a value (W0-10 redaction)
    this.name = 'ConfigError';
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

/** W0-08 section 3 defaults (synthetic data; D08 revisits). A larger value is refused in local-google and fixture modes. */
export const UPLOAD_LIMIT_DEFAULTS = Object.freeze({
  UPLOAD_MAX_FILE_BYTES: 26_214_400,
  UPLOAD_MAX_PACK_BYTES: 157_286_400,
  UPLOAD_MAX_IMAGE_PIXELS: 40_000_000,
});

/** The one process.env read. Loads rai-web/.env when present without overriding variables already set. */
export function readEnv(): Env {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env (CI, tests, a bare checkout): the environment itself must carry every variable
  }
  return process.env;
}

/** Loopback per W0-03 section 5: 127.0.0.1, ::1 or localhost. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === '::1' || h === 'localhost';
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new ConfigError(`missing:${name}`);
  return value.trim();
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function oneOf<T extends string>(env: Env, name: string, values: readonly T[]): T {
  const value = required(env, name);
  if (!(values as readonly string[]).includes(value)) throw new ConfigError(`invalid:${name}`);
  return value as T;
}

function parseQcMode(env: Env, nodeEnv: NodeEnv): QcMode {
  const mode = oneOf(env, 'QC_MODE', ['substitute', 'deterministic'] as const);
  if (mode === 'deterministic' && nodeEnv !== 'test') throw new ConfigError('invalid:QC_MODE');
  return mode;
}

function integer(env: Env, name: string, { min, max }: { min: number; max?: number }): number {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw)) throw new ConfigError(`invalid:${name}`);
  const value = Number(raw);
  if (value < min || (max !== undefined && value > max)) throw new ConfigError(`invalid:${name}`);
  return value;
}

function bool(env: Env, name: string): boolean {
  return oneOf(env, name, ['true', 'false'] as const) === 'true';
}

function postgresUrl(env: Env, name: string): string {
  const raw = required(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`invalid:${name}`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new ConfigError(`invalid:${name}`);
  return raw;
}

/** The subset commands need that touch only the database (migrate, fixtures:load, operator commands). */
export function parseDatabaseConfig(env: Env): DatabaseConfig {
  const url = postgresUrl(env, 'DATABASE_URL');
  const migrateUrl = postgresUrl(env, 'DATABASE_MIGRATE_URL');
  const operatorUrl =
    optional(env, 'DATABASE_OPERATOR_URL') === undefined
      ? migrateUrl
      : postgresUrl(env, 'DATABASE_OPERATOR_URL');
  return { url, migrateUrl, operatorUrl };
}

/** The retention thresholds the server and the operator cleanup commands share: an empty value refuses, never deletes all. */
export function parseRetentionConfig(env: Env) {
  return {
    idempotencyTtlHours: integer(env, 'IDEMPOTENCY_TTL_HOURS', { min: 1 }),
    blobOrphanMinAgeHours: integer(env, 'BLOB_ORPHAN_MIN_AGE_HOURS', { min: 0 }),
    // W3 deferred rulings item 7: never below one hour, so the sweep cannot take an in-flight upload.
    blobTmpMaxAgeHours: integer(env, 'BLOB_TMP_MAX_AGE_HOURS', { min: 1 }),
  };
}

export function parseNodeEnv(env: Env): NodeEnv {
  return oneOf(env, 'NODE_ENV', ['development', 'test', 'production'] as const);
}

const IDENTITY_ENV_PREFIXES = ['RAI_IDENTITY_', 'RAI_SECRET_', 'RAI_SESSION_'];

/** Parses every section-5 variable and applies the fail-closed rules this ticket owns. Pure: no I/O. */
export function parseConfig(env: Env): AppConfig {
  const nodeEnv = parseNodeEnv(env);
  const host = required(env, 'HOST');
  const port = integer(env, 'PORT', { min: 1, max: 65535 });
  let publicBaseUrl: URL;
  try {
    publicBaseUrl = new URL(required(env, 'PUBLIC_BASE_URL'));
  } catch {
    throw new ConfigError('invalid:PUBLIC_BASE_URL');
  }
  const trustProxy = bool(env, 'TRUST_PROXY');

  const modeRaw = optional(env, 'RAI_IDENTITY_MODE');
  if (modeRaw === undefined || !(IDENTITY_MODES as readonly string[]).includes(modeRaw)) {
    throw new ConfigError('mode_unknown'); // S1: missing and unknown are not distinguished
  }
  const mode = modeRaw as IdentityMode;
  if (mode === 'fixture') {
    if (nodeEnv !== 'test') throw new ConfigError('fixture_outside_test'); // S13
    if (!isLoopbackHost(host) || !isLoopbackHost(publicBaseUrl.hostname))
      throw new ConfigError('bind_not_loopback'); // S14
  }
  // W0-02 section 5 HOST row: non-loopback is refused unless the mode is network or production. S3 (base URL)
  // and S5 (trustProxy) for local-google carry finer codes and are W1-01a's, inside the identity adapter parse.
  if (mode === 'local-google' && !isLoopbackHost(host)) throw new ConfigError('bind_not_loopback'); // S2
  const identityEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && IDENTITY_ENV_PREFIXES.some((p) => name.startsWith(p)))
      identityEnv[name] = value;
  }

  const logPretty = bool(env, 'LOG_PRETTY');
  if (logPretty && nodeEnv === 'production') throw new ConfigError('log_pretty_in_production');

  const upload = {
    maxFileBytes: integer(env, 'UPLOAD_MAX_FILE_BYTES', { min: 1 }),
    maxPackBytes: integer(env, 'UPLOAD_MAX_PACK_BYTES', { min: 1 }),
    maxImagePixels: integer(env, 'UPLOAD_MAX_IMAGE_PIXELS', { min: 1 }),
  };
  if (mode === 'local-google' || mode === 'fixture') {
    // W0-08 section 3: a local override cannot quietly widen the policy; raising a limit is a D08 change.
    if (upload.maxFileBytes > UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES)
      throw new ConfigError('invalid:UPLOAD_MAX_FILE_BYTES');
    if (upload.maxPackBytes > UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES)
      throw new ConfigError('invalid:UPLOAD_MAX_PACK_BYTES');
    if (upload.maxImagePixels > UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS)
      throw new ConfigError('invalid:UPLOAD_MAX_IMAGE_PIXELS');
  }

  return {
    nodeEnv,
    host,
    port,
    publicBaseUrl,
    trustProxy,
    database: parseDatabaseConfig(env),
    blobDir: required(env, 'BLOB_DIR'),
    upload,
    ...parseRetentionConfig(env),
    identity: { mode, env: Object.freeze(identityEnv) },
    mail: {
      mode: oneOf(env, 'MAIL_MODE', ['sink-file', 'sink-memory'] as const),
      sinkDir: required(env, 'MAIL_SINK_DIR'),
    },
    qc: { mode: parseQcMode(env, nodeEnv) },
    log: { level: oneOf(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const), pretty: logPretty },
    buildCommit: required(env, 'BUILD_COMMIT'),
  };
}
