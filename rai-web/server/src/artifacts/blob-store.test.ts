// W0-04 "Artifact store" on a temp directory: content-hash key layout, root 0700 and files 0600, temp-then-rename,
// dedupe with a size check, the per-file cap on the stream, verify, discard, and tmp/ emptied at init.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BlobIntegrityError, BlobMissingError, createFilesystemBlobStore, keyPathFor } from './blob-store.js';

let root: string;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rai-w1-03-store-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const stream = (b: Buffer): Readable => Readable.from([b]);

test('put: bytes land under sha256/<h[0:2]>/<h[2:4]>/<h> with no extension, 0600, inside a 0700 root; the hash is the key', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'blobs'));
  await store.init();
  const bytes = Buffer.from('RAI-DESK-SYNTHETIC-FIXTURE store test');
  const result = await store.put(stream(bytes), { maxBytes: 1024 });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.hash, sha(bytes));
  assert.equal(result.sizeBytes, bytes.length);
  assert.equal(result.deduplicated, false);
  const file = keyPathFor(store.root, result.hash);
  assert.equal(
    file,
    path.join(store.root, 'sha256', result.hash.slice(0, 2), result.hash.slice(2, 4), result.hash),
  );
  assert.deepEqual(await readFile(file), bytes);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(store.root)).mode & 0o777, 0o700);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  assert.equal(await store.exists(result.hash), true);
  assert.deepEqual(await readdir(store.tmpDir), [], 'no temp file left behind');
  const chunks: Buffer[] = [];
  for await (const c of await store.open(result.hash)) chunks.push(c as Buffer);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.deepEqual(await store.verify(result.hash, bytes.length), { ok: true });
});

test('identical bytes share one object (deduplicated: true) and the second temp file is discarded', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'dedupe'));
  const bytes = Buffer.from('same bytes twice');
  const first = await store.put(stream(bytes), { maxBytes: 1024 });
  const second = await store.put(stream(bytes), { maxBytes: 1024 });
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(second.hash, first.hash);
  assert.equal(second.deduplicated, true);
  assert.deepEqual(await readdir(store.tmpDir), []);
  const objects = await readdir(
    path.join(store.root, 'sha256', first.hash.slice(0, 2), first.hash.slice(2, 4)),
  );
  assert.deepEqual(objects, [first.hash]);
});

test('the per-file cap aborts the stream at limit + 1, leaves no temp file and returns too_large', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'cap'));
  const exact = await store.put(Readable.from([Buffer.alloc(512, 1), Buffer.alloc(512, 2)]), {
    maxBytes: 1024,
  });
  assert.ok(exact.ok, 'exactly the limit is accepted');
  const over = await store.put(Readable.from([Buffer.alloc(512, 1), Buffer.alloc(513, 2)]), {
    maxBytes: 1024,
  });
  assert.deepEqual(over, { ok: false, reason: 'too_large' });
  assert.deepEqual(await readdir(store.tmpDir), []);
});

test('stage → readStaged → discard leaves nothing; stage → commit renames; a size mismatch on dedupe is an integrity error', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'stage'));
  const bytes = Buffer.from('staged bytes');
  const staged = await store.stage(stream(bytes), { maxBytes: 1024 });
  assert.ok(staged.ok);
  if (!staged.ok) return;
  assert.deepEqual(await store.readStaged(staged.temp), bytes);
  assert.equal((await readdir(store.tmpDir)).length, 1);
  await store.discard(staged.temp);
  await store.discard(staged.temp); // idempotent
  assert.deepEqual(await readdir(store.tmpDir), []);
  assert.equal(await store.exists(staged.hash), false, 'discarded bytes never commit');

  const again = await store.stage(stream(bytes), { maxBytes: 1024 });
  assert.ok(again.ok);
  if (!again.ok) return;
  const committed = await store.commit(again.temp);
  assert.equal(committed.deduplicated, false);
  assert.equal(await store.exists(again.hash), true);

  // A forged temp ref claiming the same hash with another size must not silently dedupe (W0-04 write path).
  const forged = await store.stage(stream(Buffer.from('other')), { maxBytes: 1024 });
  assert.ok(forged.ok);
  if (!forged.ok) return;
  await assert.rejects(
    store.commit({ path: forged.temp.path, hash: again.hash, sizeBytes: 5 }),
    (err: unknown) => err instanceof BlobIntegrityError && err.reason === 'size_mismatch',
  );
  assert.deepEqual(await readdir(store.tmpDir), [], 'the temp file is removed on failure too');
});

test('verify reports missing, size_mismatch and hash_mismatch; open throws BlobMissingError for an unknown key', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'verify'));
  const bytes = Buffer.from('verify me');
  const put = await store.put(stream(bytes), { maxBytes: 1024 });
  assert.ok(put.ok);
  if (!put.ok) return;
  const missing = sha(Buffer.from('never stored'));
  assert.deepEqual(await store.verify(missing), { ok: false, reason: 'missing' });
  await assert.rejects(store.open(missing), (err: unknown) => err instanceof BlobMissingError);
  assert.deepEqual(await store.verify(put.hash, bytes.length + 1), { ok: false, reason: 'size_mismatch' });
  await writeFile(keyPathFor(store.root, put.hash), Buffer.from('tampered!'), { mode: 0o600 });
  assert.deepEqual(await store.verify(put.hash), { ok: false, reason: 'hash_mismatch' });
  assert.throws(() => keyPathFor(store.root, '../etc/passwd'), /not a sha256 hex key/);
});

test('init empties tmp/ (W0-08 section 6) and cleanupTemp removes only files older than the threshold', async () => {
  const store = createFilesystemBlobStore(path.join(root, 'tmp-clean'));
  await store.init();
  await writeFile(path.join(store.tmpDir, 'stale'), 'x');
  await writeFile(path.join(store.tmpDir, 'fresh'), 'y');
  const future = new Date(Date.now() + 2 * 3_600_000);
  assert.equal(await store.cleanupTemp(3_600_000, new Date()), 0, 'both are younger than an hour now');
  assert.equal(await store.cleanupTemp(3_600_000, future), 2, 'both are older than an hour from the future');
  await writeFile(path.join(store.tmpDir, 'leftover'), 'z');
  await store.init();
  assert.deepEqual(await readdir(store.tmpDir), []);
});
