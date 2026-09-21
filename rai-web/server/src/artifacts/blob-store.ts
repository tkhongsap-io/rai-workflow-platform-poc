// W0-04 "Artifact store": the BlobStore interface and its filesystem implementation. The store knows nothing about
// cases, slots, roles or media types. Layout under BLOB_DIR (W0-04 "Layout and write path", W0-08 section 6):
// `sha256/<h[0:2]>/<h[2:4]>/<h>` with no extension, temp files under `tmp/<uuid>`, root and directories 0700,
// files 0600; write = stream to tmp while hashing and counting → fsync → atomic rename → fsync the directory; an
// existing key is deduplicated after a size check (a size mismatch is BlobIntegrity, never a silent dedupe). No
// delete or overwrite method exists (D08 owns deletion). `tmp/` is emptied at process start (W0-08 section 6).
//
// The W0-08 pipeline needs the full bytes for the structural check before the blob may commit, so `put` is split
// into `stage` (temp file, hash, size cap) and `commit` (rename under the hash); `put` composes the two for callers
// that inspect nothing (the fixture loader). `discard` removes a staged file after a rejection. Nothing under the
// root is ever served statically; only the W1-03b download route reads it, after authorization.

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';

export type ContentHash = string & { readonly brand?: 'sha256-hex' };
export type TempRef = { readonly path: string; readonly hash: ContentHash; readonly sizeBytes: number };

export type StageResult =
  { ok: true; temp: TempRef; hash: ContentHash; sizeBytes: number } | { ok: false; reason: 'too_large' };

export type CommitResult = { hash: ContentHash; sizeBytes: number; deduplicated: boolean };

export type PutResult =
  | { ok: true; hash: ContentHash; sizeBytes: number; deduplicated: boolean }
  | { ok: false; reason: 'too_large' };

export type VerifyResult =
  { ok: true } | { ok: false; reason: 'missing' | 'hash_mismatch' | 'size_mismatch' };

export interface BlobStore {
  /** Streams bytes to a private temp location, hashes while writing, then commits under the hash (W0-04). */
  put(input: Readable, opts: { maxBytes: number }): Promise<PutResult>;
  /** Streams bytes to a private temp location and hashes them; the caller inspects, then commits or discards. */
  stage(input: Readable, opts: { maxBytes: number }): Promise<StageResult>;
  /** Reads a staged file back for inspection (at most the per-file limit, so it fits in memory). */
  readStaged(temp: TempRef): Promise<Buffer>;
  /** Atomic rename under the hash, or dedupe when the key exists with the same size. */
  commit(temp: TempRef): Promise<CommitResult>;
  /** Opens a read stream for the bytes. Callers have already passed authorization. */
  open(hash: ContentHash): Promise<Readable>;
  exists(hash: ContentHash): Promise<boolean>;
  /** Re-hashes the stored bytes and compares. Used by store:verify and W7-00. */
  verify(hash: ContentHash, expectedSize?: number): Promise<VerifyResult>;
  /** Removes an uncommitted temp file after a failed upload. Idempotent. */
  discard(temp: TempRef): Promise<void>;
}

export class BlobIntegrityError extends Error {
  constructor(
    readonly hash: string,
    readonly reason: 'size_mismatch' | 'hash_mismatch',
  ) {
    super(`blob integrity: ${reason}`); // never the path; the hash is a reference, not content
    this.name = 'BlobIntegrityError';
  }
}

export class BlobMissingError extends Error {
  constructor(readonly hash: string) {
    super('blob missing');
    this.name = 'BlobMissingError';
  }
}

const HASH_HEX = /^[0-9a-f]{64}$/;

export function keyPathFor(blobDir: string, hash: string): string {
  if (!HASH_HEX.test(hash)) throw new Error('not a sha256 hex key');
  return path.join(blobDir, 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);
}

async function fsyncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } catch {
    // some filesystems refuse fsync on a directory handle; the rename itself is still atomic
  } finally {
    await handle.close();
  }
}

class TooLarge extends Error {
  constructor() {
    super('too_large');
    this.name = 'TooLarge';
  }
}

/** The input stream closed or was destroyed before it ended: the client went away or the parser gave up. */
export class StagingAborted extends Error {
  constructor() {
    super('staging aborted');
    this.name = 'StagingAborted';
  }
}

export interface FilesystemBlobStore extends BlobStore {
  readonly root: string;
  readonly tmpDir: string;
  /** Creates the root (0700) and empties `tmp/`; called once at process start and by tests. */
  init(): Promise<void>;
  /** Removes temp files older than `maxAgeMs`; returns how many (store:cleanup). */
  cleanupTemp(maxAgeMs: number, now?: Date): Promise<number>;
  /** Every committed object key under sha256/ (db:cleanup --report compares it with the artifact rows). */
  listObjects(): Promise<ContentHash[]>;
}

export function createFilesystemBlobStore(blobDir: string): FilesystemBlobStore {
  const root = path.resolve(blobDir);
  const tmpDir = path.join(root, 'tmp');

  async function ensureDirs(): Promise<void> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  }

  async function stage(input: Readable, opts: { maxBytes: number }): Promise<StageResult> {
    await ensureDirs();
    const tempPath = path.join(tmpDir, randomUUID());
    const hasher = createHash('sha256');
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > opts.maxBytes) {
          callback(new TooLarge());
          return;
        }
        hasher.update(chunk);
        callback(null, chunk);
      },
    });
    if (input.destroyed) throw new StagingAborted();
    try {
      await pipeline(input, counter, createWriteStream(tempPath, { mode: 0o600, flags: 'wx' }));
    } catch (err) {
      await unlink(tempPath).catch(() => undefined);
      if (err instanceof TooLarge) return { ok: false, reason: 'too_large' };
      if ((err as { code?: unknown }).code === 'ERR_STREAM_PREMATURE_CLOSE') throw new StagingAborted();
      throw err;
    }
    const handle = await open(tempPath, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const hash = hasher.digest('hex') as ContentHash;
    return { ok: true, temp: { path: tempPath, hash, sizeBytes: size }, hash, sizeBytes: size };
  }

  async function commit(temp: TempRef): Promise<CommitResult> {
    const target = keyPathFor(root, temp.hash);
    try {
      const existing = await stat(target).catch(() => undefined);
      if (existing !== undefined) {
        if (existing.size !== temp.sizeBytes) throw new BlobIntegrityError(temp.hash, 'size_mismatch');
        await unlink(temp.path).catch(() => undefined);
        return { hash: temp.hash, sizeBytes: temp.sizeBytes, deduplicated: true };
      }
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await rename(temp.path, target);
      await fsyncDirectory(path.dirname(target));
      return { hash: temp.hash, sizeBytes: temp.sizeBytes, deduplicated: false };
    } catch (err) {
      await unlink(temp.path).catch(() => undefined);
      throw err;
    }
  }

  return {
    root,
    tmpDir,
    async init() {
      await ensureDirs();
      await this.cleanupTemp(0);
    },
    async cleanupTemp(maxAgeMs, now = new Date()) {
      await ensureDirs();
      let removed = 0;
      for (const name of await readdir(tmpDir)) {
        const file = path.join(tmpDir, name);
        const info = await stat(file).catch(() => undefined);
        if (info === undefined || !info.isFile()) continue;
        if (maxAgeMs <= 0 || now.getTime() - info.mtimeMs >= maxAgeMs) {
          await rm(file, { force: true });
          removed += 1;
        }
      }
      return removed;
    },
    async listObjects() {
      const out: ContentHash[] = [];
      const shardRoot = path.join(root, 'sha256');
      for (const a of await readdir(shardRoot).catch(() => [] as string[])) {
        for (const b of await readdir(path.join(shardRoot, a)).catch(() => [] as string[])) {
          for (const name of await readdir(path.join(shardRoot, a, b)).catch(() => [] as string[])) {
            if (HASH_HEX.test(name)) out.push(name);
          }
        }
      }
      return out.sort();
    },
    stage,
    commit,
    async put(input, opts) {
      const staged = await stage(input, opts);
      if (!staged.ok) return staged;
      const committed = await commit(staged.temp);
      return { ok: true, ...committed };
    },
    readStaged(temp) {
      return readFile(temp.path);
    },
    async open(hash) {
      const file = keyPathFor(root, hash);
      const info = await stat(file).catch(() => undefined);
      if (info === undefined || !info.isFile()) throw new BlobMissingError(hash);
      return createReadStream(file);
    },
    async exists(hash) {
      const info = await stat(keyPathFor(root, hash)).catch(() => undefined);
      return info !== undefined && info.isFile();
    },
    async verify(hash, expectedSize) {
      const file = keyPathFor(root, hash);
      const info = await stat(file).catch(() => undefined);
      if (info === undefined || !info.isFile()) return { ok: false, reason: 'missing' };
      if (expectedSize !== undefined && info.size !== expectedSize)
        return { ok: false, reason: 'size_mismatch' };
      const hasher = createHash('sha256');
      for await (const chunk of createReadStream(file)) hasher.update(chunk as Buffer);
      return hasher.digest('hex') === hash ? { ok: true } : { ok: false, reason: 'hash_mismatch' };
    },
    async discard(temp) {
      await unlink(temp.path).catch(() => undefined);
    },
  };
}
