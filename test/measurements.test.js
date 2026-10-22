'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY, setup } = require('./helpers');
const { dateInZone, shiftDate } = require('../helpers/garmin-dates');
const { normalizeMeasurements } = require('../helpers/garmin-measurements');
const { parseGarminJson } = require('../helpers/garmin-http');
const { rangesFor } = require('../helpers/dashboard-measurements');
const summary = require('../controllers/garmin-summary-daily');

const to = dateInZone('Europe/Rome');
const from = shiftDate(to, -13);
const input = { from, to, activityFrom: shiftDate(to, -20), activityTo: to, timeZone: 'Europe/Rome' };
const values = { firstName: 'Tester', lastName: 'Garmin', primarySport: 'running', apiKey: TEST_API_KEY };

async function fixture(t) {
  const app = await accountApplication(t, { measurements: true });
  const a = await app.register(values);
  return { ...app, a };
}

test('dashboard: first import, typed measures, cache, real forced refresh and per-account isolation', async t => {
  const { a, provider, register } = await fixture(t);
  const sync = async force => {
    const response = await a.api('/garmin/sync', { method: 'POST', body: { ...input, force } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const result = await sync(false);
  const last = result.measurements.daily.at(-1);
  assert.equal(last.heartRateReferenceBpm, 57);
  assert.equal(last.hrv, 48); assert.equal(last.sleepMinutes, 480);
  assert.equal(last.deep + last.light + last.rem, 465, 'Total sleep must not be derived from stages');
  assert.equal(result.activities.sessions[0].id, '9007199254740997');
  assert.equal(result.activities.sessions[0].durationMinutes, 2700.5 / 60);
  assert.equal(result.activities.complete, true);
  const calls = provider.state.dataRequests;
  assert.equal(calls, 5, 'Settings + three daily endpoints + one activity page');
  await sync(false);
  assert.equal(provider.state.dataRequests, calls, 'Fresh cache should not contact Garmin');
  await sync(true);
  assert.equal(provider.state.dataRequests, calls + 4, 'Force reloads every displayed resource');
  assert.equal(provider.state.tokenRequests, 1);
  const b = await register({ ...values, apiKey: undefined });
  const other = await (await b.api('/dashboard', { headers: { 'X-Profile-Id': a.profile.id } })).json();
  assert.deepEqual(other.measurements.daily, []); assert.deepEqual(other.activities.sessions, []);
  assert.equal((await b.api('/garmin/sync', { method: 'POST', body: input })).status, 503);
  assert.equal((await a.api('/garmin/sync', { method: 'POST', headers: { 'X-CSRF-Token': '' }, body: input })).status, 403);
});

test('interval navigation fetches ad hoc dates, and partial provider failures preserve cached data', async t => {
  const { a, provider } = await fixture(t);
  await a.api('/garmin/sync', { method: 'POST', body: input });
  const older = { ...input, view: 'wellness', from: shiftDate(to, -43), to: shiftDate(to, -30), resources: ['wellness', 'hrv', 'sleep'] };
  const response = await a.api('/garmin/sync', { method: 'POST', body: older });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.measurements.daily.length, 14);
  assert.equal(result.measurements.daily[0].date, older.from);
  const lastCall = provider.state.requests.filter(row => row.path.endsWith('dailySleepSummariesByDate')).at(-1);
  assert.equal(lastCall.query.startDate, older.from);
  provider.state.resourceStatus.sleep = 500;
  provider.state.resourceBodies.wellness = { data: [{ userProfilePk: '9007199254740993', calendarDate: older.to, source: 'garmin', heartRate: { restingValue: 60 }, bodyBattery: { latestValue: 80 }, stress: { avgLevel: 20 } }] };
  const partial = await (await a.api('/garmin/sync', { method: 'POST', body: { ...older, force: true } })).json();
  assert.equal(partial.measurements.daily.at(-1).sleepMinutes, 480);
  assert.equal(partial.measurements.daily.at(-1).heartRateReferenceBpm, 60);
  assert.equal(partial.measurements.sync.sleep.state, 'stale');
  assert.equal(partial.measurements.state, 'partial');
});

test('key rotation fences in-flight writes; a different provider identity never merges histories', async t => {
  const { a, provider, database } = await fixture(t);
  await a.api('/garmin/sync', { method: 'POST', body: input });
  const old = await database.getGarminConnection(a.profile.id);
  provider.state.dataDelayMs = 100;
  const pending = a.api('/garmin/sync', { method: 'POST', body: { ...input, force: true } });
  await new Promise(resolve => setTimeout(resolve, 30));
  await a.api('/profile', { method: 'PATCH', body: { ...values, apiKey: TEST_API_KEY } });
  assert.equal((await pending).status, 409);
  provider.state.dataDelayMs = 0;
  provider.state.measurementIdentity = '9007199254740995';
  provider.state.resourceStatus.hrv = 204;
  const fresh = await a.api('/garmin/sync', { method: 'POST', body: input });
  assert.equal(fresh.status, 200, await fresh.clone().text());
  const current = await database.getGarminConnection(a.profile.id);
  assert.notEqual(current.id, old.id);
  assert.equal(current.identity, '9007199254740995');
  assert.equal((await fresh.json()).measurements.daily.at(-1).hrv, null, 'Do not carry the previous account HRV into the new connection');
});

test('429 is persisted and respected, without deleting good measurements', async t => {
  const { a, provider } = await fixture(t);
  await a.api('/garmin/sync', { method: 'POST', body: input });
  provider.state.resourceStatus.hrv = 429;
  const partial = await (await a.api('/garmin/sync', { method: 'POST', body: { ...input, force: true } })).json();
  assert.equal(partial.measurements.daily.at(-1).hrv, 48);
  assert.equal(partial.measurements.sync.hrv.errorCode, 'GARMIN_RATE_LIMIT');
  const calls = provider.state.dataRequests;
  const limited = await a.api('/garmin/sync', { method: 'POST', body: { ...input, force: true } });
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
  assert.equal(provider.state.dataRequests, calls);
});

test('missing days, unsupported REM and malformed dates do not turn into fake zero values', () => {
  const result = normalizeMeasurements('sleep', [{ calendarDate: to, userProfilePK: '123', sleepTimeSeconds: 3600, deviceRemCapable: false }], [from, to]);
  assert.equal(result.records[0].values, null);
  assert.equal(result.records[1].values.sleepMinutes, 60);
  assert.equal(result.records[1].values.rem, null);
  assert.equal(result.records[1].availability.rem, 'not_supported');
  assert.equal(result.records[1].values.light, null);
  assert.throws(() => normalizeMeasurements('wellness', { data: [{ calendarDate: '2026-02-30' }] }, [to]));
  assert.throws(() => rangesFor({ from: shiftDate(to, -200), to }, 'Europe/Rome'));
  assert.equal(parseGarminJson('{"id":9007199254740993}').id, '9007199254740993');
  assert.equal(rangesFor({ ...input, to: shiftDate(to, 1) }, 'Europe/Rome').to, to, 'Never fetch a future day when browser and Garmin dates differ');
});

test('endpoint controller validates intervals and reports wrong envelopes before persistence', async t => {
  const provider = await setup(t, { measurements: true });
  await assert.rejects(summary(provider.client, { startDate: '2026-02-30', endDate: to }), { code: 'INVALID_DATE_RANGE' });
  assert.equal(provider.state.tokenRequests, 0);
  provider.state.resourceBodies.wellness = [];
  await assert.rejects(summary(provider.client, { startDate: from, endDate: to }), { code: 'GARMIN_INVALID_RESPONSE' });
});


test('a temporary empty response keeps the previous values explicitly marked as missing', async t => {
  const { a, provider } = await fixture(t);
  await a.api('/garmin/sync', { method: 'POST', body: input });
  provider.state.resourceStatus.sleep = 204;
  const result = await (await a.api('/garmin/sync', { method: 'POST', body: { ...input, force: true } })).json();
  assert.equal(result.measurements.daily.at(-1).sleepMinutes, 480);
  assert.equal(result.measurements.daily.at(-1).availability.sleepMinutes, 'not_in_latest_response');
  assert.equal(result.measurements.sync.sleep.state, 'fresh');
  assert.equal(result.measurements.sync.sleep.complete, false);
  assert.equal(result.measurements.sync.sleep.errorCode, null);
  assert.equal(result.measurements.sync.sleep.dataState, 'cached');
});

test('an incomplete activity pagination never publishes definitive totals', async t => {
  const { a, provider } = await fixture(t);
  await a.api('/garmin/sync', { method: 'POST', body: input });
  provider.state.resourceBodies.activities = Array.from({ length: 99 }, (_, index) => ({ activityId: index + 1, ownerId: '9007199254740993', startTimeLocal: `${to} 07:00:00`, duration: 100 }));
  const result = await (await a.api('/garmin/sync', { method: 'POST', body: { ...input, force: true, resources: ['activities'] } })).json();
  assert.equal(result.activities.errorCode, 'GARMIN_RANGE_INCOMPLETE');
  assert.equal(result.activities.state, 'stale');
  assert.equal(result.activities.sessions[0].id, '9007199254740997', 'Previous complete snapshot is preserved');
});
