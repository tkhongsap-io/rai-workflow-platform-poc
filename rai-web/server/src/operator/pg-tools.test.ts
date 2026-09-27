// W7-01 (W7 plan sections 2 and 3.1; W7-D5): how the backup commands invoke pg_dump and pg_restore. Every case runs
// through an injected runner, so no process is spawned: the test pins the argv, the child environment and the
// connection target per RAI_PG_TOOLS mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PgToolsError,
  connectionFromUrl,
  parseToolMajor,
  resolvePgTools,
  toolTarget,
  type Invocation,
  type ToolIo,
} from './pg-tools.js';

const SECRET = 'sEcr3t%2Fpw';
const URL_WITH_SECRET = `postgres://rai_owner:${SECRET}@127.0.0.1:55385/rai`;
const conn = connectionFromUrl(URL_WITH_SECRET);

interface Call {
  invocation: Invocation;
  io: ToolIo;
}

function recorder(stdoutFor: (inv: Invocation) => string = () => '') {
  const calls: Call[] = [];
  const run = (invocation: Invocation, io: ToolIo) => {
    calls.push({ invocation, io });
    return Promise.resolve({ stdout: stdoutFor(invocation) });
  };
  return { calls, run };
}

/** No argv element may carry the password (encoded or decoded) or a connection URL. */
function assertArgvClean(inv: Invocation): void {
  for (const arg of [inv.command, ...inv.args]) {
    assert.ok(!arg.includes('sEcr3t'), `argv carries the password: ${arg}`);
    assert.ok(!/postgres(ql)?:\/\//.test(arg), `argv carries a URL: ${arg}`);
  }
}

test('connectionFromUrl decodes user, password and database and keeps host and port', () => {
  assert.deepEqual(conn, {
    host: '127.0.0.1',
    port: 55385,
    user: 'rai_owner',
    password: 'sEcr3t/pw',
    database: 'rai',
  });
  assert.equal(connectionFromUrl('postgres://u@db.internal/x').port, 5432);
  assert.equal(connectionFromUrl('postgres://u@db.internal/x').password, undefined);
  assert.throws(() => connectionFromUrl('postgres://u@h:1/'), PgToolsError);
});

test('path mode: the URL host and port as given; docker modes: host 127.0.0.1 and the container port', () => {
  assert.deepEqual(toolTarget({ kind: 'path' }, conn, 5432), {
    host: '127.0.0.1',
    port: 55385,
    user: 'rai_owner',
    database: 'rai',
  });
  const remote = connectionFromUrl('postgres://rai_owner:x@db.example.internal:6000/desk');
  assert.deepEqual(toolTarget({ kind: 'path' }, remote, 5432), {
    host: 'db.example.internal',
    port: 6000,
    user: 'rai_owner',
    database: 'desk',
  });
  for (const mode of [
    { kind: 'docker', container: 'pg' },
    { kind: 'docker-compose', project: 'rai-ops' },
  ] as const) {
    assert.deepEqual(toolTarget(mode, conn, 5432), {
      host: '127.0.0.1',
      port: 5432,
      user: 'rai_owner',
      database: 'rai',
    });
    assert.equal(toolTarget(mode, remote, 6543).port, 6543);
    assert.equal(toolTarget(mode, remote, 6543).host, '127.0.0.1');
    assert.equal(toolTarget(mode, remote, 6543).database, 'desk');
  }
});

test('path mode runs pg_dump from PATH with the target in flags, the password only as PGPASSWORD, output to the file', async () => {
  const { calls, run } = recorder();
  const tools = resolvePgTools({ pgTools: { kind: 'path' }, containerPort: 5432 }, { run });
  await tools.dump(conn, ['--format=custom'], '/backups/x/db.dump');
  assert.equal(calls.length, 1);
  const [{ invocation, io }] = calls as [Call];
  assert.equal(invocation.command, 'pg_dump');
  assert.deepEqual(invocation.args, [
    '--host',
    '127.0.0.1',
    '--port',
    '55385',
    '--username',
    'rai_owner',
    '--dbname',
    'rai',
    '--no-password',
    '--format=custom',
  ]);
  assert.deepEqual(invocation.env, { PGPASSWORD: 'sEcr3t/pw' });
  assert.deepEqual(io, { stdoutTo: '/backups/x/db.dump' });
  assertArgvClean(invocation);
});

test('docker mode: docker exec -e PGPASSWORD forwards the name only; the tool connects to 127.0.0.1:<container port>', async () => {
  const { calls, run } = recorder();
  const tools = resolvePgTools(
    { pgTools: { kind: 'docker', container: 'ci-pg-1' }, containerPort: 5432 },
    { run },
  );
  await tools.dump(conn, ['--format=custom', '--no-owner'], '/b/db.dump');
  await tools.restore(conn, ['--exit-on-error'], '/b/db.dump');
  const [dump, restore] = calls as [Call, Call];
  assert.equal(dump.invocation.command, 'docker');
  assert.deepEqual(dump.invocation.args, [
    'exec',
    '-e',
    'PGPASSWORD',
    'ci-pg-1',
    'pg_dump',
    '--host',
    '127.0.0.1',
    '--port',
    '5432',
    '--username',
    'rai_owner',
    '--dbname',
    'rai',
    '--no-password',
    '--format=custom',
    '--no-owner',
  ]);
  assert.deepEqual(dump.invocation.env, { PGPASSWORD: 'sEcr3t/pw' });
  assert.deepEqual(dump.io, { stdoutTo: '/b/db.dump' });
  // Restore input streams over stdin (docker exec -i): no container filesystem path is used.
  assert.deepEqual(restore.invocation.args.slice(0, 6), [
    'exec',
    '-i',
    '-e',
    'PGPASSWORD',
    'ci-pg-1',
    'pg_restore',
  ]);
  assert.ok(restore.invocation.args.includes('--exit-on-error'));
  assert.deepEqual(restore.io, { stdinFrom: '/b/db.dump' });
  for (const { invocation } of calls) assertArgvClean(invocation);
});

test('docker-compose mode resolves the project postgres container by label, once, then runs docker exec', async () => {
  const { calls, run } = recorder((inv) => (inv.args[0] === 'ps' ? 'f00dcafe\n' : ''));
  const tools = resolvePgTools(
    { pgTools: { kind: 'docker-compose', project: 'rai-ops' }, containerPort: 5432 },
    { run },
  );
  await tools.dump(conn, [], '/b/1.dump');
  await tools.dump(conn, [], '/b/2.dump');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0]!.invocation, {
    command: 'docker',
    args: [
      'ps',
      '-q',
      '--filter',
      'label=com.docker.compose.project=rai-ops',
      '--filter',
      'label=com.docker.compose.service=postgres',
    ],
    env: {},
  });
  assert.deepEqual(calls[1]!.invocation.args.slice(0, 5), [
    'exec',
    '-e',
    'PGPASSWORD',
    'f00dcafe',
    'pg_dump',
  ]);
  assert.deepEqual(calls[2]!.invocation.args.slice(0, 5), [
    'exec',
    '-e',
    'PGPASSWORD',
    'f00dcafe',
    'pg_dump',
  ]);
  for (const { invocation } of calls) assertArgvClean(invocation);
});

test('docker-compose mode refuses a project with no running postgres container, or more than one', async () => {
  for (const stdout of ['', '\n', 'a\nb\n']) {
    const { run } = recorder(() => stdout);
    const tools = resolvePgTools(
      { pgTools: { kind: 'docker-compose', project: 'rai-ops' }, containerPort: 5432 },
      { run },
    );
    await assert.rejects(
      tools.dump(conn, [], '/b/x.dump'),
      (err: unknown) => err instanceof PgToolsError && err.reason === 'pg_tools_container_not_found',
    );
  }
});

test('a URL without a password sends no PGPASSWORD; restore with no connection only lists (no target flags)', async () => {
  const { calls, run } = recorder();
  const tools = resolvePgTools(
    { pgTools: { kind: 'docker', container: 'pg' }, containerPort: 5432 },
    { run },
  );
  await tools.dump(connectionFromUrl('postgres://rai_owner@127.0.0.1:1/rai'), [], '/b/x.dump');
  assert.deepEqual(calls[0]!.invocation.env, {});
  assert.deepEqual(calls[0]!.invocation.args.slice(0, 3), ['exec', 'pg', 'pg_dump']);
  await tools.restore(null, ['--list'], '/b/x.dump');
  assert.deepEqual(calls[1]!.invocation.args, ['exec', '-i', 'pg', 'pg_restore', '--list']);
});

test('version() reads the major version of pg_dump in the configured place', async () => {
  const { calls, run } = recorder(() => 'pg_dump (PostgreSQL) 16.15\n');
  const docker = resolvePgTools(
    { pgTools: { kind: 'docker', container: 'pg' }, containerPort: 5432 },
    { run },
  );
  assert.equal(await docker.version(), 16);
  assert.deepEqual(calls[0]!.invocation, {
    command: 'docker',
    args: ['exec', 'pg', 'pg_dump', '--version'],
    env: {},
  });
  const onPath = resolvePgTools({ pgTools: { kind: 'path' }, containerPort: 5432 }, { run });
  assert.equal(await onPath.version(), 16);
  assert.deepEqual(calls[1]!.invocation, { command: 'pg_dump', args: ['--version'], env: {} });
});

test('parseToolMajor reads 9.6-style and 10+ versions and refuses anything else', () => {
  assert.equal(parseToolMajor('pg_dump (PostgreSQL) 16.15'), 16);
  assert.equal(parseToolMajor('pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)'), 17);
  assert.equal(parseToolMajor('pg_dump (PostgreSQL) 18beta1'), 18);
  assert.equal(parseToolMajor('pg_dump (PostgreSQL) 9.6.24'), 9);
  assert.throws(() => parseToolMajor('command not found'), PgToolsError);
});
