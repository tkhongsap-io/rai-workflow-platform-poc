// `npm run fixtures:eval:generate` (W4b plan sections 11.1 and 16; W4-09a): renders every document of
// `qc-eval-synthetic@1` from the case rows with Node built-ins only, checks each SHA-256 against the committed
// manifest.json, writes the bytes to the gitignored output directory as
// <out>/qc-eval-synthetic@1/<split>/<case>/slot-<n>/<filename> (plus a copy of the manifest) and prints the set
// identity `qc-eval-synthetic@1 <sha256[0:12]>`. `--write-manifest` refreshes the manifest instead of checking it;
// `--out <dir>` overrides the output root. No document byte is committed.
//
// The set hash covers every file of this directory (case rows, renderers, vocabulary, labels, README) except
// manifest.json and tests, followed by the sorted per-document digests, so a changed row, label or rendering
// changes the identity. W4-09b freezes it.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { SlotNumber } from '@rai/shared/qc/types';
import { sha256Hex } from '../generate/blob-layout.js';
import { FIXTURES_PACKAGE_ROOT } from '../manifest.js';
import { EVAL_CASES } from './cases.js';
import { EVAL_SET_NAME, EVAL_SET_VERSION, renderDocument, type RenderedDocument } from './render.js';
import type { EvalCase, EvalFormat, EvalSplit } from './types.js';

export const EVAL_DIR = path.join(FIXTURES_PACKAGE_ROOT, 'src', 'evaluation');
export const EVAL_MANIFEST_PATH = path.join(EVAL_DIR, 'manifest.json');
/** The gitignored output root (rai-web/.local is removed by `npm run reset`). */
export const DEFAULT_EVAL_OUTPUT_DIR = path.resolve(FIXTURES_PACKAGE_ROOT, '..', '.local', 'eval-fixtures');

export interface GeneratedEvalDocument {
  caseId: string;
  split: EvalSplit;
  document: RenderedDocument;
  sha256: string;
}

export interface EvalManifestDocument {
  caseId: string;
  split: EvalSplit;
  slot: SlotNumber;
  format: EvalFormat;
  mediaType: AllowedMediaType;
  filename: string;
  sha256: string;
  sizeBytes: number;
}

export interface EvalManifest {
  name: string;
  version: string;
  sha256: string;
  split: EvalSplit[]; // the splits the set holds
  documents: Record<string, EvalManifestDocument>; // by document id
}

/** Pure: every attached document of every case, in case and slot order. */
export function generateEvalSet(cases: readonly EvalCase[] = EVAL_CASES): GeneratedEvalDocument[] {
  return cases.flatMap((c) =>
    c.slots.flatMap((s) => {
      if (s.disposition !== 'attached') return [];
      const document = renderDocument(s.document);
      return [{ caseId: c.caseId, split: c.split, document, sha256: sha256Hex(document.bytes) }];
    }),
  );
}

/** Relative paths (forward slashes) of the files the set hash covers, sorted. */
export function listEvalSourceFiles(dir: string = EVAL_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = path.join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry !== 'manifest.json' && !entry.endsWith('.test.ts')) out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.map((p) => p.split(path.sep).join('/')).sort();
}

export function computeEvalSetHash(
  documents: Record<string, { sha256: string }>,
  dir: string = EVAL_DIR,
): string {
  const hash = createHash('sha256');
  for (const rel of listEvalSourceFiles(dir)) {
    hash.update(`${rel}\0`);
    hash.update(readFileSync(path.join(dir, rel)));
    hash.update('\0');
  }
  for (const id of Object.keys(documents).sort()) hash.update(`${id} ${documents[id]!.sha256}\n`);
  return hash.digest('hex');
}

export function evalManifestFromGenerated(generated: GeneratedEvalDocument[]): EvalManifest {
  const documents: Record<string, EvalManifestDocument> = {};
  for (const g of generated)
    documents[g.document.documentId] = {
      caseId: g.caseId,
      split: g.split,
      slot: g.document.slot,
      format: g.document.format,
      mediaType: g.document.mediaType,
      filename: g.document.filename,
      sha256: g.sha256,
      sizeBytes: g.document.bytes.length,
    };
  const split = [...new Set(generated.map((g) => g.split))].sort();
  return {
    name: EVAL_SET_NAME,
    version: EVAL_SET_VERSION,
    sha256: computeEvalSetHash(documents),
    split,
    documents,
  };
}

export function readEvalManifest(file: string = EVAL_MANIFEST_PATH): EvalManifest {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as EvalManifest;
  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.version !== 'string' ||
    typeof parsed.sha256 !== 'string' ||
    !Array.isArray(parsed.split) ||
    typeof parsed.documents !== 'object'
  )
    throw new Error(`${file}: not an evaluation set manifest`);
  return parsed;
}

/** The manifest as written: two-space JSON with the short `split` list on one line, as prettier formats it. */
export function formatEvalManifest(manifest: EvalManifest): string {
  return `${JSON.stringify(manifest, null, 2).replace(/"split": \[[^\]]*\]/, `"split": ${JSON.stringify(manifest.split).replace(/,/g, ', ')}`)}\n`;
}

export function evalSetLabel(manifest: Pick<EvalManifest, 'name' | 'version' | 'sha256'>): string {
  return `${manifest.name}@${manifest.version} ${manifest.sha256.slice(0, 12)}`;
}

export class EvalManifestMismatch extends Error {
  constructor(readonly differences: string[]) {
    super(
      `fixtures/src/evaluation/manifest.json does not match the generated set:\n  ${differences.join('\n  ')}`,
    );
    this.name = 'EvalManifestMismatch';
  }
}

export function assertEvalManifestMatches(manifest: EvalManifest, generated: GeneratedEvalDocument[]): void {
  const expected = evalManifestFromGenerated(generated);
  const differences: string[] = [];
  if (manifest.name !== expected.name || manifest.version !== expected.version)
    differences.push(
      `identity: manifest ${manifest.name}@${manifest.version}, code ${expected.name}@${expected.version}`,
    );
  if (JSON.stringify(manifest.split) !== JSON.stringify(expected.split))
    differences.push(`split: manifest ${manifest.split.join(',')}, generated ${expected.split.join(',')}`);
  const ids = new Set([...Object.keys(manifest.documents), ...Object.keys(expected.documents)]);
  for (const id of [...ids].sort()) {
    const a = manifest.documents[id];
    const b = expected.documents[id];
    if (a === undefined) differences.push(`${id}: generated but not in the manifest`);
    else if (b === undefined) differences.push(`${id}: in the manifest but not generated`);
    else if (JSON.stringify(a) !== JSON.stringify(b))
      differences.push(
        `${id}: manifest ${a.sha256.slice(0, 12)} (${a.sizeBytes} B), generated ${b.sha256.slice(0, 12)} (${b.sizeBytes} B)`,
      );
  }
  if (manifest.sha256 !== expected.sha256)
    differences.push(
      `set sha256: manifest ${manifest.sha256.slice(0, 12)}, computed ${expected.sha256.slice(0, 12)}`,
    );
  if (differences.length > 0) throw new EvalManifestMismatch(differences);
}

export function evalOutputPath(root: string, g: GeneratedEvalDocument): string {
  return path.join(
    root,
    `${EVAL_SET_NAME}@${EVAL_SET_VERSION}`,
    g.split,
    g.caseId,
    `slot-${g.document.slot}`,
    g.document.filename,
  );
}

export async function writeEvalSet(
  generated: GeneratedEvalDocument[],
  manifest: EvalManifest,
  root: string = DEFAULT_EVAL_OUTPUT_DIR,
): Promise<void> {
  for (const g of generated) {
    const file = evalOutputPath(root, g);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, g.document.bytes);
  }
  const setDir = path.join(root, `${EVAL_SET_NAME}@${EVAL_SET_VERSION}`);
  await mkdir(setDir, { recursive: true });
  await writeFile(path.join(setDir, 'manifest.json'), formatEvalManifest(manifest));
}

async function main(argv: string[]): Promise<void> {
  const outIndex = argv.indexOf('--out');
  const root =
    outIndex >= 0 && argv[outIndex + 1] !== undefined
      ? path.resolve(argv[outIndex + 1]!)
      : DEFAULT_EVAL_OUTPUT_DIR;
  const generated = generateEvalSet();
  let manifest: EvalManifest;
  if (argv.includes('--write-manifest')) {
    manifest = evalManifestFromGenerated(generated);
    await writeFile(EVAL_MANIFEST_PATH, formatEvalManifest(manifest));
    console.log(`fixtures:eval:generate: wrote ${path.relative(process.cwd(), EVAL_MANIFEST_PATH)}`);
  } else {
    manifest = readEvalManifest();
    assertEvalManifestMatches(manifest, generated);
  }
  await writeEvalSet(generated, manifest, root);
  const total = generated.reduce((n, g) => n + g.document.bytes.length, 0);
  console.log(
    `fixtures:eval:generate: wrote ${generated.length} documents (${total} bytes) to ${path.relative(process.cwd(), root) || '.'}`,
  );
  console.log(`fixtures:eval:generate: ${evalSetLabel(manifest)}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
