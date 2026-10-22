'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('two-month pages show the previous/current pair and move two months per step across year boundaries', async () => {
  const { trainingMonthPair, trainingLoad } = await import('../frontend/src/lib/training-load.js');
  const current = trainingMonthPair('2026-10-22');
  assert.deepEqual(current.months.map(month => month.from), ['2026-09-01', '2026-10-01']);
  assert.deepEqual(trainingMonthPair('2026-10-22', -1).months.map(month => month.from), ['2026-07-01', '2026-08-01']);
  assert.deepEqual(trainingMonthPair('2026-10-22', 1).months.map(month => month.from), ['2026-11-01', '2026-12-01']);
  assert.deepEqual(trainingMonthPair('2027-01-31').months.map(month => month.from), ['2026-12-01', '2027-01-01']);
  assert.deepEqual(trainingMonthPair('2027-01-31', -1).months.map(month => month.from), ['2026-10-01', '2026-11-01']);
  assert.deepEqual(trainingMonthPair('2027-01-31', 1).months.map(month => month.from), ['2027-02-01', '2027-03-01']);
  const load = trainingLoad([
    { date: '2026-09-01', durationMinutes: 45, status: 'completed' },
    { date: '2026-10-22', durationMinutes: 80, status: 'completed' },
  ], current, '2026-10-22');
  assert.equal(load.minutes, 125);
  assert.equal(load.daily.length, 61);
  assert.equal(load.daily[0].day, '2026-09-01');
  assert.equal(load.daily.at(-1).day, '2026-10-31');
});

test('month navigation preserves full months across years, leap days and short months', async () => {
  const { trainingMonth } = await import('../frontend/src/lib/training-load.js');
  const current = trainingMonth('2026-10-22');
  assert.equal(current.from, '2026-10-01');
  assert.equal(current.to, '2026-10-31');
  assert.equal(trainingMonth('2026-10-31', 1).from, '2026-11-01');
  assert.equal(trainingMonth('2026-10-31', 1).to, '2026-11-30');
  assert.equal(trainingMonth('2027-01-31', -1).from, '2026-12-01');
  assert.equal(trainingMonth('2026-12-31', 1).to, '2027-01-31');
  assert.equal(trainingMonth('2024-03-31', -1).to, '2024-02-29');
  assert.equal(trainingMonth('2027-03-31', -1).to, '2027-02-28');
  for (const month of [current, trainingMonth('2024-02-01'), trainingMonth('2026-02-01')]) {
    assert.equal(new Date(`${month.gridStart}T12:00:00Z`).getUTCDay(), 1);
    assert.equal(new Date(`${month.gridEnd}T12:00:00Z`).getUTCDay(), 1);
    assert.ok(month.gridStart <= month.from);
    assert.ok(month.gridEnd > month.to);
  }
});

test('the whole month has cells, while only completed sessions through today contribute to daily load', async () => {
  const { trainingMonth, trainingLoad } = await import('../frontend/src/lib/training-load.js');
  const completed = (date, durationMinutes) => ({ date, durationMinutes, status: 'completed' });
  const load = trainingLoad([
    completed('2026-10-01', 30),
    completed('2026-10-22', 45), completed('2026-10-22', 75),
    { date: '2026-10-22', durationMinutes: 300, status: 'planned' },
    completed('2026-09-30', 90), completed('2026-10-23', 90),
    completed('2026-10-20', 0), completed('2026-10-20', -45),
    completed('2026-10-20', NaN), completed('2026-10-20', '45'),
  ], trainingMonth('2026-10-22'), '2026-10-22');
  assert.equal(load.daily.length, 31);
  assert.equal(load.minutes, 150);
  assert.equal(load.sessions, 3);
  assert.equal(load.activeDays, 2);
  assert.deepEqual(load.daily[0], { day: '2026-10-01', minutes: 30, value: 0.5, sessions: 1 });
  assert.deepEqual(load.daily[21], { day: '2026-10-22', minutes: 120, value: 2, sessions: 2 });
  assert.deepEqual(load.daily[1], { day: '2026-10-02', minutes: 0, value: 0, sessions: 0 });
  assert.deepEqual(load.daily.at(-1), { day: '2026-10-31', minutes: 0, value: 0, sessions: 0 });
  assert.ok(load.daily.slice(22).every(day => day.value === 0));
});

test('viewing a past or future month filters sessions and always includes its first and last day', async () => {
  const { trainingMonth, trainingLoad } = await import('../frontend/src/lib/training-load.js');
  const sessions = [
    { date: '2026-09-01', durationMinutes: 45, status: 'completed' },
    { date: '2026-09-30', durationMinutes: 60, status: 'completed' },
    { date: '2026-10-22', durationMinutes: 80, status: 'completed' },
    { date: '2026-11-01', durationMinutes: 90, status: 'completed' },
  ];
  const previous = trainingLoad(sessions, trainingMonth('2026-10-22', -1), '2026-10-22');
  assert.equal(previous.minutes, 105);
  assert.equal(previous.activeDays, 2);
  assert.equal(previous.daily.length, 30);
  assert.equal(previous.daily[0].minutes, 45);
  assert.equal(previous.daily.at(-1).minutes, 60);
  const future = trainingLoad(sessions, trainingMonth('2026-10-22', 1), '2026-10-22');
  assert.equal(future.minutes, 0);
  assert.equal(future.activeDays, 0);
  assert.equal(future.sessions, 0);
  assert.equal(future.daily.length, 30);
  assert.ok(future.daily.every(day => day.value === 0));
  const leap = trainingLoad([], trainingMonth('2024-02-01'), '2024-02-01');
  assert.equal(leap.daily.length, 29);
  assert.equal(leap.daily.at(-1).day, '2024-02-29');
});

test('monthly totals update when a session reverts to planned', async () => {
  const { trainingMonth, trainingLoad } = await import('../frontend/src/lib/training-load.js');
  const sessions = [{ date: '2026-10-22', durationMinutes: 80, status: 'completed' }];
  const month = trainingMonth('2026-10-22');
  assert.equal(trainingLoad(sessions, month, '2026-10-22').minutes, 80);
  sessions[0].status = 'planned';
  const empty = trainingLoad(sessions, month, '2026-10-22');
  assert.equal(empty.minutes, 0);
  assert.equal(empty.activeDays, 0);
  assert.equal(empty.sessions, 0);
  assert.ok(empty.daily.every(day => day.value === 0));
});

test('hour bands have fixed thresholds and the selected theme supplies the accent scale', async () => {
  const { trainingIntensity, trainingColors } = await import('../frontend/src/lib/training-load.js');
  assert.deepEqual([0, 0.01, 0.99, 1, 1.99, 2, 2.99, 3, 6].map(trainingIntensity), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  const colors = trainingColors('#253745', '#eeeeee');
  assert.equal(colors.length, 5);
  assert.equal(colors[0], '#eeeeee');
  assert.equal(colors.at(-1), '#253745');
  assert.equal(new Set(colors).size, 5);
});
