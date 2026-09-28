// W4-06a (W4b plan section 3.2, decision 11 WA-D09): decimal strings compare exactly, as scaled bigints, never as
// floats; the number conversion happens only after the comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDecimal, decimalToNumber, parseDecimal, ratioToPercent } from './decimal.js';

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

// W4-06c (plan section 3.3, decision 11): a ratio becomes a percent exactly, on the decimal string, so a ratio at the
// band compares equal to it (0.01 × 100 is 1, where 0.07 * 100 in binary floating point is 7.000000000000001).
test('ratioToPercent multiplies by 100 exactly and canonicalises; too long a result is null', () => {
  assert.equal(ratioToPercent('0.01'), '1');
  assert.equal(ratioToPercent('0.07'), '7');
  assert.equal(ratioToPercent('0.015'), '1.5');
  assert.equal(ratioToPercent('0.029999'), '2.9999');
  assert.equal(ratioToPercent('0.1'), '10');
  assert.equal(ratioToPercent('1'), '100');
  assert.equal(ratioToPercent('0'), '0');
  assert.equal(ratioToPercent('-0.004'), '-0.4');
  assert.equal(ratioToPercent('0.000000000000000001'), '0.0000000000000001');
  assert.equal(ratioToPercent('12.5'), '1250');
  assert.equal(compareDecimal(ratioToPercent('0.02')!, '2'), 0);
  assert.equal(compareDecimal(ratioToPercent('0.0299999999')!, '3'), -1);
  // The result must stay a decimal-string message param (at most 18 integer digits).
  assert.equal(ratioToPercent('9999999999999999'), '999999999999999900');
  assert.equal(ratioToPercent('99999999999999999'), null);
  for (const text of ['', '1e-2', '5%', 'abc']) assert.equal(ratioToPercent(text), null, text);
});
