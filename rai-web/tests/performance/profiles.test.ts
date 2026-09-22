import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { baseline, cacheClass, guardPlan, routePath, summarize, type Plan } from './profiles.js';
import { durations, type RunConfig } from './core.js';
const config = (name: string, port: number): RunConfig => ({
  baseUrl: `http://127.0.0.1:${port}`,
  target: { host: '127.0.0.1', port: 54370, database: `rai_perf_${name}` },
  urls: Object.fromEntries(
    ['app', 'owner', 'operator'].map((role) => [
      role,
      `postgresql://rai_${role}:synthetic@127.0.0.1:54370/rai_perf_${name}`,
    ]),
  ) as RunConfig['urls'],
  finalHead: 'a'.repeat(40),
  authorization: 'parent-authorized-final-head',
});
const plan: Plan = {
  queue: config('queue', 8901),
  mutation: config('mutation', 8902),
  evidence: {
    startupVerified: true,
    responseFinishVerified: true,
    qcScenarioApproved: 'synthetic unit only',
    machine: 'unit',
  },
  outputPrefix: 'unused',
  readLog: () => Promise.resolve(''),
};
test('paired preflight refuses shared DB/origin, foreign container and missing final-runtime proof', () => {
  guardPlan(plan);
  assert.throws(() => guardPlan({ ...plan, mutation: plan.queue }));
  assert.throws(() => guardPlan({ ...plan, mutation: { ...plan.mutation, baseUrl: plan.queue.baseUrl } }));
  assert.throws(() =>
    guardPlan({ ...plan, mutation: { ...plan.mutation, target: { ...plan.mutation.target, port: 54369 } } }),
  );
  assert.throws(() =>
    guardPlan({ ...plan, evidence: { ...plan.evidence, responseFinishVerified: false as never } }),
  );
  assert.throws(() => routePath('/api/cases/:caseId', { caseId: '../other' }));
});
test('cache classes reject mistaken hit/miss classification; failures cannot produce p95', () => {
  const a = '2026-09-23T00:00:00Z',
    b = '2026-09-23T00:00:06Z';
  cacheClass(a, a, true);
  cacheClass(a, b, false);
  assert.throws(() => cacheClass(a, b, true));
  assert.throws(() => cacheClass(a, a, false));
  assert.throws(() => cacheClass(a, 'invalid', false));
  assert.throws(() => summarize([{ wallMs: 2, error: 'HTTP 500' }], 1));
});
test('generalized joins require exact route/status and unique duration', () => {
  const line = JSON.stringify({
    event: 'request.completed',
    correlationId: 'sample',
    fields: { route: '/readyz', status: 200, durationMs: 4 },
  });
  assert.deepEqual(durations(line, ['sample'], { route: '/readyz', status: 200 }), [4]);
  assert.throws(() => durations(line, ['sample']));
  assert.throws(() => durations(line, ['sample'], { route: '/readyz', status: 503 }));
  assert.throws(() => durations(`${line}\n${line}`, ['sample'], { route: '/readyz', status: 200 }));
});
test('journal retains failures and refuses successful-only summary without network or DB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rai-perf-pure-'));
  try {
    const local = { ...plan, outputPrefix: path.join(dir, 'evidence') };
    await assert.rejects(
      baseline(local, 'failure', true, 'mutation', undefined, 201, 1000, (index) => () => ({
        wallMs: 1,
        ...(index === 2 ? { error: 'synthetic failure' } : {}),
      })),
      /failed samples retained/,
    );
    const rows = (await readFile(`${local.outputPrefix}-failure.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s) as { phase?: string; error?: string; summary?: unknown });
    assert.equal(rows.filter((r) => r.phase === 'sample').length, 40);
    assert.equal(rows.filter((r) => r.error).length, 1);
    assert(!rows.some((r) => r.summary));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post-response settlement failure retains HTTP wall and correlation, never a passing summary', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rai-perf-after-'));
  try {
    const local = { ...plan, outputPrefix: path.join(dir, 'evidence') };
    await assert.rejects(
      baseline(
        local,
        'settle',
        true,
        'mutation',
        undefined,
        201,
        1000,
        () => () => ({ wallMs: 7, correlationId: 'synthetic-correlation' }),
        (_sample, index) =>
          index === 1 ? Promise.reject(new Error('settlement failed')) : Promise.resolve(),
      ),
      /failed samples retained/,
    );
    const rows = (await readFile(`${local.outputPrefix}-settle.jsonl`, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (s) => JSON.parse(s) as { index?: number; wallMs?: number; correlationId?: string; error?: string },
      );
    const failed = rows.find((r) => r.index === 1)!;
    assert.equal(failed.wallMs, 7);
    assert.equal(failed.correlationId, 'synthetic-correlation');
    assert.equal(failed.error, 'settlement failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
