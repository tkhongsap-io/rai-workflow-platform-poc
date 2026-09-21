// `npm run fixtures:generate` (W0-02 section 3.3; W0-08 8.5): builds the W0-08 8.4 documents from the data tables
// with Node built-ins only, writes them to the gitignored output directory as <outputDir>/<fixture id>/<filename>,
// checks every SHA-256 against data/manifest.json and prints the fixture set identity. `--write-manifest`
// refreshes the manifest instead of checking it (a change to any fixture bumps `version` in the same PR; the
// script never bumps it by itself). `--out <dir>` overrides the output directory.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_DOCUMENTS,
  FIXTURE_SENTINEL,
  FIXTURE_THAI_LINE,
  documentTextLines,
  type FixtureDocument,
} from './data/documents/index.js';
import { buildDocx, buildXlsx } from './generate/ooxml.js';
import { buildJpeg } from './generate/jpeg.js';
import { buildPdf, PDF_MEDIUM_TARGET_BYTES } from './generate/pdf.js';
import { buildPng } from './generate/png.js';
import { sha256Hex } from './generate/blob-layout.js';
import {
  DEFAULT_OUTPUT_DIR,
  MANIFEST_PATH,
  computeSetHash,
  fixtureSetLabel,
  readManifest,
  type FixtureManifest,
} from './manifest.js';

export interface GeneratedDocument {
  document: FixtureDocument;
  bytes: Buffer;
  sha256: string;
}

/** Pure: the bytes of one fixture document. The same row always yields the same bytes (W0-08 8.1 rule 3). */
export function generateDocument(document: FixtureDocument): Buffer {
  const lines = documentTextLines(document);
  const asciiLines = lines.filter((l) => l !== FIXTURE_THAI_LINE);
  switch (document.kind) {
    case 'pdf':
      return buildPdf({
        asciiLines,
        thaiLine: FIXTURE_THAI_LINE,
        title: `${FIXTURE_SENTINEL} ${document.fixtureDocumentId}`,
        filler:
          document.sizeClass === 'medium'
            ? { targetBytes: PDF_MEDIUM_TARGET_BYTES, seed: document.fixtureDocumentId }
            : undefined,
      });
    case 'docx':
      return buildDocx(lines);
    case 'xlsx':
      return buildXlsx(lines);
    case 'png':
      // tEXt is Latin-1: the ASCII lines go there (sentinel first); the Thai line goes in an iTXt chunk.
      return buildPng({ comment: asciiLines.join('\n'), thaiLine: FIXTURE_THAI_LINE });
    case 'jpeg':
      return buildJpeg(lines.join('\n'));
  }
}

export function generateAll(documents: readonly FixtureDocument[] = FIXTURE_DOCUMENTS): GeneratedDocument[] {
  return documents.map((document) => {
    const bytes = generateDocument(document);
    return { document, bytes, sha256: sha256Hex(bytes) };
  });
}

export function outputPathFor(outputDir: string, document: FixtureDocument): string {
  return path.join(outputDir, document.fixtureDocumentId, document.filename);
}

export async function writeGeneratedDocuments(
  generated: GeneratedDocument[],
  outputDir: string = DEFAULT_OUTPUT_DIR,
): Promise<void> {
  for (const g of generated) {
    const file = outputPathFor(outputDir, g.document);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, g.bytes);
  }
}

/** True when every document file the manifest lists exists in outputDir (the loader's "output absent" check). */
export function outputIsPresent(
  outputDir: string,
  documents: readonly FixtureDocument[] = FIXTURE_DOCUMENTS,
): boolean {
  return documents.every((d) => existsSync(outputPathFor(outputDir, d)));
}

export function manifestFromGenerated(
  generated: GeneratedDocument[],
  identity: Pick<FixtureManifest, 'name' | 'version'>,
): FixtureManifest {
  const documents: FixtureManifest['documents'] = {};
  for (const g of generated)
    documents[g.document.fixtureDocumentId] = {
      filename: g.document.filename,
      sha256: g.sha256,
      sizeBytes: g.bytes.length,
    };
  return { name: identity.name, version: identity.version, sha256: computeSetHash(documents), documents };
}

export class ManifestMismatch extends Error {
  constructor(readonly differences: string[]) {
    super(`data/manifest.json does not match the generated documents:\n  ${differences.join('\n  ')}`);
    this.name = 'ManifestMismatch';
  }
}

/** Compares the manifest with the generated set; throws ManifestMismatch listing every difference. */
export function assertManifestMatches(manifest: FixtureManifest, generated: GeneratedDocument[]): void {
  const expected = manifestFromGenerated(generated, manifest);
  const differences: string[] = [];
  const ids = new Set([...Object.keys(manifest.documents), ...Object.keys(expected.documents)]);
  for (const id of [...ids].sort()) {
    const a = manifest.documents[id];
    const b = expected.documents[id];
    if (a === undefined) differences.push(`${id}: generated but not in the manifest`);
    else if (b === undefined) differences.push(`${id}: in the manifest but not generated`);
    else if (a.sha256 !== b.sha256 || a.sizeBytes !== b.sizeBytes || a.filename !== b.filename)
      differences.push(
        `${id}: manifest ${a.sha256.slice(0, 12)} (${a.sizeBytes} B), generated ${b.sha256.slice(0, 12)} (${b.sizeBytes} B)`,
      );
  }
  if (manifest.sha256 !== expected.sha256)
    differences.push(
      `set sha256: manifest ${manifest.sha256.slice(0, 12)}, computed ${expected.sha256.slice(0, 12)}`,
    );
  if (differences.length > 0) throw new ManifestMismatch(differences);
}

async function main(argv: string[]): Promise<void> {
  const writeManifest = argv.includes('--write-manifest');
  const outIndex = argv.indexOf('--out');
  const outputDir =
    outIndex >= 0 && argv[outIndex + 1] !== undefined
      ? path.resolve(argv[outIndex + 1]!)
      : DEFAULT_OUTPUT_DIR;
  const generated = generateAll();
  const current = readManifest();
  let manifest: FixtureManifest;
  if (writeManifest) {
    manifest = manifestFromGenerated(generated, current);
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`fixtures:generate: wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  } else {
    assertManifestMatches(current, generated);
    manifest = current;
  }
  await writeGeneratedDocuments(generated, outputDir);
  const total = generated.reduce((n, g) => n + g.bytes.length, 0);
  console.log(
    `fixtures:generate: wrote ${generated.length} documents (${total} bytes) to ${path.relative(process.cwd(), outputDir) || '.'}`,
  );
  console.log(`fixtures:generate: ${fixtureSetLabel(manifest)}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
