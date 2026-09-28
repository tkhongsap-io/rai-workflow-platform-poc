// W4-05a (W4b plan section 4.1, W0-07 3.3): the QC request's artifact handles are real and revocable. With the
// BlobStore bound, a runner reads exactly the stored bytes of every artifact during a submit, lane or upload run;
// the handles it keeps reject once the run ends; a runner that ignores the deadline finds them revoked when the
// signal aborts; without a store they reject during the run. Through the composed app (the HTTP lane QC route) the
// handles read real bytes, so compose-app-deps passes the store. Synthetic probe runners and the fixture pack only;
// fixture set slice1-synthetic@1.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { AuthorizedArtifactRef, QcRunRequest, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import type { LaneQcRunResponse } from '@rai/shared/schemas/review';
import { createFilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { ArtifactReadError } from '@rai/server/qc/artifact-handles';
import {
  runAndPersistLaneQc,
  runAndPersistSubmitQc,
  runAndPersistUploadQc,
} from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import {
  app,
  capture,
  caseRevision,
  db,
  diagnostics,
  fixtureBlobDir,
  openFixtureApp,
  rebuildApp,
  signIn,
  submit,
} from '../support/fixture-app.js';
import { asUser } from '../support/sign-in.js';

const OWNER_A = 'fx-user-owner-cm';
const AI_COE = 'fx-user-ai-coe';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const START = Date.parse('2026-09-28T09:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

afterEach(() => {
  assertNoLeak(capture);
});

const blobs = () => createFilesystemBlobStore(fixtureBlobDir());

function completed(): QcRunResult {
  const at = new Date(clock).toISOString();
  return { status: 'completed', findings: [], rulesEvaluated: [], startedAt: at, finishedAt: at };
}

async function bytesOf(ref: AuthorizedArtifactRef): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await ref.read()) as unknown as AsyncIterable<Uint8Array>)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

interface Seen {
  request?: QcRunRequest;
  read: Array<{ slot: number; hashOk: boolean; lengthOk: boolean }>;
  errors: unknown[];
}

/** Reads every artifact of the request during the run and keeps the handles for after it. */
function reader(seen: Seen): QcRunner {
  return {
    identity: { runner: 'content-probe', runnerVersion: '0.0.0' },
    async run(request) {
      seen.request = request;
      for (const ref of request.artifacts) {
        try {
          const bytes = await bytesOf(ref);
          seen.read.push({
            slot: ref.slot,
            hashOk: createHash('sha256').update(bytes).digest('hex') === ref.contentHash,
            lengthOk: bytes.length === ref.byteLength,
          });
        } catch (error) {
          seen.errors.push(error);
        }
      }
      return completed();
    },
  };
}

async function assertRevoked(request: QcRunRequest | undefined) {
  assert.ok(request !== undefined && request.artifacts.length > 0);
  for (const ref of request.artifacts)
    await assert.rejects(
      ref.read(),
      (error: unknown) => error instanceof ArtifactReadError && error.detail === 'handle_revoked',
    );
}

async function submitVendor() {
  const owner = await signIn(OWNER_A);
  const { version, correlationId } = await submit(owner, VENDOR.caseId);
  return {
    versionId: version.versionId,
    input: { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
  };
}

describe('W4-05a real, revocable artifact read handles', () => {
  it('a submit run reads the stored bytes of every attached artifact; the kept handles reject afterwards', async () => {
    const { input } = await submitVendor();
    const seen: Seen = { read: [], errors: [] };
    const outcome = await runAndPersistSubmitQc(
      { db: db.app, runner: reader(seen), blobs: blobs(), now, ...diagnostics },
      input,
    );
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(seen.errors, []);
    assert.deepEqual(
      seen.read.map((r) => r.slot).sort(),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
      'every attached slot of the vendor pack',
    );
    assert.ok(seen.read.every((r) => r.hashOk && r.lengthOk));
    await assertRevoked(seen.request);
  });

  it('a lane run reads real bytes and its handles are revoked once it settles', async () => {
    const { input } = await submitVendor();
    const seen: Seen = { read: [], errors: [] };
    const outcome = await runAndPersistLaneQc(
      { db: db.app, runner: reader(seen), blobs: blobs(), now, ...diagnostics },
      { ...input, lane: 'ai_coe' },
    );
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(seen.errors, []);
    assert.ok(seen.read.length > 0 && seen.read.every((r) => r.hashOk && r.lengthOk));
    await assertRevoked(seen.request);
  });

  it('an upload run reads the uploaded slot bytes and revokes them afterwards', async () => {
    const seen: Seen = { read: [], errors: [] };
    const outcome = await runAndPersistUploadQc(
      { db: db.app, runner: reader(seen), blobs: blobs(), now, ...diagnostics },
      { caseId: VENDOR.caseId, versionId: VENDOR.draftVersionId, slot: 5, correlationId: randomUUID() },
    );
    assert.ok(outcome !== undefined);
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(seen.errors, []);
    assert.deepEqual(
      seen.read.map((r) => ({ ...r })),
      [{ slot: 5, hashOk: true, lengthOk: true }],
    );
    await assertRevoked(seen.request);
  });

  it('without a bound store every read() rejects store_unbound during the run', async () => {
    const { input } = await submitVendor();
    const seen: Seen = { read: [], errors: [] };
    await runAndPersistSubmitQc({ db: db.app, runner: reader(seen), now, ...diagnostics }, input);
    assert.deepEqual(seen.read, []);
    assert.equal(seen.errors.length, 9);
    for (const error of seen.errors)
      assert.ok(error instanceof ArtifactReadError && error.detail === 'store_unbound', String(error));
    await assertRevoked(seen.request);
  });

  it('when the deadline fires the handles are revoked, even for a runner that ignores the signal', async () => {
    const { input } = await submitVendor();
    let afterAbort: unknown;
    let readBefore = false;
    const stubborn: QcRunner = {
      identity: { runner: 'content-probe', runnerVersion: '0.0.0' },
      async run(request, signal) {
        await bytesOf(request.artifacts[0]!);
        readBefore = true;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        // The runner keeps going past the deadline and tries to read again.
        afterAbort = await request.artifacts[0]!.read().then(
          () => 'resolved',
          (error: unknown) => error,
        );
        // A content runner maps the refused read to an outage (W4-06a); here it gives up, recorded as the timeout.
        throw new Error('synthetic: read refused after the deadline');
      },
    };
    const outcome = await runAndPersistSubmitQc(
      { db: db.app, runner: stubborn, blobs: blobs(), timeoutMs: 200, now, ...diagnostics },
      input,
    );
    assert.equal(readBefore, true);
    assert.ok(
      afterAbort instanceof ArtifactReadError && afterAbort.detail === 'handle_revoked',
      String(afterAbort),
    );
    assert.equal(outcome.status, 'unavailable');
    assert.equal(outcome.status === 'unavailable' ? outcome.reason : undefined, 'timeout');
  });

  it('through the composed app the lane QC route hands the runner handles that read real bytes', async () => {
    const seen: Seen = { read: [], errors: [] };
    await rebuildApp({ qcRunner: reader(seen) });
    const { versionId } = await submitVendor();
    const reviewer = await signIn(AI_COE);
    const res = await app.inject({
      method: 'POST',
      url: `/api/cases/${VENDOR.caseId}/versions/${versionId}/lanes/ai_coe/qc-run`,
      headers: { 'content-type': 'application/json', ...asUser(reviewer) },
      payload: { expectedVersion: { versionId, revision: await caseRevision(VENDOR.caseId) } },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json<LaneQcRunResponse>().status, 'completed');
    assert.deepEqual(seen.errors, []);
    assert.ok(seen.read.length > 0 && seen.read.every((r) => r.hashOk && r.lengthOk));
    await assertRevoked(seen.request);
  });
});
