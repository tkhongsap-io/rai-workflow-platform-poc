// W0-08 8.5's node:test suite for the generator: each generated file's SHA-256 equals the manifest; each file passes
// the section 2 structural check for its declared kind; each contains the sentinel; the Thai filename is NFC and
// unchanged after a round trip through the section 6 Content-Disposition encoding; no file in the fixtures source
// directory is binary; no committed file exceeds 64 KiB. The structural check below is test-local and mirrors
// W0-08 section 2 so this suite can run before W1-03's sniff module exists; it is not the product sniff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  FIXTURE_DOCUMENTS,
  FIXTURE_PROVENANCE_SENTENCE,
  FIXTURE_SENTINEL,
  FIXTURE_THAI_LINE,
  THAI_NAMED_FIXTURE_DOCUMENT_ID,
  type FixtureDocumentKind,
} from './data/documents/index.js';
import { ManifestMismatch, assertManifestMatches, generateAll, generateDocument } from './generate.js';
import { blobKeyPath } from './generate/blob-layout.js';
import { PDF_MEDIUM_TARGET_BYTES } from './generate/pdf.js';
import { FIXTURES_PACKAGE_ROOT, computeSetHash, fixtureSetLabel, readManifest } from './manifest.js';

const generated = generateAll();
const manifest = readManifest();

// ---- test-local structural check (W0-08 section 2) -------------------------------------------------------------

const PDF_ACTIVE_TOKENS = ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA'];
const ARCHIVE_OR_EXECUTABLE =
  /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|iso|cab|jar|apk|exe|dll|msi|com|scr|bat|cmd|ps1|sh|js|mjs|vbs|hta|lnk|app|dmg|pkg)$/i;

function checkPdf(bytes: Buffer): void {
  assert.match(bytes.subarray(0, 8).toString('latin1'), /^%PDF-[12]\.\d/);
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString('latin1');
  assert.ok(tail.includes('%%EOF'), '%%EOF within the last 1,024 bytes');
  const text = bytes.toString('latin1');
  for (const token of PDF_ACTIVE_TOKENS) assert.ok(!text.includes(token), `no ${token}`);
}

interface CentralEntry {
  name: string;
  method: number;
  flags: number;
  uncompressedSize: number;
}

function readCentralDirectory(bytes: Buffer): CentralEntry[] {
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'local file header at offset 0');
  const searchFrom = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= searchFrom; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.ok(eocd >= 0, 'EOCD found');
  const commentLength = bytes.readUInt16LE(eocd + 20);
  assert.equal(eocd + 22 + commentLength, bytes.length, 'EOCD at the end of the file');
  assert.equal(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07])), -1, 'no ZIP64 locator');
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  assert.ok(entryCount <= 2000);
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < entryCount; i += 1) {
    assert.equal(bytes.readUInt32LE(p), 0x02014b50, 'central directory signature');
    const flags = bytes.readUInt16LE(p + 8);
    const method = bytes.readUInt16LE(p + 10);
    const uncompressedSize = bytes.readUInt32LE(p + 24);
    const nameLength = bytes.readUInt16LE(p + 28);
    const extraLength = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    entries.push({ name, method, flags, uncompressedSize });
    total += uncompressedSize;
    p += 46 + nameLength + extraLength + commentLen;
  }
  assert.ok(total <= 500 * 1024 * 1024);
  for (const e of entries) {
    assert.ok(e.uncompressedSize <= 100 * 1024 * 1024, e.name);
    assert.ok(e.method === 0 || e.method === 8, `${e.name}: method ${e.method}`);
    assert.equal(e.flags & 1, 0, `${e.name}: not encrypted`);
    assert.ok(!e.name.includes('\0') && !e.name.includes('\\') && !e.name.startsWith('/'), e.name);
    assert.ok(!e.name.split('/').includes('..'), e.name);
    assert.notEqual(path.posix.basename(e.name).toLowerCase(), 'vbaproject.bin', e.name);
    assert.doesNotMatch(e.name, ARCHIVE_OR_EXECUTABLE, e.name);
  }
  return entries;
}

function checkOoxml(bytes: Buffer, kind: 'docx' | 'xlsx'): void {
  const names = new Set(readCentralDirectory(bytes).map((e) => e.name));
  assert.ok(names.has('[Content_Types].xml'));
  const hasWord = names.has('word/document.xml');
  const hasXl = names.has('xl/workbook.xml');
  assert.notEqual(hasWord, hasXl, 'exactly one package kind');
  assert.equal(kind === 'docx' ? hasWord : hasXl, true, `${kind} marker part present`);
}

function checkPng(bytes: Buffer): void {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.readUInt32BE(8), 13, 'IHDR length');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width >= 1 && height >= 1 && width * height <= 40_000_000);
  assert.deepEqual(
    [...bytes.subarray(bytes.length - 12)],
    [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
    'IEND is the last chunk',
  );
}

function checkJpeg(bytes: Buffer): void {
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual([...bytes.subarray(bytes.length - 2)], [0xff, 0xd9]);
  let p = 2;
  let sofFound = false;
  while (p + 4 <= bytes.length) {
    assert.equal(bytes[p], 0xff, `marker at ${p}`);
    const marker = bytes[p + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    const length = bytes.readUInt16BE(p + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = bytes.readUInt16BE(p + 5);
      const width = bytes.readUInt16BE(p + 7);
      assert.ok(width * height <= 40_000_000);
      sofFound = true;
      break;
    }
    assert.notEqual(marker, 0xda, 'SOS before any SOF');
    p += 2 + length;
  }
  assert.ok(sofFound, 'a SOF0/SOF1/SOF2 frame header before the scan');
}

const EXTENSION_BY_KIND: Record<FixtureDocumentKind, RegExp> = {
  pdf: /\.pdf$/i,
  docx: /\.docx$/i,
  xlsx: /\.xlsx$/i,
  png: /\.png$/i,
  jpeg: /\.(jpg|jpeg)$/i,
};

function structuralCheck(bytes: Buffer, kind: FixtureDocumentKind): void {
  switch (kind) {
    case 'pdf':
      return checkPdf(bytes);
    case 'docx':
    case 'xlsx':
      return checkOoxml(bytes, kind);
    case 'png':
      return checkPng(bytes);
    case 'jpeg':
      return checkJpeg(bytes);
  }
}

// ---- RFC 8187 `filename*` round trip (W0-08 section 6) ---------------------------------------------------------

const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;
function encodeFilenameStar(filename: string): string {
  const bytes = Buffer.from(filename, 'utf8');
  let out = "UTF-8''";
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += b < 0x80 && ATTR_CHAR.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}
function decodeFilenameStar(value: string): string {
  assert.ok(value.startsWith("UTF-8''"));
  return decodeURIComponent(value.slice("UTF-8''".length));
}

// ---- tests -----------------------------------------------------------------------------------------------------

test(`${fixtureSetLabel(manifest)}: every generated document's SHA-256 and size equal the manifest, and the set hash is current`, () => {
  assert.equal(generated.length, FIXTURE_DOCUMENTS.length);
  assert.equal(Object.keys(manifest.documents).length, FIXTURE_DOCUMENTS.length);
  for (const g of generated) {
    const row = manifest.documents[g.document.fixtureDocumentId];
    assert.ok(row, g.document.fixtureDocumentId);
    assert.equal(g.sha256, row.sha256, g.document.fixtureDocumentId);
    assert.equal(g.bytes.length, row.sizeBytes, g.document.fixtureDocumentId);
    assert.equal(g.document.filename, row.filename);
  }
  assert.equal(
    manifest.sha256,
    computeSetHash(manifest.documents),
    'run fixtures:generate --write-manifest and bump version',
  );
  assert.equal(manifest.name, 'slice1-synthetic');
  assert.match(manifest.version, /^\d+$/);
  assert.doesNotThrow(() => assertManifestMatches(manifest, generated));
});

test('the generator is deterministic: a second run yields identical bytes', () => {
  for (const g of generated)
    assert.ok(generateDocument(g.document).equals(g.bytes), g.document.fixtureDocumentId);
});

test('a stale manifest is detected: a changed digest, a missing row and a changed set hash are each reported', () => {
  const stale = structuredClone(manifest);
  stale.documents['fx-doc-0001-01']!.sha256 = '0'.repeat(64);
  delete stale.documents['fx-doc-0005-08'];
  stale.sha256 = '1'.repeat(64);
  assert.throws(
    () => assertManifestMatches(stale, generated),
    (err: unknown) =>
      err instanceof ManifestMismatch &&
      err.differences.some((d) => d.startsWith('fx-doc-0001-01:')) &&
      err.differences.some((d) => d.startsWith('fx-doc-0005-08:')) &&
      err.differences.some((d) => d.startsWith('set sha256:')),
  );
});

test('every file passes the W0-08 section 2 structural check for its declared kind and extension', () => {
  for (const g of generated) {
    assert.match(g.document.filename, EXTENSION_BY_KIND[g.document.kind], g.document.fixtureDocumentId);
    structuralCheck(g.bytes, g.document.kind);
  }
  const kinds = new Set(generated.map((g) => g.document.kind));
  assert.deepEqual([...kinds].sort(), ['docx', 'jpeg', 'pdf', 'png', 'xlsx'], 'every allowed kind appears');
});

test('every file carries the sentinel, its own fixture id, its case id, the Thai line and the provenance sentence in plain bytes', () => {
  for (const g of generated) {
    const latin1 = g.bytes.toString('latin1');
    const utf8 = g.bytes.toString('utf8');
    const id = g.document.fixtureDocumentId;
    assert.ok(latin1.includes(FIXTURE_SENTINEL), `${id}: sentinel`);
    assert.ok(latin1.includes(id), `${id}: own fixture id`);
    assert.ok(latin1.includes(`RAI-2000-${g.document.caseNumber}`), `${id}: case id`);
    assert.ok(latin1.includes(FIXTURE_PROVENANCE_SENTENCE), `${id}: provenance sentence`);
    assert.ok(utf8.includes(FIXTURE_THAI_LINE), `${id}: Thai line as UTF-8`);
  }
});

test('size classes: small documents are small, the one medium PDF is about 2 MiB, and nothing approaches the 25 MiB limit', () => {
  for (const g of generated) {
    if (g.document.sizeClass === 'medium') {
      assert.ok(
        g.bytes.length >= PDF_MEDIUM_TARGET_BYTES - 1024 && g.bytes.length <= PDF_MEDIUM_TARGET_BYTES,
      );
    } else {
      // W0-08 8.4 says "< 10 KiB" for the text documents; a 64 x 64 RGB PNG with a stored IDAT is 12.5 KiB by
      // arithmetic (64 x (1 + 64 x 3) bytes), so the images are bounded at 16 KiB.
      const bound = g.document.kind === 'png' ? 16 * 1024 : 10 * 1024;
      assert.ok(
        g.bytes.length > 0 && g.bytes.length < bound,
        `${g.document.fixtureDocumentId}: ${g.bytes.length} B`,
      );
    }
    assert.ok(g.bytes.length < 26_214_400);
  }
  assert.equal(generated.filter((g) => g.document.sizeClass === 'medium').length, 1);
});

test(`the Thai filename (${THAI_NAMED_FIXTURE_DOCUMENT_ID}) is NFC, 34 code points, 82 bytes, and unchanged after a filename* round trip`, () => {
  const doc = FIXTURE_DOCUMENTS.find((d) => d.fixtureDocumentId === THAI_NAMED_FIXTURE_DOCUMENT_ID);
  assert.ok(doc);
  assert.equal(doc.filename, 'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf');
  assert.equal(doc.filename, doc.filename.normalize('NFC'));
  assert.equal([...doc.filename].length, 34);
  assert.equal(Buffer.byteLength(doc.filename, 'utf8'), 82);
  const encoded = encodeFilenameStar(doc.filename);
  assert.match(encoded, /^UTF-8''[A-Za-z0-9%!#$&+\-.^_`|~]+$/);
  assert.equal(decodeFilenameStar(encoded), doc.filename);
  // Every filename in the set obeys the W0-08 section 3 filename rule.
  for (const d of FIXTURE_DOCUMENTS) {
    assert.equal(d.filename, d.filename.normalize('NFC'));
    assert.ok([...d.filename].length <= 200 && [...d.filename].length >= 5);
    assert.ok(
      ![...d.filename].some(
        (ch) => ch === '/' || ch === '\\' || ch.codePointAt(0)! < 0x20 || ch === '\u007f',
      ),
      d.filename,
    );
    assert.equal(d.filename, d.filename.trim());
  }
});

test('the blob key layout is sha256/<h[0:2]>/<h[2:4]>/<h> with no extension (W0-04)', () => {
  const h = generated[0]!.sha256;
  assert.equal(blobKeyPath('/blobs', h), path.join('/blobs', 'sha256', h.slice(0, 2), h.slice(2, 4), h));
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

test('no file in the fixtures package source is binary and none exceeds 64 KiB (no committed documents; W0-08 8.1 rule 2)', () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let count = 0;
  for (const file of walk(FIXTURES_PACKAGE_ROOT)) {
    if (path.basename(file) === 'tsconfig.tsbuildinfo') continue; // gitignored build output
    const bytes = readFileSync(file);
    assert.ok(bytes.length <= 64 * 1024, `${path.relative(FIXTURES_PACKAGE_ROOT, file)}: ${bytes.length} B`);
    assert.equal(bytes.indexOf(0), -1, `${file}: contains a NUL byte`);
    assert.doesNotThrow(() => decoder.decode(bytes), `${file}: not valid UTF-8`);
    count += 1;
  }
  assert.ok(count > 10);
});
