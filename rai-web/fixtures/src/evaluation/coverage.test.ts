// W4-09a done-when: every item on the evaluation plan's fixture list has at least one dev case (W4b plan section
// 11.1 "Coverage"; docs/evaluation/plan.md "Planned fixtures"). Format, language, template, model type and slot
// states are read from the case rows; only the semantic items (a band relation, a contradiction) are tagged, and
// each tag is checked against the claims the case actually holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SlotNumber, StageContext } from '@rai/shared/qc/types';
import { EVAL_CASES } from './cases.js';
import {
  MALFORMED_FORMATS,
  READABLE_FORMATS,
  SCANNED_FORMATS,
  type Claim,
  type EvalCase,
  type EvalDocument,
  type SemanticItem,
} from './types.js';

const dev = EVAL_CASES.filter((c) => c.split === 'dev');

function documents(c: EvalCase): EvalDocument[] {
  return c.slots.flatMap((s) => (s.disposition === 'attached' ? [s.document] : []));
}

function claims(d: EvalDocument): Claim[] {
  return d.pages.flat().flatMap((b) => ('claim' in b ? [b.claim] : []));
}

function slotDoc(c: EvalCase, slot: SlotNumber): EvalDocument | undefined {
  const s = c.slots.find((x) => x.slot === slot);
  return s?.disposition === 'attached' ? s.document : undefined;
}

/** Exact decimal comparison of two short percent strings ('1.5%' vs '1%'), as scaled integers. */
function comparePercent(a: string, b: string): number {
  const scale = (v: string): bigint => {
    const [i, f = ''] = v.replace('%', '').split('.');
    return BigInt(i!) * 10_000n + BigInt(f.padEnd(4, '0'));
  };
  const x = scale(a);
  const y = scale(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

test('every case has all nine slots in order, a unique id, and documents with unique ids', () => {
  const ids = new Set<string>();
  const docIds = new Set<string>();
  for (const c of EVAL_CASES) {
    assert.ok(!ids.has(c.caseId), c.caseId);
    ids.add(c.caseId);
    assert.deepEqual(
      c.slots.map((s) => s.slot),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    for (const d of documents(c)) {
      assert.ok(!docIds.has(d.documentId), d.documentId);
      docIds.add(d.documentId);
      assert.equal(d.documentId, `${c.caseId}-s${d.slot}`);
    }
    for (const s of c.slots) if (s.disposition === 'not_applicable') assert.ok(s.reason.length > 0);
  }
  assert.ok(dev.length >= 20);
});

test('Thai and English: cases and readable DOCX and XLSX documents in each language', () => {
  for (const language of ['en', 'th'] as const) {
    assert.ok(
      dev.some((c) => c.language === language),
      language,
    );
    for (const format of ['docx', 'xlsx'] as const)
      assert.ok(
        dev.some((c) =>
          documents(c).some((d) => d.language === language && d.format === format && claims(d).length > 0),
        ),
        `${language} ${format} with a claim`,
      );
  }
});

test('formats: DOCX, XLSX, text-layer PDF (plain and FlateDecode), scanned PNG and image-only PDF, malformed, CID-font Thai PDF', () => {
  const formats = new Set(dev.flatMap((c) => documents(c).map((d) => d.format)));
  for (const f of [...READABLE_FORMATS, ...SCANNED_FORMATS, ...MALFORMED_FORMATS, 'pdf_cid'] as const)
    assert.ok(formats.has(f), f);
  const cid = dev.flatMap(documents).find((d) => d.format === 'pdf_cid')!;
  assert.equal(cid.language, 'th', 'the CID-font PDF carries Thai text');
  assert.ok(
    dev.some((c) => documents(c).some((d) => d.format.startsWith('pdf') && d.pages.length >= 3)),
    'a multi-page PDF',
  );
  assert.ok(
    dev.some((c) => documents(c).some((d) => d.format === 'xlsx' && d.pages.length >= 2)),
    'a multi-sheet XLSX',
  );
});

test('templates v1.0 Sheet3 and v2.0; model types llm, classic_ml and other', () => {
  for (const v of ['v1.0 Sheet3', 'v2.0'] as const)
    assert.ok(
      dev.some((c) => c.checklistTemplateVersion === v),
      v,
    );
  for (const m of ['llm', 'classic_ml', 'other'] as const)
    assert.ok(
      dev.some((c) => c.modelType === m),
      m,
    );
});

test('missing, not-yet and N/A on a lane-gated slot against each stage', () => {
  for (const stage of ['idea', 'pre_build', 'pre_launch'] as StageContext[])
    for (const disposition of ['missing', 'not_yet', 'not_applicable'] as const)
      assert.ok(
        dev.some(
          (c) =>
            c.stageContext === stage && c.slots.some((s) => s.slot !== 9 && s.disposition === disposition),
        ),
        `${stage} ${disposition}`,
      );
});

test('conflicting BRD (slot 5) and privacy checklist (slot 2) entries on the same fact', () => {
  const conflicting = dev.filter((c) => c.exercises?.includes('conflicting_brd_privacy'));
  assert.ok(conflicting.length >= 1);
  for (const c of conflicting) {
    const facts = (slot: SlotNumber): Map<string, string> =>
      new Map(claims(slotDoc(c, slot)!).map((x) => [x.item, x.answer]));
    const a = facts(2);
    const b = facts(5);
    assert.ok(
      [...a].some(([item, answer]) => b.has(item) && b.get(item) !== answer),
      `${c.caseId}: slots 2 and 5 disagree on a fact`,
    );
  }
});

test('extraction-only "Yes" and valid metric evidence', () => {
  const extraction = dev.filter((c) => c.exercises?.includes('extraction_only_yes'));
  assert.ok(extraction.length >= 1);
  for (const c of extraction)
    assert.ok(
      claims(slotDoc(c, 1)!).some(
        (x) => x.item === 'hallucination' && x.answer === 'yes' && x.metric === 'extraction_accuracy',
      ),
      c.caseId,
    );
  const valid = dev.filter((c) => c.exercises?.includes('valid_metric_evidence'));
  assert.ok(valid.length >= 1);
  for (const c of valid)
    for (const x of claims(slotDoc(c, 1)!))
      for (const field of ['metric', 'value', 'denominator', 'threshold', 'evidence'] as const)
        assert.ok(x[field] !== undefined, `${c.caseId}: ${field}`);
});

test('band values below, equal and above each tier on v1.0 (llm), a missing tier, and v2.0 never inheriting the bands', () => {
  const band = { high: '1%', medium: '2%', low: '3%' } as const;
  for (const tier of ['high', 'medium', 'low'] as const)
    for (const [relation, sign] of [
      ['below', -1],
      ['equal', 0],
      ['above', 1],
    ] as const) {
      const item = `band_${tier}_${relation}` as SemanticItem;
      const cases = dev.filter((c) => c.exercises?.includes(item));
      assert.ok(cases.length >= 1, item);
      for (const c of cases) {
        assert.equal(c.checklistTemplateVersion, 'v1.0 Sheet3', `${c.caseId} ${item}`);
        assert.notEqual(c.modelType, 'classic_ml', `${c.caseId} ${item}`);
        assert.ok(
          claims(slotDoc(c, 1)!).some(
            (x) =>
              x.metric === 'hallucination_rate' &&
              x.tier === tier &&
              x.value !== undefined &&
              comparePercent(x.value, band[tier]) === sign,
          ),
          `${c.caseId} ${item}`,
        );
      }
    }
  assert.ok(
    dev.some(
      (c) =>
        c.exercises?.includes('band_tier_missing') &&
        claims(slotDoc(c, 1)!).some((x) => x.metric === 'hallucination_rate' && x.tier === undefined),
    ),
  );
  const v2 = dev.filter((c) => c.exercises?.includes('v2_no_v1_bands'));
  assert.ok(v2.length >= 1);
  for (const c of v2) {
    assert.equal(c.checklistTemplateVersion, 'v2.0');
    assert.ok(
      claims(slotDoc(c, 1)!).some(
        (x) =>
          x.metric === 'hallucination_rate' &&
          x.tier !== undefined &&
          comparePercent(x.value!, band[x.tier]) >= 0,
      ),
      `${c.caseId}: a value that v1.0 bands would flag`,
    );
  }
});

test('classic ML: a matching metric, a claim without one, a reasoned N/A, no claim at all, and slot 1 N/A', () => {
  const classic = dev.filter((c) => c.modelType === 'classic_ml');
  const slot1Claims = (c: EvalCase): Claim[] => {
    const d = slotDoc(c, 1);
    return d === undefined ? [] : claims(d).filter((x) => x.item === 'classic_ml_performance');
  };
  assert.ok(classic.some((c) => slot1Claims(c).some((x) => x.metric === 'f1' && x.value !== undefined)));
  assert.ok(classic.some((c) => slot1Claims(c).some((x) => x.answer === 'yes' && x.metric === undefined)));
  assert.ok(classic.some((c) => slot1Claims(c).some((x) => x.answer === 'na' && x.evidence !== undefined)));
  assert.ok(classic.some((c) => slotDoc(c, 1) !== undefined && slot1Claims(c).length === 0));
  assert.ok(classic.some((c) => c.slots[0]!.disposition === 'not_applicable'));
});

test('unreadable inputs: a scanned slot 1, an unreadable slot 2 and an unreadable slot 5', () => {
  const unreadable = (c: EvalCase, slot: SlotNumber): boolean => {
    const d = slotDoc(c, slot);
    return d !== undefined && !READABLE_FORMATS.includes(d.format);
  };
  assert.ok(dev.some((c) => SCANNED_FORMATS.includes(slotDoc(c, 1)?.format ?? 'docx')));
  assert.ok(dev.some((c) => unreadable(c, 2)));
  assert.ok(dev.some((c) => unreadable(c, 5)));
});

test('injection and exfiltration documents for the W4-10a probes', () => {
  for (const probe of ['approval_injection', 'exfiltration', 'template_leakage'] as const)
    assert.ok(
      dev.some((c) => c.probes?.includes(probe)),
      probe,
    );
});
