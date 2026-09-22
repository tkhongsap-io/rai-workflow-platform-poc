// W0-02 section 10.1: th.json and en.json hold identical key sets with no empty values; t() substitutes params.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import th from './th.json' with { type: 'json' };
import en from './en.json' with { type: 'json' };
import { DEFAULT_LOCALE, LOCALE_KEYS, isLocaleKey, t } from './keys.js';

test('both catalogues have the same keys and no empty value', () => {
  const thKeys = Object.keys(th).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, thKeys);
  for (const [key, value] of [...Object.entries(th), ...Object.entries(en)]) {
    assert.equal(typeof value, 'string', key);
    assert.ok(value.trim().length > 0, `${key} is not empty`);
  }
  assert.deepEqual([...LOCALE_KEYS].sort(), thKeys);
});

test('Thai is the default locale and t() renders both with param substitution (D12)', () => {
  assert.equal(DEFAULT_LOCALE, 'th');
  assert.equal(t('th', 'error.forbidden'), th['error.forbidden']);
  assert.equal(t('en', 'error.forbidden'), en['error.forbidden']);
  assert.equal(t('en', 'auth.signed_in_as', { displayName: 'Prasit W.' }), 'Signed in as Prasit W.');
  assert.equal(
    t('th', 'error.unsafe_upload.too_large', { max_file_mb: 25 }),
    th['error.unsafe_upload.too_large'].replace('{max_file_mb}', '25'),
  );
  assert.equal(isLocaleKey('error.forbidden'), true);
  assert.equal(isLocaleKey('no.such.key'), false);
});

test('every key uses the dotted lower-case namespace convention', () => {
  for (const key of LOCALE_KEYS) {
    assert.match(key, /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, key);
  }
});

test('operator labels have matching placeholders in both languages', () => {
  for (const key of LOCALE_KEYS.filter((key) => key.startsWith('operator.'))) {
    const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(params(th[key]), params(en[key]), key);
  }
  for (const locale of ['th', 'en'] as const) {
    const rendered = t(locale, 'operator.correlation_copy', { recordId: 'notification-1' });
    assert.ok(rendered.includes('notification-1'));
    assert.doesNotMatch(rendered, /\{\w+\}/);
  }
});
