'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY } = require('./helpers');
const { dateInZone, shiftDate } = require('../helpers/garmin-dates');
const { rangesFor } = require('../helpers/dashboard-measurements');

const today = dateInZone('Europe/Rome');
const values = { firstName: 'Test', lastName: 'Planner', primarySport: 'running', apiKey: TEST_API_KEY };

test('planner imports only the selected week, reuses cache and keeps Garmin records separate from local CRUD', async t => {
  const { register, provider } = await accountApplication(t, { measurements: true });
  const a = await register(values);
  await a.api('/dashboard/layout', { method: 'PUT', body: { version: 3, sections: { overview: [], wellness: [] } } });
  const activityFrom = shiftDate(today, -13), activityTo = shiftDate(today, -7);
  const scope = { view: 'plan', activityFrom, activityTo, timeZone: 'Europe/Rome' };
  const local = await (await a.api('/sessions', { method: 'POST', body: { title: 'My workout', sport: 'running', date: activityTo, time: '18:00', durationMinutes: 45 } })).json();
  const initial = await (await a.api(`/dashboard?${new URLSearchParams(scope)}`)).json();
  assert.deepEqual(initial.requirements, { activities: { from: activityFrom, to: activityTo } });
  assert.deepEqual(initial.activities.range, { from: activityFrom, to: activityTo });
  assert.equal(initial.sessions[0].id, local.id);
  assert.equal(provider.state.dataRequests, 0, 'Reading the plan never calls Garmin');
  const response = await a.api('/garmin/sync', { method: 'POST', body: scope });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.activities.complete, true);
  assert.ok(result.activities.sessions.length);
  assert.ok(result.activities.sessions.every(session => session.date >= activityFrom && session.date <= activityTo));
  const search = provider.state.requests.find(row => row.path.includes('/activities/search/activities'));
  assert.equal(search.query.startDate, activityFrom); assert.equal(search.query.endDate, activityTo);
  assert.equal(provider.state.dataRequests, 2, 'Only settings and activity search');
  const requests = provider.state.dataRequests;
  await a.api('/garmin/sync', { method: 'POST', body: scope });
  assert.equal(provider.state.dataRequests, requests, 'Fresh weeks reuse the imported cache');
  const cached = await (await a.api(`/dashboard?${new URLSearchParams(scope)}`)).json();
  assert.equal(cached.sessions.length, 1, 'Imported activities never become local sessions');
  const garminId = result.activities.sessions[0].id;
  assert.equal((await a.api(`/sessions/${garminId}`, { method: 'PATCH', body: { status: 'planned' } })).status, 404);
  assert.equal((await a.api(`/sessions/${garminId}`, { method: 'DELETE' })).status, 404);
  const b = await register(values);
  const other = await (await b.api(`/dashboard?${new URLSearchParams(scope)}`)).json();
  assert.deepEqual(other.activities.sessions, []); assert.deepEqual(other.sessions, []);
  provider.state.resourceStatus.activities = 503;
  const failed = await (await a.api('/garmin/sync', { method: 'POST', body: { ...scope, force: true } })).json();
  assert.ok(failed.activities.errorCode);
  assert.deepEqual(failed.activities.sessions, cached.activities.sessions, 'An upstream failure retains the imported week');
  assert.equal((await (await a.api(`/dashboard?${new URLSearchParams(scope)}`)).json()).sessions[0].id, local.id);
});

test('planner handles current, future and old weeks without requesting future or unsupported dates', async t => {
  const { register, provider } = await accountApplication(t, { measurements: true });
  const a = await register(values);
  const range = rangesFor({ view: 'plan' }, 'Europe/Rome');
  assert.equal(new Date(`${range.activityFrom}T12:00:00Z`).getUTCDay(), 1);
  assert.equal(range.activityTo, shiftDate(range.activityFrom, 6));
  assert.equal(range.activityDays.at(-1), today);
  for (const start of [shiftDate(today, 7), shiftDate(today, -400)]) {
    const scope = { view: 'plan', activityFrom: start, activityTo: shiftDate(start, 6), timeZone: 'Europe/Rome' };
    const result = await (await a.api('/garmin/sync', { method: 'POST', body: scope })).json();
    assert.deepEqual(result.requirements, {}); assert.deepEqual(result.activities.sessions, []);
  }
  assert.equal(provider.state.dataRequests, 0); assert.equal(provider.state.tokenRequests, 0);
  const clipped = rangesFor({ view: 'plan', activityFrom: shiftDate(today, -368), activityTo: shiftDate(today, -362) }, 'Europe/Rome');
  assert.equal(clipped.activityDays[0], shiftDate(today, -365));
  assert.throws(() => rangesFor({ view: 'plan', activityFrom: today, activityTo: shiftDate(today, 7) }, 'Europe/Rome'));
  const noKey = await register({ ...values, apiKey: null });
  const localOnly = await noKey.api('/dashboard?view=plan');
  assert.equal(localOnly.status, 200); assert.deepEqual((await localOnly.json()).activities.sessions, []);
  assert.equal(provider.state.dataRequests, 0);
});

test('planner merges both sources chronologically with unique keys and daily and weekly duration totals', async () => {
  const { plannerWeek } = await import('../frontend/src/lib/planner.js');
  const { weekDays } = await import('../frontend/src/lib/dates.js');
  const days = weekDays('2026-10-23');
  const local = [{ id: '1', date: days[0], time: '18:00', durationMinutes: 45 }, { id: '2', date: days[1], time: '', durationMinutes: 15 }];
  const imported = [{ id: '1', date: days[0], time: '07:00', durationMinutes: 30, manual: true },
    { id: '3', date: days[0], time: null, durationMinutes: 10 }, { id: '4', date: '2026-10-18', durationMinutes: 900 }];
  const week = plannerWeek(local, imported, days);
  assert.deepEqual(week.entries.map(session => session.key), ['garmin:3', 'garmin:1', 'local:1', 'local:2']);
  assert.equal(week.entries[1].source, 'garmin', 'A manual activity on Connect remains an imported read-only record');
  assert.equal(week.minutes, 100); assert.equal(week.days[0].minutes, 85); assert.equal(week.days[1].minutes, 15);
  assert.equal(week.days[2].sessions.length, 0);
  assert.equal(local[0].source, undefined, 'Preparing the calendar does not mutate stored records');
});
