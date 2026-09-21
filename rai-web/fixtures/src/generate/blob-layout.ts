// Writes fixture objects under BLOB_DIR in the W0-04 layout (`sha256/<h[0:2]>/<h[2:4]>/<h>`, directories 0700,
// files 0600, temp file then atomic rename, dedupe by hash with a size check) so the loaded rows point at objects
// exactly where the W1-03a BlobStore expects them. This is the loader's write path only until W1-03a lands; the
// upload route never uses it, and W1-03a's `put` replaces this call in load.ts (W0-08 8.7 "through the same blob
// interface uploads use").

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface BlobWriteResult {
  hash: string;
  sizeBytes: number;
  deduplicated: boolean;
  path: string;
}

export function blobKeyPath(blobDir: string, hash: string): string {
  return path.join(blobDir, 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
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

export async function writeBlob(blobDir: string, bytes: Buffer): Promise<BlobWriteResult> {
  await mkdir(blobDir, { recursive: true, mode: 0o700 });
  const tmpDir = path.join(blobDir, 'tmp');
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  const hash = sha256Hex(bytes);
  const target = blobKeyPath(blobDir, hash);
  const tmp = path.join(tmpDir, randomUUID());
  await writeFile(tmp, bytes, { mode: 0o600, flush: true });
  try {
    const existing = await stat(target).catch(() => undefined);
    if (existing !== undefined) {
      if (existing.size !== bytes.length)
        throw new Error(`blob ${hash} exists with size ${existing.size}, expected ${bytes.length}`);
      await unlink(tmp);
      return { hash, sizeBytes: bytes.length, deduplicated: true, path: target };
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await rename(tmp, target);
    await fsyncDirectory(path.dirname(target));
    return { hash, sizeBytes: bytes.length, deduplicated: false, path: target };
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}
