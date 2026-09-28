// W4-08a (W4b plan section 11.2): loads one split of `qc-eval-synthetic@1` for the harness. The documents are rendered
// in memory (the renderers are deterministic) and checked against the committed manifest, so a run always grades the
// exact bytes the set identity names; nothing is read from or written to `.local/`. Synthetic data only.
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { SlotNumber } from '@rai/shared/qc/types';
import { EVAL_CASES } from '@rai/fixtures/evaluation/cases';
import {
  assertEvalManifestMatches,
  evalSetLabel,
  generateEvalSet,
  readEvalManifest,
} from '@rai/fixtures/evaluation/generate';
import { readAllLabels } from '@rai/fixtures/evaluation/labels';
import type { CaseLabels, EvalCase, EvalFormat, EvalLanguage } from '@rai/fixtures/evaluation/types';

export interface LoadedDocument {
  documentId: string;
  slot: SlotNumber;
  format: EvalFormat;
  language: EvalLanguage;
  mediaType: AllowedMediaType;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface LoadedCase {
  evalCase: EvalCase;
  labels: CaseLabels;
  /** The attached documents by slot. */
  documents: ReadonlyMap<SlotNumber, LoadedDocument>;
}

export interface LoadedSet {
  name: string;
  version: string;
  sha256: string;
  /** `qc-eval-synthetic@1 <sha256[0:12]>`, the line every evidence record cites. */
  label: string;
  split: string;
  cases: LoadedCase[];
}

/** A split the set does not hold (the held-out split arrives with W4-09b). */
export class EvalSplitUnavailable extends Error {
  constructor(
    readonly split: string,
    held: readonly string[],
  ) {
    super(`split ${split} is not in the evaluation set (it holds: ${held.join(', ')})`);
    this.name = 'EvalSplitUnavailable';
  }
}

export function loadEvalSet(split: string): LoadedSet {
  const manifest = readEvalManifest();
  if (!(manifest.split as string[]).includes(split)) throw new EvalSplitUnavailable(split, manifest.split);
  const generated = generateEvalSet();
  assertEvalManifestMatches(manifest, generated); // throws EvalManifestMismatch
  const byDocument = new Map(generated.map((g) => [g.document.documentId, g]));
  const labels = readAllLabels();
  const cases: LoadedCase[] = [];
  for (const evalCase of EVAL_CASES) {
    if (evalCase.split !== split) continue;
    const caseLabels = labels.get(evalCase.caseId);
    if (caseLabels === undefined) throw new Error(`no labels for ${evalCase.caseId}`);
    const documents = new Map<SlotNumber, LoadedDocument>();
    for (const s of evalCase.slots) {
      if (s.disposition !== 'attached') continue;
      const g = byDocument.get(s.document.documentId);
      if (g === undefined) throw new Error(`${s.document.documentId} was not rendered`);
      documents.set(s.slot, {
        documentId: g.document.documentId,
        slot: s.slot,
        format: g.document.format,
        language: s.document.language,
        mediaType: g.document.mediaType,
        filename: g.document.filename,
        bytes: new Uint8Array(g.document.bytes),
        sha256: g.sha256,
      });
    }
    cases.push({ evalCase, labels: caseLabels, documents });
  }
  return {
    name: manifest.name,
    version: manifest.version,
    sha256: manifest.sha256,
    label: evalSetLabel(manifest),
    split,
    cases,
  };
}
