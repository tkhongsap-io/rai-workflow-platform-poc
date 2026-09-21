// The fixture set identity (W0-02 section 8.3; W0-08 8.1 rule 6): data/manifest.json carries
// `{ name, version, sha256, documents }`. `sha256` is computed here over the sorted data files (everything under
// data/ except manifest.json and *.test.ts, keyed by relative path) followed by the sorted per-document digests, so
// a change to a case, a document row, a user, or the generator's output changes the hash; the same PR bumps
// `version`. Every evidence record cites `fixture set <name>@<version> <sha256[0:12]>`.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES_PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES_DATA_DIR = path.join(FIXTURES_PACKAGE_ROOT, 'src', 'data');
export const MANIFEST_PATH = path.join(FIXTURES_DATA_DIR, 'manifest.json');
/** The gitignored output directory `fixtures:generate` writes to (rai-web/.local is removed by `npm run reset`). */
export const DEFAULT_OUTPUT_DIR = path.resolve(FIXTURES_PACKAGE_ROOT, '..', '.local', 'fixtures');

export interface ManifestDocument {
  filename: string;
  sha256: string;
  sizeBytes: number;
}

export interface FixtureManifest {
  name: string;
  version: string;
  sha256: string;
  documents: Record<string, ManifestDocument>; // by fixture document id
}

export function readManifest(file: string = MANIFEST_PATH): FixtureManifest {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as FixtureManifest;
  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.version !== 'string' ||
    typeof parsed.sha256 !== 'string' ||
    typeof parsed.documents !== 'object'
  )
    throw new Error(`${file}: not a fixture manifest`);
  return parsed;
}

/** Relative paths (forward slashes) of the data files the set hash covers, sorted. */
export function listDataFiles(dataDir: string = FIXTURES_DATA_DIR): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry !== 'manifest.json' && !entry.endsWith('.test.ts'))
        out.push(path.relative(dataDir, full));
    }
  };
  walk(dataDir);
  return out.map((p) => p.split(path.sep).join('/')).sort();
}

export function computeSetHash(
  documentDigests: Record<string, { sha256: string }>,
  dataDir: string = FIXTURES_DATA_DIR,
): string {
  const hash = createHash('sha256');
  for (const rel of listDataFiles(dataDir)) {
    hash.update(`${rel}\0`);
    hash.update(readFileSync(path.join(dataDir, rel)));
    hash.update('\0');
  }
  for (const id of Object.keys(documentDigests).sort()) hash.update(`${id} ${documentDigests[id]!.sha256}\n`);
  return hash.digest('hex');
}

export function fixtureSetLabel(manifest: Pick<FixtureManifest, 'name' | 'version' | 'sha256'>): string {
  return `fixture set ${manifest.name}@${manifest.version} ${manifest.sha256.slice(0, 12)}`;
}
