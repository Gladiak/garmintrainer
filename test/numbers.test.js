'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('dashboard numbers round Garmin floating point values to at most two localized decimals', async () => {
  const { formatNumber } = await import('../frontend/src/lib/numbers.js');
  for (const [value, expected] of [[4.599999904632568, '4,6'], [0.60000001192092896, '0,6'], [59.892896, '59,89'], [17.5058, '17,51'], [1.005, '1,01'], [0.1 + 0.2, '0,3'], [12, '12'], [0, '0']]) {
    assert.equal(formatNumber(value, 'it-IT'), expected);
  }
  assert.equal(formatNumber(59.892896, 'en-GB'), '59.89');
  assert.equal(formatNumber(59.892896, 'fr-FR'), '59,89');
  assert.equal(formatNumber(59.892896, 'de-DE'), '59,89');
  assert.equal(formatNumber(59.892896, 'es-ES'), '59,89');
  for (const value of [null, undefined, NaN, Infinity, '4.6']) assert.equal(formatNumber(value), '—');
});
