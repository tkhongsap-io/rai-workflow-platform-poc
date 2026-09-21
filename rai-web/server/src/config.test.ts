import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, isLoopbackHost, parseConfig, parseDatabaseConfig, type Env } from './config.js';

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

test('an unknown or missing identity mode refuses to start (S1) without distinguishing the two', () => {
  assert.equal(reasonOf(withEnv({ RAI_IDENTITY_MODE: 'nonsense' })), 'mode_unknown');
  assert.equal(reasonOf(withEnv({ RAI_IDENTITY_MODE: undefined })), 'mode_unknown');
});

test('a misconfiguration is a start-up failure with a code naming the variable, never a default', () => {
  assert.equal(reasonOf(withEnv({ NODE_ENV: 'staging' })), 'invalid:NODE_ENV');
  assert.equal(reasonOf(withEnv({ PORT: '5173x' })), 'invalid:PORT');
  assert.equal(reasonOf(withEnv({ DATABASE_URL: 'mysql://x' })), 'invalid:DATABASE_URL');
  assert.equal(reasonOf(withEnv({ BLOB_DIR: undefined })), 'missing:BLOB_DIR');
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
