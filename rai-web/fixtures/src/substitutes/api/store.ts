// W1-13: the in-memory state of the API substitute, built from the W1-09 fixture tables (cases, documents), the
// W1-00 fixture identities and the W1-00 configuration seed, exactly as `fixtures:load` would put them in
// Postgres: five cases in `draft`, one open draft each with the nine W0-08 8.3 slot dispositions, 33 artifact
// rows whose bytes are generated on demand from the same generator the loader uses, no submitted version, no
// decision, no finding (W0-08 8.1 rule 4). `reset()` rebuilds it. Everything else (sessions, uploads, versions,
// idempotency records) is added by the routes at run time and lost when the process ends.

import { FIXTURE_CASES, type FixtureCase, type FixtureSlotDisposition } from '../../data/cases/index.js';
import {
  FIXTURE_DOCUMENTS,
  MEDIA_TYPE_BY_KIND,
  findFixtureDocument,
  type FixtureDocument,
} from '../../data/documents/index.js';
import { FIXTURE_BUSINESS_UNITS, FIXTURE_USERS, type FixtureUser } from '../../data/users.js';
import { fixtureUuid } from '../../data/ids.js';
import { generateDocument } from '../../generate.js';
import { readManifest, type FixtureManifest } from '../../manifest.js';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { APP_TIMEZONE } from '@rai/shared/constants';
import type { CaseId, ConfigurationRevisionId, SubjectId } from '@rai/shared/ids';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type {
  CaseStatus,
  CaseWritableFields,
  ConfigurationView,
  LaneProjectionStatus,
  ReadinessProjectionStatus,
  RiskTier,
} from '@rai/shared/schemas/cases';
import { type PackDraft, type SlotNumber, type SlotState } from '@rai/shared/schemas/pack';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { RecordedLogLine, SubstituteSession } from './types.js';
import { asContractMediaType, asContractModelType, asContractStageContext } from './contract-cast.js';

/** The instant the fixture rows carry (`created_at`, `uploaded_at`); fixed so every read is reproducible. */
export const FIXTURE_LOADED_AT = '2026-09-21T00:00:00.000Z';
export const FIXTURE_CONFIGURATION_PUBLISHED_AT = '2026-09-20T23:59:59.000Z';
export const FIXTURE_CONFIGURATION_REVISION_ID = fixtureUuid('configuration/1') as ConfigurationRevisionId;

export interface StoredCase {
  caseId: CaseId;
  registryId: string;
  fields: CaseWritableFields;
  status: CaseStatus;
  riskTier: RiskTier | null;
  privacyStatus: LaneProjectionStatus;
  securityStatus: LaneProjectionStatus;
  raiStatus: LaneProjectionStatus;
  aiReadinessStatus: ReadinessProjectionStatus;
  caseRevision: number; // W0-04 case.row_version
  createdBy: SubjectId;
  createdAt: string;
  updatedAt: string;
  draft: PackDraft | null; // the one open draft, or null once submitted (W2 reopens with a successor)
  versions: SubmittedVersion[]; // ascending by versionNumber; never mutated after push (immutable, A07)
}

export interface StoredArtifact {
  ref: ArtifactRef;
  bytes: () => Uint8Array; // generated on first read for fixture documents; held in memory for uploads
}

export interface IdempotencyRecord {
  digest: string;
  status: number;
  body: Uint8Array;
}

export class SubstituteStore {
  readonly users: readonly FixtureUser[] = FIXTURE_USERS;
  readonly businessUnitIds: ReadonlySet<string> = new Set(
    FIXTURE_BUSINESS_UNITS.map((b) => b.businessUnitId),
  );
  readonly configuration: ConfigurationView;
  readonly manifest: FixtureManifest;
  sessions = new Map<string, SubstituteSession>();
  cases = new Map<string, StoredCase>();
  artifacts = new Map<string, StoredArtifact>();
  idempotency = new Map<string, IdempotencyRecord>();
  /** Every log line the substitute emitted (`authz.denied` and friends), for tests; never written anywhere. */
  logLines: RecordedLogLine[] = [];
  private registryCounter = 0;

  constructor() {
    this.manifest = readManifest();
    this.configuration = Object.freeze({
      revisionId: FIXTURE_CONFIGURATION_REVISION_ID,
      publishedAt: FIXTURE_CONFIGURATION_PUBLISHED_AT,
      useCaseGroups: [...CONFIGURATION_SEED.use_case_groups.groups],
      checklistTemplateVersions: [...CONFIGURATION_SEED.checklist_templates.versions],
      slaWorkingDays: { ...CONFIGURATION_SEED.sla },
      timezone: APP_TIMEZONE,
    });
    this.reset();
  }

  /** Rebuilds the fixture state; drops every session, upload, version and idempotency record. */
  reset(): void {
    this.sessions.clear();
    this.cases.clear();
    this.artifacts.clear();
    this.idempotency.clear();
    this.logLines = [];
    this.registryCounter = 0;
    for (const document of FIXTURE_DOCUMENTS)
      this.artifacts.set(document.artifactId, this.fixtureArtifact(document));
    for (const fixtureCase of FIXTURE_CASES)
      this.cases.set(fixtureCase.caseId, this.fixtureCase(fixtureCase));
  }

  findUser(fixtureUserId: string): FixtureUser | undefined {
    return this.users.find((u) => u.fixtureUserId === fixtureUserId);
  }

  subjectExists(subjectId: string): boolean {
    return this.users.some((u) => u.subjectId === subjectId);
  }

  /** `RAI-<yyyy>-<nnnn>`, desk-local and unique; fixtures use the reserved year 2000 so the two never collide. */
  nextRegistryId(now: Date): string {
    this.registryCounter += 1;
    return `RAI-${now.getUTCFullYear()}-${String(this.registryCounter).padStart(4, '0')}`;
  }

  private fixtureArtifact(document: FixtureDocument): StoredArtifact {
    const owner = FIXTURE_USERS.find((u) => u.fixtureUserId === 'fx-user-owner-cm');
    const manifestRow = this.manifest.documents[document.fixtureDocumentId];
    const fixtureCase = FIXTURE_CASES.find((c) => c.caseNumber === document.caseNumber);
    if (owner === undefined || manifestRow === undefined || fixtureCase === undefined)
      throw new Error(`fixture document ${document.fixtureDocumentId} is not in the manifest or has no case`);
    let cached: Uint8Array | undefined;
    return {
      ref: {
        artifactId: document.artifactId,
        caseId: fixtureCase.caseId,
        sha256: manifestRow.sha256,
        filename: document.filename,
        mediaType: asContractMediaType(MEDIA_TYPE_BY_KIND[document.kind]),
        sizeBytes: manifestRow.sizeBytes,
        uploadedBy: owner.subjectId,
        uploadedAt: FIXTURE_LOADED_AT,
      },
      bytes: () => {
        cached ??= new Uint8Array(generateDocument(document));
        return cached;
      },
    };
  }

  private fixtureCase(fixtureCase: FixtureCase): StoredCase {
    const owner = FIXTURE_USERS.find((u) => u.fixtureUserId === fixtureCase.ownerFixtureUserId);
    if (owner === undefined) throw new Error(`${fixtureCase.fixtureCaseId}: owner is not a fixture user`);
    const slots = {} as Record<SlotNumber, SlotState>;
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const)
      slots[slot] = toSlotState(fixtureCase.slots[slot]);
    return {
      caseId: fixtureCase.caseId,
      registryId: fixtureCase.registryId,
      fields: {
        useCaseName: fixtureCase.useCaseName,
        businessUnitId: fixtureCase.businessUnitId,
        businessUnit: fixtureCase.businessUnit,
        businessOwner: owner.subjectId,
        technicalOwner: fixtureCase.technicalOwner,
        sourceRecordId: fixtureCase.sourceRecordId, // stored and read back unchanged (L10); AIR-FX-* is synthetic
        useCaseGroup: fixtureCase.useCaseGroup,
        vendorInvolved: fixtureCase.vendorInvolved,
        modelType: asContractModelType(fixtureCase.modelType),
      },
      status: 'draft',
      riskTier: null,
      privacyStatus: 'pending',
      securityStatus: 'pending',
      raiStatus: 'pending',
      aiReadinessStatus: 'not_ready',
      caseRevision: 1,
      createdBy: owner.subjectId,
      createdAt: FIXTURE_LOADED_AT,
      updatedAt: FIXTURE_LOADED_AT,
      draft: {
        draftId: fixtureCase.draftVersionId,
        caseId: fixtureCase.caseId,
        versionNumber: 1,
        parentVersionId: null,
        checklistTemplateVersion: fixtureCase.checklistTemplateVersion,
        stageContext: asContractStageContext(fixtureCase.stageContext),
        slots,
        draftRevision: 1,
        updatedAt: FIXTURE_LOADED_AT,
      },
      versions: [],
    };
  }
}

function toSlotState(disposition: FixtureSlotDisposition): SlotState {
  switch (disposition.state) {
    case 'attached': {
      const document = findFixtureDocument(disposition.fixtureDocumentId);
      if (document === undefined)
        throw new Error(`unknown fixture document ${disposition.fixtureDocumentId}`);
      return { state: 'attached', artifactId: document.artifactId };
    }
    case 'not_yet':
      return { state: 'not_yet' };
    case 'missing':
      return { state: 'missing' };
    case 'not_applicable':
      return { state: 'not_applicable', reason: disposition.reason };
  }
}
