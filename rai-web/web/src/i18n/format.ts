// W1-07 (Lane B): date and time rendering in APP_TIMEZONE (D06) through Intl (W0-02 section 10 item 5): Gregorian
// calendar for Thai (`th-TH-u-ca-gregory`) so the year is never Buddhist-era by accident. The API returns RFC 3339
// UTC strings and never a formatted date; this module is the only formatter the screens use. Pure; unit-tested.
// W1-06 adds file sizes through Intl unit formatting so the unit is localised, never a hard-coded string.

import { APP_TIMEZONE } from '@rai/shared/constants';
import type { Locale } from '@rai/shared/locales/keys';

export const INTL_LOCALE_BY_LOCALE: Readonly<Record<Locale, string>> = Object.freeze({
  th: 'th-TH-u-ca-gregory',
  en: 'en-GB',
});

export function formatDateTime(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE_BY_LOCALE[locale], {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE_BY_LOCALE[locale], {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatBytes(locale: Locale, bytes: number): string {
  const tag = INTL_LOCALE_BY_LOCALE[locale];
  if (bytes < 1024) return new Intl.NumberFormat(tag, { style: 'unit', unit: 'byte' }).format(bytes);
  if (bytes < 1024 * 1024)
    return new Intl.NumberFormat(tag, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(
      bytes / 1024,
    );
  return new Intl.NumberFormat(tag, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(
    bytes / (1024 * 1024),
  );
}
