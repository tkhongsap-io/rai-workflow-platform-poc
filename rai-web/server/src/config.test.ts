import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ConfigError,
  isLoopbackHost,
  parseBackupConfig,
  parseConfig,
  parseDatabaseConfig,
  REPO_ROOT,
  type Env,
} from './config.js';

const base: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '8787',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  TRUST_PROXY: 'false',
  DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:54320/rai',
  DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:54320/rai',
  DATABASE_OPERATOR_URL: '',
  BLOB_DIR: './.local/blobs',
  UPLOAD_MAX_FILE_BYTES: '26214400',
  UPLOAD_MAX_PACK_BYTES: '157286400',
  UPLOAD_MAX_IMAGE_PIXELS: '40000000',
  IDEMPOTENCY_TTL_HOURS: '72',
  BLOB_ORPHAN_MIN_AGE_HOURS: '24',
  BLOB_TMP_MAX_AGE_HOURS: '1',
  RAI_IDENTITY_MODE: 'fixture',
  RAI_SESSION_ABSOLUTE_HOURS: '12',
  MAIL_MODE: 'sink-memory',
  MAIL_SINK_DIR: './.local/mail',
  QC_MODE: 'substitute',
  LOG_LEVEL: 'info',
  LOG_PRETTY: 'false',
  BUILD_COMMIT: 'dev',
};

const withEnv = (overrides: Record<string, string | undefined>): Env => ({ ...base, ...overrides });

function reasonOf(env: Env): string {
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.reason;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

test('a complete test environment parses into the typed config', () => {
  const config = parseConfig(base);
  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 8787);
  assert.equal(config.identity.mode, 'fixture');
  assert.deepEqual(config.identity.env, { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12' });
  assert.equal(
    config.database.operatorUrl,
    config.database.migrateUrl,
    'empty operator URL falls back to the migrate URL',
  );
  assert.equal(config.upload.maxFileBytes, 26214400);
  assert.equal(config.mail.mode, 'sink-memory');
  assert.equal(config.log.pretty, false);
});

test('fixture identity is refused outside NODE_ENV=test and off loopback (W0-03 S13, S14): absent from production config', () => {
  assert.equal(reasonOf(withEnv({ NODE_ENV: 'production', LOG_PRETTY: 'false' })), 'fixture_outside_test');
  assert.equal(reasonOf(withEnv({ NODE_ENV: 'development' })), 'fixture_outside_test');
  assert.equal(reasonOf(withEnv({ HOST: '0.0.0.0' })), 'bind_not_loopback');
  assert.equal(reasonOf(withEnv({ PUBLIC_BASE_URL: 'http://desk.example.test' })), 'bind_not_loopback');
});

test('local-google refuses a non-loopback bind host before listen (W0-03 S2, W0-02 section 5 HOST row)', () => {
  const localGoogle = { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'local-google' };
  assert.equal(parseConfig(withEnv(localGoogle)).identity.mode, 'local-google');
  assert.equal(parseConfig(withEnv({ ...localGoogle, HOST: 'localhost' })).host, 'localhost');
  for (const HOST of ['0.0.0.0', '::', '172.26.0.2']) {
    assert.equal(reasonOf(withEnv({ ...localGoogle, HOST })), 'bind_not_loopback', HOST);
  }
});

test('an unknown or missing identity mode refuses to start (S1) without distinguishing the two', () => {
  assert.equal(reasonOf(withEnv({ RAI_IDENTITY_MODE: 'nonsense' })), 'mode_unknown');
  assert.equal(reasonOf(withEnv({ RAI_IDENTITY_MODE: undefined })), 'mode_unknown');
});

test('a misconfiguration is a start-up failure with a code naming the variable, never a default', () => {
  assert.equal(reasonOf(withEnv({ NODE_ENV: 'staging' })), 'invalid:NODE_ENV');
  assert.equal(reasonOf(withEnv({ PORT: '5173x' })), 'invalid:PORT');
  assert.equal(reasonOf(withEnv({ DATABASE_URL: 'mysql://x' })), 'invalid:DATABASE_URL');
  assert.equal(reasonOf(withEnv({ BLOB_DIR: undefined })), 'missing:BLOB_DIR');
  assert.equal(reasonOf(withEnv({ IDEMPOTENCY_TTL_HOURS: '' })), 'missing:IDEMPOTENCY_TTL_HOURS');
  assert.equal(
    reasonOf(withEnv({ MAIL_MODE: 'smtp' })),
    'invalid:MAIL_MODE',
    'no transport value exists until W7',
  );
  assert.equal(reasonOf(withEnv({ QC_MODE: 'real' })), 'invalid:QC_MODE');
  assert.equal(reasonOf(withEnv({ TRUST_PROXY: 'yes' })), 'invalid:TRUST_PROXY');
  const err = (() => {
    try {
      parseConfig(withEnv({ PORT: 'abc' }));
    } catch (e) {
      return e as ConfigError;
    }
    return undefined;
  })();
  assert.equal(err?.exitCode, 78);
  assert.equal(err?.message.includes('abc'), false, 'the message never carries a value');
});

test('LOG_PRETTY is refused in production (W0-10 section 3.1)', () => {
  assert.equal(
    reasonOf(withEnv({ NODE_ENV: 'production', RAI_IDENTITY_MODE: 'production', LOG_PRETTY: 'true' })),
    'log_pretty_in_production',
  );
});

test('an upload limit above the W0-08 section 3 default is refused at start in fixture and local-google modes (W1-03)', () => {
  assert.equal(reasonOf(withEnv({ UPLOAD_MAX_FILE_BYTES: '26214401' })), 'invalid:UPLOAD_MAX_FILE_BYTES');
  assert.equal(reasonOf(withEnv({ UPLOAD_MAX_PACK_BYTES: '157286401' })), 'invalid:UPLOAD_MAX_PACK_BYTES');
  assert.equal(reasonOf(withEnv({ UPLOAD_MAX_IMAGE_PIXELS: '40000001' })), 'invalid:UPLOAD_MAX_IMAGE_PIXELS');
  assert.equal(
    reasonOf(
      withEnv({
        NODE_ENV: 'development',
        RAI_IDENTITY_MODE: 'local-google',
        RAI_IDENTITY_GOOGLE_CLIENT_ID: 'x',
        RAI_IDENTITY_GOOGLE_CLIENT_SECRET: 'y',
        UPLOAD_MAX_FILE_BYTES: '26214401',
      }),
    ),
    'invalid:UPLOAD_MAX_FILE_BYTES',
  );
  // a smaller value is a valid local narrowing
  assert.equal(parseConfig(withEnv({ UPLOAD_MAX_FILE_BYTES: '1024' })).upload.maxFileBytes, 1024);
});

test('W3-F7 (ruling item 7): BLOB_TMP_MAX_AGE_HOURS below 1 refuses to start; 1 is the floor', () => {
  assert.equal(reasonOf(withEnv({ BLOB_TMP_MAX_AGE_HOURS: '0' })), 'invalid:BLOB_TMP_MAX_AGE_HOURS');
  assert.equal(parseConfig(withEnv({ BLOB_TMP_MAX_AGE_HOURS: '1' })).blobTmpMaxAgeHours, 1);
});

test('parseDatabaseConfig needs only the three database variables', () => {
  const db = parseDatabaseConfig({
    DATABASE_URL: base.DATABASE_URL,
    DATABASE_MIGRATE_URL: base.DATABASE_MIGRATE_URL,
  });
  assert.equal(db.operatorUrl, base.DATABASE_MIGRATE_URL);
  assert.throws(
    () => parseDatabaseConfig({ DATABASE_URL: base.DATABASE_URL }),
    (e: unknown) => e instanceof ConfigError && e.reason === 'missing:DATABASE_MIGRATE_URL',
  );
});

test('isLoopbackHost accepts only 127.0.0.1, ::1 and localhost', () => {
  for (const h of ['127.0.0.1', '::1', '[::1]', 'localhost', 'LOCALHOST']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '::', '10.0.0.5', 'desk.example.test', '127.0.0.1.example'])
    assert.equal(isLoopbackHost(h), false, h);
});

// W4a plan section 2 (W4-13): `deterministic` binds the W4a runner in every environment; `substitute` is a local
// value only, refused under NODE_ENV=production or a non-local identity mode. Unset and unknown refuse everywhere.
const qcModeEnvs: Record<string, Record<string, string>> = {
  'fixture/test': { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture' },
  'local-google/development': { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'local-google' },
  'local-google/test': { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'local-google' },
  'local-google/production': { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'local-google' },
  'network/development': { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'network', HOST: '0.0.0.0' },
  'network/production': { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'network', HOST: '0.0.0.0' },
  'production/production': { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'production', HOST: '0.0.0.0' },
};
const substituteAllowed = new Set(['fixture/test', 'local-google/development', 'local-google/test']);

test('QC_MODE=deterministic parses in every NODE_ENV and identity mode (W4a plan section 2)', () => {
  for (const [name, env] of Object.entries(qcModeEnvs))
    assert.equal(parseConfig(withEnv({ ...env, QC_MODE: 'deterministic' })).qc.mode, 'deterministic', name);
});

test('QC_MODE=substitute is refused under NODE_ENV=production or a non-local identity mode (W4a plan section 2)', () => {
  for (const [name, env] of Object.entries(qcModeEnvs)) {
    const e = withEnv({ ...env, QC_MODE: 'substitute' });
    if (substituteAllowed.has(name)) assert.equal(parseConfig(e).qc.mode, 'substitute', name);
    else assert.equal(reasonOf(e), 'invalid:QC_MODE', name);
  }
});

test('QC_MODE unset is missing and any other value is invalid, in every identity mode; no fallback', () => {
  for (const [name, env] of Object.entries(qcModeEnvs)) {
    assert.equal(reasonOf(withEnv({ ...env, QC_MODE: undefined })), 'missing:QC_MODE', name);
    assert.equal(reasonOf(withEnv({ ...env, QC_MODE: ' ' })), 'missing:QC_MODE', name);
    for (const value of ['real', 'model', 'none', 'disabled', 'Deterministic', 'substitute-scripted'])
      assert.equal(reasonOf(withEnv({ ...env, QC_MODE: value })), 'invalid:QC_MODE', `${name} ${value}`);
  }
});

// W7-01 (W7 plan section 2): the backup keys are read by the operator commands only, through parseBackupConfig.
const backupEnv = (overrides: Record<string, string | undefined>): Env => ({
  NODE_ENV: 'development',
  RAI_PG_TOOLS: 'docker-compose:rai-dev',
  BACKUP_DIR: '/var/backups/rai',
  ...overrides,
});
const rootFor = { cwd: '/work/repo/rai-web', repoRoot: '/work/repo' };

function backupReason(env: Env, where = rootFor): string {
  try {
    parseBackupConfig(env, where);
  } catch (err) {
    if (err instanceof ConfigError) return err.reason;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

test('W7-01 parseBackupConfig: RAI_PG_TOOLS takes path, docker:<container> and docker-compose:<project>', () => {
  assert.deepEqual(parseBackupConfig(backupEnv({ RAI_PG_TOOLS: 'path' }), rootFor).pgTools, { kind: 'path' });
  assert.deepEqual(parseBackupConfig(backupEnv({ RAI_PG_TOOLS: 'docker:abc123_pg-1' }), rootFor).pgTools, {
    kind: 'docker',
    container: 'abc123_pg-1',
  });
  assert.deepEqual(parseBackupConfig(backupEnv({}), rootFor).pgTools, {
    kind: 'docker-compose',
    project: 'rai-dev',
  });
  for (const value of [undefined, '', '   '])
    assert.equal(backupReason(backupEnv({ RAI_PG_TOOLS: value })), 'missing:RAI_PG_TOOLS');
  for (const value of [
    'docker',
    'docker:',
    'docker-compose:',
    'PATH',
    'host',
    'docker:a b',
    'docker:-x',
    'docker:$(id)',
    'podman:pg',
    'docker-compose:a;b',
  ])
    assert.equal(backupReason(backupEnv({ RAI_PG_TOOLS: value })), 'invalid:RAI_PG_TOOLS', value);
});

test('W7-01 parseBackupConfig: docker-compose:* is refused under NODE_ENV=production; path and docker:* are not', () => {
  assert.equal(backupReason(backupEnv({ NODE_ENV: 'production' })), 'invalid:RAI_PG_TOOLS');
  assert.equal(
    parseBackupConfig(backupEnv({ NODE_ENV: 'production', RAI_PG_TOOLS: 'path' }), rootFor).pgTools.kind,
    'path',
  );
  assert.equal(
    parseBackupConfig(backupEnv({ NODE_ENV: 'production', RAI_PG_TOOLS: 'docker:pg' }), rootFor).pgTools.kind,
    'docker',
  );
});

test('W7-01 parseBackupConfig: RAI_PG_CONTAINER_PORT defaults to 5432 and must be a port', () => {
  assert.equal(parseBackupConfig(backupEnv({}), rootFor).containerPort, 5432);
  assert.equal(parseBackupConfig(backupEnv({ RAI_PG_CONTAINER_PORT: '' }), rootFor).containerPort, 5432);
  assert.equal(parseBackupConfig(backupEnv({ RAI_PG_CONTAINER_PORT: '6543' }), rootFor).containerPort, 6543);
  for (const value of ['0', '65536', 'x', '-1', '54.3'])
    assert.equal(
      backupReason(backupEnv({ RAI_PG_CONTAINER_PORT: value })),
      'invalid:RAI_PG_CONTAINER_PORT',
      value,
    );
});

test('W7-01 parseBackupConfig: BACKUP_DIR is required and refused inside the Git worktree outside rai-web/.local/', () => {
  for (const value of [undefined, '', ' '])
    assert.equal(backupReason(backupEnv({ BACKUP_DIR: value })), 'missing:BACKUP_DIR');
  // Relative values resolve against the working directory (rai-web/ for every npm command).
  assert.equal(
    parseBackupConfig(backupEnv({ BACKUP_DIR: './.local/backups' }), rootFor).backupDir,
    '/work/repo/rai-web/.local/backups',
  );
  assert.equal(
    parseBackupConfig(backupEnv({ BACKUP_DIR: '/work/repo/rai-web/.local/x/y' }), rootFor).backupDir,
    '/work/repo/rai-web/.local/x/y',
  );
  assert.equal(
    parseBackupConfig(backupEnv({ BACKUP_DIR: '/var/backups/rai' }), rootFor).backupDir,
    '/var/backups/rai',
  );
  assert.equal(
    parseBackupConfig(backupEnv({ BACKUP_DIR: '/work/repo-backups' }), rootFor).backupDir,
    '/work/repo-backups',
  );
  for (const value of [
    './backups',
    '.',
    './.local',
    '../docs',
    '/work/repo',
    '/work/repo/changes/x',
    '/work/repo/rai-web/.localx',
    '/work/repo/rai-web/.local/../server',
    '/work/repo/.local/backups',
  ])
    assert.equal(backupReason(backupEnv({ BACKUP_DIR: value })), 'invalid:BACKUP_DIR', value);
});

test('W7-01 parseBackupConfig defaults to this checkout: REPO_ROOT holds rai-web/, and ./.local/backups from rai-web/ is accepted', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'rai-web', 'package.json')));
  assert.ok(existsSync(path.join(REPO_ROOT, 'docker-compose.yml')));
  const cwd = path.join(REPO_ROOT, 'rai-web');
  assert.equal(
    parseBackupConfig(backupEnv({ BACKUP_DIR: './.local/backups' }), { cwd }).backupDir,
    path.join(cwd, '.local', 'backups'),
  );
  assert.equal(
    backupReason(backupEnv({ BACKUP_DIR: './server' }), { cwd, repoRoot: REPO_ROOT }),
    'invalid:BACKUP_DIR',
  );
});

test('W7-01 parseConfig (the server) ignores the backup keys: no refusal from them and no field carrying them', () => {
  const config = parseConfig(
    withEnv({ RAI_PG_TOOLS: 'nonsense', BACKUP_DIR: '/work/repo/changes', RAI_PG_CONTAINER_PORT: 'x' }),
  );
  assert.ok(!JSON.stringify(config).includes('nonsense'));
  assert.ok(!('backup' in config));
});
