import { Value } from 'typebox/value';
import { QueueQuerySchema } from '@rai/shared/schemas/queue';
import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import type { QueueQuery } from '@rai/shared/schemas/queue';
import {
  Api,
  durations,
  expectedQueue,
  guard,
  percentile95,
  queuePath,
  queueShape,
  validateManifest,
  type Manifest,
  type RunConfig,
} from './core.js';

export interface Selection {
  actor: string;
  query: QueueQuery;
}
/** Parent explicitly invokes on the authorized final built server after seeding/settling. */
export async function measure(
  config: RunConfig,
  manifest: Manifest,
  selections: Selection[],
  output: string,
  readServerLog?: () => Promise<string>,
) {
  guard(config);
  validateManifest(manifest, config.finalHead);
  assert(selections.length > 0);
  for (const s of selections) {
    assert(Value.Check(QueueQuerySchema, s.query));
    expectedQueue(manifest.rows, s.actor, s.query);
  }
  assert.equal(new Set(selections.map((s) => JSON.stringify(s))).size, selections.length);
  await writeFile(
    output,
    `${JSON.stringify({ head: config.finalHead, fixture: manifest.fixture, manifestHash: manifest.sha256, selections, warmup: 30, samples: 200, concurrency: 1, connection: 'Node fetch connection reuse', serverDuration: readServerLog ? 'required' : 'not requested' })}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  const groups: { selection: Selection; samples: { wallMs: number; correlationId: string }[] }[] = [];
  for (const selection of selections) {
    const api = new Api(config.baseUrl);
    await api.signIn(selection.actor);
    const expected = expectedQueue(manifest.rows, selection.actor, selection.query);
    const samples: { wallMs: number; correlationId: string }[] = [];
    let failures = 0;
    for (let index = -30; index < 200; index++) {
      const start = performance.now();
      let response: Awaited<ReturnType<Api['raw']>> | undefined;
      let error: string | undefined;
      try {
        response = await api.raw(queuePath(selection.query));
        assert.equal(response.status, 200);
        const body: unknown = JSON.parse(response.text);
        queueShape(body);
        assert.deepEqual(body, expected, 'queue changed or scope/filter/order mismatch');
        assert(response.correlationId, 'missing correlation id');
        if (index >= 0) samples.push({ wallMs: response.wallMs, correlationId: response.correlationId });
      } catch (e) {
        failures++;
        error = e instanceof Error ? e.message : 'unknown failure';
      }
      await appendFile(
        output,
        `${JSON.stringify({
          selection,
          phase: index < 0 ? 'warmup' : 'sample',
          index,
          status: response?.status ?? null,
          wallMs: response?.wallMs ?? performance.now() - start,
          correlationId: response?.correlationId ?? null,
          bytes: response?.bytes ?? null,
          error,
        })}\n`,
      );
      if (index < 0 && error) throw new Error('warmup failed; raw evidence retained');
    }
    assert.equal(failures, 0, 'sample failures; raw evidence retained, no successful-only percentile');
    groups.push({ selection, samples });
  }
  // A requested join never silently becomes HTTP-only evidence; raw samples remain if this throws.
  const log = readServerLog === undefined ? undefined : await readServerLog();
  const summary = groups.map(({ selection, samples }) => {
    const wall = samples.map((s) => s.wallMs);
    const server =
      log === undefined
        ? undefined
        : durations(
            log,
            samples.map((s) => s.correlationId),
          );
    return {
      selection,
      count: samples.length,
      httpP95Ms: percentile95(wall),
      httpMaxMs: Math.max(...wall),
      ...(server === undefined
        ? { serverDuration: 'not requested' }
        : {
            serverP95Ms: percentile95(server),
            serverMaxMs: Math.max(...server),
            serverSamples: server.map((durationMs, i) => ({
              correlationId: samples[i]!.correlationId,
              durationMs,
            })),
          }),
    };
  });
  await appendFile(
    output,
    `${JSON.stringify({ summary, advisoryTargetMs: 300, acceptance: 'not evaluated' })}\n`,
  );
  return summary;
}
