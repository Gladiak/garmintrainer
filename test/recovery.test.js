'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const end = '2026-10-23';
const activity = (id, date, extra = {}) => ({ id, date, status: 'completed', durationMinutes: 40, activityTrainingLoad: 80, ...extra });
const completeByDay = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [`2026-${i < 5 ? '09' : '10'}-${String(i < 5 ? 26 + i : i - 4).padStart(2, '0')}`, true]));

test('rolling load weeks exclude outside and planned activities, with true rest days counted as zero', async () => {
  const { recoveryMetrics } = await import('../frontend/src/lib/recovery.js');
  const result = recoveryMetrics({ completeByDay, sessions: [
    activity('1', '2026-10-17'), activity('2', end), activity('3', '2026-10-10', { activityTrainingLoad: 50 }),
    activity('4', '2026-10-09'), activity('5', '2026-10-24'), activity('6', end, { status: 'planned' }),
  ] }, end);
  assert.equal(result.current.load, 160); assert.equal(result.current.minutes, 80);
  assert.equal(result.current.count, 2); assert.equal(result.current.complete, true);
  assert.equal(result.previous.load, 50); assert.equal(result.loadChange, 110);
  const rest = recoveryMetrics({ completeByDay }, end);
  assert.equal(rest.current.load, 0); assert.equal(rest.current.minutes, 0); assert.equal(rest.loadChange, 0);
});

test('missing or partial load data never imply rest or a definitive comparison', async () => {
  const { recoveryMetrics } = await import('../frontend/src/lib/recovery.js');
  const empty = recoveryMetrics(null, end);
  assert.equal(empty.current.load, null); assert.equal(empty.current.minutes, null); assert.equal(empty.loadChange, null);
  const partial = recoveryMetrics({ completeByDay, sessions: [activity('1', end), activity('2', end, { activityTrainingLoad: null })] }, end);
  assert.equal(partial.current.load, 80); assert.equal(partial.current.loadCount, 1);
  assert.equal(partial.current.loadComplete, false); assert.equal(partial.loadChange, null);
  const missing = recoveryMetrics({ completeByDay: { ...completeByDay, [end]: false }, sessions: [activity('1', end)] }, end);
  assert.equal(missing.current.complete, false); assert.equal(missing.current.load, 80); assert.equal(missing.loadChange, null);
});

test('VO2 compares distinct dates in the same sport, regardless of response ordering', async () => {
  const { recoveryMetrics } = await import('../frontend/src/lib/recovery.js');
  const sessions = [
    activity('1', '2026-09-25', { activityType: 'running', vo2Max: 20 }),
    activity('2', '2026-10-22', { activityType: 'cycling', vo2Max: 55 }),
    activity('3', '2026-10-20', { activityType: 'running', vo2Max: 48 }),
    activity('4', end, { activityType: 'running', vo2Max: 50, time: '18:00' }),
    activity('5', end, { activityType: 'running', vo2Max: 49, time: '08:00' }),
    activity('6', '2026-10-24', { activityType: 'running', vo2Max: 60 }),
  ];
  const result = recoveryMetrics({ sessions }, end);
  assert.equal(result.latestVo2.id, '4'); assert.equal(result.previousVo2.id, '3');
  assert.equal(recoveryMetrics({ sessions: sessions.filter(session => session.id !== '3') }, end).previousVo2, null);
  assert.equal(recoveryMetrics({ sessions: [activity('7', end, { vo2Max: 0 })] }, end).latestVo2, null);
});

test('sleep and heart averages include only measured days within their own windows', async () => {
  const { recoveryMetrics } = await import('../frontend/src/lib/recovery.js');
  const result = recoveryMetrics({ daily: [
    { date: '2026-10-15', sleepScore: 10, heartRateReferenceBpm: 100 },
    { date: '2026-10-16', sleepScore: 20, heartRateReferenceBpm: 60 },
    { date: '2026-10-17', sleepScore: 80, heartRateReferenceBpm: 50 },
    { date: '2026-10-18', sleepScore: null, heartRateReferenceBpm: null },
    { date: end, sleepScore: 90, heartRateReferenceBpm: 80 },
    { date: '2026-10-24', sleepScore: 100, heartRateReferenceBpm: 100 },
  ] }, end);
  assert.deepEqual(result.sleep, { value: 85, count: 2 });
  assert.deepEqual(result.heart, { value: 55, count: 2 });
});
