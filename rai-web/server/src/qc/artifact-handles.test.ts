// W4-05a (W4b plan section 4.1, W0-07 3.3): the request's artifact read handles stream the stored bytes from the
// BlobStore while the run is live, and reject (never an empty stream) once revoked, when the blob is missing, or when
// no store is bound. Revocation also ends a stream a handle already opened. Synthetic bytes in a temp directory.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { AuthorizedArtifactRef } from '@rai/shared/qc/types';
import {
  BlobMissingError,
  createFilesystemBlobStore,
  type BlobStore,
  type FilesystemBlobStore,
} from '../artifacts/blob-store.js';
import { ArtifactReadError, authorizedHandles } from './artifact-handles.js';

let root: string;
let store: FilesystemBlobStore;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rai-w4-05a-handles-'));
  store = createFilesystemBlobStore(root);
  await store.init();
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

type Meta = Omit<AuthorizedArtifactRef, 'read'>;

async function stored(bytes: Buffer, slot: Meta['slot'] = 1): Promise<Meta> {
  const put = await store.put(Readable.from([bytes]), { maxBytes: 1 << 20 });
  assert.ok(put.ok);
  return {
    artifactId: `00000000-0000-7000-8000-00000000000${slot}`,
    slot,
    contentHash: put.hash,
    mediaType: 'text/plain',
    filename: `synthetic-${slot}.txt`,
    byteLength: put.sizeBytes,
  };
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function rejectsWith(promise: Promise<unknown>, detail: ArtifactReadError['detail']) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ArtifactReadError, String(error));
    assert.equal(error.detail, detail);
    return true;
  });
}

test('read() streams exactly the stored bytes, once per call, and the metadata is unchanged', async () => {
  const one = Buffer.from('synthetic claim document: accuracy 0.91 on the hold-out set\n');
  const two = Buffer.alloc(200_000, 7); // several stream chunks
  const metas = [await stored(one, 1), await stored(two, 5)];
  const { refs, revoke } = authorizedHandles(store, metas);
  assert.equal(refs.length, 2);
  for (const [i, ref] of refs.entries()) {
    assert.deepEqual({ ...ref, read: undefined }, { ...metas[i], read: undefined });
    assert.equal(typeof ref.read, 'function');
  }
  const first = await drain(await refs[0]!.read());
  assert.deepEqual(first, one);
  const big = await drain(await refs[1]!.read());
  assert.equal(big.length, metas[1]!.byteLength);
  assert.equal(sha256(big), metas[1]!.contentHash);
  // A second read of the same handle opens a fresh stream from the start.
  assert.deepEqual(await drain(await refs[0]!.read()), one);
  revoke();
});

test('after revoke() every read() rejects handle_revoked; revoke() is idempotent', async () => {
  const meta = await stored(Buffer.from('synthetic revoked document\n'));
  const { refs, revoke } = authorizedHandles(store, [meta]);
  revoke();
  revoke();
  await rejectsWith(refs[0]!.read(), 'handle_revoked');
  await rejectsWith(refs[0]!.read(), 'handle_revoked');
});

test('revoke() while the store is still opening rejects and destroys the opened stream', async () => {
  const opened = new PassThrough();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const gated = {
    async open() {
      await gate;
      return opened;
    },
  } as unknown as BlobStore;
  const { refs, revoke } = authorizedHandles(gated, [await stored(Buffer.from('x'))]);
  const pending = refs[0]!.read();
  revoke();
  release();
  await rejectsWith(pending, 'handle_revoked');
  assert.equal(opened.destroyed, true);
});

test('revoke() ends a stream a handle opened before the run ended: it errors, never ends short', async () => {
  const source = new PassThrough();
  const fake = { open: () => Promise.resolve(source) } as unknown as BlobStore;
  const { refs, revoke } = authorizedHandles(fake, [await stored(Buffer.from('y'))]);
  const stream = await refs[0]!.read();
  const reader = stream.getReader();
  source.write(Buffer.from('first part '));
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  revoke();
  assert.equal(source.destroyed, true);
  await assert.rejects(async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
    }
  });
});

test('a missing blob rejects with the store BlobMissingError, which names no path', async () => {
  const meta = { ...(await stored(Buffer.from('z'))), contentHash: 'f'.repeat(64) };
  const { refs, revoke } = authorizedHandles(store, [meta]);
  await assert.rejects(refs[0]!.read(), (error: unknown) => {
    assert.ok(error instanceof BlobMissingError);
    assert.doesNotMatch(error.message, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
  revoke();
});

test('with no store bound read() rejects store_unbound, never an empty stream', async () => {
  const { refs, revoke } = authorizedHandles(undefined, [await stored(Buffer.from('w'))]);
  await rejectsWith(refs[0]!.read(), 'store_unbound');
  revoke();
  await rejectsWith(refs[0]!.read(), 'handle_revoked');
});

test('ArtifactReadError carries only its detail code', () => {
  const error = new ArtifactReadError('handle_revoked');
  assert.equal(error.name, 'ArtifactReadError');
  assert.equal(error.message, 'artifact read: handle_revoked');
});
