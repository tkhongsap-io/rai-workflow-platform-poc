// W4-03 test support (unit tests only): a synthetic `QcRunRequest` with nine slot states and the seeded `w5.1`
// selection for its trigger. Artifacts refuse `read()`, so a rule that touched document bytes would fail the test.
// Synthetic values only; no fixture document is involved.
import { CURRENT_LANE_MAPPING, type Lane } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcRunRequest,
  QcTrigger,
  SelectedRule,
  SlotDisposition,
  SlotNumber,
  SlotState,
  StageContext,
} from '@rai/shared/qc/types';
import { CONFIGURATION_SEED } from '../../configuration/seed.js';
import { selectRules } from '../select.js';

export const REVISION = '0192a0de-0000-7000-8000-00000000c0de';
export const TEMPLATE = 'v1.0 Sheet3';

const hashOf = (slot: number) => slot.toString(16).padStart(64, 'a');
export const artifactIdOf = (slot: number) => `00000000-0000-7000-8000-${String(slot).padStart(12, '0')}`;

export class ReadRefused extends Error {
  constructor() {
    super('the deterministic runner must never read document bytes');
  }
}

export interface RequestShape {
  trigger?: QcTrigger;
  lane?: Lane | null;
  stage?: StageContext;
  vendor?: boolean;
  /** Dispositions by slot; every other slot is `attached`. */
  slots?: Partial<Record<SlotNumber, SlotDisposition>>;
  rules?: SelectedRule[] | null;
  /** W5-10: the version's submit proposal; defaults to null (no proposal, as for a version submitted before W5). */
  riskProposal?: QcRunRequest['riskProposal'];
  reads?: { count: number };
}

export function seededRules(trigger: QcTrigger, modelType: QcRunRequest['modelType'] = 'llm') {
  return selectRules(CONFIGURATION_SEED.qc_rules, TEMPLATE, trigger, modelType);
}

export function requestOf(shape: RequestShape = {}): QcRunRequest {
  const trigger = shape.trigger ?? 'submit';
  const slots: SlotState[] = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((slot) => {
    const disposition = shape.slots?.[slot] ?? 'attached';
    return {
      slot,
      disposition,
      reason: disposition === 'not_applicable' ? 'synthetic reason' : null,
      artifactId: disposition === 'attached' ? artifactIdOf(slot) : null,
    };
  });
  const artifacts: AuthorizedArtifactRef[] = slots
    .filter((s) => s.disposition === 'attached')
    .map((s) => ({
      artifactId: artifactIdOf(s.slot),
      slot: s.slot,
      contentHash: hashOf(s.slot),
      mediaType: 'application/pdf',
      filename: `synthetic-${s.slot}.pdf`,
      byteLength: 1024,
      read: () => {
        if (shape.reads !== undefined) shape.reads.count += 1;
        return Promise.reject(new ReadRefused());
      },
    }));
  return {
    correlationId: '00000000-0000-4000-8000-000000000001',
    runKey: 'f'.repeat(64),
    trigger,
    lane: shape.lane ?? (trigger === 'approve_attempt' ? 'dpo' : null),
    version: {
      caseId: '00000000-0000-7000-8000-00000000ca5e',
      versionId: '00000000-0000-7000-8000-000000000001',
      versionNumber: 1,
      isDraft: trigger === 'upload',
    },
    checklistTemplateVersion: TEMPLATE,
    qcRulesRevision: REVISION,
    laneMappingVersion: CURRENT_LANE_MAPPING.version,
    stageContext: shape.stage ?? 'pre_build',
    modelType: 'llm',
    vendorInvolved: shape.vendor ?? false,
    slots,
    artifacts,
    deadlineMs: Date.parse('2026-09-27T05:00:10Z'),
    rules: shape.rules === undefined ? seededRules(trigger) : shape.rules,
    riskProposal: shape.riskProposal ?? null,
  };
}

/** The one rule of the seeded selection with this ID, for a single-rule request. */
export function onlyRule(ruleId: string, trigger: QcTrigger = 'submit'): SelectedRule[] {
  const rule = seededRules(trigger).find((r) => r.ruleId === ruleId);
  if (rule === undefined) throw new Error(`${ruleId} is not selected for ${trigger}`);
  return [rule];
}
