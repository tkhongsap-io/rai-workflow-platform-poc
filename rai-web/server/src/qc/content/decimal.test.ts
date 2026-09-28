// W4-06a (W4b plan section 3.2, decision 11 WA-D09): decimal strings compare exactly, as scaled bigints, never as
// floats; the number conversion happens only after the comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDecimal, decimalToNumber, parseDecimal } from './decimal.js';

test('parseDecimal accepts plain decimal strings and canonicalises them; anything else is null', () => {
  assert.equal(parseDecimal('1'), '1');
  assert.equal(parseDecimal('0.40'), '0.4');
  assert.equal(parseDecimal('007.500'), '7.5');
  assert.equal(parseDecimal('-0.0'), '0');
  assert.equal(parseDecimal('-2.50'), '-2.5');
  assert.equal(parseDecimal('+3'), '3');
  assert.equal(parseDecimal(' 12 '), '12');
  for (const text of [
    '',
    '.5',
    '5.',
    '1e3',
    '1,000',
    '0x10',
    'NaN',
    'Infinity',
    '1.2.3',
    '๑',
    '5%',
    '1'.repeat(19),
  ])
    assert.equal(parseDecimal(text), null, text);
});

test('compareDecimal is exact where binary floats are not', () => {
  assert.equal(compareDecimal('1', '1.0'), 0);
  assert.equal(compareDecimal('0.3', '0.1'), 1);
  assert.equal(compareDecimal('0.1', '0.3'), -1);
  // 0.1 + 0.2 != 0.3 in floats; as decimals, 0.30000000000000004 > 0.3 exactly.
  assert.equal(compareDecimal('0.30000000000000004', '0.3'), 1);
  assert.equal(compareDecimal('0.999999999999999999', '1'), -1);
  assert.equal(compareDecimal('-1', '0'), -1);
  assert.equal(compareDecimal('-0.5', '-0.25'), -1);
  assert.equal(compareDecimal('100', '99.99'), 1);
  assert.equal(compareDecimal('2', '2.000000000000000000'), 0);
  assert.throws(() => compareDecimal('1%', '1'), /not a decimal/);
});

test('decimalToNumber converts only after the comparison', () => {
  assert.equal(decimalToNumber('2.4'), 2.4);
  assert.equal(decimalToNumber('-0.5'), -0.5);
  assert.equal(decimalToNumber('500'), 500);
});
