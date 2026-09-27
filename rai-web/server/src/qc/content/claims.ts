// W4-06a (W4b plan section 3.2; decision 10, WA-D09): the provisional synthetic claim grammar. It turns the segments
// the extractor returned into claims: a claim's locator (text-free, W4-16), its excerpt (text, kept in memory for the
// run only), its fields by column key and its normalised answer. The key, answer and item words are the rule's
// catalogue `params` (configuration the D09 owners can retune), never code. Pure: no I/O, no clock.
//
//   - XLSX: per sheet, the first row whose cells match at least three column keys is the header; every later row with
//     a non-empty answer cell is a claim, located at that cell; its excerpt is the row's non-empty cells in column
//     order joined by U+001F.
//   - DOCX / PDF: a segment (a paragraph or a text line) of `key: value` pairs separated by `;`, at least one of them
//     an `answer` pair, is a claim located at the segment's locator; its excerpt is the segment text.
import type { EvidenceLocator } from '@rai/shared/qc/types';
import { CLAIM_COLUMN_KEYS, type ClaimColumnKey, type ClaimLabels } from '@rai/shared/schemas/cases';
import type { Segment } from '../extraction/port.js';
import { compareDecimal, parseDecimal } from './decimal.js';

export type ClaimAnswer = 'yes' | 'no' | 'na' | 'unknown';
export interface BilingualLabelList {
  en: readonly string[];
  th: readonly string[];
}

export interface GrammarClaim {
  locator: EvidenceLocator;
  /** The matched claim text. Never leaves the content runner: a finding carries only its hash. */
  excerpt: string;
  /** Field text by column key, as written (trimmed). */
  fields: Partial<Record<ClaimColumnKey, string>>;
  answer: ClaimAnswer;
}

const XLSX_HEADER_MIN_KEYS = 3;
const XLSX_EXCERPT_SEPARATOR = '\u001f';
const PAIR_SEPARATOR = ';';
const KEY_VALUE_SEPARATOR = /[:：]/; // ASCII or full-width colon

/** NFC, case folded, whitespace collapsed and trimmed: how every label, answer and keyword is compared. */
export function normaliseLabel(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function wordsOf(list: BilingualLabelList): string[] {
  return [...list.en, ...list.th].map(normaliseLabel);
}

/** Label word → column key, first list wins on a shared word. */
function keyIndex(labels: ClaimLabels): Map<string, ClaimColumnKey> {
  const index = new Map<string, ClaimColumnKey>();
  for (const key of CLAIM_COLUMN_KEYS)
    for (const word of wordsOf(labels.keys[key])) if (!index.has(word)) index.set(word, key);
  return index;
}

function answerOf(text: string | undefined, labels: ClaimLabels): ClaimAnswer {
  if (text === undefined) return 'unknown';
  const word = normaliseLabel(text);
  for (const answer of ['yes', 'no', 'na'] as const)
    if (wordsOf(labels.answers[answer]).includes(word)) return answer;
  return 'unknown';
}

function pairClaim(
  segment: Segment,
  keys: Map<string, ClaimColumnKey>,
  labels: ClaimLabels,
): GrammarClaim | null {
  const fields: Partial<Record<ClaimColumnKey, string>> = {};
  for (const pair of segment.text.split(PAIR_SEPARATOR)) {
    const at = pair.search(KEY_VALUE_SEPARATOR);
    if (at <= 0) continue;
    const key = keys.get(normaliseLabel(pair.slice(0, at)));
    if (key === undefined || fields[key] !== undefined) continue; // unknown keys are ignored; the first one wins
    fields[key] = pair.slice(at + 1).trim();
  }
  if (fields.answer === undefined) return null;
  return { locator: segment.locator, excerpt: segment.text, fields, answer: answerOf(fields.answer, labels) };
}

/** `B7` → column 2, row 7; null for anything that is not an A1 reference. */
function cellPosition(ref: string): { column: number; row: number } | null {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
  if (match === null) return null;
  let column = 0;
  for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64);
  return { column, row: Number(match[2]) };
}

interface SheetCell {
  column: number;
  ref: string;
  text: string;
}

function sheetClaims(
  sheetIndex: number,
  rows: Map<number, SheetCell[]>,
  keys: Map<string, ClaimColumnKey>,
  labels: ClaimLabels,
): GrammarClaim[] {
  const rowNumbers = [...rows.keys()].sort((a, b) => a - b);
  let header: Map<number, ClaimColumnKey> | undefined;
  const claims: GrammarClaim[] = [];
  for (const rowNumber of rowNumbers) {
    const cells = rows.get(rowNumber)!.sort((a, b) => a.column - b.column);
    if (header === undefined) {
      const columns = new Map<number, ClaimColumnKey>();
      for (const cell of cells) {
        const key = keys.get(normaliseLabel(cell.text));
        if (key !== undefined && ![...columns.values()].includes(key)) columns.set(cell.column, key);
      }
      if (columns.size >= XLSX_HEADER_MIN_KEYS) header = columns;
      continue;
    }
    const fields: Partial<Record<ClaimColumnKey, string>> = {};
    let answerCell: SheetCell | undefined;
    for (const cell of cells) {
      const key = header.get(cell.column);
      if (key === undefined) continue;
      const text = cell.text.trim();
      if (text === '') continue;
      fields[key] = text;
      if (key === 'answer') answerCell = cell;
    }
    if (answerCell === undefined) continue;
    claims.push({
      locator: { kind: 'cell', sheetIndex, cell: answerCell.ref },
      excerpt: cells.map((c) => c.text).join(XLSX_EXCERPT_SEPARATOR),
      fields,
      answer: answerOf(fields.answer, labels),
    });
  }
  return claims;
}

/** Every claim the grammar finds in one artifact's segments, in document order (XLSX: sheet, then row). */
export function parseClaims(segments: readonly Segment[], labels: ClaimLabels): GrammarClaim[] {
  const keys = keyIndex(labels);
  const claims: GrammarClaim[] = [];
  const sheets = new Map<number, Map<number, SheetCell[]>>();
  for (const segment of segments) {
    const { locator } = segment;
    if (locator.kind === 'cell') {
      const position = locator.cell === undefined ? null : cellPosition(locator.cell);
      if (position === null || locator.sheetIndex === undefined || segment.text.trim() === '') continue;
      const rows = sheets.get(locator.sheetIndex) ?? new Map<number, SheetCell[]>();
      sheets.set(locator.sheetIndex, rows);
      const row = rows.get(position.row) ?? [];
      rows.set(position.row, row);
      row.push({ column: position.column, ref: locator.cell!, text: segment.text });
      continue;
    }
    const claim = pairClaim(segment, keys, labels);
    if (claim !== null) claims.push(claim);
  }
  for (const sheetIndex of [...sheets.keys()].sort((a, b) => a - b))
    claims.push(...sheetClaims(sheetIndex, sheets.get(sheetIndex)!, keys, labels));
  return claims;
}

/** The first item (in `items` order) whose keyword appears in the claim's `question` or `item` field. */
export function claimItem<K extends string>(
  claim: GrammarClaim,
  items: Readonly<Record<K, BilingualLabelList>>,
): K | null {
  const haystacks = [claim.fields.question, claim.fields.item]
    .filter((t): t is string => t !== undefined)
    .map(normaliseLabel);
  for (const item of Object.keys(items) as K[])
    if (wordsOf(items[item]).some((word) => haystacks.some((h) => h.includes(word)))) return item;
  return null;
}

export type ValueUnit = 'percent' | 'ratio' | 'count';

const UNIT_WORDS: Readonly<Record<string, ValueUnit>> = Object.freeze({
  '%': 'percent',
  percent: 'percent',
  ratio: 'ratio',
  count: 'count',
});

/**
 * A stated value as a decimal string and a unit: `%` → `percent`; a bare number → the stated `unit` field when it
 * names one, else `ratio` if it is at most 1 and has a decimal point, else `count`. Null when it is not a number.
 */
export function parseValue(text: string, unitText?: string): { decimal: string; unit: ValueUnit } | null {
  const trimmed = text.trim();
  const percent = /^(.*?)\s*%$/.exec(trimmed);
  const decimal = parseDecimal(percent === null ? trimmed : percent[1]!);
  if (decimal === null) return null;
  if (percent !== null) return { decimal, unit: 'percent' };
  const unitWord = unitText === undefined ? undefined : normaliseLabel(unitText);
  if (unitWord !== undefined && Object.hasOwn(UNIT_WORDS, unitWord))
    return { decimal, unit: UNIT_WORDS[unitWord]! };
  const ratio = trimmed.includes('.') && !decimal.startsWith('-') && compareDecimal(decimal, '1') <= 0;
  return { decimal, unit: ratio ? 'ratio' : 'count' };
}

/** A metric name as an ID: case folded, spaces and hyphens as underscores (`Hallucination Rate` → `hallucination_rate`). */
export function metricIdOf(text: string): string {
  return normaliseLabel(text).replace(/[\s-]+/g, '_');
}
