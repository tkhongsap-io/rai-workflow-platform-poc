// W4-08a (W4b plan section 11.2 "Grading"; section 11.3 measures): grades the part records of one harness run
// against their labels. Pure: no I/O, no clock.
//
//   - A finding matches a label on `ruleId`, owning lane, scope (kind and slot) and evidence (slot and locator
//     position, in order); matching is a multiset match within one run part. An unmatched finding is a false positive,
//     an unmatched label a false negative. A part that ended unavailable matches no label.
//   - Per rule (every catalogue rule and every labelled rule) and per segment (template, model type, language and
//     format of the cited document; `none` when the finding cites no document).
//   - Unavailable handling: each part's status and reason against its label.
//   - Lane scope (decision 28) and metadata kept beside an unavailable content part (decision 27), as counts.
//   - Grounded citations, latency (nearest-rank p50/p95, max), failures (`runner_error`, `timeout`) and cost.
//
// The output holds identities, locators and counts only: never a finding message, a param or document text.
import type { Lane } from '@rai/shared/constants';
import type { EvidenceLocator, QcFinding, QcTrigger, SlotNumber } from '@rai/shared/qc/types';
import {
  READABLE_FORMATS,
  type LabelFinding,
  type LabelLocator,
  type RunPart,
} from '@rai/fixtures/evaluation/types';
import type { CitationProblem, PartRecord } from './harness.js';
import { canonicalJson } from './identity.js';
import type { LoadedSet } from './load-set.js';

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

export interface RuleGrade extends Counts {
  ruleId: string;
  engine: 'metadata' | 'content' | 'unknown';
  inCatalogue: boolean;
  labelled: number;
  raised: number;
}

export type SegmentDimension = 'template' | 'modelType' | 'language' | 'format';

/** Where a run part sits: its case, trigger, lane and uploaded slot. */
export interface PartIdentity {
  caseId: string;
  trigger: QcTrigger;
  lane: Lane | null;
  slot: SlotNumber | null;
  part: RunPart;
}

/** A finding shape as the grader compares it: identities and locators only. */
export interface GradedShape {
  ruleId: string;
  owningLane: Lane;
  scope: { kind: 'artifact' | 'slot'; slot: SlotNumber } | { kind: 'pack' } | { kind: 'run' };
  evidence: Array<{ slot: SlotNumber | null; locator: LabelLocator | EvidenceLocator }>;
}

export interface FindingMismatch extends PartIdentity, GradedShape {
  kind: 'fp' | 'fn';
}

export interface PartMismatch extends PartIdentity {
  expected: { status: string; reason: string | null };
  actual: { status: string; reason: string | null; detail: string | null };
}

export interface LatencyStats {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface Grade {
  rules: RuleGrade[];
  segments: Record<SegmentDimension, Array<{ value: string } & Counts>>;
  findings: { mismatches: FindingMismatch[] };
  parts: {
    total: number;
    statusMatched: number;
    accuracy: number | null;
    expectedUnavailable: number;
    unavailableMatched: number;
    unavailableAccuracy: number | null;
    mismatches: PartMismatch[];
  };
  laneScope: {
    approveContentParts: number;
    approveContentPartsMatched: number;
    approveContentFindings: number;
    foreignLaneFindings: number;
  };
  metadataKept: { labelled: number; recorded: number; rate: number | null };
  grounding: {
    citations: number;
    grounded: number;
    rate: number | null;
    byRule: Array<{ ruleId: string; citations: number; grounded: number; rate: number | null }>;
    failures: Array<
      PartIdentity & {
        ruleId: string;
        citedSlot: SlotNumber | null;
        locatorKind: string;
        problem: CitationProblem;
      }
    >;
  };
  latency: Record<'overall' | RunPart, LatencyStats>;
  failures: {
    count: number;
    byReason: Partial<Record<'runner_error' | 'timeout', number>>;
    parts: Array<PartIdentity & { reason: string; detail: string | null }>;
  };
  /** Summed from each part's model usage (W4-11b); 0 while no model runs (no provider until D08). */
  cost: { usdMicros: number; modelCalls: number; inputTokens: number; outputTokens: number };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

function counts(tp: number, fp: number, fn: number): Counts {
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

/** Nearest-rank percentile of `values` (`q` in (0, 1]); null for no value. */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
}

function latencyOf(values: number[]): LatencyStats {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

/** The text-free locator a label or a finding names, in one comparable shape. */
function locatorOf(locator: LabelLocator | EvidenceLocator): LabelLocator | EvidenceLocator {
  switch (locator.kind) {
    case 'section':
      return { kind: 'section', index: locator.index } as LabelLocator;
    case 'page':
      return { kind: 'page', page: locator.page };
    case 'cell':
      return { kind: 'cell', sheetIndex: locator.sheetIndex, cell: locator.cell } as LabelLocator;
    case 'text_range':
      return { kind: 'text_range', start: locator.start, end: locator.end };
    case 'absent':
      return { kind: 'absent' };
  }
}

function shapeOfFinding(f: QcFinding): GradedShape {
  const scope: GradedShape['scope'] =
    f.scope.kind === 'artifact' || f.scope.kind === 'slot'
      ? { kind: f.scope.kind, slot: f.scope.slot }
      : { kind: f.scope.kind };
  return {
    ruleId: f.ruleId,
    owningLane: f.owningLane,
    scope,
    evidence: f.evidence.map((e) => ({ slot: e.slot, locator: locatorOf(e.locator) })),
  };
}

function shapeOfLabel(f: LabelFinding): GradedShape {
  return {
    ruleId: f.ruleId,
    owningLane: f.owningLane,
    scope: f.scope.kind === 'pack' ? { kind: 'pack' } : { kind: f.scope.kind, slot: f.scope.slot },
    evidence: f.evidence.map((e) => ({ slot: e.slot, locator: locatorOf(e.locator) })),
  };
}

const keyOf = (s: GradedShape) => canonicalJson(s);

/** The slot a finding is about: its scope slot, else the first evidence slot. */
function citedSlot(s: GradedShape): SlotNumber | null {
  if (s.scope.kind === 'artifact' || s.scope.kind === 'slot') return s.scope.slot;
  return s.evidence.find((e) => e.slot !== null)?.slot ?? null;
}

class Tally {
  private readonly map = new Map<string, { tp: number; fp: number; fn: number }>();
  add(key: string, kind: 'tp' | 'fp' | 'fn'): void {
    const row = this.map.get(key) ?? { tp: 0, fp: 0, fn: 0 };
    row[kind] += 1;
    this.map.set(key, row);
  }
  get(key: string): Counts {
    const row = this.map.get(key) ?? { tp: 0, fp: 0, fn: 0 };
    return counts(row.tp, row.fp, row.fn);
  }
  keys(): string[] {
    return [...this.map.keys()].sort();
  }
}

const identityOf = (p: PartRecord): PartIdentity => ({
  caseId: p.caseId,
  trigger: p.trigger,
  lane: p.lane,
  slot: p.slot,
  part: p.part,
});

export function gradeRun(
  set: Pick<LoadedSet, 'cases'>,
  parts: readonly PartRecord[],
  catalogueRules: ReadonlyArray<{ ruleId: string; engine: 'metadata' | 'content' }>,
): Grade {
  const cases = new Map(set.cases.map((c) => [c.evalCase.caseId, c]));
  const byRule = new Tally();
  const bySegment: Record<SegmentDimension, Tally> = {
    template: new Tally(),
    modelType: new Tally(),
    language: new Tally(),
    format: new Tally(),
  };
  const labelledCount = new Map<string, number>();
  const labelledPart = new Map<string, RunPart>();
  const raisedCount = new Map<string, number>();
  const mismatches: FindingMismatch[] = [];
  const partMismatches: PartMismatch[] = [];
  let statusMatched = 0;
  let expectedUnavailable = 0;
  let unavailableMatched = 0;
  const laneScope = {
    approveContentParts: 0,
    approveContentPartsMatched: 0,
    approveContentFindings: 0,
    foreignLaneFindings: 0,
  };
  const metadataKept = { labelled: 0, recorded: 0 };
  const failures: Grade['failures'] = { count: 0, byReason: {}, parts: [] };
  const cost: Grade['cost'] = { usdMicros: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0 };
  const grounding = new Map<string, { citations: number; grounded: number }>();
  const groundingFailures: Grade['grounding']['failures'] = [];

  for (const p of parts) {
    const loaded = cases.get(p.caseId);
    if (loaded === undefined) throw new Error(`part of unknown case ${p.caseId}`);
    const { evalCase } = loaded;
    const segmentsOf = (s: GradedShape): Record<SegmentDimension, string> => {
      const slot = citedSlot(s);
      const doc = slot === null ? undefined : loaded.documents.get(slot);
      return {
        template: evalCase.checklistTemplateVersion,
        modelType: evalCase.modelType,
        language: doc?.language ?? evalCase.language,
        format: doc?.format ?? 'none',
      };
    };
    const tally = (s: GradedShape, kind: 'tp' | 'fp' | 'fn') => {
      byRule.add(s.ruleId, kind);
      const seg = segmentsOf(s);
      for (const dim of Object.keys(bySegment) as SegmentDimension[]) bySegment[dim].add(seg[dim], kind);
      if (kind !== 'tp') mismatches.push({ kind, ...identityOf(p), ...s });
    };

    // Unavailable handling.
    const expectedReason = p.expected.status === 'unavailable' ? p.expected.unavailableReason : null;
    const matched = p.status === p.expected.status && p.reason === expectedReason;
    if (matched) statusMatched += 1;
    else
      partMismatches.push({
        ...identityOf(p),
        expected: { status: p.expected.status, reason: expectedReason },
        actual: { status: p.status, reason: p.reason, detail: p.detail },
      });
    if (p.expected.status === 'unavailable') {
      expectedUnavailable += 1;
      if (matched) unavailableMatched += 1;
    }

    // Findings.
    const expected = p.expected.findings.map(shapeOfLabel);
    const actual = p.findings.map(shapeOfFinding);
    for (const s of expected) {
      labelledCount.set(s.ruleId, (labelledCount.get(s.ruleId) ?? 0) + 1);
      labelledPart.set(s.ruleId, p.part);
    }
    for (const s of actual) raisedCount.set(s.ruleId, (raisedCount.get(s.ruleId) ?? 0) + 1);
    const open = new Map<string, GradedShape[]>();
    for (const s of expected) open.set(keyOf(s), [...(open.get(keyOf(s)) ?? []), s]);
    let tpHere = 0;
    for (const s of actual) {
      const pending = open.get(keyOf(s));
      if (pending !== undefined && pending.length > 0) {
        pending.pop();
        tally(s, 'tp');
        tpHere += 1;
      } else tally(s, 'fp');
    }
    for (const rest of open.values()) for (const s of rest) tally(s, 'fn');

    // Decision 27: metadata findings of a case with an unreadable slot 1, 2 or 5 are still recorded.
    const unreadable = ([1, 2, 5] as const).some((slot) => {
      const doc = loaded.documents.get(slot);
      return doc !== undefined && !READABLE_FORMATS.includes(doc.format);
    });
    if (p.part === 'deterministic' && unreadable) {
      metadataKept.labelled += expected.length;
      metadataKept.recorded += tpHere;
    }

    // Decision 28: approve-attempt content parts, and content findings owned by another lane.
    if (p.trigger === 'approve_attempt' && p.part === 'content') {
      laneScope.approveContentParts += 1;
      if (matched) laneScope.approveContentPartsMatched += 1;
      laneScope.approveContentFindings += p.findings.length;
      laneScope.foreignLaneFindings += p.findings.filter((f) => f.owningLane !== p.lane).length;
    }

    if (p.status === 'unavailable' && (p.reason === 'runner_error' || p.reason === 'timeout')) {
      failures.count += 1;
      failures.byReason[p.reason] = (failures.byReason[p.reason] ?? 0) + 1;
      failures.parts.push({ ...identityOf(p), reason: p.reason, detail: p.detail });
    }

    if (p.engine?.model !== undefined) {
      cost.modelCalls += 1;
      cost.inputTokens += p.engine.model.inputTokens;
      cost.outputTokens += p.engine.model.outputTokens;
      cost.usdMicros += p.engine.model.costUsdMicros;
    }

    for (const c of p.citations) {
      const row = grounding.get(c.ruleId) ?? { citations: 0, grounded: 0 };
      row.citations += 1;
      if (c.grounded) row.grounded += 1;
      grounding.set(c.ruleId, row);
      if (!c.grounded && c.problem !== null)
        groundingFailures.push({
          ...identityOf(p),
          ruleId: c.ruleId,
          citedSlot: c.slot,
          locatorKind: c.locatorKind,
          problem: c.problem,
        });
    }
  }

  const engines = new Map(catalogueRules.map((r) => [r.ruleId, r.engine]));
  // A labelled rule outside the catalogue takes the engine of the part its labels sit in.
  for (const [ruleId, part] of labelledPart)
    if (!engines.has(ruleId)) engines.set(ruleId, part === 'deterministic' ? 'metadata' : 'content');
  const ruleIds = [...new Set([...engines.keys(), ...labelledCount.keys(), ...raisedCount.keys()])].sort();
  const rules: RuleGrade[] = ruleIds.map((ruleId) => ({
    ruleId,
    engine: engines.get(ruleId) ?? 'unknown',
    inCatalogue: catalogueRules.some((r) => r.ruleId === ruleId),
    labelled: labelledCount.get(ruleId) ?? 0,
    raised: raisedCount.get(ruleId) ?? 0,
    ...byRule.get(ruleId),
  }));
  const segments = Object.fromEntries(
    (Object.keys(bySegment) as SegmentDimension[]).map((dim) => [
      dim,
      bySegment[dim].keys().map((value) => ({ value, ...bySegment[dim].get(value) })),
    ]),
  ) as Grade['segments'];
  const citations = [...grounding.values()].reduce((n, r) => n + r.citations, 0);
  const grounded = [...grounding.values()].reduce((n, r) => n + r.grounded, 0);

  return {
    rules,
    segments,
    findings: { mismatches },
    parts: {
      total: parts.length,
      statusMatched,
      accuracy: ratio(statusMatched, parts.length),
      expectedUnavailable,
      unavailableMatched,
      unavailableAccuracy: ratio(unavailableMatched, expectedUnavailable),
      mismatches: partMismatches,
    },
    laneScope,
    metadataKept: { ...metadataKept, rate: ratio(metadataKept.recorded, metadataKept.labelled) },
    grounding: {
      citations,
      grounded,
      rate: ratio(grounded, citations),
      byRule: [...grounding.keys()].sort().map((ruleId) => {
        const r = grounding.get(ruleId)!;
        return { ruleId, citations: r.citations, grounded: r.grounded, rate: ratio(r.grounded, r.citations) };
      }),
      failures: groundingFailures,
    },
    latency: {
      overall: latencyOf(parts.map((p) => p.latencyMs)),
      deterministic: latencyOf(parts.filter((p) => p.part === 'deterministic').map((p) => p.latencyMs)),
      content: latencyOf(parts.filter((p) => p.part === 'content').map((p) => p.latencyMs)),
    },
    failures,
    cost,
  };
}
