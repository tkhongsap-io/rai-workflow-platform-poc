// W0-02 section 5: every variable parsed and validated at start, exposed as a typed object. This is the only file
// that reads process.env (W0-02 section 1.1 rule); everything else receives the typed config. A misconfiguration
// is a start-up failure with a reason code and exit 78 (EX_CONFIG), never a default.
//
// Identity variables (RAI_IDENTITY_*, RAI_SECRET_*, RAI_SESSION_*) belong to W0-03: this file parses the rows a
// pure read of the environment can decide that W1-00 needs (S1 mode, S13 fixture outside test, S14 fixture bind)
// and hands the rest to the W1-01a adapter as `identityEnv`. The adapter's full table (S1-S18) is W1-01a's.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_MODES, type IdentityMode } from '@rai/shared/schemas/auth';

export const EXIT_CONFIG = 78;

export type NodeEnv = 'development' | 'test' | 'production';
export type MailMode = 'sink-file' | 'sink-memory';
// W4a plan section 2 (W4-13): `deterministic` binds the W4a runner in every environment; `substitute` binds the
// scripted W1-10 runner and is a local value only (see parseQcMode).
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

/** The identity modes in which the scripted substitute may run (W4a plan section 2). */
const QC_LOCAL_IDENTITY_MODES: readonly IdentityMode[] = ['fixture', 'local-google'];

/**
 * W4a plan section 2: unset → missing, any other value → invalid; `substitute` is refused under NODE_ENV=production
 * or a non-local identity mode (W0-07 3.9). No mode ever falls back to the other runner.
 */
function parseQcMode(env: Env, nodeEnv: NodeEnv, identityMode: IdentityMode): QcMode {
  const mode = oneOf(env, 'QC_MODE', ['substitute', 'deterministic'] as const);
  if (mode === 'substitute' && (nodeEnv === 'production' || !QC_LOCAL_IDENTITY_MODES.includes(identityMode)))
    throw new ConfigError('invalid:QC_MODE');
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

/** The repository checkout this file sits in (`server/src/config.ts` and `server/dist/config.js` alike). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** W7 plan section 2 (W7-D5): where pg_dump and pg_restore run. */
export type PgToolsMode =
  | { kind: 'path' } // host binaries on PATH, against the configured host and port
  | { kind: 'docker'; container: string } // docker exec into a named Postgres container (CI service container)
  | { kind: 'docker-compose'; project: string }; // the `postgres` service container of a compose project (local)

export interface BackupConfig {
  pgTools: PgToolsMode;
  containerPort: number; // the port Postgres listens on inside its container (docker modes only)
  backupDir: string; // absolute
}

const CONTAINER_OR_PROJECT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function parsePgTools(env: Env, nodeEnv: NodeEnv): PgToolsMode {
  const value = required(env, 'RAI_PG_TOOLS');
  if (value === 'path') return { kind: 'path' };
  const separator = value.indexOf(':');
  const kind = separator < 0 ? value : value.slice(0, separator);
  const name = separator < 0 ? '' : value.slice(separator + 1);
  if (!CONTAINER_OR_PROJECT.test(name)) throw new ConfigError('invalid:RAI_PG_TOOLS');
  if (kind === 'docker') return { kind: 'docker', container: name };
  if (kind === 'docker-compose') {
    // A compose project is a development arrangement; a production host uses PATH or a named container.
    if (nodeEnv === 'production') throw new ConfigError('invalid:RAI_PG_TOOLS');
    return { kind: 'docker-compose', project: name };
  }
  throw new ConfigError('invalid:RAI_PG_TOOLS');
}

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * W7 plan section 2: the keys only `backup`, `restore` and `restore:verify` read; the server never does
 * (`parseConfig` ignores them). BACKUP_DIR resolves against the working directory and is refused inside the Git
 * worktree anywhere but under rai-web/.local/ (gitignored), so a dump cannot be committed.
 */
export function parseBackupConfig(env: Env, where: { cwd?: string; repoRoot?: string } = {}): BackupConfig {
  const nodeEnv = parseNodeEnv(env);
  const pgTools = parsePgTools(env, nodeEnv);
  const containerPort =
    optional(env, 'RAI_PG_CONTAINER_PORT') === undefined
      ? 5432
      : integer(env, 'RAI_PG_CONTAINER_PORT', { min: 1, max: 65535 });
  const repoRoot = path.resolve(where.repoRoot ?? REPO_ROOT);
  const backupDir = path.resolve(where.cwd ?? process.cwd(), required(env, 'BACKUP_DIR'));
  const inRepo = backupDir === repoRoot || isInside(repoRoot, backupDir);
  if (inRepo && !isInside(path.join(repoRoot, 'rai-web', '.local'), backupDir))
    throw new ConfigError('invalid:BACKUP_DIR');
  return { pgTools, containerPort, backupDir };
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
    qc: { mode: parseQcMode(env, nodeEnv, mode) },
    log: { level: oneOf(env, 'LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const), pretty: logPretty },
    buildCommit: required(env, 'BUILD_COMMIT'),
  };
}
