// Test-owned entry only. No production import or connection before the IPC/config/filesystem guards.
import assert from 'node:assert/strict';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardLaunch, validCommand, type LaunchConfig, type Query } from './server-contract.js';
import { serverEnv } from './server-env.js';
import { scenario } from './qc-scenario.js';
import { settlement } from './settlement.js';
import { readManifest } from '@rai/fixtures/manifest';
async function main() {
  assert(
    process.send &&
      process.env.NODE_ENV === 'test' &&
      process.env.RAI_IDENTITY_MODE === 'fixture' &&
      process.env.HOST === '127.0.0.1',
    'performance IPC test/fixture/loopback required',
  );
  const file = process.argv[2];
  assert(file);
  const stat = await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const config = JSON.parse(await readFile(file, 'utf8')) as LaunchConfig;
  guardLaunch(config);
  const target = config[config.target],
    root = await realpath(config.resourceRoot);
  assert.equal(root, path.resolve(config.resourceRoot));
  assert.equal(path.dirname(root), await realpath(tmpdir()));
  assert(path.basename(root).startsWith(`rai-perf-${config.target}-`));
  for (const name of ['blobs', 'mail']) {
    const dir = path.join(root, name);
    const s = await lstat(dir);
    assert(s.isDirectory() && !s.isSymbolicLink());
    assert.equal(await realpath(dir), dir);
  }
  const serverRoot = await realpath(config.serverRoot);
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: serverRoot, encoding: 'utf8' }).trim(),
    target.finalHead,
  );
  assert.equal(
    execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
      cwd: serverRoot,
      encoding: 'utf8',
    }).trim(),
    '',
    'final build checkout must be clean',
  );
  const fixture = JSON.parse(
    await readFile(path.join(serverRoot, 'fixtures/src/data/manifest.json'), 'utf8'),
  ) as { sha256: string };
  assert.equal(fixture.sha256, config.fixtureSha256);
  assert.equal(readManifest().sha256, config.fixtureSha256);
  const { default: pg } = await import('pg');
  const connections: InstanceType<typeof pg.Client>[] = [];
  let server: { close(): Promise<void> } | undefined;
  try {
    let operator: InstanceType<typeof pg.Client> | undefined;
    for (const role of ['app', 'owner', 'operator'] as const) {
      const client = new pg.Client({
        connectionString: target.urls[role],
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
        options: '-c default_transaction_read_only=on',
      });
      connections.push(client);
      await client.connect();
      const proof = await client.query('SELECT current_database() AS database,current_user AS role');
      assert.deepEqual(proof.rows, [{ database: target.target.database, role: `rai_${role}` }]);
      if (role === 'operator') operator = client;
      else await client.end();
    }
    assert(operator);
    const query: Query = async (text, values) =>
      (await operator.query(text, values)).rows as Record<string, unknown>[];
    const control = scenario(config, query),
      settle = settlement(query, control.ids);
    const env = serverEnv(config, root);
    const built = (await import(pathToFileURL(path.join(serverRoot, 'server/dist/start.js')).href)) as {
      startServer(
        env: Record<string, string>,
        overrides: { qcRunner: typeof control.runner },
      ): Promise<{ close(): Promise<void> }>;
    };
    server = await built.startServer(env, { qcRunner: control.runner });
    const health = await fetch(new URL('/readyz', target.baseUrl), { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200);
    const report = (await health.json()) as {
      identity: { mode: string };
      build: { commit: string };
      qc: { status: string };
      mailSink: { kind: string };
    };
    assert.equal(report.identity.mode, 'fixture');
    assert.equal(report.build.commit, target.finalHead);
    assert.equal(report.qc.status, 'ok');
    assert.equal(report.mailSink.kind, 'file');
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 15_000);
      deadline.unref();
      void server!.close().then(
        async () => {
          control.close();
          await operator.end();
          process.exit(0);
        },
        () => process.exit(1),
      );
    };
    process.on('SIGTERM', stop);
    process.on('disconnect', stop);
    let busy = false;
    const send = (message: object) => {
      if (process.connected) process.send?.(message, () => {});
    };
    process.on('message', (message: unknown) => {
      if (!validCommand(message) || stopping) return;
      if (busy) {
        send({ id: message.id, ok: false, error: 'performance_control_busy' });
        return;
      }
      busy = true;
      void (async () => {
        if (stopping) return;
        try {
          if (message.op === 'enroll') await control.enroll(message.key, message.caseId);
          else if (message.op === 'submit') await settle.submit(message.proof);
          else {
            assert.equal(
              control.ids().length,
              config.target === 'queue' ? 995 : config.mutationCases.length,
              'enrollment incomplete',
            );
            await settle.settled();
          }
          send({ id: message.id, ok: true });
        } catch {
          send({ id: message.id, ok: false, error: 'performance_control_failed' });
        } finally {
          busy = false;
        }
      })();
    });
    process.send({
      ready: true,
      head: target.finalHead,
      database: target.target.database,
      scenario: config.scenario,
      fixtureSha256: config.fixtureSha256,
    });
  } catch {
    if (server) await server.close().catch(() => {});
    await Promise.allSettled(connections.map((c) => c.end()));
    process.stderr.write('performance_startup_failed\n');
    process.exit(1);
  }
}
void main().catch(() => {
  process.stderr.write('performance_guard_failed\n');
  process.exit(1);
});
