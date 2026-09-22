import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { guard, durations, percentile95, type RunConfig } from './core.js';

export const READS = {
  session: '/api/session',
  case: '/api/cases/:caseId',
  draft: '/api/cases/:caseId/draft',
  version: '/api/cases/:caseId/versions/:versionId',
  history: '/api/cases/:caseId/versions',
  operator: '/api/operator/desk-health',
} as const;
export const BYTES = 26_214_400;
export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export interface Plan {
  queue: RunConfig;
  mutation: RunConfig;
  evidence: {
    startupVerified: true;
    responseFinishVerified: true;
    qcScenarioApproved: string;
    machine: string;
  };
  outputPrefix: string;
  readLog(target: 'queue' | 'mutation'): Promise<string>;
}
/** Attestations are supplied by the parent after inspecting the actual final INT launcher. */
export function guardPlan(plan: Plan) {
  for (const config of [plan.queue, plan.mutation]) {
    guard(config);
    assert.equal(config.target.port, 54370, 'only this task future container');
  }
  assert.notEqual(plan.queue.target.database, plan.mutation.target.database);
  assert.notEqual(new URL(plan.queue.baseUrl).origin, new URL(plan.mutation.baseUrl).origin);
  assert.equal(plan.queue.finalHead, plan.mutation.finalHead);
  assert.equal(plan.evidence.startupVerified, true);
  assert.equal(plan.evidence.responseFinishVerified, true);
  assert(plan.evidence.qcScenarioApproved.trim() && plan.evidence.machine.trim());
  assert(plan.outputPrefix);
}
export function routePath(route: string, ids: Record<string, string> = {}) {
  return route.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const id = ids[key];
    assert(id && /^[a-f0-9-]{36}$/.test(id), `missing UUID ${key}`);
    return id;
  });
}
export class Transport {
  private cookie = '';
  constructor(readonly origin: string) {}
  async request(path: string, method = 'GET', body?: BodyInit, contentType?: string) {
    assert(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'));
    const started = performance.now();
    const response = await fetch(new URL(path, this.origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
      headers: {
        cookie: this.cookie,
        'sec-fetch-site': 'same-origin',
        'idempotency-key': randomUUID(),
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      ...(body === undefined ? {} : { body }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const wallMs = performance.now() - started;
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie) this.cookie = cookie;
    return {
      wallMs,
      bytes,
      status: response.status,
      correlationId: response.headers.get('x-correlation-id'),
      contentLength: response.headers.get('content-length'),
    };
  }
  async signIn(actor: string) {
    assert(actor.startsWith('fx-user-'));
    const r = await this.request(
      '/auth/fixture/sign-in',
      'POST',
      JSON.stringify({ fixtureUserId: actor }),
      'application/json',
    );
    assert.equal(r.status, 200);
    assert(this.cookie);
  }
}
export interface Response {
  wallMs: number;
  bytes: Uint8Array;
  status: number;
  correlationId: string | null;
  contentLength: string | null;
}
export const json = (r: Response): Record<string, unknown> => {
  const value: unknown = JSON.parse(new TextDecoder().decode(r.bytes));
  assert(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};
export function binary(r: Response, expectedHash: string) {
  assert.equal(r.bytes.length, BYTES);
  assert.equal(r.contentLength, String(BYTES));
  assert.equal(digest(r.bytes), expectedHash);
}
export function cacheClass(previous: string, current: string, cached: boolean) {
  assert(Number.isFinite(Date.parse(previous)) && Number.isFinite(Date.parse(current)));
  if (cached) assert.equal(current, previous, 'not a cache hit');
  else assert.notEqual(current, previous, 'not an expired-cache probe');
}
export interface Sample {
  wallMs: number;
  correlationId?: string | null;
  error?: string;
  status?: number;
  bytes?: number;
}
export function measured(r: Response, status: number, validate: (r: Response) => void): Sample {
  const sample: Sample = {
    wallMs: r.wallMs,
    correlationId: r.correlationId,
    status: r.status,
    bytes: r.bytes.length,
  };
  try {
    assert.equal(r.status, status);
    validate(r);
  } catch (error) {
    sample.error = error instanceof Error ? error.message : 'invalid response';
  }
  return sample;
}
export function summarize(samples: Sample[], count: number) {
  assert.equal(samples.length, count);
  assert(
    samples.every((s) => !s.error),
    'failed samples retained; no successful-only percentile',
  );
  return {
    count,
    p95Ms: percentile95(samples.map((s) => s.wallMs)),
    maxMs: Math.max(...samples.map((s) => s.wallMs)),
  };
}
/** prepare runs outside timing; all attempts are journalled, including validation/transport failures. */
export async function baseline(
  plan: Plan,
  name: string,
  heavy: boolean,
  target: 'queue' | 'mutation',
  route: string | undefined,
  status: number,
  budgetMs: number,
  prepare: (index: number) => (() => Sample | Promise<Sample>) | Promise<() => Sample | Promise<Sample>>,
  after?: (sample: Sample, index: number) => Promise<void>,
) {
  guardPlan(plan);
  assert(/^[a-z0-9_-]+$/.test(name));
  const file = `${plan.outputPrefix}-${name}.jsonl`,
    warmup = heavy ? 5 : 30,
    count = heavy ? 40 : 200;
  await writeFile(
    file,
    JSON.stringify({
      name,
      head: plan.queue.finalHead,
      target,
      route,
      status,
      warmup,
      count,
      budgetMs,
      evidence: plan.evidence,
      concurrency: 1,
      acceptance: 'not evaluated',
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  const samples: Sample[] = [];
  for (let index = -warmup; index < count; index++) {
    let sample: Sample = { wallMs: 0 };
    let started: number | undefined;
    try {
      const action = await prepare(index);
      started = performance.now();
      sample = await action();
      assert(Number.isFinite(sample.wallMs) && sample.wallMs >= 0);
      if (route) assert(sample.correlationId, 'missing correlation');
      if (!sample.error) await after?.(sample, index);
    } catch (error) {
      sample = {
        ...sample,
        wallMs: sample.wallMs > 0 ? sample.wallMs : started === undefined ? 0 : performance.now() - started,
        error: error instanceof Error ? error.message : 'measurement failed',
      };
    }
    await appendFile(
      file,
      JSON.stringify({ index, phase: index < 0 ? 'warmup' : 'sample', ...sample }) + '\n',
    );
    if (index < 0) assert(!sample.error, 'warmup failed; raw evidence retained');
    else samples.push(sample);
  }
  const summary = summarize(samples, count);
  let server;
  if (route) {
    try {
      server = summarize(
        durations(
          await plan.readLog(target),
          samples.map((s) => s.correlationId!),
          { route, status },
        ).map((wallMs) => ({ wallMs })),
        count,
      );
    } catch (error) {
      await appendFile(file, JSON.stringify({ joinError: String(error) }) + '\n');
      throw error;
    }
  }
  await appendFile(file, JSON.stringify({ summary, server, advisoryTargetMs: budgetMs }) + '\n');
  return summary;
}
