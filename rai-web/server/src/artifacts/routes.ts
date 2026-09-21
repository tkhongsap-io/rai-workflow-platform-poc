// W0-02 section 7.4, verbatim: `POST /api/cases/{caseId}/artifacts` (multipart, one part named `file`, nothing else
// read, no idempotency key: idempotent by content hash), `GET /api/artifacts/{artifactId}` (bytes, attachment) and
// `GET /api/artifacts/{artifactId}/meta` (ArtifactRef). Each route declares its policy row; the W1-01 middleware
// answers 401 and 403 before the body is parsed and 404 only for an `all_cases` holder (W0-05 section 4). The
// multipart plugin is registered in this encapsulated scope only, with the W0-08 section 3 limits; its own limit
// errors are mapped here to the W0-06 codes (over limit → unsafe_upload too_large; anything else → invalid_input).
// Download headers are W0-08 section 6's; the blob directory is never served statically.

import multipart, { type Multipart, type MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { eq } from 'drizzle-orm';
import { Type } from 'typebox';
import { InvalidInputError, NotFoundError, UnsafeUploadError } from '@rai/shared/errors';
import { ArtifactRefSchema } from '@rai/shared/schemas/artifacts';
import { auditStore } from '../audit/store.js';
import type { Db } from '../db/client.js';
import { artifact } from '../db/schema/artifact.js';
import { withTransaction } from '../db/transaction.js';
import type { Emitter } from '../observability/log.js';
import type { BlobStore } from './blob-store.js';
import { contentDisposition } from './filename.js';
import { storeUpload, toArtifactRef, type UploadLimits } from './pipeline.js';

export interface ArtifactRouteDeps {
  db: Db;
  store: BlobStore;
  limits: UploadLimits;
  emitter: Emitter;
  now?: () => Date;
}

export const UPLOAD_REQUEST_TIMEOUT_MS = 120_000; // W0-08 section 3 request body time; performance targets

const CaseParams = Type.Object({ caseId: Type.String() });
const ArtifactParams = Type.Object({ artifactId: Type.String() });

/** A @fastify/multipart error (`FST_*`) → the W0-06 8 mapping. Anything else is rethrown. */
export function mapMultipartError(err: unknown): never {
  const code = (err as { code?: unknown }).code;
  if (code === 'FST_REQ_FILE_TOO_LARGE') throw new UnsafeUploadError('too_large');
  if (typeof code === 'string' && code.startsWith('FST_')) {
    throw new InvalidInputError([{ path: 'file', messageKey: 'validation.required' }]);
  }
  throw err;
}

/** The first part must be the file named `file`; a field or another name is refused before any byte is read. */
async function firstPart(request: FastifyRequest): Promise<MultipartFile | undefined> {
  const parts = request.parts();
  let first: IteratorResult<Multipart, unknown>;
  try {
    first = await parts.next();
  } catch (err) {
    return mapMultipartError(err);
  }
  if (first.done) return undefined;
  const part = first.value;
  if (part.type !== 'file' || part.fieldname !== 'file') {
    if (part.type === 'file') part.file.destroy();
    throw new InvalidInputError([{ path: 'file', messageKey: 'validation.required' }]);
  }
  return part;
}

function actorOf(request: FastifyRequest): { subjectId: string; role: string } {
  const principal = request.principal;
  const decision = request.authz?.decision;
  if (principal === undefined || decision === undefined)
    throw new Error('artifact route reached without authorization');
  return { subjectId: principal.subjectId, role: decision.via.role };
}

export function registerArtifactRoutes(fastify: FastifyInstance, deps: ArtifactRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  void fastify.register(async (scope) => {
    await scope.register(multipart, {
      throwFileSizeLimit: true,
      preservePath: true, // the declared name reaches the W0-08 filename rule as sent: path characters are refused, not stripped
      limits: {
        fileSize: deps.limits.maxFileBytes, // the stream is cut at the limit; check 5 answers too_large
        files: 1,
        // W0-08 section 3: no non-file field is read. A field part is refused below before anything else is
        // touched, and fieldSize 0 truncates any value to nothing. (`fields: 0` would make the parser skip the
        // part and cancel the request from a later tick, which destroys a file stream already handed to the
        // handler; the refusal here is the same outcome, decided synchronously.)
        fields: 1,
        fieldSize: 0,
        headerPairs: 64,
      },
    });
    const app = scope.withTypeProvider<TypeBoxTypeProvider>();

    app.post(
      '/api/cases/:caseId/artifacts',
      {
        config: { auth: { kind: 'action', action: 'artifact.upload', target: 'case' } },
        schema: { params: CaseParams, response: { 201: ArtifactRefSchema } },
      },
      async (request, reply) => {
        // W0-08 section 3: 120 s per upload request. Absent on an injected (in-process) request.
        if (typeof request.raw.setTimeout === 'function') request.raw.setTimeout(UPLOAD_REQUEST_TIMEOUT_MS);
        if (!request.isMultipart())
          throw new InvalidInputError([{ path: 'file', messageKey: 'validation.required' }]);
        const file = await firstPart(request);
        const ref = await storeUpload(
          { db: deps.db, store: deps.store, limits: deps.limits, emitter: deps.emitter, now },
          {
            caseId: request.params.caseId,
            actor: actorOf(request),
            correlationId: request.id,
            part:
              file === undefined
                ? undefined
                : { filename: file.filename, stream: file.file, truncated: () => file.file.truncated },
          },
        ).catch((err: unknown) => mapMultipartError(err));
        return reply.status(201).send(ref);
      },
    );

    async function loadArtifact(artifactId: string) {
      const [row] = await deps.db.select().from(artifact).where(eq(artifact.id, artifactId)).limit(1);
      if (row === undefined) throw new NotFoundError('artifact'); // the facts resolved, so this is a race, not a leak
      return row;
    }

    app.get(
      '/api/artifacts/:artifactId/meta',
      {
        config: { auth: { kind: 'action', action: 'artifact.download', target: 'artifact' } },
        schema: { params: ArtifactParams, response: { 200: ArtifactRefSchema } },
      },
      async (request) => toArtifactRef(await loadArtifact(request.params.artifactId)),
    );

    app.get(
      '/api/artifacts/:artifactId',
      {
        config: { auth: { kind: 'action', action: 'artifact.download', target: 'artifact' } },
        schema: { params: ArtifactParams },
      },
      async (request, reply) => {
        const row = await loadArtifact(request.params.artifactId);
        if (row.bytesState !== 'present') throw new NotFoundError('artifact');
        const actor = actorOf(request);
        const stream = await deps.store.open(row.contentHash);
        // The one audit event written outside a state change: its own transaction, before the bytes flow (W0-04).
        await withTransaction(deps.db, (tx) =>
          auditStore.append(tx, {
            actorSubjectId: actor.subjectId,
            actorRole: actor.role,
            action: 'artifact.downloaded',
            targetCaseId: row.caseId,
            targetRef: { artifact_id: row.id },
            correlationId: request.id,
            occurredAt: now(),
          }),
        );
        return reply
          .status(200)
          .header('Content-Type', row.mediaType)
          .header('Content-Length', String(row.sizeBytes))
          .header('Content-Disposition', contentDisposition(row.filename))
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', 'sandbox')
          .header('Cache-Control', 'no-store')
          .header('Referrer-Policy', 'no-referrer')
          .send(stream);
      },
    );
  });
}
