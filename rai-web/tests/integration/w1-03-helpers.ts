// Shared bootstrap for the W1-03 integration suites: the real Postgres with the fixture set loaded, a temp
// BLOB_DIR, the app built exactly as start.ts builds it (fixture identity, authorization middleware, artifact
// routes) plus the log capture seam, a multipart body builder for `app.inject()`, and the fixture generator's
// documents as base bytes. Lane A owns these files (W0-02 section 8.1: a suite file belongs to its ticket's lane).

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../support/observed-app.js';
import { createFilesystemBlobStore, type FilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import { createScopeFactsSource } from '@rai/server/authz/facts';
import { createIdentityAdapter } from '@rai/server/identity/adapter';
import { createFixtureIdentityProvider } from '@rai/server/identity/fixture';
import { createPgSessionStore } from '@rai/server/identity/session';
import { UPLOAD_LIMIT_DEFAULTS } from '@rai/server/config';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { FIXTURE_DOCUMENTS, FIXTURE_THAI_LINE, documentTextLines } from '@rai/fixtures/data/documents/index';
import { generateDocument } from '@rai/fixtures/generate';
import { buildPdf } from '@rai/fixtures/generate/pdf';
import { buildDocx, buildXlsx } from '@rai/fixtures/generate/ooxml';
import { buildPng } from '@rai/fixtures/generate/png';
import { buildJpeg } from '@rai/fixtures/generate/jpeg';
import { loadFixtures } from '@rai/fixtures/load';
import type { BaseDocuments } from '@rai/server/artifacts/sniff.test-bytes';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { signInAsFixture, type FixtureSession } from '../support/sign-in.js';

export const PUBLIC_BASE_URL = new URL('http://127.0.0.1:8787');
export const LIMITS = {
  maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
  maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
  maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
};

export interface CapturedLine {
  event?: string;
  correlationId?: string | null;
  fields?: Record<string, unknown>;
  raw: string;
}

export interface Harness {
  db: TestDatabase;
  app: FastifyInstance;
  store: FilesystemBlobStore;
  blobDir: string;
  lines: CapturedLine[];
  linesFor(event: string): CapturedLine[];
  /** Empties the business tables, reloads the fixture set and clears the captured lines. */
  reload(): Promise<void>;
  close(): Promise<void>;
}

export async function openHarness(): Promise<Harness> {
  const db = await openTestDatabase();
  const blobDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-03-blobs-'));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w1-03-out-'));
  const store = createFilesystemBlobStore(blobDir);
  await store.init();
  const lines: CapturedLine[] = [];
  let pending = '';
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      pending += chunk.toString('utf8');
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        const raw = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (raw.trim() !== '') {
          try {
            lines.push({ ...(JSON.parse(raw) as Omit<CapturedLine, 'raw'>), raw });
          } catch {
            lines.push({ raw });
          }
        }
        nl = pending.indexOf('\n');
      }
      cb();
    },
  });
  const adapter = createIdentityAdapter({
    env: { RAI_IDENTITY_MODE: 'fixture', RAI_SESSION_ABSOLUTE_HOURS: '12', RAI_SESSION_IDLE_MINUTES: '120' },
    nodeEnv: 'test',
    discovery: () => Promise.reject(new Error('never called in fixture mode')),
    groupMappingSource: () => Promise.resolve(null),
    fixtureUsers: FIXTURE_USERS,
  });
  await adapter.start({ host: '127.0.0.1', port: 8787, publicBaseUrl: PUBLIC_BASE_URL, trustProxy: false });
  const built = buildApp({
    db: db.app,
    config: {
      nodeEnv: 'test',
      log: { level: 'info', pretty: false },
      trustProxy: false,
      publicBaseUrl: PUBLIC_BASE_URL,
    },
    logStream,
    artifacts: { store, limits: LIMITS },
    identity: {
      adapter,
      sessionStore: createPgSessionStore(db.app),
      facts: createScopeFactsSource(db.app),
      fixtureProvider: createFixtureIdentityProvider(FIXTURE_USERS),
    },
  });
  await built.fastify.ready();
  const harness: Harness = {
    db,
    app: built.fastify,
    store,
    blobDir,
    lines,
    linesFor: (event) => lines.filter((l) => l.event === event),
    async reload() {
      await db.reset();
      await db.owner.execute('TRUNCATE TABLE "session"');
      await rm(path.join(blobDir, 'sha256'), { recursive: true, force: true });
      await store.init();
      await loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir, outputDir });
      lines.length = 0;
    },
    async close() {
      await built.fastify.close();
      await db.close();
      await rm(blobDir, { recursive: true, force: true });
      await rm(outputDir, { recursive: true, force: true });
    },
  };
  return harness;
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export interface MultipartPart {
  name: string;
  filename?: string | undefined;
  contentType?: string;
  data: Buffer | string;
}

/** A multipart/form-data body for `app.inject()`; `filename` is sent raw (UTF-8), as browsers do. */
export function multipart(parts: MultipartPart[]): { headers: Record<string, string>; payload: Buffer } {
  const boundary = `----rai-w1-03-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename !== undefined) head += `; filename="${part.filename}"`;
    head += `\r\n`;
    if (part.contentType !== undefined || part.filename !== undefined)
      head += `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n`;
    head += `\r\n`;
    chunks.push(Buffer.from(head, 'utf8'));
    chunks.push(typeof part.data === 'string' ? Buffer.from(part.data, 'utf8') : part.data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  const payload = Buffer.concat(chunks);
  return {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
    payload,
  };
}

export function fileUpload(filename: string, bytes: Buffer, contentType = 'application/octet-stream') {
  return multipart([{ name: 'file', filename, contentType, data: bytes }]);
}

export async function upload(
  app: FastifyInstance,
  session: FixtureSession | undefined,
  caseId: string,
  filename: string,
  bytes: Buffer,
  contentType?: string,
) {
  const body = fileUpload(filename, bytes, contentType);
  return app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/artifacts`,
    headers: {
      ...body.headers,
      ...(session === undefined ? {} : { cookie: session.cookie, 'sec-fetch-site': 'same-origin' }),
    },
    payload: body.payload,
  });
}

export function signIn(app: FastifyInstance, fixtureUserId: string): Promise<FixtureSession> {
  return signInAsFixture(app, fixtureUserId);
}

/** The five kinds as the real fixture generator produces them (W0-08 8.5), for the hostile rows and positives. */
export function fixtureBaseDocuments(): BaseDocuments {
  const doc = (id: string) => {
    const d = FIXTURE_DOCUMENTS.find((x) => x.fixtureDocumentId === id);
    if (d === undefined) throw new Error(`no fixture document ${id}`);
    return d;
  };
  const lines = documentTextLines(doc('fx-doc-0001-01'));
  return {
    pdf: buildPdf({ asciiLines: lines, thaiLine: FIXTURE_THAI_LINE, title: 'W1-03 base' }),
    docx: buildDocx(lines),
    xlsx: buildXlsx(lines),
    png: buildPng({ comment: lines.join('\n'), thaiLine: FIXTURE_THAI_LINE }),
    jpeg: buildJpeg(lines.join('\n')),
  };
}

export function fixtureDocumentBytes(fixtureDocumentId: string): Buffer {
  const d = FIXTURE_DOCUMENTS.find((x) => x.fixtureDocumentId === fixtureDocumentId);
  if (d === undefined) throw new Error(`no fixture document ${fixtureDocumentId}`);
  return generateDocument(d);
}

/** A valid PDF padded with comment filler before the xref to exactly `targetBytes` (the section 8.6 boundary rows). */
export function pdfOfExactSize(targetBytes: number, seed: string): Buffer {
  const base = buildPdf({
    asciiLines: ['RAI-DESK-SYNTHETIC-FIXTURE boundary'],
    thaiLine: FIXTURE_THAI_LINE,
    title: seed,
  });
  const xrefAt = base.lastIndexOf('xref\n');
  const startxrefAt = base.lastIndexOf('startxref\n') + 'startxref\n'.length;
  const oldNumber = /^\d+/.exec(base.subarray(startxrefAt).toString('ascii'))![0];
  let fillerLength = targetBytes - base.length;
  let newNumber = String(xrefAt + fillerLength);
  for (let i = 0; i < 3; i += 1) {
    fillerLength = targetBytes - base.length + oldNumber.length - newNumber.length;
    newNumber = String(xrefAt + fillerLength);
  }
  if (fillerLength < 3) throw new Error('target too small');
  const filler = Buffer.alloc(fillerLength, 0x2d); // '-' inside '%' comment lines of 64 bytes
  for (let i = 0; i < fillerLength; i += 64) {
    filler[i] = 0x25; // '%'
    if (i > 0) filler[i - 1] = 0x0a;
  }
  filler[fillerLength - 1] = 0x0a;
  const out = Buffer.concat([
    base.subarray(0, xrefAt),
    filler,
    base.subarray(xrefAt, startxrefAt),
    Buffer.from(newNumber, 'ascii'),
    base.subarray(startxrefAt + oldNumber.length),
  ]);
  if (out.length !== targetBytes) throw new Error(`built ${out.length}, wanted ${targetBytes}`);
  return out;
}

export async function objectCount(blobDir: string): Promise<number> {
  const root = path.join(blobDir, 'sha256');
  let n = 0;
  for (const a of await readdir(root).catch(() => [] as string[])) {
    for (const b of await readdir(path.join(root, a))) n += (await readdir(path.join(root, a, b))).length;
  }
  return n;
}
