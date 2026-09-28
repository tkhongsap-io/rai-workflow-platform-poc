// W4-05a (W4b plan section 4.1, W0-07 3.3): the QC request's artifact read handles. `read()` streams the stored bytes
// from the BlobStore (the store the authorized download route reads) while the run is live. The orchestrator revokes
// every handle once the runner settles or the deadline fires; after that `read()` rejects and any stream a handle
// opened is destroyed, so it errors instead of ending short. With no store bound, `read()` rejects (`store_unbound`)
// and a missing blob rejects with the store's BlobMissingError: never an empty stream that would read as an empty
// document. The content runner (W4-06a) maps these rejections to `artifact_unreadable`. Error messages carry a detail
// code only, never a path, filename or document text (W0-10).

import { Readable } from 'node:stream';
import type { AuthorizedArtifactRef } from '@rai/shared/qc/types';
import type { BlobStore } from '../artifacts/blob-store.js';

export type ArtifactReadDetail = 'handle_revoked' | 'store_unbound';

export class ArtifactReadError extends Error {
  constructor(readonly detail: ArtifactReadDetail) {
    super(`artifact read: ${detail}`);
    this.name = 'ArtifactReadError';
  }
}

export interface ArtifactHandles {
  /** The request's artifacts, each with its live `read()`. */
  refs: AuthorizedArtifactRef[];
  /** Ends every handle and destroys every stream they opened. Idempotent. */
  revoke: () => void;
}

/** Builds the run's read handles over `blobs` for the request's artifacts (metadata copied unchanged). */
export function authorizedHandles(
  blobs: BlobStore | undefined,
  artifacts: ReadonlyArray<Omit<AuthorizedArtifactRef, 'read'>>,
): ArtifactHandles {
  let revoked = false;
  const open = new Set<Readable>();

  async function read(contentHash: string): Promise<ReadableStream<Uint8Array>> {
    if (revoked) throw new ArtifactReadError('handle_revoked');
    if (blobs === undefined) throw new ArtifactReadError('store_unbound');
    const stream = await blobs.open(contentHash);
    if (revoked) {
      stream.destroy();
      throw new ArtifactReadError('handle_revoked');
    }
    open.add(stream);
    stream.once('close', () => open.delete(stream));
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  }

  return {
    refs: artifacts.map((artifact) => ({ ...artifact, read: () => read(artifact.contentHash) })),
    revoke() {
      if (revoked) return;
      revoked = true;
      for (const stream of open) stream.destroy(new ArtifactReadError('handle_revoked'));
      open.clear();
    },
  };
}
