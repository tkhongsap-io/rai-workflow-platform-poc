// W1-13: W0-02 section 7.4 — upload (`artifact.upload`, keyed by :caseId), download and meta (`artifact.download`,
// keyed by :artifactId alone and reaching the case through artifact.caseId, W0-05 "Downloads and deep links").
// The upload runs W0-08 section 4 checks 1-8 and 10 through sniff.ts (the substitute's approximation; the
// structural checks are W1-03's) and keeps the bytes in memory under a content hash; nothing is written to disk.

import { createHash } from 'node:crypto';
import { InvalidInputError, NotFoundError, UnsafeUploadError } from '@rai/shared/errors';
import { uuidv7 } from '@rai/shared/ids';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { RouteContext, RouteDefinition } from './handler.js';
import { boundaryOf, parseMultipart } from './multipart.js';
import { authorizedCase } from './routes-cases.js';
import { checkUpload } from './sniff.js';
import type { StoredArtifact, StoredCase } from './store.js';
import { baseHeaders, contentDispositionFor, json } from './support.js';
import { asContractMediaType } from './contract-cast.js';

const MIB = 1024 * 1024;

/** Bytes of every artifact the open draft references (W0-08 check 10: the per-pack total, re-checked at attach). */
export function attachedBytes(ctx: RouteContext, stored: StoredCase, excludeArtifactId?: string): number {
  if (stored.draft === null) return 0;
  let total = 0;
  for (const state of Object.values(stored.draft.slots)) {
    if (state.state !== 'attached' || state.artifactId === excludeArtifactId) continue;
    total += ctx.store.artifacts.get(state.artifactId)?.ref.sizeBytes ?? 0;
  }
  return total;
}

function authorizedArtifact(ctx: RouteContext): StoredArtifact {
  const artifact = ctx.store.artifacts.get(ctx.params.artifactId ?? '');
  if (artifact === undefined) throw new NotFoundError('artifact');
  return artifact;
}

export function artifactRoutes(): RouteDefinition[] {
  return [
    {
      method: 'POST',
      path: '/api/cases/:caseId/artifacts',
      auth: { kind: 'action', action: 'artifact.upload', target: 'case' },
      handler: (ctx) => {
        const stored = authorizedCase(ctx);
        if (ctx.principal === undefined) throw new NotFoundError('case'); // unreachable after the 401 step
        // Check 3: an open draft (a submitted version never accepts bytes).
        if (stored.draft === null)
          throw new InvalidInputError([{ path: 'body', messageKey: 'validation.no_open_draft' }]);
        const boundary = boundaryOf(ctx.request.headers['content-type']);
        const parts =
          boundary === undefined ? [] : parseMultipart(ctx.request.body ?? new Uint8Array(), boundary);
        const file = parts.find((p) => p.name === 'file'); // no other field is read (W0-08 section 3)
        if (file === undefined)
          throw new InvalidInputError([{ path: 'body.file', messageKey: 'validation.required' }]);
        // Check 5: the per-file limit (the parser aborts at limit + 1; here the body is already in memory).
        if (file.bytes.byteLength > ctx.options.uploadMaxFileBytes)
          throw new UnsafeUploadError('too_large', {
            max_file_mb: Math.floor(ctx.options.uploadMaxFileBytes / MIB),
          });
        // Checks 4, 6, 7, 8.
        const verdict = checkUpload(file.filename ?? '', file.bytes);
        if (!verdict.ok) throw new UnsafeUploadError(verdict.reason);
        // Check 10: the per-pack total.
        if (attachedBytes(ctx, stored) + file.bytes.byteLength > ctx.options.uploadMaxPackBytes)
          throw new UnsafeUploadError('pack_total_exceeded', {
            max_pack_mb: Math.floor(ctx.options.uploadMaxPackBytes / MIB),
          });
        // Checks 11-12: content-hash keyed object (deduplicated) and a new metadata row.
        const bytes = new Uint8Array(file.bytes); // copy: the multipart view shares the request buffer
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const ref: ArtifactRef = {
          artifactId: uuidv7(),
          caseId: stored.caseId,
          sha256,
          filename: (file.filename ?? '').normalize('NFC'),
          mediaType: asContractMediaType(verdict.mediaType), // the sniffed type, never the declared one
          sizeBytes: bytes.byteLength,
          uploadedBy: ctx.principal.subjectId,
          uploadedAt: ctx.options.now().toISOString(),
        };
        ctx.store.artifacts.set(ref.artifactId, { ref, bytes: () => bytes });
        ctx.emitter.log('upload.stored', {
          caseId: stored.caseId,
          artifactId: ref.artifactId,
          contentHash: sha256,
          sizeBytes: ref.sizeBytes,
          mediaType: ref.mediaType,
        });
        return json(201, ctx.correlationId, ref);
      },
    },
    {
      method: 'GET',
      path: '/api/artifacts/:artifactId/meta',
      auth: { kind: 'action', action: 'artifact.download', target: 'artifact' },
      handler: (ctx) => json(200, ctx.correlationId, authorizedArtifact(ctx).ref),
    },
    {
      method: 'GET',
      path: '/api/artifacts/:artifactId',
      auth: { kind: 'action', action: 'artifact.download', target: 'artifact' },
      handler: (ctx) => {
        const artifact = authorizedArtifact(ctx);
        return {
          status: 200,
          headers: {
            ...baseHeaders(ctx.correlationId),
            'content-type': artifact.ref.mediaType,
            'content-disposition': contentDispositionFor(artifact.ref.filename),
            'x-content-type-options': 'nosniff',
            'content-length': String(artifact.ref.sizeBytes),
          },
          body: artifact.bytes(),
        };
      },
    },
  ];
}
