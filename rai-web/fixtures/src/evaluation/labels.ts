// Reads the provisional labels of `qc-eval-synthetic@1` (labels/<caseId>.json; W4b plan section 11.1). The labels
// were written by the agent team under Ta's delegation of 2026-09-27 and are unsigned: the lane experts and the
// AI/COE lead sign when D09 names them (decision 14b). A label is never changed to fit a runner's output; a
// disagreement is recorded (W4-09b, disagreements.md).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURES_PACKAGE_ROOT } from '../manifest.js';
import type { CaseLabels } from './types.js';

export const LABELS_DIR = path.join(FIXTURES_PACKAGE_ROOT, 'src', 'evaluation', 'labels');

export function readCaseLabels(caseId: string, dir: string = LABELS_DIR): CaseLabels {
  const parsed = JSON.parse(readFileSync(path.join(dir, `${caseId}.json`), 'utf8')) as CaseLabels;
  if (parsed.caseId !== caseId || !Array.isArray(parsed.runs))
    throw new Error(`labels/${caseId}.json: not the labels of ${caseId}`);
  return parsed;
}

/** Every label file, by case id. */
export function readAllLabels(dir: string = LABELS_DIR): Map<string, CaseLabels> {
  const out = new Map<string, CaseLabels>();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const caseId = file.slice(0, -'.json'.length);
    out.set(caseId, readCaseLabels(caseId, dir));
  }
  return out;
}
