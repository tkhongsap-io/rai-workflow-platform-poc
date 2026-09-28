// W7-16 (W7 plan section 9 row W7-16, section 12): the deployment-readiness note is held to the code. The note's
// configuration table must name exactly the environment keys non-test code under server/src reads, its planned keys
// must not be read yet, every .env.example key must be accounted for, and the production values the note gives must
// pass the server's own start-up parse. Reads files only: no network, no Postgres, no process spawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBackupConfig, parseConfig, REPO_ROOT } from './config.js';
import { parseIdentityConfig } from './identity/config.js';

const NOTE_PATH = path.join(REPO_ROOT, 'docs', 'engineering', 'deployment-readiness.md');
const SERVER_SRC = path.join(REPO_ROOT, 'rai-web', 'server', 'src');
const ENV_EXAMPLE = path.join(REPO_ROOT, 'rai-web', '.env.example');

const readNote = (): string => readFileSync(NOTE_PATH, 'utf8');

/** The lines of the section whose heading contains `title`, up to the next heading of the same or a higher level. */
function section(note: string, title: string): string[] {
  const lines = note.split('\n');
  const start = lines.findIndex((l) => /^#{2,4} /.test(l) && l.includes(title));
  assert.ok(start >= 0, `the note has a heading containing "${title}"`);
  const level = /^(#+)/.exec(lines[start] ?? '')?.[1]?.length ?? 2;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#+) /.exec(l);
    return m !== null && (m[1]?.length ?? 0) <= level;
  });
  return end < 0 ? rest : rest.slice(0, end);
}

interface KeyRow {
  key: string;
  value: string; // the production value cell, trimmed
}

/** Rows of the configuration table: `| \`KEY\` | read by | production value | ... |`. */
function tableRows(note: string): KeyRow[] {
  const rows: KeyRow[] = [];
  for (const line of section(note, 'Keys the code reads')) {
    const m = /^\| `([A-Z][A-Z0-9_]*)` \|[^|]*\|([^|]*)\|/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) rows.push({ key: m[1], value: m[2].trim() });
  }
  return rows;
}

/** Keys listed as backticked names in a bullet list section. */
function listedKeys(note: string, title: string): string[] {
  const keys: string[] = [];
  for (const line of section(note, title)) {
    const m = /^- `([A-Z][A-Z0-9_]*)`/.exec(line);
    if (m?.[1] !== undefined) keys.push(m[1]);
  }
  return keys;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield full;
  }
}

/** Every environment key non-test server code reads: `(env, 'KEY'` (the config.ts helpers) and `env.KEY` / `env['KEY']`. */
function keysReadByCode(): Set<string> {
  const keys = new Set<string>();
  const patterns = [
    /\(env, '([A-Z][A-Z0-9_]*)'/g,
    /\benv\??\.([A-Z][A-Z0-9_]*)\b/g,
    /\benv\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  for (const file of sourceFiles(SERVER_SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const m of text.matchAll(pattern)) if (m[1]) keys.add(m[1]);
  }
  return keys;
}

const sorted = (values: Iterable<string>) => [...values].sort();

test('the scanner finds the keys config.ts, the identity slice and the operator commands read', () => {
  const keys = keysReadByCode();
  for (const key of [
    'NODE_ENV',
    'DATABASE_URL',
    'RAI_IDENTITY_NETWORK_SOURCE',
    'RAI_SECRET_SOURCE',
    'BACKUP_DIR',
  ])
    assert.ok(keys.has(key), `scanner sees ${key}`);
});

test('the configuration table names exactly the keys the code reads', () => {
  const rows = tableRows(readNote());
  const inTable = new Set(rows.map((r) => r.key));
  assert.equal(inTable.size, rows.length, 'each key has one row');
  const read = keysReadByCode();
  const missing = sorted([...read].filter((k) => !inTable.has(k)));
  const stale = sorted([...inTable].filter((k) => !read.has(k)));
  assert.deepEqual(missing, [], 'keys the code reads that the note does not list (add a row)');
  assert.deepEqual(stale, [], 'rows for keys the code no longer reads (remove or move them)');
});

test('planned keys are not read by the code yet', () => {
  const planned = listedKeys(readNote(), 'Planned keys');
  assert.ok(planned.length > 0, 'the note lists the planned keys');
  const read = keysReadByCode();
  const nowRead = planned.filter((k) => read.has(k));
  assert.deepEqual(nowRead, [], 'planned keys the code now reads: move them into the configuration table');
});

test('every .env.example key is in the configuration table or the local-only list', () => {
  const note = readNote();
  const inTable = new Set(tableRows(note).map((r) => r.key));
  const localOnly = listedKeys(note, 'Local-only keys');
  assert.deepEqual(
    localOnly.filter((k) => inTable.has(k)),
    [],
    'a local-only key is not also a host key',
  );
  const known = new Set([...inTable, ...localOnly]);
  const exampleKeys = readFileSync(ENV_EXAMPLE, 'utf8')
    .split('\n')
    .map((l) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
  assert.ok(exampleKeys.length > 20, '.env.example parsed');
  assert.deepEqual(sorted(new Set(exampleKeys.filter((k) => !known.has(k)))), []);
});

/**
 * Synthetic stand-ins for the values a host or custody supplies. Every one is a reserved `.test` name or a temporary
 * path; nothing here is a real endpoint or credential.
 */
function standIns(): Record<string, string> {
  const tmp = path.join(os.tmpdir(), 'rai-w7-16-standin');
  return {
    PORT: '8080',
    PUBLIC_BASE_URL: 'https://rai-desk.example.test',
    DATABASE_URL: 'postgres://rai_app:synthetic@db.example.test:5432/rai',
    DATABASE_MIGRATE_URL: 'postgres://rai_owner:synthetic@db.example.test:5432/rai',
    DATABASE_OPERATOR_URL: 'postgres://rai_operator:synthetic@db.example.test:5432/rai',
    DATABASE_ADMIN_URL: 'postgres://rai_admin:synthetic@db.example.test:5432/postgres',
    BLOB_DIR: path.join(tmp, 'blobs'),
    MAIL_SINK_DIR: path.join(tmp, 'mail'),
    BACKUP_DIR: path.join(tmp, 'backups'),
    BUILD_COMMIT: '0123456789abcdef0123456789abcdef01234567',
    RAI_IDENTITY_OIDC_ISSUER_URL: 'https://idp.rai-desk.test',
    RAI_IDENTITY_OIDC_CLIENT_ID: 'synthetic-client-id',
    RAI_IDENTITY_OIDC_CLIENT_SECRET: 'synthetic-client-secret',
    RAI_IDENTITY_ALLOW_LIST_JSON: JSON.stringify({
      version: 1,
      entries: [
        { email: 'admin@rai-desk.example', roles: [{ role: 'admin', scope: { kind: 'all_cases' } }] },
      ],
    }),
  };
}

const NON_LITERAL = new Set(['host', 'custody', 'release', 'unset']);

/** The production environment the note describes: literals as written, host/custody/release from the stand-ins. */
function productionEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const stand = standIns();
  const problems: string[] = [];
  for (const { key, value } of tableRows(readNote())) {
    const literal = /^`([^`]*)`$/.exec(value)?.[1];
    if (literal !== undefined) env[key] = literal;
    else if (!NON_LITERAL.has(value))
      problems.push(`${key}: production value "${value}" is not a literal or a source word`);
    else if (value === 'unset') continue;
    else if (stand[key] === undefined) problems.push(`${key}: no synthetic stand-in for a ${value} value`);
    else env[key] = stand[key];
  }
  assert.deepEqual(problems, []);
  return env;
}

test('the production values in the note pass the server start-up parse (network, allow-list, off loopback)', () => {
  const env = productionEnv();
  const config = parseConfig(env);
  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.trustProxy, true);
  assert.equal(config.publicBaseUrl.protocol, 'https:');
  assert.equal(config.identity.mode, 'network');
  assert.equal(config.mail.mode, 'sink-file');
  assert.equal(config.qc.mode, 'deterministic');
  assert.equal(config.log.pretty, false);
  const identity = parseIdentityConfig(
    config.identity.env,
    {
      host: config.host,
      port: config.port,
      publicBaseUrl: config.publicBaseUrl,
      trustProxy: config.trustProxy,
    },
    config.nodeEnv,
  );
  assert.ok(identity.ok, `identity parse refused: ${identity.ok ? '' : identity.reason}`);
  assert.equal(identity.config.mode, 'network');
  assert.ok(identity.config.mode === 'network' && identity.config.source === 'allow-list');
  const backup = parseBackupConfig(env, { cwd: os.tmpdir() });
  assert.deepEqual(backup.pgTools, { kind: 'path' });
  assert.equal(env.RAI_SECRET_SOURCE, 'env');
  for (const key of [
    'RAI_IDENTITY_GOOGLE_CLIENT_ID',
    'RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
    'RAI_IDENTITY_LOCAL_ROLE_MAP',
  ])
    assert.equal(env[key], undefined, `${key} is unset on a network host`);
});

test('the note says nothing is deployed and leaves host, backup target, custody and incidents to D10', () => {
  const note = readNote();
  assert.match(note, /Nothing is deployed/);
  for (const topic of ['host', 'backup target', 'custody', 'incident'])
    assert.match(note, new RegExp(`D10[^\\n]*${topic}|${topic}[^\\n]*D10`, 'i'), `D10 owns ${topic}`);
});

/** The names `RAI_SECRET_SOURCE=file` overlays, parsed from `CUSTODY_NAMES` in identity/adapter.ts (not exported). */
function fileSourceNames(): string[] {
  const text = readFileSync(path.join(SERVER_SRC, 'identity', 'adapter.ts'), 'utf8');
  const block = /const CUSTODY_NAMES = \[([^\]]*)\]/.exec(text)?.[1];
  assert.ok(block !== undefined, 'identity/adapter.ts declares CUSTODY_NAMES');
  return [...block.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] ?? '');
}

test('the note names exactly the keys the file secret source reads, and every other custody key as environment-only', () => {
  const note = readNote();
  const fileKeys = listedKeys(note, 'Keys `RAI_SECRET_SOURCE=file` reads');
  const names = fileSourceNames();
  assert.ok(names.length > 0, 'CUSTODY_NAMES parsed');
  assert.deepEqual(sorted(fileKeys), sorted(names), 'the file-source list matches CUSTODY_NAMES');
  const custody = tableRows(note)
    .filter((r) => r.value === 'custody')
    .map((r) => r.key);
  const envOnly = listedKeys(note, 'Custody keys read only from the environment');
  assert.deepEqual(
    sorted(envOnly),
    sorted(custody.filter((k) => !names.includes(k))),
    'custody keys the file source does not overlay are listed as environment-only',
  );
  for (const key of ['DATABASE_URL', 'DATABASE_MIGRATE_URL', 'DATABASE_OPERATOR_URL', 'DATABASE_ADMIN_URL'])
    assert.ok(!fileKeys.includes(key), `${key} is not read from RAI_SECRET_DIR`);
});
