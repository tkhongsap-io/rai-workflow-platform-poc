// W4-06a test support (unit tests only): a synthetic `QcRunRequest` whose attached artifacts stream real bytes with a
// matching sha256, and a recording fake `Extractor`. The bytes of an artifact are a JSON envelope `{ slot, segments }`,
// so the fake extractor returns the segments the test chose and records which slot it was asked to read. Synthetic
// text only; no fixture document is involved.
import { createHash } from 'node:crypto';
import { CURRENT_LANE_MAPPING, type Lane } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcRunRequest,
  QcTrigger,
  SelectedRule,
  SlotDisposition,
  SlotNumber,
  SlotState,
} from '@rai/shared/qc/types';
import { CONFIGURATION_SEED } from '../../configuration/seed.js';
import type { ExtractFailureReason, ExtractResult, Extractor, Segment } from '../extraction/port.js';
import { selectRules } from '../select.js';

export const REVISION = '0192a0de-0000-7000-8000-00000000c0de';
export const TEMPLATE = 'v1.0 Sheet3';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const EXTRACTOR_VERSION = 'rai-extract/1+test';
const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const artifactIdOf = (slot: number) => `00000000-0000-7000-8000-${String(slot).padStart(12, '0')}`;

/** What an attached slot holds: segments (the default envelope), a failure the fake answers, or raw bytes. */
export type SlotDocument =
  | Segment[]
  | { fail: ExtractFailureReason }
  | { throws: true }
  | { mediaType: string; segments?: Segment[] }
  | { bytes: Uint8Array; declaredHash?: string; declaredLength?: number }
  | { readRejects: true };

export interface RequestShape {
  trigger?: QcTrigger;
  lane?: Lane | null;
  /** Dispositions by slot; every other slot is `attached`. */
  slots?: Partial<Record<SlotNumber, SlotDisposition>>;
  /** Documents by attached slot; an attached slot without one holds no claims. */
  documents?: Partial<Record<SlotNumber, SlotDocument>>;
  /** For `upload`: the one slot the request carries (default 1). */
  uploadSlot?: SlotNumber;
  rules?: SelectedRule[] | null;
  templateVersion?: string;
  /** Counts `read()` calls by slot. */
  reads?: Map<number, number>;
}

function envelope(slot: number, document: SlotDocument | undefined): Uint8Array {
  const body =
    document === undefined || Array.isArray(document)
      ? { slot, segments: document ?? [] }
      : 'fail' in document
        ? { slot, fail: document.fail }
        : 'throws' in document
          ? { slot, throws: true }
          : 'mediaType' in document
            ? { slot, segments: document.segments ?? [] }
            : { slot, segments: [] };
  return new TextEncoder().encode(JSON.stringify(body));
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  // Two chunks, so the runner has to join them.
  const cut = Math.floor(bytes.length / 2);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function artifactOf(slot: SlotNumber, shape: RequestShape): AuthorizedArtifactRef {
  const document = shape.documents?.[slot];
  const raw =
    document !== undefined && !Array.isArray(document) && 'bytes' in document ? document : undefined;
  const bytes = raw?.bytes ?? envelope(slot, document);
  const mediaType =
    document !== undefined && !Array.isArray(document) && 'mediaType' in document ? document.mediaType : DOCX;
  const rejects = document !== undefined && !Array.isArray(document) && 'readRejects' in document;
  return {
    artifactId: artifactIdOf(slot),
    slot,
    contentHash: raw?.declaredHash ?? sha256(bytes),
    mediaType,
    filename: `synthetic-${slot}.docx`,
    byteLength: raw?.declaredLength ?? bytes.length,
    read: () => {
      shape.reads?.set(slot, (shape.reads.get(slot) ?? 0) + 1);
      if (rejects) {
        const error = new Error('synthetic: blob missing');
        error.name = 'BlobMissingError';
        return Promise.reject(error);
      }
      return Promise.resolve(streamOf(bytes));
    },
  };
}

export function seededRules(trigger: QcTrigger, template = TEMPLATE): SelectedRule[] {
  return selectRules(CONFIGURATION_SEED.qc_rules, template, trigger, 'llm');
}

/** The seeded selection for the trigger, restricted to these rule IDs (content rules W4-06a implements). */
export function onlyRules(trigger: QcTrigger, ...ruleIds: string[]): SelectedRule[] {
  const rules = seededRules(trigger).filter((r) => ruleIds.includes(r.ruleId));
  if (rules.length !== ruleIds.length) throw new Error(`${ruleIds.join()} not all selected for ${trigger}`);
  return rules;
}

export function requestOf(shape: RequestShape = {}): QcRunRequest {
  const trigger = shape.trigger ?? 'approve_attempt';
  const carried: readonly SlotNumber[] = trigger === 'upload' ? [shape.uploadSlot ?? 1] : ALL_SLOTS;
  const slots: SlotState[] = carried.map((slot) => {
    const disposition = shape.slots?.[slot] ?? 'attached';
    return {
      slot,
      disposition,
      reason: disposition === 'not_applicable' ? 'synthetic reason' : null,
      artifactId: disposition === 'attached' ? artifactIdOf(slot) : null,
    };
  });
  const artifacts = slots.filter((s) => s.disposition === 'attached').map((s) => artifactOf(s.slot, shape));
  return {
    correlationId: '00000000-0000-4000-8000-000000000001',
    runKey: 'f'.repeat(64),
    trigger,
    lane: shape.lane === undefined ? (trigger === 'approve_attempt' ? 'ai_coe' : null) : shape.lane,
    version: {
      caseId: '00000000-0000-7000-8000-00000000ca5e',
      versionId: '00000000-0000-7000-8000-000000000001',
      versionNumber: 1,
      isDraft: trigger === 'upload',
    },
    checklistTemplateVersion: shape.templateVersion ?? TEMPLATE,
    qcRulesRevision: REVISION,
    laneMappingVersion: CURRENT_LANE_MAPPING.version,
    stageContext: 'pre_build',
    modelType: 'llm',
    vendorInvolved: false,
    slots,
    artifacts,
    deadlineMs: Date.parse('2026-09-27T05:00:10Z'),
    rules: shape.rules === undefined ? onlyRules(trigger, 'ACC-METRIC-CITED') : shape.rules,
  };
}

export interface RecordingExtractor extends Extractor {
  /** The slot of every `extract` call, in call order. */
  readonly calls: number[];
}

/** A fake `Extractor` over the JSON envelope: it answers what the test put in the slot and records the slot. */
export function recordingExtractor(): RecordingExtractor {
  const calls: number[] = [];
  return {
    version: EXTRACTOR_VERSION,
    calls,
    extract(input): Promise<ExtractResult> {
      const parsed = JSON.parse(new TextDecoder().decode(input.bytes)) as {
        slot: number;
        segments?: Segment[];
        fail?: ExtractFailureReason;
        throws?: true;
      };
      calls.push(parsed.slot);
      if (parsed.throws === true) return Promise.reject(new Error('synthetic extractor bug'));
      if (parsed.fail !== undefined)
        return Promise.resolve({ ok: false, extractorVersion: EXTRACTOR_VERSION, reason: parsed.fail });
      return Promise.resolve({
        ok: true,
        extractorVersion: EXTRACTOR_VERSION,
        segments: parsed.segments ?? [],
      });
    },
    selfTest: () => Promise.resolve(true),
  };
}

// ---- synthetic claims under the dev grammar (fixtures/src/evaluation/vocabulary.ts) -------------------------------

/** A claim's fields; `undefined` leaves the field out (the tests spread a complete claim and blank one field). */
export type ClaimFields = Partial<
  Record<
    'item' | 'question' | 'answer' | 'metric' | 'value' | 'denominator' | 'threshold' | 'evidence' | 'tier',
    string | undefined
  >
>;

export const COMPLETE_HALLUCINATION: ClaimFields = {
  item: '2.1',
  question: 'Hallucination rate measured on the evaluation set?',
  answer: 'Yes',
  metric: 'hallucination_rate',
  value: '0.4%',
  denominator: '500',
  threshold: '1%',
  evidence: 'eval-report-21',
  tier: 'high',
};

export const COMPLETE_ACCURACY: ClaimFields = {
  item: '2.2',
  question: 'Answer accuracy measured on the evaluation set?',
  answer: 'Yes',
  metric: 'accuracy',
  value: '96%',
  denominator: '500',
  threshold: '90%',
  evidence: 'eval-report-22',
};

/** A DOCX paragraph (section locator) in the dev `key: value; ...` rendering; undefined fields are left out. */
export function claimParagraph(index: number, fields: ClaimFields): Segment {
  const text = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
  return { locator: { kind: 'section', index }, text };
}
