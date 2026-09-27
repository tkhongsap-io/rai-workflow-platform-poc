// Types of the synthetic QC evaluation set `qc-eval-synthetic@1` (W4b plan section 11.1; W4-09a dev split). The
// case rows, the rendered documents and the expected runs are data; the harness (W4-08a) reads them. Locators here
// follow the W4-16 contract (decision 21): ordinals and A1 references, never document text.

import type { Lane } from '@rai/shared/constants';
import type { ModelType, SlotNumber, StageContext } from '@rai/shared/qc/types';

export type EvalSplit = 'dev'; // W4-09b adds 'heldout'
export type EvalLanguage = 'en' | 'th';
export type TemplateVersion = 'v1.0 Sheet3' | 'v2.0';

/**
 * How a document is written. Text formats: `docx`, `xlsx`, `pdf` (no filter), `pdf_flate` (FlateDecode). Scanned:
 * `png`, `pdf_image` (an image XObject, no text operator). `pdf_cid`: Thai in a Type0 Identity-H font with no
 * ToUnicode (not decodable, plan section 4.3). Malformed: `pdf_broken_xref`, `docx_doctype`.
 */
export type EvalFormat =
  | 'docx'
  | 'xlsx'
  | 'pdf'
  | 'pdf_flate'
  | 'png'
  | 'pdf_image'
  | 'pdf_cid'
  | 'pdf_broken_xref'
  | 'docx_doctype';

export const READABLE_FORMATS: readonly EvalFormat[] = Object.freeze(['docx', 'xlsx', 'pdf', 'pdf_flate']);
export const SCANNED_FORMATS: readonly EvalFormat[] = Object.freeze(['png', 'pdf_image']);
export const MALFORMED_FORMATS: readonly EvalFormat[] = Object.freeze(['pdf_broken_xref', 'docx_doctype']);

/** A claim's item: the checklist items the content rules judge and the two pack facts (plan section 3.3). */
export type ClaimItem =
  'hallucination' | 'accuracy' | 'classic_ml_performance' | 'personal_data' | 'external_vendor';

/** One claim, rendered under the dev grammar (vocabulary.ts). Absent fields are not written. */
export interface Claim {
  item: ClaimItem;
  ref: string; // the checklist item number, `^\d+(\.\d+){0,3}$`
  answer: 'yes' | 'no' | 'na';
  metric?: string;
  value?: string; // as written, e.g. '0.4%' or '0.91'
  denominator?: string;
  threshold?: string;
  evidence?: string;
  tier?: 'high' | 'medium' | 'low';
}

export type Block = { text: string } | { claim: Claim };

export interface EvalDocument {
  documentId: string; // `<case id>-s<slot>`
  slot: SlotNumber;
  format: EvalFormat;
  language: EvalLanguage;
  filename: string; // NFC
  /** Pages (PDF), sheets (XLSX) or consecutive paragraphs (DOCX). The renderer prepends the provenance preamble. */
  pages: Block[][];
}

export type EvalSlotState =
  | { slot: SlotNumber; disposition: 'attached'; document: EvalDocument }
  | { slot: SlotNumber; disposition: 'not_applicable'; reason: string }
  | { slot: SlotNumber; disposition: 'missing' | 'not_yet' };

/** A probe the case carries for W4-10a (plan section 12). */
export type ProbeTag = 'approval_injection' | 'exfiltration' | 'template_leakage';

export interface EvalCase {
  caseId: string;
  split: EvalSplit;
  title: string; // one line, what the case exercises
  checklistTemplateVersion: TemplateVersion;
  modelType: ModelType;
  stageContext: StageContext;
  vendorInvolved: boolean;
  language: EvalLanguage;
  slots: EvalSlotState[]; // all nine, in slot order
  probes?: ProbeTag[];
  /** Semantic fixture-list items the case stands for (the rest of the coverage is read from the data). */
  exercises?: SemanticItem[];
}

export type SemanticItem =
  | 'conflicting_brd_privacy'
  | 'extraction_only_yes'
  | 'valid_metric_evidence'
  | `band_${'high' | 'medium' | 'low'}_${'below' | 'equal' | 'above'}`
  | 'band_tier_missing'
  | 'v2_no_v1_bands';

// ---- labels ----------------------------------------------------------------------------------------------------

export type LabelLocator =
  | { kind: 'section'; index: number }
  | { kind: 'cell'; sheetIndex: number; cell: string }
  | { kind: 'page'; page: number }
  | { kind: 'absent' };

export interface LabelEvidence {
  slot: SlotNumber;
  locator: LabelLocator;
}

export type LabelScope =
  { kind: 'artifact'; slot: SlotNumber } | { kind: 'slot'; slot: SlotNumber } | { kind: 'pack' };

export interface LabelFinding {
  ruleId: string;
  owningLane: Lane;
  scope: LabelScope;
  evidence: LabelEvidence[];
  fact?: 'personal_data' | 'external_vendor'; // PACK-CONTRADICTION only: the claim key (decision 30)
}

export type RunPart = 'deterministic' | 'content';

export type LabelPartOutcome =
  | { status: 'completed'; findings: LabelFinding[] }
  | {
      status: 'unavailable';
      unavailableReason: 'artifact_unreadable' | 'timeout' | 'runner_error';
      findings: [];
    };

export type LabelRun =
  | { trigger: 'upload'; slot: SlotNumber; lane: null; parts: Record<RunPart, LabelPartOutcome> }
  | { trigger: 'submit'; lane: null; parts: Record<RunPart, LabelPartOutcome> }
  | { trigger: 'approve_attempt'; lane: Lane; parts: Record<RunPart, LabelPartOutcome> };

export const LABELLED_BY =
  'agent-team, provisional (Ta delegation 2026-09-27); lane-expert sign-off pending (D09)' as const;

export interface CaseLabels {
  caseId: string;
  split: EvalSplit;
  labelledBy: typeof LABELLED_BY;
  runs: LabelRun[];
}
