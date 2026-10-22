'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function clockFixture(t, instant, timeZone = 'Europe/Rome') {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(instant) });
  const { today } = await import('../frontend/src/lib/dates.js');
  const { observeDay } = await import('../frontend/src/lib/day-clock.js');
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = new EventTarget();
  global.document = new EventTarget();
  document.visibilityState = 'visible';
  const days = [];
  const stop = observeDay(timeZone, () => days.push(today(timeZone)));
  t.after(() => { stop(); global.window = previousWindow; global.document = previousDocument; });
  return { days, stop, today };
}

test('open dashboard advances at Garmin midnight, once, while the UTC day stays the same', async t => {
  const { days, stop, today } = await clockFixture(t, '2026-10-23T21:59:59.900Z');
  assert.equal(today('Europe/Rome'), '2026-10-23');
  t.mock.timers.tick(150);
  assert.deepEqual(days, ['2026-10-24']);
  assert.equal(today('UTC'), '2026-10-23');
  t.mock.timers.tick(60_000);
  assert.equal(days.length, 1, 'minute checks do not notify or fetch on an unchanged day');
  stop(); t.mock.timers.tick(86400_000);
  assert.equal(days.length, 1, 'unmount cleans up the timer');
});

test('DST spring and autumn days follow the calendar, without a fixed 24-hour timeout', async t => {
  const { days } = await clockFixture(t, '2026-03-28T22:59:59.900Z');
  t.mock.timers.tick(150);
  assert.deepEqual(days, ['2026-03-29']);
  t.mock.timers.setTime(Date.parse('2026-03-29T01:00:00Z'));
  window.dispatchEvent(new Event('focus'));
  assert.equal(days.length, 1, 'spring clock jump is not a new day');
  t.mock.timers.setTime(Date.parse('2026-03-29T22:00:00Z'));
  window.dispatchEvent(new Event('focus'));
  assert.equal(days.at(-1), '2026-03-30', '23-hour day');
  t.mock.timers.setTime(Date.parse('2026-10-25T22:00:00Z'));
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(days.at(-1), '2026-10-25', 'autumn day still has one hour remaining');
  t.mock.timers.setTime(Date.parse('2026-10-25T23:00:00Z'));
  window.dispatchEvent(new Event('focus'));
  assert.equal(days.at(-1), '2026-10-26', '25-hour day');
});

test('a suspended/background tab catches up when visible or restored; listeners are removed', async t => {
  const { days, stop } = await clockFixture(t, '2026-10-23T12:00:00Z', 'Pacific/Honolulu');
  t.mock.timers.setTime(Date.parse('2026-10-26T00:00:00Z'));
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(days, []);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(days, ['2026-10-25'], 'Garmin timezone can differ from the browser and UTC');
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(days.length, 1);
  stop(); t.mock.timers.setTime(Date.parse('2026-10-28T00:00:00Z'));
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(days.length, 1);
});

test('server day ranges also roll over and preserve an explicit historical selection', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T21:59:59.900Z') });
  const { rangesFor } = require('../helpers/dashboard-measurements');
  assert.equal(rangesFor({ view: 'overview' }, 'Europe/Rome').to, '2026-10-23');
  t.mock.timers.tick(150);
  assert.equal(rangesFor({ view: 'overview' }, 'Europe/Rome').to, '2026-10-24');
  const history = rangesFor({ view: 'overview', from: '2026-10-20', to: '2026-10-20' }, 'Europe/Rome');
  assert.equal(history.to, '2026-10-20');
  const wellness = rangesFor({ view: 'wellness', period: 14 }, 'Europe/Rome');
  assert.equal(wellness.from, '2026-10-11'); assert.equal(wellness.to, '2026-10-24');
});
