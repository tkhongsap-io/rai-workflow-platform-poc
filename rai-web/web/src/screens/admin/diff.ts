// W6-05 (W6 plan section 9): the structured two-revision diff of the Admin configuration pages. Pure: two
// configuration bodies in, one entry per difference out, keyed by an RFC 6901 JSON pointer (the same path form the
// W6-04 problems use). Objects recurse by key in sorted order, arrays by index; a value whose type changes (object,
// array, scalar) is one change at its path. The screen renders the entries as they are and never re-derives them.

export type DiffChange = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  /** JSON pointer into the body, e.g. `/dpo` or `/templates/v2.0/rules/0`. */
  path: string;
  change: DiffChange;
  /** The value in the earlier ("from") revision; absent when added. */
  before?: unknown;
  /** The value in the later ("to") revision; absent when removed. */
  after?: unknown;
}

/** One pointer segment (RFC 6901 section 3): `~` becomes `~0`, `/` becomes `~1`. */
export function pointerSegment(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

type Shape = 'object' | 'array' | 'scalar';

function shapeOf(value: unknown): Shape {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'scalar';
}

function walk(before: unknown, after: unknown, path: string, out: DiffEntry[]): void {
  const shape = shapeOf(before);
  if (shape !== shapeOf(after)) {
    out.push({ path, change: 'changed', before, after });
    return;
  }
  if (shape === 'scalar') {
    if (!Object.is(before, after)) out.push({ path, change: 'changed', before, after });
    return;
  }
  if (shape === 'array') {
    const a = before as unknown[];
    const b = after as unknown[];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const at = `${path}/${i}`;
      if (i >= a.length) out.push({ path: at, change: 'added', after: b[i] });
      else if (i >= b.length) out.push({ path: at, change: 'removed', before: a[i] });
      else walk(a[i], b[i], at, out);
    }
    return;
  }
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    const at = `${path}/${pointerSegment(key)}`;
    if (!Object.hasOwn(a, key)) out.push({ path: at, change: 'added', after: b[key] });
    else if (!Object.hasOwn(b, key)) out.push({ path: at, change: 'removed', before: a[key] });
    else walk(a[key], b[key], at, out);
  }
}

/** Every difference from `before` (the earlier revision) to `after`; `[]` when the bodies are equal. */
export function diffBodies(before: Record<string, unknown>, after: Record<string, unknown>): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(before, after, '', out);
  return out;
}

/** A diff value as JSON text; an absent side is empty. Numbers and words are text, never colour (section 9). */
export function formatDiffValue(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

/**
 * The revision a revision page compares with when the URL names none: the revision in force when this is another
 * one, else the highest-numbered revision below this one, else none (the kind's only revision).
 */
export function defaultAgainst(
  items: readonly { revisionId: string; revisionNumber: number; inForce: boolean }[],
  revisionId: string,
): string | undefined {
  const self = items.find((item) => item.revisionId === revisionId);
  const inForce = items.find((item) => item.inForce);
  if (inForce !== undefined && inForce.revisionId !== revisionId) return inForce.revisionId;
  if (self === undefined) return undefined;
  const earlier = items
    .filter((item) => item.revisionNumber < self.revisionNumber)
    .sort((x, y) => y.revisionNumber - x.revisionNumber);
  return earlier[0]?.revisionId;
}
