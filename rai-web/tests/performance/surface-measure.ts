import assert from 'node:assert/strict';
import { checkControls, type Controls } from './server-contract.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildPdf } from '@rai/fixtures/generate/pdf';
import { FIXTURE_THAI_LINE } from '@rai/fixtures/data/documents/index';
import {
  baseline,
  binary,
  BYTES,
  cacheClass,
  digest,
  guardPlan,
  json,
  measured,
  READS,
  routePath,
  Transport,
  type Plan,
} from './profiles.js';

export interface SurfacePlan extends Plan {
  reads: {
    name: string;
    kind: keyof typeof READS;
    actor: string;
    ids: Record<string, string>;
    expected: Record<string, unknown>;
  }[];
  mutationActor: string;
  /** 45 distinct real API-prepared drafts, reserved for this invocation. No replay measurements. */
  submissions: { caseId: string; versionId: string; revision: number }[];
  uploadCaseId: string;
}
/** Same valid PDF comment-padding technique as w1-03 boundary tests; no DB helper import. */
export function exactPdf(seed: string): Uint8Array {
  const base = buildPdf({
    asciiLines: ['RAI-DESK-SYNTHETIC-FIXTURE performance'],
    thaiLine: FIXTURE_THAI_LINE,
    title: seed,
  });
  const xrefAt = base.indexOf('\nxref\n') + 1;
  const start = base.lastIndexOf('startxref\n') + 'startxref\n'.length;
  const old = /^\d+/.exec(base.subarray(start).toString('ascii'))![0];
  let length = BYTES - base.length,
    next = String(xrefAt + length);
  for (let i = 0; i < 3; i++) {
    length = BYTES - base.length + old.length - next.length;
    next = String(xrefAt + length);
  }
  assert(length >= 3);
  const filler = Buffer.alloc(length, 45);
  for (let i = 0; i < length; i += 64) {
    filler[i] = 37;
    if (i) filler[i - 1] = 10;
  }
  filler[length - 1] = 10;
  const result = Buffer.concat([
    base.subarray(0, xrefAt),
    filler,
    base.subarray(xrefAt, start),
    Buffer.from(next),
    base.subarray(start + old.length),
  ]);
  assert.equal(result.length, BYTES);
  return result;
}
export async function measureSurfaces(plan: SurfacePlan, controls: { queue: Controls; mutation: Controls }) {
  guardPlan(plan);
  checkControls(plan.queue, controls.queue);
  checkControls(plan.mutation, controls.mutation);
  await controls.queue.settled();
  await controls.mutation.settled();
  assert(plan.reads.length && new Set(plan.reads.map((s) => s.name)).size === plan.reads.length);
  assert.equal(plan.submissions.length, 45);
  assert.equal(new Set(plan.submissions.map((s) => s.caseId)).size, 45);
  assert.equal(new Set(plan.submissions.map((s) => s.versionId)).size, 45);
  // Only mutation origin receives POSTs other than login. Queue data remains unchanged.
  for (const selection of plan.reads) {
    assert(Object.hasOwn(READS, selection.kind));
    assert(Object.keys(selection.expected).length, 'explicit stable response assertions required');
    const route = READS[selection.kind],
      path = routePath(route, selection.ids);
    const api = new Transport(plan.queue.baseUrl);
    await api.signIn(selection.actor);
    await baseline(
      plan,
      `json-${selection.name}`,
      false,
      'queue',
      route,
      200,
      300,
      () => async () =>
        measured(await api.request(path), 200, (r) => {
          const value = json(r);
          for (const [key, expected] of Object.entries(selection.expected))
            assert.deepEqual(value[key], expected);
        }),
    );
  }
  const mutation = new Transport(plan.mutation.baseUrl);
  await mutation.signIn(plan.mutationActor);
  await baseline(
    plan,
    'submit',
    true,
    'mutation',
    '/api/cases/:caseId/draft/submit',
    201,
    1000,
    async (index) => {
      const draft = plan.submissions[index + 5]!;
      assert(Number.isInteger(draft.revision) && draft.revision >= 0);
      const path = routePath('/api/cases/:caseId/draft/submit', { caseId: draft.caseId });
      const preflight = await mutation.request(path.slice(0, -'/submit'.length));
      assert.equal(preflight.status, 200);
      const current = json(preflight);
      assert.equal(current.draftId, draft.versionId);
      assert.equal(current.draftRevision, draft.revision);
      const body = JSON.stringify({
        expectedVersion: { versionId: draft.versionId, revision: draft.revision },
      });
      return async () =>
        measured(await mutation.request(path, 'POST', body, 'application/json'), 201, (r) => {
          const version = json(r);
          assert.equal(version.versionId, draft.versionId);
          assert.equal(version.caseId, draft.caseId);
          assert(version.submittedAt);
        });
    },
    (sample, index) =>
      controls.mutation.submit({
        caseId: plan.submissions[index + 5]!.caseId,
        versionId: plan.submissions[index + 5]!.versionId,
        correlationId: sample.correlationId!,
      }),
  );
  const artifacts: { id: string; hash: string }[] = [];
  const runId = randomUUID();
  const uploadPath = routePath('/api/cases/:caseId/artifacts', { caseId: plan.uploadCaseId });
  await baseline(plan, 'upload', true, 'mutation', '/api/cases/:caseId/artifacts', 201, 10_000, (index) => {
    const bytes = exactPdf(`${runId}-${index}`),
      hash = digest(bytes);
    const body = new FormData();
    body.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      'synthetic-performance.pdf',
    );
    return async () =>
      measured(await mutation.request(uploadPath, 'POST', body), 201, (r) => {
        const ref = json(r);
        assert.equal(ref.sha256, hash);
        assert.equal(ref.sizeBytes, BYTES);
        assert.equal(typeof ref.artifactId, 'string');
        artifacts.push({ id: ref.artifactId as string, hash });
      });
  });
  assert.equal(artifacts.length, 45);
  assert.equal(new Set(artifacts.map((a) => a.hash)).size, 45);
  await baseline(plan, 'download', true, 'mutation', '/api/artifacts/:artifactId', 200, 5000, (index) => {
    const artifact = artifacts[index + 5]!;
    const path = routePath('/api/artifacts/:artifactId', { artifactId: artifact.id });
    return async () => measured(await mutation.request(path), 200, (r) => binary(r, artifact.hash));
  });
  const health = new Transport(plan.queue.baseUrl);
  async function prime() {
    const r = await health.request('/readyz');
    assert.equal(r.status, 200);
    const value = json(r);
    assert.equal(value.status, 'ready');
    assert.equal(typeof value.checkedAt, 'string');
    return value.checkedAt as string;
  }
  for (const cached of [true, false]) {
    await baseline(
      plan,
      cached ? 'ready-cached' : 'ready-uncached',
      !cached,
      'queue',
      '/readyz',
      200,
      cached ? 100 : 2500,
      async () => {
        const previous = await prime();
        if (!cached) await delay(5100); // real 5s cache expiry, excluded from sample; no reset endpoint
        return async () =>
          measured(await health.request('/readyz'), 200, (r) => {
            const value = json(r);
            assert.equal(value.status, 'ready');
            cacheClass(previous, String(value.checkedAt), cached);
          });
      },
    );
  }
}
