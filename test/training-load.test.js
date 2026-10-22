'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('activity totals and calendar cover exactly the selected range, excluding future, external and planned sessions', async () => {
  const { trainingLoad } = await import('../frontend/src/lib/training-load.js');
  const completed = (date, durationMinutes) => ({ date, durationMinutes, status: 'completed' });
  const range = { from: '2026-10-16', to: '2026-10-22' };
  const result = trainingLoad([
    completed('2026-10-16', 30), completed('2026-10-22', 45), completed('2026-10-22', 75),
    completed('2026-10-15', 90), completed('2026-10-23', 90),
    { date: '2026-10-22', durationMinutes: 300, status: 'planned' },
    completed('2026-10-20', -45), completed('2026-10-20', NaN), completed('2026-10-20', '45'),
  ], range, '2026-10-22');
  assert.equal(result.daily.length, 7); assert.equal(result.minutes, 150);
  assert.equal(result.sessions, 3); assert.equal(result.activeDays, 2);
  assert.deepEqual(result.daily.at(-1), { day: '2026-10-22', minutes: 120, value: 2, sessions: 2 });
  const day = trainingLoad([completed('2026-10-22', 45)], { from: range.to, to: range.to });
  assert.equal(day.daily.length, 1); assert.equal(day.minutes, 45);
});

test('inclusive ranges preserve leap days and year boundaries without hidden month expansion', async () => {
  const { trainingLoad } = await import('../frontend/src/lib/training-load.js');
  assert.deepEqual(trainingLoad([], { from: '2024-02-28', to: '2024-03-01' }).daily.map(day => day.day), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.deepEqual(trainingLoad([], { from: '2026-12-31', to: '2027-01-01' }).daily.map(day => day.day), ['2026-12-31', '2027-01-01']);
});

test('fixed hour thresholds and colors keep activity load comparable across intervals', async () => {
  const { trainingIntensity, trainingColors } = await import('../frontend/src/lib/training-load.js');
  assert.deepEqual([0, 0.01, 0.99, 1, 1.99, 2, 2.99, 3, 6].map(trainingIntensity), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const colors = trainingColors('#253745', '#eeeeee');
  assert.equal(colors.length, 5); assert.equal(colors[0], '#eeeeee');
  assert.equal(colors.at(-1), '#253745'); assert.equal(new Set(colors).size, 5);
});
