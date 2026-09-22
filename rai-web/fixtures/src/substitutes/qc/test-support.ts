// Builders for the W1-10 unit tests: a QcRunRequest shaped like the orchestrator's (W0-07 3.3) for a W0-08 fixture
// case, with synthetic artifact references whose `read()` records every call. Test-only; imported by *.test.ts.

import type { Lane } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcRunRequest,
  QcTrigger,
  SlotDisposition,
  SlotNumber,
  SlotState,
} from '@rai/shared/qc/types';

export interface FixtureCaseShape {
  fixtureCaseId: string;
  checklistTemplateVersion: string;
  stageContext: QcRunRequest['stageContext'];
  modelType: QcRunRequest['modelType'];
  vendorInvolved: boolean;
  slots: Partial<Record<SlotNumber, SlotDisposition>>; // omitted slots are `missing`
}

/** The W0-08 section 8.3 cases as the orchestrator would present them (dispositions only; bytes are synthetic). */
export const FIXTURE_CASES: Record<string, FixtureCaseShape> = {
  'fx-case-nonvendor': {
    fixtureCaseId: 'fx-case-nonvendor',
    checklistTemplateVersion: 'v1.0 Sheet3',
    stageContext: 'pre_launch',
    modelType: 'classic_ml',
    vendorInvolved: false,
    slots: {
      1: 'attached',
      2: 'attached',
      3: 'not_applicable',
      4: 'not_applicable',
      5: 'attached',
      6: 'attached',
      7: 'attached',
      8: 'attached',
      9: 'attached',
    },
  },
  'fx-case-vendor': {
    fixtureCaseId: 'fx-case-vendor',
    checklistTemplateVersion: 'v2.0',
    stageContext: 'pre_launch',
    modelType: 'llm',
    vendorInvolved: true,
    slots: {
      1: 'attached',
      2: 'attached',
      3: 'attached',
      4: 'attached',
      5: 'attached',
      6: 'attached',
      7: 'attached',
      8: 'attached',
      9: 'attached',
    },
  },
  'fx-case-missing-slot': {
    fixtureCaseId: 'fx-case-missing-slot',
    checklistTemplateVersion: 'v1.0 Sheet3',
    stageContext: 'pre_build',
    modelType: 'classic_ml',
    vendorInvolved: false,
    slots: {
      1: 'attached',
      2: 'attached',
      3: 'not_applicable',
      4: 'not_applicable',
      5: 'attached',
      6: 'attached',
      7: 'missing',
      8: 'not_yet',
      9: 'attached',
    },
  },
  'fx-case-na-reasons': {
    fixtureCaseId: 'fx-case-na-reasons',
    checklistTemplateVersion: 'v1.0 Sheet3',
    stageContext: 'idea',
    modelType: 'llm',
    vendorInvolved: true,
    slots: {
      1: 'attached',
      2: 'attached',
      3: 'attached',
      4: 'not_applicable',
      5: 'attached',
      6: 'attached',
      7: 'attached',
      8: 'not_yet',
      9: 'not_applicable',
    },
  },
  'fx-case-hr-dualrole': {
    fixtureCaseId: 'fx-case-hr-dualrole',
    checklistTemplateVersion: 'v1.0 Sheet3',
    stageContext: 'pre_launch',
    modelType: 'classic_ml',
    vendorInvolved: false,
    slots: {
      1: 'attached',
      2: 'attached',
      3: 'not_applicable',
      4: 'not_applicable',
      5: 'attached',
      6: 'attached',
      7: 'attached',
      8: 'attached',
      9: 'not_yet',
    },
  },
};

const ALL_SLOTS: SlotNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const LANE_SLOTS: Record<Lane, SlotNumber[]> = {
  ai_coe: [1, 5],
  dpo: [2, 3, 4, 5],
  it_security: [5, 6, 7, 8],
};

/** Deterministic synthetic sha256 for a (case, slot) pair; never a real document hash. */
export function syntheticHash(fixtureCaseId: string, slot: number): string {
  const seed = `${fixtureCaseId}:${slot}`;
  let out = '';
  for (let i = 0; out.length < 64; i += 1) {
    const code = seed.charCodeAt(i % seed.length) + i * 7;
    out += (code % 16).toString(16);
  }
  return out;
}

/** The synthetic artifact row id the loader would mint; a UUID-shaped string, not the fixture doc id. */
export function syntheticArtifactId(fixtureCaseId: string, slot: number): string {
  const n = fixtureCaseId.length.toString(16).padStart(4, '0');
  return `00000000-0000-4000-8000-${n}0000000${slot}`;
}

export interface BuiltRequest {
  request: QcRunRequest;
  reads: { slot: SlotNumber; artifactId: string }[]; // every `read()` invocation, for the no-write-path test
}

export interface BuildOptions {
  trigger: QcTrigger;
  lane?: Lane;
  uploadSlot?: SlotNumber; // for `upload`: the one slot the run is scoped to
  caseId?: string; // defaults to the fixture case id (the default resolver)
  versionId?: string;
  qcRulesRevision?: string;
}

export function buildRequest(fixtureCaseId: string, options: BuildOptions): BuiltRequest {
  const shape = FIXTURE_CASES[fixtureCaseId];
  if (shape === undefined) throw new Error(`unknown fixture case ${fixtureCaseId}`);
  const reads: BuiltRequest['reads'] = [];
  const scopedSlots: SlotNumber[] =
    options.trigger === 'upload'
      ? [options.uploadSlot ?? 1]
      : options.trigger === 'approve_attempt'
        ? LANE_SLOTS[options.lane ?? 'ai_coe']
        : ALL_SLOTS;
  const slots: SlotState[] = scopedSlots.map((slot) => {
    const disposition = shape.slots[slot] ?? 'missing';
    return {
      slot,
      disposition,
      reason: disposition === 'not_applicable' ? 'slot.na.reason.non_vendor_default' : null,
      artifactId: disposition === 'attached' ? syntheticArtifactId(fixtureCaseId, slot) : null,
    };
  });
  const artifacts: AuthorizedArtifactRef[] = slots
    .filter((s) => s.disposition === 'attached')
    .map((s) => ({
      artifactId: s.artifactId!,
      slot: s.slot,
      contentHash: syntheticHash(fixtureCaseId, s.slot),
      mediaType: 'application/pdf',
      filename: `synthetic-${fixtureCaseId}-${s.slot}.pdf`,
      byteLength: 1024,
      read: () => {
        reads.push({ slot: s.slot, artifactId: s.artifactId! });
        return Promise.resolve(new ReadableStream<Uint8Array>());
      },
    }));
  const versionId = options.versionId ?? `${fixtureCaseId}-v1`;
  const request: QcRunRequest = {
    correlationId: '11111111-1111-4111-8111-111111111111',
    runKey: `runkey-${fixtureCaseId}-${options.trigger}-${options.lane ?? '-'}`,
    trigger: options.trigger,
    lane: options.trigger === 'approve_attempt' ? (options.lane ?? 'ai_coe') : null,
    version: {
      caseId: options.caseId ?? fixtureCaseId,
      versionId,
      versionNumber: 1,
      isDraft: options.trigger === 'upload',
    },
    checklistTemplateVersion: shape.checklistTemplateVersion,
    qcRulesRevision: options.qcRulesRevision ?? 'cfg-rev-0001',
    laneMappingVersion: 'lane-mapping/v1',
    stageContext: shape.stageContext,
    modelType: shape.modelType,
    vendorInvolved: shape.vendorInvolved,
    slots,
    artifacts,
    deadlineMs: 10_000,
  };
  return { request, reads };
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
