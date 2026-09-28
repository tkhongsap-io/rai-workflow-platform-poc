// W4-06a (W4b plan section 3.2; decision 11, WA-D09): decimal strings compared exactly, as scaled bigints, never as
// binary floats. The stored `measure` numbers are converted from the parsed decimal only after any comparison; the
// exact string travels in a decimal-string message param when a finding needs it. Pure.

/** Up to 18 digits on each side, as the decimal-string message param allows (plan section 3.1). */
const DECIMAL = /^([+-]?)(\d{1,18})(?:\.(\d{1,18}))?$/;

/**
 * The canonical decimal string of `text` (trimmed; leading `+` dropped; leading integer zeros and trailing fraction
 * zeros removed; `-0` is `0`), or null when it is not a plain decimal: no exponent, grouping, or other digits.
 */
export function parseDecimal(text: string): string | null {
  const match = DECIMAL.exec(text.trim());
  if (match === null) return null;
  const integer = match[2]!.replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const body = fraction === '' ? integer : `${integer}.${fraction}`;
  const zero = /^0(\.0*)?$/.test(body);
  return match[1] === '-' && !zero ? `-${body}` : body;
}

function scaled(value: string, scale: number): bigint {
  const canonical = parseDecimal(value);
  if (canonical === null) throw new TypeError('not a decimal string');
  const negative = canonical.startsWith('-');
  const [integer, fraction = ''] = (negative ? canonical.slice(1) : canonical).split('.');
  const digits = BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
  return negative ? -digits : digits;
}

/** -1, 0 or 1 as `a` is less than, equal to or greater than `b`, exactly. Throws on a non-decimal string. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const scale = 18;
  const x = scaled(a, scale);
  const y = scaled(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The JavaScript number of a decimal string (`MeasureSchema` stores numbers); only after any comparison. */
export function decimalToNumber(decimal: string): number {
  return Number(decimal);
}
