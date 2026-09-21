// `npm run fixtures:load` (W0-02 section 3.3; W0-08 section 8.7): loads the fixture set into an EMPTY database
// inside one transaction and refuses a non-empty one, any NODE_ENV outside development/test and any
// RAI_IDENTITY_MODE outside local-google/fixture (W0-08 8.1 rule 5). W1-00 created it with the configuration
// seed; W1-09 adds the five W0-08 8.3 cases, one open draft each, the nine artifact_slot rows per draft, the
// objects under BLOB_DIR (W0-04 layout) and their artifact rows, and the fixture_set row. The fixture identities
// live in the fixture identity provider (users.ts), not in a table.
//
// Fixtures never fake a transition (W0-08 8.1 rule 4): no submitted version, lane decision, finding or disposition
// is ever inserted, and no audit event is written for the fixture rows themselves (the only audit events after a
// load are the seed's configuration.published rows). A journey that needs a submitted version submits through the
// real transition.
//
// `--reset` runs `npm run reset` (db:down, db:up, migrate, this loader, empty rai-web/.local) and exits with its
// status; the inner loader run carries no flag, so there is no recursion.

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb, schema, type Db, type Tx } from '@rai/server/db/client';
import { withTransaction } from '@rai/server/db/transaction';
import { applyConfigurationSeed, SEED_KINDS } from '@rai/server/configuration/seed';
import { parseDatabaseConfig, parseNodeEnv, readEnv, type Env } from '@rai/server/config';
import { FIXTURE_CASES, fixtureCaseOwner, storedReason, type FixtureCase } from './data/cases/index.js';
import { FIXTURE_DOCUMENTS, MEDIA_TYPE_BY_KIND, findFixtureDocument } from './data/documents/index.js';
import { Readable } from 'node:stream';
import { createFilesystemBlobStore } from '@rai/server/artifacts/blob-store';
import {
  assertManifestMatches,
  generateAll,
  outputIsPresent,
  writeGeneratedDocuments,
  type GeneratedDocument,
} from './generate.js';
import { DEFAULT_OUTPUT_DIR, fixtureSetLabel, readManifest, type FixtureManifest } from './manifest.js';

/** The set identity as committed in data/manifest.json (name, version and hash). */
export const FIXTURE_SET: Readonly<Pick<FixtureManifest, 'name' | 'version' | 'sha256'>> = Object.freeze(
  (({ name, version, sha256 }) => ({ name, version, sha256 }))(readManifest()),
);

export const LOADER_IDENTITY_MODES = ['local-google', 'fixture'] as const;

export class FixturesRefused extends Error {
  constructor(reason: string) {
    super(`fixtures:load refused: ${reason}`);
    this.name = 'FixturesRefused';
  }
}

export async function databaseIsEmpty(db: Db): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT (SELECT count(*) FROM "case") + (SELECT count(*) FROM configuration_revision) + (SELECT count(*) FROM audit_event) + (SELECT count(*) FROM artifact) + (SELECT count(*) FROM fixture_set) AS n`,
  );
  return Number((result.rows[0] as { n: string }).n) === 0;
}

export interface LoadOptions {
  nodeEnv: string;
  identityMode: string;
  /** BLOB_DIR: the objects are written under `<blobDir>/sha256/` in the W0-04 layout. */
  blobDir: string;
  /** Where `fixtures:generate` writes the documents; generated here when absent. Default rai-web/.local/fixtures. */
  outputDir?: string;
  now?: Date;
}

export interface LoadResult {
  fixtureSet: string; // `fixture set <name>@<version> <sha256[0:12]>`
  publishedKinds: string[];
  cases: number;
  drafts: number;
  slots: number;
  artifacts: number;
  blobsWritten: number;
  blobsDeduplicated: number;
  correlationId: string;
}

/**
 * Loads the fixture set into an empty database. `publishedAt` for the seed is one second in the past so a
 * submission made right after loading is "after the publish time" under the provisional activation rule.
 */
export async function loadFixtures(db: Db, options: LoadOptions): Promise<LoadResult> {
  if (options.nodeEnv !== 'development' && options.nodeEnv !== 'test')
    throw new FixturesRefused(`NODE_ENV=${options.nodeEnv}`);
  if (!(LOADER_IDENTITY_MODES as readonly string[]).includes(options.identityMode))
    throw new FixturesRefused(
      `RAI_IDENTITY_MODE=${options.identityMode} (fixtures exist only in local-google and fixture mode)`,
    );
  if (!(await databaseIsEmpty(db))) throw new FixturesRefused('database is not empty (run npm run reset)');

  // Generate (deterministic, in memory), check against the committed manifest, write the output when absent.
  const manifest = readManifest();
  const generated = generateAll();
  assertManifestMatches(manifest, generated);
  const outputDir = options.outputDir ?? DEFAULT_OUTPUT_DIR;
  if (!outputIsPresent(outputDir)) await writeGeneratedDocuments(generated, outputDir);

  // Objects first (W0-04: the blob is committed before its row; an orphan object after a failed transaction is
  // harmless, a row without an object is not), then one transaction for every row.
  // Through the same blob interface uploads use (W0-08 8.7; the W1-09 review handed this one call site to W1-03).
  const store = createFilesystemBlobStore(options.blobDir);
  const byDocumentId = new Map<string, GeneratedDocument>();
  let blobsWritten = 0;
  let blobsDeduplicated = 0;
  for (const g of generated) {
    const written = await store.put(Readable.from([g.bytes]), { maxBytes: g.bytes.length });
    if (!written.ok) throw new Error(`${g.document.fixtureDocumentId}: blob store refused the object`);
    if (written.deduplicated) blobsDeduplicated += 1;
    else blobsWritten += 1;
    byDocumentId.set(g.document.fixtureDocumentId, g);
  }

  const correlationId = randomUUID();
  const now = options.now ?? new Date();
  const publishedAt = new Date(now.getTime() - 1000);
  const counts = { slots: 0, artifacts: 0 };
  await withTransaction(db, async (tx) => {
    await applyConfigurationSeed(tx, { correlationId, publishedAt });
    for (const fixtureCase of FIXTURE_CASES) {
      const inserted = await insertCase(tx, fixtureCase, byDocumentId, { correlationId, now });
      counts.slots += inserted.slots;
      counts.artifacts += inserted.artifacts;
    }
    await tx.insert(schema.fixtureSet).values({
      name: manifest.name,
      version: manifest.version,
      sha256: manifest.sha256,
      loadedAt: now,
      correlationId,
    });
  });

  return {
    fixtureSet: fixtureSetLabel(manifest),
    publishedKinds: [...SEED_KINDS],
    cases: FIXTURE_CASES.length,
    drafts: FIXTURE_CASES.length,
    slots: counts.slots,
    artifacts: counts.artifacts,
    blobsWritten,
    blobsDeduplicated,
    correlationId,
  };
}

async function insertCase(
  tx: Tx,
  fixtureCase: FixtureCase,
  generated: Map<string, GeneratedDocument>,
  run: { correlationId: string; now: Date },
): Promise<{ slots: number; artifacts: number }> {
  const owner = fixtureCaseOwner(fixtureCase);
  await tx.insert(schema.cases).values({
    id: fixtureCase.caseId,
    registryId: fixtureCase.registryId,
    sourceRecordId:
      fixtureCase.sourceRecordId.kind === 'known' ? fixtureCase.sourceRecordId.value : 'Unknown',
    useCaseName: fixtureCase.useCaseName,
    businessUnit: fixtureCase.businessUnit,
    businessOwner: owner.displayName,
    technicalOwner: fixtureCase.technicalOwner,
    useCaseGroup: fixtureCase.useCaseGroup,
    vendorInvolved: fixtureCase.vendorInvolved,
    modelType: fixtureCase.modelType,
    ownerSubjectId: owner.subjectId,
    businessUnitId: fixtureCase.businessUnitId,
    deskStatus: 'draft',
    currentVersionId: null,
    draftVersionId: fixtureCase.draftVersionId, // deferrable FK: the draft row follows in this transaction
    createdBy: owner.subjectId,
    createdAt: run.now,
    updatedAt: run.now,
  });
  await tx.insert(schema.packVersion).values({
    id: fixtureCase.draftVersionId,
    caseId: fixtureCase.caseId,
    versionNumber: 1,
    parentVersionId: null,
    createdBy: owner.subjectId,
    createdAt: run.now,
    stageContext: fixtureCase.stageContext,
    checklistTemplateVersion: fixtureCase.checklistTemplateVersion,
    // everything submit-only stays NULL: this is an open draft, never a fabricated submission (W0-08 8.1 rule 4)
  });

  let artifacts = 0;
  let slots = 0;
  for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
    const disposition = fixtureCase.slots[slot];
    let artifactId: string | null = null;
    if (disposition.state === 'attached') {
      const document = findFixtureDocument(disposition.fixtureDocumentId);
      const bytes = generated.get(disposition.fixtureDocumentId);
      if (document === undefined || bytes === undefined)
        throw new Error(
          `${fixtureCase.fixtureCaseId} slot ${slot}: unknown document ${disposition.fixtureDocumentId}`,
        );
      if (document.caseNumber !== fixtureCase.caseNumber || document.slot !== slot)
        throw new Error(
          `${disposition.fixtureDocumentId} does not belong to ${fixtureCase.fixtureCaseId} slot ${slot}`,
        );
      await tx.insert(schema.artifact).values({
        id: document.artifactId,
        contentHash: bytes.sha256,
        sizeBytes: bytes.bytes.length,
        filename: document.filename,
        mediaType: MEDIA_TYPE_BY_KIND[document.kind],
        uploadedBy: owner.subjectId,
        uploadedRole: 'owner',
        uploadedAt: run.now,
        caseId: fixtureCase.caseId,
        correlationId: run.correlationId,
        bytesState: 'present',
      });
      artifactId = document.artifactId;
      artifacts += 1;
    }
    await tx.insert(schema.artifactSlot).values({
      id: randomUUID(),
      versionId: fixtureCase.draftVersionId,
      slot,
      state: disposition.state,
      reason: storedReason(disposition),
      artifactId,
      updatedBy: owner.subjectId,
      updatedAt: run.now,
    });
    slots += 1;
  }
  return { slots, artifacts };
}

/** Every document row is referenced by exactly one attached slot; exported for the fixtures test. */
export function attachedDocumentIds(): string[] {
  return FIXTURE_CASES.flatMap((c) =>
    Object.values(c.slots).flatMap((d) => (d.state === 'attached' ? [d.fixtureDocumentId] : [])),
  ).sort();
}

function identityModeFromEnv(env: Env): string {
  return env.RAI_IDENTITY_MODE?.trim() ?? '';
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--reset')) {
    const result = spawnSync('npm', ['run', 'reset'], { stdio: 'inherit', env: process.env });
    process.exit(result.status ?? 1);
  }
  const env = readEnv();
  const nodeEnv = parseNodeEnv(env);
  const identityMode = identityModeFromEnv(env);
  const blobDir = env.BLOB_DIR?.trim();
  if (blobDir === undefined || blobDir === '') throw new FixturesRefused('BLOB_DIR is not set');
  const { operatorUrl } = parseDatabaseConfig(env);
  const handle = createDb(operatorUrl, { max: 2 });
  try {
    const result = await loadFixtures(handle.db, { nodeEnv, identityMode, blobDir: path.resolve(blobDir) });
    console.log(`fixtures:load: ${result.fixtureSet}`);
    console.log(`fixtures:load: published configuration revisions: ${result.publishedKinds.join(', ')}`);
    console.log(
      `fixtures:load: ${result.cases} cases, ${result.drafts} open drafts, ${result.slots} slot rows, ${result.artifacts} artifacts; ${result.blobsWritten} objects written, ${result.blobsDeduplicated} already present under ${path.relative(process.cwd(), blobDir) || '.'}`,
    );
    console.log(
      `fixtures:load: ${FIXTURE_DOCUMENTS.length} documents in the set; correlation id ${result.correlationId}`,
    );
  } finally {
    await handle.close();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
