// W4-06a (W4b plan section 3.2; decision 10, WA-D09): the provisional synthetic claim grammar over extracted segments.
// Synthetic text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_LABELS } from '../../configuration/seed.js';
import type { Segment } from '../extraction/port.js';
import { claimItem, metricIdOf, normaliseLabel, parseClaims, parseValue } from './claims.js';

const US = '\u001f';
const cell = (sheetIndex: number, ref: string, text: string): Segment => ({
  locator: { kind: 'cell', sheetIndex, cell: ref },
  text,
});
const para = (index: number, text: string): Segment => ({ locator: { kind: 'section', index }, text });
const line = (page: number, text: string): Segment => ({ locator: { kind: 'page', page }, text });
const ITEMS = {
  hallucination: { en: ['hallucination'], th: ['การหลอน'] },
  accuracy: { en: ['accuracy'], th: ['ความแม่นยำ'] },
};

test('labels match after NFC, case folding and whitespace collapse', () => {
  assert.equal(normaliseLabel('  Answer \t'), 'answer');
  assert.equal(normaliseLabel('Sample   Size'), 'sample size');
  assert.equal(normaliseLabel('café'), 'café');
  assert.equal(normaliseLabel('คำตอบ'), 'คำตอบ');
});

test('DOCX and PDF: one segment of `key: value` pairs with an answer key is one claim at the segment locator', () => {
  const text =
    'item: 2.1; question: Hallucination rate measured on the evaluation set?; answer: Yes; metric: hallucination_rate; value: 0.4%; denominator: 500; threshold: 1%; evidence: eval-report-21; tier: high';
  const claims = parseClaims(
    [
      para(1, 'SYNTHETIC preamble line, no pairs'),
      para(2, text),
      para(3, 'metric: accuracy; value: 96%'), // pairs but no answer key: not a claim
      para(4, 'Answer:   N/A ;Question: Answer accuracy measured?'), // spacing and case vary
    ],
    CLAIM_LABELS,
  );
  assert.equal(claims.length, 2);
  const [first, second] = claims as [(typeof claims)[0], (typeof claims)[0]];
  assert.deepEqual(first.locator, { kind: 'section', index: 2 });
  assert.equal(first.excerpt, text);
  assert.equal(first.answer, 'yes');
  assert.deepEqual(first.fields, {
    item: '2.1',
    question: 'Hallucination rate measured on the evaluation set?',
    answer: 'Yes',
    metric: 'hallucination_rate',
    value: '0.4%',
    denominator: '500',
    threshold: '1%',
    evidence: 'eval-report-21',
    tier: 'high',
  });
  assert.deepEqual(second.locator, { kind: 'section', index: 4 });
  assert.equal(second.answer, 'na');
  assert.equal(second.fields.question, 'Answer accuracy measured?');

  const pdf = parseClaims([line(3, 'answer: No; question: Answer accuracy measured?')], CLAIM_LABELS);
  assert.deepEqual(pdf[0]?.locator, { kind: 'page', page: 3 });
  assert.equal(pdf[0]?.answer, 'no');
});

test('Thai keys and answers are matched from the Thai label lists', () => {
  const claims = parseClaims(
    [
      para(
        1,
        'ข้อ: 2.2; คำถาม: มีการวัดความแม่นยำของคำตอบหรือไม่; คำตอบ: ใช่; ตัวชี้วัด: accuracy; ค่า: 96%',
      ),
    ],
    CLAIM_LABELS,
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.answer, 'yes');
  assert.equal(claims[0]?.fields.metric, 'accuracy');
  assert.equal(claims[0]?.fields.value, '96%');
  assert.equal(claimItem(claims[0], ITEMS), 'accuracy');
});

test('an unknown answer word is `unknown`; the first occurrence of a key wins; unknown keys are ignored', () => {
  const [claim] = parseClaims(
    [para(1, 'answer: maybe; answer: yes; colour: blue; value: 1; no colon here')],
    CLAIM_LABELS,
  );
  assert.equal(claim?.answer, 'unknown');
  assert.deepEqual(claim?.fields, { answer: 'maybe', value: '1' });
});

test('XLSX: the first row matching three column keys is the header; each later row with an answer cell is a claim', () => {
  const segments: Segment[] = [
    cell(1, 'A1', 'SYNTHETIC preamble'),
    cell(1, 'A2', 'item'), // one key only: not a header
    cell(1, 'A4', 'Item'),
    cell(1, 'B4', 'Question'),
    cell(1, 'C4', 'Answer'),
    cell(1, 'D4', 'Metric'),
    cell(1, 'E4', 'Value'),
    cell(1, 'F4', 'Denominator'),
    cell(1, 'A5', '2.1'),
    cell(1, 'B5', 'Hallucination rate measured?'),
    cell(1, 'C5', 'Yes'),
    cell(1, 'E5', '5%'),
    cell(1, 'A6', 'A note row with no answer'),
    cell(1, 'C7', 'No'),
    cell(1, 'A7', '2.2'),
    // Sheet 2: its own header, columns in another order.
    cell(2, 'B2', 'answer'),
    cell(2, 'A2', 'question'),
    cell(2, 'C2', 'metric'),
    cell(2, 'A10', 'Answer accuracy measured?'),
    cell(2, 'B10', 'N/A'),
  ];
  const claims = parseClaims(segments, CLAIM_LABELS);
  assert.deepEqual(
    claims.map((c) => [c.locator, c.answer]),
    [
      [{ kind: 'cell', sheetIndex: 1, cell: 'C5' }, 'yes'],
      [{ kind: 'cell', sheetIndex: 1, cell: 'C7' }, 'no'],
      [{ kind: 'cell', sheetIndex: 2, cell: 'B10' }, 'na'],
    ],
  );
  assert.deepEqual(claims[0]?.fields, {
    item: '2.1',
    question: 'Hallucination rate measured?',
    answer: 'Yes',
    value: '5%',
  });
  assert.equal(claims[0]?.excerpt, ['2.1', 'Hallucination rate measured?', 'Yes', '5%'].join(US));
  assert.equal(claims[1]?.excerpt, ['2.2', 'No'].join(US), 'cells in column order, not segment order');
  assert.equal(claimItem(claims[0], ITEMS), 'hallucination');
  assert.equal(claimItem(claims[2]!, ITEMS), 'accuracy');
});

test('XLSX column order compares by column, so AA follows Z', () => {
  const segments: Segment[] = [
    cell(1, 'Z1', 'answer'),
    cell(1, 'AA1', 'metric'),
    cell(1, 'B1', 'question'),
    cell(1, 'AA2', 'accuracy'),
    cell(1, 'Z2', 'yes'),
    cell(1, 'B2', 'Answer accuracy?'),
  ];
  const [claim] = parseClaims(segments, CLAIM_LABELS);
  assert.equal(claim?.excerpt, ['Answer accuracy?', 'yes', 'accuracy'].join(US));
  assert.deepEqual(claim?.locator, { kind: 'cell', sheetIndex: 1, cell: 'Z2' });
});

test('claimItem reads the question or the item field; no keyword is no item', () => {
  const [claim] = parseClaims([para(1, 'item: hallucination check; answer: yes')], CLAIM_LABELS);
  assert.equal(claimItem(claim!, ITEMS), 'hallucination');
  const [thai] = parseClaims([para(1, 'คำถาม: มีการวัดอัตราการหลอนหรือไม่; คำตอบ: ใช่')], CLAIM_LABELS);
  assert.equal(claimItem(thai!, ITEMS), 'hallucination');
  const [other] = parseClaims(
    [para(1, 'question: Does it process personal data?; answer: yes')],
    CLAIM_LABELS,
  );
  assert.equal(claimItem(other!, ITEMS), null);
});

test('values: % is percent; a bare number at most 1 with a decimal point is a ratio; otherwise a count', () => {
  assert.deepEqual(parseValue('0.4%'), { decimal: '0.4', unit: 'percent' });
  assert.deepEqual(parseValue('96 %'), { decimal: '96', unit: 'percent' });
  assert.deepEqual(parseValue('0.91'), { decimal: '0.91', unit: 'ratio' });
  assert.deepEqual(parseValue('1.0'), { decimal: '1', unit: 'ratio' });
  assert.deepEqual(parseValue('1'), { decimal: '1', unit: 'count' });
  assert.deepEqual(parseValue('1.5'), { decimal: '1.5', unit: 'count' });
  assert.deepEqual(parseValue('500'), { decimal: '500', unit: 'count' });
  // A stated unit wins for a bare number.
  assert.deepEqual(parseValue('2.4', 'percent'), { decimal: '2.4', unit: 'percent' });
  assert.deepEqual(parseValue('2.4', '%'), { decimal: '2.4', unit: 'percent' });
  for (const text of ['', 'about 5%', 'five', '5%%', '1e-3', '1,000'])
    assert.equal(parseValue(text), null, text);
});

test('metric names normalise to an ID: case, spaces and hyphens fold to one form', () => {
  assert.equal(metricIdOf('hallucination_rate'), 'hallucination_rate');
  assert.equal(metricIdOf(' Hallucination Rate '), 'hallucination_rate');
  assert.equal(metricIdOf('hallucination-rate'), 'hallucination_rate');
  assert.equal(metricIdOf('Accuracy'), 'accuracy');
});
