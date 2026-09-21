// W0-02 section 10 item 5: dates render in Asia/Bangkok, Gregorian calendar in Thai, never Buddhist-era by accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatDate, formatDateTime, INTL_LOCALE_BY_LOCALE } from './format.js';

test('a UTC instant renders in Asia/Bangkok (UTC+7) in both locales', () => {
  // 2026-09-21T17:30:00Z is 2026-09-22 00:30 in Bangkok: the day rolls over.
  const en = formatDateTime('en', '2026-09-21T17:30:00Z');
  assert.match(en, /22/);
  assert.match(en, /00:30/);
  const th = formatDateTime('th', '2026-09-21T17:30:00Z');
  assert.match(th, /22/);
  assert.match(th, /00:30/);
});

test('the Thai locale uses the Gregorian calendar, not the Buddhist era', () => {
  assert.equal(INTL_LOCALE_BY_LOCALE.th, 'th-TH-u-ca-gregory');
  const th = formatDate('th', '2026-09-21T03:00:00Z');
  assert.match(th, /2026/);
  assert.doesNotMatch(th, /2569/);
});

test('an unparsable timestamp is returned unchanged rather than rendered as Invalid Date', () => {
  assert.equal(formatDateTime('en', 'not-a-date'), 'not-a-date');
  assert.equal(formatDate('th', ''), '');
});

test('W1-06: file sizes render through Intl unit formatting in both locales', () => {
  assert.match(formatBytes('en', 512), /512/);
  assert.match(formatBytes('en', 20 * 1024), /20/);
  assert.match(formatBytes('en', 3 * 1024 * 1024 + 200_000), /3\.2/);
  assert.match(formatBytes('th', 3 * 1024 * 1024), /3/);
});
