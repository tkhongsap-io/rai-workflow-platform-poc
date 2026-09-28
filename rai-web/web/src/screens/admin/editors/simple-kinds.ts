// W6-06 (W6 plan sections 1.2 Q16/Q18, 2.1 and 9): the form model of the simple configuration kinds. A draft may be
// half-finished (Q18), so a body is read leniently into form values and written back over its base without refusing
// anything: every rule of what may be published is the server's (`publishProblems`, W6-03), and the page lists the
// problems it serves. Other keys of the base body are kept, so the form never drops what it does not show.

import type { Lane } from '@rai/shared/constants';

export const SIMPLE_KINDS = [
  'sla',
  'calendar',
  'use_case_groups',
  'operator_recipients',
  'checklist_templates',
] as const;
export type SimpleKind = (typeof SIMPLE_KINDS)[number];
export type ListKind = Exclude<SimpleKind, 'sla'>;

/** The SLA fields, in the order the lanes are shown (D01: DPO 3, the others 5). */
export const SLA_LANES = ['dpo', 'ai_coe', 'it_security'] as const satisfies readonly Lane[];
export type SlaLane = (typeof SLA_LANES)[number];

/** Each list kind's array field (`shared/src/schemas/cases.ts`). */
export const LIST_FIELD: Readonly<Record<ListKind, string>> = Object.freeze({
  calendar: 'holidays',
  use_case_groups: 'groups',
  operator_recipients: 'addresses',
  checklist_templates: 'versions',
});

/** D06: the working-day calendar's time zone is fixed; the editor never offers another. */
export const CALENDAR_TIMEZONE = 'Asia/Bangkok';

export type SimpleForm =
  { kind: 'sla'; values: Record<SlaLane, string> } | { kind: ListKind; items: string[] };

type Body = Readonly<Record<string, unknown>>;

export function isSimpleKind(kind: string): kind is SimpleKind {
  return (SIMPLE_KINDS as readonly string[]).includes(kind);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** The form values of `body` (the draft's, or the revision in force's; `undefined` before anything exists). */
export function formOf(kind: SimpleKind, body: Body | undefined): SimpleForm {
  if (kind === 'sla') {
    const values = Object.fromEntries(SLA_LANES.map((lane) => [lane, text(body?.[lane])])) as Record<
      SlaLane,
      string
    >;
    return { kind, values };
  }
  const list = body?.[LIST_FIELD[kind]];
  const items = Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  return { kind, items };
}

/** A whole number (optionally signed) becomes a number; anything else stays text for the server to name. */
function slaValue(input: string): number | string {
  const value = input.trim();
  return /^-?\d{1,9}$/.test(value) ? Number(value) : value;
}

/** The body a save sends: the form written over `base`, whose other keys are kept. */
export function bodyOf(form: SimpleForm, base: Body | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = { ...base };
  if (form.kind === 'sla') {
    for (const lane of SLA_LANES) body[lane] = slaValue(form.values[lane]);
    return body;
  }
  if (form.kind === 'calendar') body.timezone = CALENDAR_TIMEZONE;
  body[LIST_FIELD[form.kind]] = form.items.map((item) => item.trim()).filter((item) => item !== '');
  return body;
}

export type ProblemTarget = { lane: SlaLane } | { index: number } | { whole: true };

/**
 * Which field a served problem names. The server keeps a schema problem's first pointer segment only, and a W6-03
 * problem's whole pointer (`/addresses/1`), so a row index is known only when the pointer carries it.
 */
export function problemTarget(kind: SimpleKind, path: string): ProblemTarget {
  const segments = path.split('/').slice(1);
  if (kind === 'sla') {
    const lane = SLA_LANES.find((x) => x === segments[0]);
    return lane === undefined || segments.length !== 1 ? { whole: true } : { lane };
  }
  if (segments.length === 2 && segments[0] === LIST_FIELD[kind] && /^\d+$/.test(segments[1]!))
    return { index: Number(segments[1]) };
  return { whole: true };
}
