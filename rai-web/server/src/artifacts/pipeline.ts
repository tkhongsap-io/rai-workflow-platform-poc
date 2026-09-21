// W0-08 section 4 "Order of checks", checks 3-12, after the middleware answered 1 (session) and 2 (scope). Stops
// at the first failure; 3 and 4 fail before any file byte is read. A rejection stores nothing, writes no audit
// event and emits one `upload.rejected` line with the W0-10 3.3 fields (never the filename, the bytes or their
// hash); the temp file is unlinked before the response. A success commits the blob, the artifact row and the
// `artifact.uploaded` event in one transaction (check 12) and emits `upload.stored`.

import { and, eq, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { InvalidInputError, UnsafeUploadError, type UnsafeUploadReason } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type { AllowedMediaType, ArtifactRef } from '@rai/shared/schemas/artifacts';
import { auditStore } from '../audit/store.js';
import type { Db, Executor } from '../db/client.js';
import { artifact } from '../db/schema/artifact.js';
import { artifactSlot } from '../db/schema/artifact-slot.js';
import { cases } from '../db/schema/case.js';
import { lockCase, withTransaction } from '../db/transaction.js';
import type { Emitter } from '../observability/log.js';
import { StagingAborted, type BlobStore, type TempRef } from './blob-store.js';
import { checkFilename, MEDIA_TYPE_BY_KIND } from './filename.js';
import { inspectBytes } from './sniff.js';

export interface UploadLimits {
  maxFileBytes: number;
  maxPackBytes: number;
  maxImagePixels: number;
}

export interface UploadDeps {
  db: Db;
  store: BlobStore;
  limits: UploadLimits;
  emitter: Emitter;
  now?: () => Date;
}

export interface UploadActor {
  subjectId: string;
  role: string; // the role the policy row allowed (owner or bu_spoc)
}

export interface UploadPart {
  filename: string | undefined; // the client's declared name, as received
  stream: Readable;
  /** True once the multipart parser cut the stream at its per-file limit (W0-08 check 5). */
  truncated: () => boolean;
}

const MIB = 1024 * 1024;

export function toArtifactRef(row: typeof artifact.$inferSelect): ArtifactRef {
  return {
    artifactId: row.id,
    caseId: row.caseId,
    sha256: row.contentHash,
    filename: row.filename,
    mediaType: row.mediaType as AllowedMediaType, // the sniffed row value (W0-08 section 2), stored as text
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

/** W0-08 check 3: the case must have an open draft; a submitted version never accepts bytes. */
export async function openDraftOf(exec: Executor, caseId: string): Promise<string | null> {
  const [row] = await exec
    .select({ draftVersionId: cases.draftVersionId })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  return row?.draftVersionId ?? null;
}

/** W0-08 check 10: bytes the open draft's attached artifacts already reference. */
export async function attachedBytesOf(exec: Executor, draftVersionId: string): Promise<number> {
  const [row] = await exec
    .select({ total: sql<string>`coalesce(sum(${artifact.sizeBytes}), 0)` })
    .from(artifactSlot)
    .innerJoin(artifact, eq(artifactSlot.artifactId, artifact.id))
    .where(and(eq(artifactSlot.versionId, draftVersionId), eq(artifactSlot.state, 'attached')));
  return Number(row?.total ?? 0);
}

export class UploadRejected extends UnsafeUploadError {
  constructor(
    readonly reason: UnsafeUploadReason,
    params?: Record<string, string | number>,
  ) {
    super(reason, params);
  }
}

/**
 * Stores one upload for `caseId` on behalf of `actor` and returns the W0-02 7.4 ArtifactRef. Throws
 * InvalidInputError (`validation.required` for a missing part, `validation.no_open_draft`) or UnsafeUploadError.
 */
export async function storeUpload(
  deps: UploadDeps,
  input: { caseId: string; actor: UploadActor; correlationId: string; part: UploadPart | undefined },
): Promise<ArtifactRef> {
  const { db, store, limits, emitter } = deps;
  const now = deps.now ?? (() => new Date());
  const { caseId, actor, correlationId, part } = input;

  const reject = (
    reason: UnsafeUploadReason,
    detail: {
      sizeBytes: number;
      declaredMediaType?: AllowedMediaType | undefined;
      sniffedMediaType?: AllowedMediaType | undefined;
    },
    params?: Record<string, string | number>,
  ): never => {
    emitter.log('upload.rejected', {
      caseId,
      reason,
      sniffedMediaType: detail.sniffedMediaType,
      declaredMediaType: detail.declaredMediaType,
      sizeBytes: detail.sizeBytes,
    });
    throw new UploadRejected(reason, params);
  };

  // Check 3: open draft, before any byte is read.
  const draftVersionId = await openDraftOf(db, caseId);
  if (draftVersionId === null) {
    part?.stream.destroy();
    throw new InvalidInputError([{ path: 'caseId', messageKey: 'validation.no_open_draft' }]);
  }
  if (part === undefined) throw new InvalidInputError([{ path: 'file', messageKey: 'validation.required' }]);

  // Check 4: filename rule, before any byte is read. The stream is destroyed, never drained.
  const name = checkFilename(part.filename);
  if (!name.ok) {
    part.stream.destroy();
    return reject(name.reason, { sizeBytes: 0 });
  }
  const declaredMediaType = MEDIA_TYPE_BY_KIND[name.kind];

  // Check 5: stream to tmp while hashing, per-file cap. A stream that closes before it ends (the client went
  // away, or the parser stopped on a malformed body) is a request-shape failure, not an unsafe upload.
  const staged = await store.stage(part.stream, { maxBytes: limits.maxFileBytes }).catch((err: unknown) => {
    if (err instanceof StagingAborted)
      throw new InvalidInputError([{ path: 'file', messageKey: 'validation.required' }]);
    throw err;
  });
  if (!staged.ok || part.truncated()) {
    if (staged.ok) await store.discard(staged.temp);
    return reject(
      'too_large',
      { sizeBytes: limits.maxFileBytes, declaredMediaType },
      { max_file_mb: limits.maxFileBytes / MIB },
    );
  }
  const temp: TempRef = staged.temp;
  const discardAnd = async (
    reason: UnsafeUploadReason,
    sniffedMediaType?: AllowedMediaType,
    params?: Record<string, string | number>,
  ): Promise<never> => {
    await store.discard(temp);
    return reject(reason, { sizeBytes: temp.sizeBytes, declaredMediaType, sniffedMediaType }, params);
  };

  // Check 6: non-empty.
  if (temp.sizeBytes === 0) return discardAnd('empty_file');

  // Checks 7-9: magic, kind versus extension, structure, on the staged bytes (at most the per-file limit).
  const bytes = await store.readStaged(temp);
  const inspected = inspectBytes(bytes, name.kind, { maxImagePixels: limits.maxImagePixels });
  if (!inspected.ok) {
    return discardAnd(
      inspected.reason,
      inspected.sniffedMediaType,
      inspected.reason === 'image_too_large'
        ? { max_megapixels: limits.maxImagePixels / 1_000_000 }
        : undefined,
    );
  }

  // Checks 10-12 under the case lock: pack total, blob commit, artifact row and audit event in one transaction.
  const artifactId = uuidv7();
  const uploadedAt = now();
  let row: typeof artifact.$inferSelect;
  try {
    row = await withTransaction(db, async (tx) => {
      if (!(await lockCase(tx, caseId)))
        throw new InvalidInputError([{ path: 'caseId', messageKey: 'validation.no_open_draft' }]);
      const draftNow = await openDraftOf(tx, caseId);
      if (draftNow === null)
        throw new InvalidInputError([{ path: 'caseId', messageKey: 'validation.no_open_draft' }]);
      const attached = await attachedBytesOf(tx, draftNow);
      if (attached + temp.sizeBytes > limits.maxPackBytes)
        throw new UploadRejected('pack_total_exceeded', { max_pack_mb: limits.maxPackBytes / MIB });
      const committed = await store.commit(temp);
      const [inserted] = await tx
        .insert(artifact)
        .values({
          id: artifactId,
          contentHash: committed.hash,
          sizeBytes: committed.sizeBytes,
          filename: name.filename,
          mediaType: inspected.mediaType,
          uploadedBy: actor.subjectId,
          uploadedRole: actor.role,
          uploadedAt,
          caseId,
          correlationId,
          bytesState: 'present',
        })
        .returning();
      await auditStore.append(tx, {
        actorSubjectId: actor.subjectId,
        actorRole: actor.role,
        action: 'artifact.uploaded',
        targetCaseId: caseId,
        targetVersionId: draftNow,
        targetRef: {
          artifact_id: artifactId,
          content_hash: committed.hash,
          size_bytes: committed.sizeBytes,
          deduplicated: committed.deduplicated,
        },
        correlationId,
        occurredAt: uploadedAt,
      });
      return inserted!;
    });
  } catch (err) {
    await store.discard(temp);
    if (err instanceof UploadRejected) {
      return reject(
        err.reason,
        { sizeBytes: temp.sizeBytes, declaredMediaType, sniffedMediaType: inspected.mediaType },
        err.details?.params,
      );
    }
    throw err;
  }

  emitter.log('upload.stored', {
    caseId,
    artifactId,
    contentHash: row.contentHash,
    sizeBytes: row.sizeBytes,
    mediaType: row.mediaType,
  });
  return toArtifactRef(row);
}
