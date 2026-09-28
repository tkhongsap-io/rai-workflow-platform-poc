// W0-07 section 4.8 "no external mail path": a module-graph walk over rai-web/ finds no node:net, node:tls or
// node:http(s) use in the sinks and no mail SDK anywhere (source or dependency manifests), and the config loader
// refuses every MAIL_MODE value other than sink-memory and sink-file, naming the key. Done-when: "no external mail
// path exists in any configuration".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, parseConfig, type Env } from '@rai/server/config';

const SINK_DIR = path.dirname(fileURLToPath(import.meta.url));
const RAI_WEB = path.resolve(SINK_DIR, '..', '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.local', 'playwright-report', 'test-results']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every import / export-from / require / dynamic-import specifier in a source file. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

/** Transport-capable built-ins the sinks must never touch (W0-07 section 4.6: no SMTP, no HTTP mail API). */
const TRANSPORT_BUILTINS = /^(node:)?(net|tls|http|https|http2|dgram|dns|child_process|worker_threads)$/;
/** Mail SDKs and transports; matched against every specifier and every dependency name under rai-web/. */
const MAIL_SDK =
  /^(nodemailer|emailjs|smtp-|smtp2go|@sendgrid\/|sendgrid|mailgun|mailjet|postmark|resend$|@resend\/|@aws-sdk\/client-ses|@aws-sdk\/client-sesv2|aws-ses|@azure\/communication-email|@mailchimp\/|mandrill|sparkpost|@postal\/|sendmail$|nodemailer-|@google-cloud\/.*mail|googleapis$|mailparser|mailcomposer|smtp-server|smtp-connection)/i;

/** W7-07 (W7 plan section 5.3): the server's in-product file drop is walked by the same rule as the substitutes. */
const FILE_DROP = path.join(RAI_WEB, 'server', 'src', 'notifications', 'file-drop.ts');

test('the sink modules import only node:crypto, node:fs, node:path and @rai/shared; never a transport', () => {
  // W7-07: `-` is allowed in an @rai/shared path so `@rai/shared/mail/file-stem` (the moved mailFileStem) matches.
  const allowed =
    /^(node:crypto|node:fs\/promises|node:fs|node:path|@rai\/shared\/[a-z/-]+|\.\.?\/[a-z./-]+\.js)$/;
  const sinkFiles = readdirSync(SINK_DIR)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'support.ts')
    .map((n) => path.join(SINK_DIR, n));
  assert.ok(sinkFiles.length >= 5, `sink sources found: ${sinkFiles.join(', ')}`);
  sinkFiles.push(FILE_DROP);
  for (const file of sinkFiles) {
    const name = path.relative(RAI_WEB, file);
    const specifiers = specifiersOf(readFileSync(file, 'utf8'));
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, TRANSPORT_BUILTINS, `${name} imports ${specifier}`);
      assert.doesNotMatch(specifier, MAIL_SDK, `${name} imports ${specifier}`);
      assert.match(
        specifier,
        allowed,
        `${name} imports ${specifier}, outside the W0-07 section 2 allow-list`,
      );
    }
  }
});

test('no module under rai-web/ imports a mail SDK or transport, in any workspace', () => {
  let scanned = 0;
  for (const file of walk(RAI_WEB)) {
    if (!SOURCE_EXT.has(path.extname(file))) continue;
    scanned += 1;
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      assert.doesNotMatch(specifier, MAIL_SDK, `${path.relative(RAI_WEB, file)} imports ${specifier}`);
    }
  }
  assert.ok(scanned > 20, `scanned ${scanned} source files`);
});

test('no workspace manifest lists a mail SDK or transport as a dependency', () => {
  const manifests = [
    'package.json',
    'shared/package.json',
    'server/package.json',
    'web/package.json',
    'fixtures/package.json',
    'tests/package.json',
  ];
  for (const manifest of manifests) {
    const parsed = JSON.parse(readFileSync(path.join(RAI_WEB, manifest), 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const deps = parsed[field];
      if (deps === undefined || deps === null || typeof deps !== 'object') continue;
      for (const name of Object.keys(deps))
        assert.doesNotMatch(name, MAIL_SDK, `${manifest} ${field}: ${name}`);
    }
  }
  // the lock file is the complete picture, including transitive packages
  const lock = readFileSync(path.join(RAI_WEB, 'package-lock.json'), 'utf8');
  for (const forbidden of [
    'node_modules/nodemailer',
    'node_modules/@sendgrid/',
    'node_modules/mailgun',
    'node_modules/postmark',
    'node_modules/@aws-sdk/client-ses',
    'node_modules/resend',
    'node_modules/smtp-',
  ]) {
    assert.ok(!lock.includes(`"${forbidden}`), `package-lock.json contains ${forbidden}`);
  }
});

const baseEnv: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '8787',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  TRUST_PROXY: 'false',
  DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:54331/rai',
  DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:54331/rai',
  BLOB_DIR: './.local/blobs',
  UPLOAD_MAX_FILE_BYTES: '26214400',
  UPLOAD_MAX_PACK_BYTES: '157286400',
  UPLOAD_MAX_IMAGE_PIXELS: '40000000',
  IDEMPOTENCY_TTL_HOURS: '72',
  BLOB_ORPHAN_MIN_AGE_HOURS: '24',
  BLOB_TMP_MAX_AGE_HOURS: '1',
  RAI_IDENTITY_MODE: 'fixture',
  MAIL_MODE: 'sink-memory',
  MAIL_SINK_DIR: './.local/mail',
  QC_MODE: 'substitute',
  LOG_LEVEL: 'info',
  LOG_PRETTY: 'false',
  BUILD_COMMIT: 'dev',
};

function configReason(overrides: Record<string, string | undefined>): string {
  const env: Env = { ...baseEnv, ...overrides };
  try {
    parseConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.reason;
    throw err;
  }
  return 'accepted';
}

test('the config loader accepts exactly sink-memory and sink-file for MAIL_MODE', () => {
  assert.equal(configReason({ MAIL_MODE: 'sink-memory' }), 'accepted');
  assert.equal(configReason({ MAIL_MODE: 'sink-file' }), 'accepted');
  assert.equal(parseConfig({ ...baseEnv, MAIL_MODE: 'sink-file' }).mail.sinkDir, './.local/mail');
});

test('the config loader refuses smtp, sink-smtp, memory, file and an unset MAIL_MODE, naming the key', () => {
  for (const value of ['smtp', 'sink-smtp', 'memory', 'file', 'SINK-MEMORY', 'ses', 'http']) {
    assert.equal(configReason({ MAIL_MODE: value }), 'invalid:MAIL_MODE', `MAIL_MODE=${value}`);
  }
  assert.equal(configReason({ MAIL_MODE: undefined }), 'missing:MAIL_MODE');
  assert.equal(configReason({ MAIL_MODE: '' }), 'missing:MAIL_MODE');
  assert.equal(configReason({ MAIL_SINK_DIR: undefined }), 'missing:MAIL_SINK_DIR');
});
