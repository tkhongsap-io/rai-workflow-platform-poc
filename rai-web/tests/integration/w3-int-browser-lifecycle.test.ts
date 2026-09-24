// The old shared reset helper now runs only after the real owned child has stopped.
import { test } from 'node:test';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { readEnv } from '@rai/server/config';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { PackDraft } from '@rai/shared/schemas/pack';
import { createRealServerLifecycle, realServerOptions } from '../browser/support/real-server-lifecycle.js';
import { resetToFixtureSet } from '../browser/support/database.js';
import buildReal from '../browser/support/build-real.js';
import { startJourneyServer } from '../browser/support/journey-server.js';
import {
  attachCapture,
  RAI_WEB_ROOT,
  freeLoopbackPort,
  startTestServer,
  type TestServerProcess,
} from '../support/process.js';
import { assertNoLeak } from '../support/log-capture.js';
import { operatorUrlForTests } from '../support/db.js';

const safe = { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture' };
const origin = 'http://127.0.0.1:58819';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function controlChild(stop: TestServerProcess['stop']): TestServerProcess {
  return {
    baseUrl: origin,
    port: 58819,
    pid: 1,
    lines: [],
    waitForEvent: () => Promise.reject(new Error('unused')),
    linesFor: () => [],
    stop,
  };
}

test('lifecycle rejects unsafe configuration before start/reset effects', () => {
  let effects = 0;
  const deps = {
    start: () => {
      effects++;
      return Promise.resolve(controlChild(() => Promise.resolve({ code: 0, signal: null })));
    },
    reset: () => {
      effects++;
      return Promise.resolve();
    },
  };
  for (const [url, env] of [
    [origin, { ...safe, NODE_ENV: 'production' }],
    [origin, { ...safe, RAI_IDENTITY_MODE: 'google' }],
    ['http://0.0.0.0:58819', safe],
    ['http://127.0.0.1:58819/?override=1', safe],
    [origin, { ...safe, DATABASE_URL: 'postgres://synthetic:synthetic@db.example/rai' }],
  ] as const)
    assert.throws(() => createRealServerLifecycle(url, env, deps));
  assert.equal(effects, 0);
});

test('reset/load/start waits for stop; overlapping operations are refused', async () => {
  const gate = deferred();
  const stopping = deferred();
  const events: string[] = [];
  const lifecycle = createRealServerLifecycle(origin, safe, {
    reset: () => {
      events.push('reset/load');
      return Promise.resolve();
    },
    start: () => {
      events.push('start');
      return Promise.resolve(
        controlChild(async () => {
          events.push('stop.begin');
          stopping.resolve();
          await gate.promise;
          events.push('stop.end');
          return { code: 0, signal: null };
        }),
      );
    },
  });
  await lifecycle.reset();
  const resetting = lifecycle.reset();
  await stopping.promise;
  await assert.rejects(lifecycle.reset(), /already active/);
  assert.deepEqual(events, ['reset/load', 'start', 'stop.begin']);
  gate.resolve();
  await resetting;
  assert.deepEqual(events, ['reset/load', 'start', 'stop.begin', 'stop.end', 'reset/load', 'start']);
  await lifecycle.stop();
});

test('failed stop forbids reset/start; failed load forbids startup', async () => {
  let resets = 0;
  const lifecycle = createRealServerLifecycle(origin, safe, {
    reset: () => {
      resets++;
      return Promise.resolve();
    },
    start: () => Promise.resolve(controlChild(() => Promise.resolve({ code: 1, signal: null }))),
  });
  await lifecycle.reset();
  await assert.rejects(lifecycle.reset(), /exit cleanly/);
  assert.equal(resets, 1);
  await assert.rejects(lifecycle.reset(), /failed; refusing/);
  let starts = 0;
  const failedLoad = createRealServerLifecycle(origin, safe, {
    reset: () => Promise.reject(new Error('load failed')),
    start: () => {
      starts++;
      return Promise.resolve(controlChild(() => Promise.resolve({ code: 0, signal: null })));
    },
  });
  await assert.rejects(
    failedLoad.withTest('managed', () => Promise.resolve()),
    /load failed/,
  );
  assert.equal(starts, 0);
});

test('failed bodies still stop/audit; reset-only mode starts no competing child', async () => {
  let stopped = 0;
  let starts = 0;
  const lifecycle = createRealServerLifecycle(origin, safe, {
    reset: () => Promise.resolve(),
    start: () => {
      starts++;
      return Promise.resolve(
        controlChild(() => {
          stopped++;
          return Promise.resolve({ code: 0, signal: null });
        }),
      );
    },
  });
  await assert.rejects(
    lifecycle.withTest('managed', () => Promise.reject(new Error('body failure'))),
    /body failure/,
  );
  assert.equal(stopped, 1);
  await lifecycle.withTest('reset-only', () => Promise.resolve());
  assert.equal(starts, 1);
});

test('shared reset ownership is mechanically limited to the lifecycle and its real proof', () => {
  const browser = path.join(RAI_WEB_ROOT, 'tests/browser');
  const testsRoot = path.join(RAI_WEB_ROOT, 'tests');
  const allowed = new Set([
    'browser/support/database.ts',
    'browser/support/real-server-lifecycle.ts',
    'integration/w3-int-browser-lifecycle.test.ts',
  ]);
  function checkResetOwners(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'dist') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) checkResetOwners(file);
      else if (entry.name.endsWith('.ts') && readFileSync(file, 'utf8').includes('resetToFixtureSet'))
        assert(allowed.has(path.relative(testsRoot, file)), `${file}: shared reset is lifecycle-owned`);
    }
  }
  checkResetOwners(testsRoot);

  const managed = [
    'w1-12-harness',
    'w1-int-06-case-pack-versions',
    'w1-int-07-shell-sign-in-cases',
    'w2-int-07-reviewer-workspace',
    'w2-int-09-disposition',
    'w2-int-journey',
    'w3-int-02-queue',
    'w1-int-evidence-config',
    'w1-int-journey',
  ];
  for (const name of readdirSync(browser).filter((name) => name.endsWith('.spec.ts'))) {
    const source = readFileSync(path.join(browser, name), 'utf8');
    assert(!source.includes('resetToFixtureSet'), `${name}: reset must be fixture-owned`);
    if (managed.includes(name.replace('.spec.ts', '')))
      assert.match(source, /from ['"]\.\/support\/real-test\.js['"]/);
  }
  assert.match(
    readFileSync(path.join(browser, 'w1-int-evidence-config.spec.ts'), 'utf8'),
    /serverMode: 'reset-only'/,
  );
  assert.match(
    readFileSync(path.join(browser, 'w1-int-journey.spec.ts'), 'utf8'),
    /serverMode: 'reset-only'/,
  );
});

test(
  'actual busy built child drains before original shared reset/load and restarts with a new PID',
  { timeout: 60000 },
  async () => {
    await buildReal(); // A clean integration checkout has no prebuilt server or fixture output.
    const env = readEnv();
    const port = await freeLoopbackPort();
    const baseURL = `http://127.0.0.1:${port}`;
    const options = realServerOptions(baseURL, env);
    const blocker = new pg.Client({ connectionString: env.DATABASE_MIGRATE_URL });
    const observer = new pg.Client({ connectionString: operatorUrlForTests(env) });
    const stopped = deferred();
    const events: string[] = [];
    const children: TestServerProcess[] = [];
    const lifecycle = createRealServerLifecycle(baseURL, env, {
      reset: async () => {
        events.push('reset/load');
        return resetToFixtureSet();
      },
      start: async () => {
        const child = await startTestServer(options);
        children.push(child);
        events.push('start');
        return {
          ...child,
          stop: async () => {
            events.push('stop.begin');
            stopped.resolve();
            const exit = await child.stop();
            events.push('stop.end');
            return exit;
          },
        };
      },
    });
    let posting: Promise<Response> | undefined;
    let resetting: Promise<void> | undefined;
    try {
      await blocker.connect();
      await observer.connect();
      await lifecycle.reset();
      const caseId = findFixtureCase('fx-case-nonvendor')!.caseId;
      const login = await fetch(`${baseURL}/auth/fixture/sign-in`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixtureUserId: 'fx-user-owner-cm' }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers
        .getSetCookie()
        .map((line) => line.split(';')[0])
        .join('; ');
      const draft = (await (
        await fetch(`${baseURL}/api/cases/${caseId}/draft`, { headers: { cookie } })
      ).json()) as PackDraft;
      // Relation/row lock only: no SQL business writes or fake outcomes.
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "case" WHERE id=$1 FOR UPDATE', [caseId]);
      const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      posting = fetch(`${baseURL}/api/cases/${caseId}/draft/submit`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'idempotency-key': 'lifecycle-busy-submit' },
        body: JSON.stringify({
          expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
        }),
      });
      // Poll actual lock state with a bounded deadline; no ordering sleep or retry of the reset.
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await observer.query<{ waiting: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting',
          [blockerPid],
        );
        if (result.rows[0]?.waiting) {
          blocked = true;
          break;
        }
      }
      assert.equal(blocked, true, 'actual submitted request is waiting in PostgreSQL');
      resetting = lifecycle.reset();
      await stopped.promise;
      assert.deepEqual(events, ['reset/load', 'start', 'stop.begin']);
      await blocker.query('COMMIT');
      const response = await posting;
      assert.equal(response.status, 201);
      await resetting;
      assert.deepEqual(events, ['reset/load', 'start', 'stop.begin', 'stop.end', 'reset/load', 'start']);
      assert.notEqual(children[0]?.pid, children[1]?.pid);
      const fresh = await fetch(`${baseURL}/api/cases/${caseId}/draft`, { headers: { cookie } });
      assert.equal(fresh.status, 401, 'original reset removed the old session');
      const restored = await observer.query<{ submitted_at: Date | null }>(
        'SELECT submitted_at FROM pack_version WHERE id=$1',
        [draft.draftId],
      );
      assert.equal(restored.rows[0]?.submitted_at, null, 'original fixture draft restored after real submit');
      for (const child of children) assertNoLeak({ text: () => JSON.stringify(child.lines) });
    } finally {
      // Ending the connection releases any row lock it holds; an open client would keep the test process alive.
      await blocker.end();
      await posting?.catch(() => undefined);
      await resetting?.catch(() => undefined);
      await lifecycle.stop();
      await observer.end();
    }
  },
);

for (const stream of ['stdout', 'stderr'] as const) {
  test(`capture audits split UTF-8 ${stream} tail after exit through close`, async () => {
    const child = new ChildProcess();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    const capture = attachCapture(child);
    const bytes = Buffer.from('เอกสารประกอบ_ผู้ให้บริการ_2569.pdf');
    const source = stream === 'stdout' ? stdout : stderr;
    source.write(bytes.subarray(0, 1));
    Object.defineProperty(child, 'exitCode', { value: 0 });
    child.emit('exit', 0, null);
    let settled = false;
    const stopping = capture.stop(1000).then((exit) => {
      settled = true;
      return exit;
    });
    await Promise.resolve();
    assert.equal(settled, false, 'PID exit alone cannot certify complete capture');
    source.write(bytes.subarray(1));
    child.emit('close', 0, null);
    assert.deepEqual(await stopping, { code: 0, signal: null });
    assert.equal(capture.lines[0]?.raw, bytes.toString('utf8'));
    assert.throws(() => assertNoLeak({ text: () => JSON.stringify(capture.lines) }), /forbidden log canary/);
  });
}

test('missing stdio close fails within the bound without raw captured diagnostics', async () => {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  child.stdout = stdout;
  child.stderr = new PassThrough();
  const capture = attachCapture(child);
  stdout.write('RAI-DESK-SYNTHETIC-FIXTURE');
  Object.defineProperty(child, 'exitCode', { value: 0 });
  child.emit('exit', 0, null);
  await assert.rejects(capture.stop(5), (error: Error) => {
    assert.match(error.message, /did not close within 5 ms/);
    assert(!error.message.includes('RAI-DESK'));
    return true;
  });
  child.emit('close', 0, null);
});

test('journey startup failure reports a line count, never the raw captured output', async () => {
  // The refused sink path lands in the child's stderr stack trace.
  const sink = path.join(tmpdir(), 'RAI-DESK-SYNTHETIC-FIXTURE', 'mail');
  await assert.rejects(startJourneyServer({ MAIL_SINK_DIR: sink }), (error: Error) => {
    assert.match(error.message, /^Journey process exited; captured line count \d+$/);
    return true;
  });
});
