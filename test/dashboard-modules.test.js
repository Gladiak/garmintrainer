'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY } = require('./helpers');
const { dateInZone, shiftDate } = require('../helpers/garmin-dates');
const { normalizeSeries } = require('../helpers/garmin-series');
const { validateLayout, moduleRequirements } = require('../helpers/dashboard-layout');
const { measurementsFor } = require('../postman/mocks/garmin/measurements');

const today = dateInZone('Europe/Rome');
const values = { firstName: 'Test', lastName: 'Modules', primarySport: 'running', apiKey: TEST_API_KEY };
const layout = (...types) => ({ version: 1, modules: types.map((type, i) => ({ type, id: `module-${i}` })) });
async function fixture(t, ...types) {
  const app = await accountApplication(t, { measurements: true });
  const a = await app.register(values);
  assert.equal((await a.api('/dashboard/layout', { method: 'PUT', body: layout(...types) })).status, 200);
  const sync = async body => {
    const response = await a.api('/garmin/sync', { method: 'POST', body: { timeZone: 'Europe/Rome', ...body } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return { ...app, a, sync };
}

test('daily cards default to today and share one V2 request without hidden history', async t => {
  const { sync, provider } = await fixture(t, 'heart-card', 'battery-card', 'stress-card');
  const result = await sync({});
  assert.deepEqual(result.measurements.range, { from: today, to: today });
  assert.equal(result.measurements.daily.length, 1);
  assert.deepEqual(Object.keys(result.requirements), ['wellness']);
  assert.equal(provider.state.dataRequests, 2, 'Settings and a single V2, no sleep/HRV/activities');
  const summary = provider.state.requests.find(row => row.path.endsWith('/v2/dailysummaries'));
  assert.equal(summary.query.startDate, today); assert.equal(summary.query.endDate, today);
  const day = result.measurements.daily[0];
  assert.equal(day.stress, 23); assert.equal(day.stressMax, 72);
  assert.equal(day.stressRestSeconds, 28800);
  const calls = provider.state.dataRequests;
  await sync({});
  assert.equal(provider.state.dataRequests, calls);
  await sync({ force: true });
  assert.equal(provider.state.dataRequests, calls + 1);
});

test('min/max modules use V2 over the selected period; cards and duplicate modules reuse it', async t => {
  const { sync, provider } = await fixture(t, 'heart-rate', 'body-battery', 'battery-card', 'body-battery');
  const from = shiftDate(today, -6);
  const result = await sync({ from, to: today });
  assert.equal(provider.state.dataRequests, 2);
  assert.deepEqual(result.requirements, { wellness: { from, to: today } });
  assert.equal(result.measurements.daily.length, 7);
  assert.equal(result.measurements.daily[0].heartRateMinBpm, 44);
  assert.equal(result.measurements.daily[0].heartRateMaxBpm, 152);
  assert.equal(result.measurements.daily[0].bodyBatteryMin, 12);
  assert.equal(result.measurements.daily[0].bodyBatteryMax, 91);
  assert.deepEqual(result.measurements.details, {});
  assert.ok(!provider.state.requests.some(row => /dailyHeartRate|reports\/daily/.test(row.path)));
});

test('day charts retrieve, normalize and cache only the day and the HRV night', async t => {
  const { sync, provider } = await fixture(t, 'heart-rate', 'body-battery', 'hrv');
  const result = await sync({});
  assert.equal(provider.state.dataRequests, 4, 'Settings + three detail endpoints');
  const details = result.measurements.details;
  assert.equal(details['heart-rate-day'].points.length, 7);
  assert.equal(details['body-battery-day'].points[0].value, 74);
  assert.equal(details['hrv-night'].summary, 48);
  assert.ok(details['hrv-night'].points[0].timestamp < Date.parse(`${today}T00:00:00Z`), 'Keep previous-evening readings');
  await sync({});
  assert.equal(provider.state.dataRequests, 4);
});

test('planner-only layout has no Garmin traffic and layouts are per account with CSRF validation', async t => {
  const { a, register, provider, database, sync } = await fixture(t, 'planner');
  await a.api('/profile', { method: 'PATCH', body: { ...values, apiKey: null } });
  const result = await sync({});
  assert.deepEqual(result.requirements, {});
  assert.equal(provider.state.dataRequests, 0); assert.equal(provider.state.tokenRequests, 0);
  const b = await register();
  const other = await (await b.api('/dashboard', { headers: { 'X-Profile-Id': a.profile.id } })).json();
  assert.notDeepEqual(other.layout, layout('planner'));
  assert.deepEqual(await database.getDashboardLayout(a.profile.id), validateLayout(layout('planner')));
  assert.equal((await a.api('/dashboard/layout', { method: 'PUT', headers: { 'X-CSRF-Token': '' }, body: layout() })).status, 403);
  assert.equal((await a.api('/dashboard/layout', { method: 'PUT', body: layout('__proto__') })).status, 400);
  assert.throws(() => validateLayout({ version: 1, modules: [{ type: 'heart-card', id: 'same' }, { type: 'stress', id: 'same' }] }));
});

test('failed historical window does not mark another window as failed; removing modules removes their requests', async t => {
  const { a, sync, provider } = await fixture(t, 'heart-rate', 'body-battery', 'stress-card');
  const range = { from: shiftDate(today, -13), to: today };
  await sync(range);
  provider.state.resourceStatus.wellness = 500;
  const older = { from: shiftDate(today, -27), to: shiftDate(today, -14), force: true };
  assert.equal((await sync(older)).resourceStates.wellness.errorCode, 'GARMIN_REQUEST_FAILED');
  const cached = await (await a.api(`/dashboard?${new URLSearchParams(range)}`)).json();
  assert.equal(cached.resourceStates.wellness.errorCode, null);
  provider.state.resourceStatus.wellness = 200;
  await a.api('/dashboard/layout', { method: 'PUT', body: layout('sleep') });
  const before = provider.state.dataRequests;
  await sync(range);
  assert.equal(provider.state.dataRequests, before + 1);
  assert.ok(provider.state.requests.at(-1).path.includes('dailySleepSummariesByDate'));
});

test('old cached rows without the new min/max mapping are reimported only for their missing day', async t => {
  const { a, sync, provider, database } = await fixture(t, 'heart-rate');
  const from = shiftDate(today, -6);
  await sync({ from, to: today });
  const connection = await database.getGarminConnection(a.profile.id);
  const date = shiftDate(today, -3);
  const [row] = await database.readGarminRows(a.profile.id, connection.id, 'wellness', [date]);
  delete row.schemaVersion; delete row.values.heartRateMinBpm;
  await database.acquireGarminSync(a.profile.id, 'test-writer');
  await database.saveGarminRows(a.profile, connection.id, 'wellness', [row], 'test-writer');
  await database.releaseGarminSync(a.profile.id, 'test-writer');
  const before = provider.state.dataRequests;
  await sync({ from, to: today });
  assert.equal(provider.state.dataRequests, before + 1);
  assert.deepEqual(provider.state.requests.at(-1).query, { startDate: date, endDate: date });
});

test('series descriptor positions, unsupported shapes and null sentinels never create invented samples', () => {
  const url = new URL(`http://localhost/wellness-service/wellness/dailyHeartRate?date=${today}`);
  const payload = JSON.parse(measurementsFor(url).body);
  payload.heartRateValues[1][1] = -1;
  const result = normalizeSeries('heart-rate-day', payload, today);
  assert.equal(result.records[0].values.points[1].value, null);
  payload.heartRateValueDescriptors = [];
  assert.throws(() => normalizeSeries('heart-rate-day', payload, today), { code: 'GARMIN_INVALID_RESPONSE' });
  assert.deepEqual(moduleRequirements(layout('heart-card', 'sleep'), shiftDate(today, -6), today), {
    wellness: { from: today, to: today }, sleep: { from: shiftDate(today, -6), to: today },
  });
});

test('refreshing a daily card inside a longer dashboard downloads only its anchor day', async t => {
  const { sync, provider } = await fixture(t, 'heart-rate', 'battery-card');
  const range = { from: shiftDate(today, -13), to: today };
  await sync(range);
  const before = provider.state.dataRequests;
  await sync({ ...range, force: true, moduleId: 'module-1' });
  assert.equal(provider.state.dataRequests, before + 1);
  assert.deepEqual(provider.state.requests.at(-1).query, { startDate: today, endDate: today });
});

test('activity metadata comes from search summaries without additional detail requests', async t => {
  const { sync, provider } = await fixture(t, 'activities');
  const result = await sync({});
  const activity = result.activities.sessions[0];
  assert.equal(activity.activityType, 'running'); assert.equal(activity.time, '07:00');
  assert.equal(activity.distanceMeters, 8250); assert.equal(activity.averageHeartRateBpm, 144);
  assert.equal(activity.caloriesKcal, 520); assert.equal(activity.elevationGainMeters, 78);
  assert.equal(provider.state.dataRequests, 2, 'Settings and search, no activity detail endpoint');
  assert.ok(!provider.state.requests.some(row => row.path.startsWith('/activity-service/')));
});

test('separate views constrain overview to one day and keep the plan free of Garmin requests', async t => {
  const { register, provider } = await accountApplication(t, { measurements: true });
  const a = await register(values);
  const plan = await a.api('/garmin/sync', { method: 'POST', body: { view: 'plan' } });
  assert.equal(plan.status, 200); assert.deepEqual((await plan.json()).requirements, {});
  assert.equal(provider.state.dataRequests, 0); assert.equal(provider.state.tokenRequests, 0);
  const overview = await (await a.api('/dashboard?view=overview&timeZone=Europe%2FRome')).json();
  assert.deepEqual(overview.measurements.range, { from: today, to: today });
  assert.ok(overview.layout.sections.overview.some(module => module.type === 'training-status'));
  assert.ok(!Object.values(overview.layout.sections).flat().some(module => module.type === 'planner'));
  for (const endpoint of ['/dashboard?view=overview&period=7', '/dashboard?view=invalid']) {
    assert.equal((await a.api(endpoint)).status, 400);
  }
  const invalid = await a.api('/garmin/sync', { method: 'POST', body: { view: 'overview', from: shiftDate(today, -6), to: today } });
  assert.equal(invalid.status, 400); assert.equal(provider.state.dataRequests, 0);
});

test('wellness imports only selected physiological sources over its interval and reuses the cache', async t => {
  const { register, provider } = await accountApplication(t, { measurements: true });
  const a = await register(values);
  const body = { view: 'wellness', period: 14, timeZone: 'Europe/Rome' };
  const response = await a.api('/garmin/sync', { method: 'POST', body });
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.view, 'wellness'); assert.equal(result.measurements.daily.length, 14);
  assert.deepEqual(Object.keys(result.requirements).sort(), ['hrv', 'sleep', 'wellness']);
  assert.equal(provider.state.dataRequests, 4, 'settings and three summary endpoints, no activities or day readings');
  const day = result.measurements.daily.at(-1);
  assert.equal(day.respirationAvg, 15); assert.equal(day.spo2Avg, 97); assert.equal(day.steps, 8250);
  assert.equal(day.hrvStatus, 'BALANCED'); assert.equal(day.hrvBaselineLow, 40); assert.equal(day.hrvBaselineHigh, 62);
  assert.equal(day.hrvWeeklyAvg, 47); assert.equal(day.sleepScore, 82);
  await a.api('/garmin/sync', { method: 'POST', body });
  assert.equal(provider.state.dataRequests, 4);
  assert.equal((await a.api('/garmin/sync', { method: 'POST', body: { ...body, moduleId: 'overview-heart-card' } })).status, 400);
  const before = provider.state.dataRequests;
  assert.equal((await a.api('/garmin/sync', { method: 'POST', body: { ...body, force: true, moduleId: 'wellness-spo2-card', resources: ['wellness'] } })).status, 200);
  assert.equal(provider.state.dataRequests, before + 1);
  assert.deepEqual(provider.state.requests.at(-1).query, { startDate: today, endDate: today });
});

test('recovery retrieves its history once, keeping visible daily measurements and activities on the selected day', async t => {
  const { sync, provider } = await fixture(t, 'training-status', 'training-summary');
  const result = await sync({ view: 'overview' });
  assert.equal(provider.state.dataRequests, 5, 'settings, HRV, sleep, wellness and one activity search');
  assert.deepEqual(result.requirements.hrv, { from: today, to: today });
  assert.deepEqual(result.requirements.sleep, { from: shiftDate(today, -6), to: today });
  assert.deepEqual(result.requirements.wellness, { from: shiftDate(today, -7), to: today });
  assert.deepEqual(result.requirements.activities, { from: shiftDate(today, -27), to: today });
  assert.equal(result.measurements.daily.length, 1);
  assert.equal(result.trainingContext.daily.length, 8);
  assert.equal(result.trainingContext.daily.at(-1).sleepScore, 82);
  assert.equal(Object.keys(result.trainingContext.completeByDay).length, 28);
  assert.ok(Object.values(result.trainingContext.completeByDay).every(Boolean));
  assert.ok(result.activities.sessions.every(session => session.date === today));
  const activity = result.activities.sessions[0];
  assert.equal(activity.aerobicTrainingEffect, 3.2); assert.equal(activity.anaerobicTrainingEffect, 1.1);
  assert.equal(activity.activityTrainingLoad, 96); assert.equal(activity.vo2Max, 49);
  assert.equal(result.trainingStatus, undefined);
  await sync({ view: 'overview' });
  assert.equal(provider.state.dataRequests, 5, 'the historical ranges reuse the cache');
});

test('recovery history follows historical anchors, refreshes only its sources and disappears with the module', async t => {
  const { a, sync, provider } = await fixture(t, 'training-status', 'heart-rate');
  const anchor = shiftDate(today, -20);
  const input = { view: 'overview', from: anchor, to: anchor };
  const first = await sync(input);
  assert.equal(first.trainingContext.daily.at(-1).date, anchor);
  assert.equal(first.requirements.activities.from, shiftDate(anchor, -27));
  const before = provider.state.dataRequests;
  await sync({ ...input, moduleId: 'module-0', force: true });
  assert.equal(provider.state.dataRequests, before + 4, 'one request per summary source, no heart-rate detail refresh');
  await a.api('/dashboard/layout', { method: 'PUT', body: layout('heart-card') });
  const result = await sync(input);
  assert.deepEqual(result.requirements, { wellness: { from: anchor, to: anchor } });
  assert.equal(result.trainingContext, null);
});

test('physiological optional values stay missing or invalid without inferred health classifications', () => {
  const { normalizeMeasurements, normalizeActivities } = require('../helpers/garmin-measurements');
  const wellness = normalizeMeasurements('wellness', { data: [{ calendarDate: today, respiration: { avgValue: -99 }, pulseOx: { avgValue: 101 } }] }, [today]).records[0];
  assert.equal(wellness.values.respirationAvg, null); assert.equal(wellness.availability.respirationAvg, 'invalid');
  assert.equal(wellness.values.spo2Avg, null); assert.equal(wellness.values.steps, null);
  const hrv = normalizeMeasurements('hrv', { hrvSummaries: [{ calendarDate: today, lastNightAvg: 48, status: 'UNKNOWN' }] }, [today]).records[0];
  assert.equal(hrv.values.hrvStatus, null); assert.equal(hrv.values.hrvBaselineLow, null);
  const [record] = normalizeActivities([{ activityId: '123', startTimeLocal: `${today} 10:00:00`, duration: 600, aerobicTrainingEffect: -1, vO2MaxValue: 0 }], [today]).records;
  assert.equal(record.values[0].aerobicTrainingEffect, null); assert.equal(record.values[0].vo2Max, null);
});

test('stored v1 layout upgrades to separate editable sections and a fixed plan', () => {
  const { upgradeLayout, defaultLayout, viewModules } = require('../helpers/dashboard-layout');
  const old = layout('heart-card', 'hrv', 'sleep', 'stress', 'planner', 'activities');
  const upgraded = upgradeLayout(old);
  assert.equal(upgraded.version, 2);
  assert.deepEqual(upgraded.sections.overview.map(module => module.type), ['heart-card', 'activities', 'training-status']);
  assert.deepEqual(upgraded.sections.wellness, defaultLayout.sections.wellness);
  assert.deepEqual(viewModules(upgraded, 'plan'), [{ id: 'planner', type: 'planner' }]);
  assert.deepEqual(validateLayout(upgraded), upgraded);
  assert.throws(() => validateLayout({ version: 2, sections: { overview: [{ id: 'invalid', type: 'respiration' }], wellness: [] } }));
});

test('no measurements on first access is a neutral cached outcome, with no identity failure or invented owner', async t => {
  const { a, provider, database, sync } = await fixture(t, 'heart-card', 'sleep-card', 'hrv-card', 'activities', 'heart-rate', 'body-battery', 'hrv');
  for (const resource of ['wellness', 'sleep', 'hrv', 'activities', 'heart-rate-day', 'body-battery-day', 'hrv-night']) provider.state.resourceStatus[resource] = 204;
  const result = await sync({ view: 'overview' });
  assert.equal(await database.getGarminConnection(a.profile.id), null, 'empty replies never verify or create an identity');
  assert.deepEqual(result.measurements.daily, []);
  for (const state of Object.values(result.resourceStates)) {
    assert.equal(state.errorCode, null); assert.equal(state.dataState, 'no_data'); assert.equal(state.state, 'fresh');
    assert.equal(state.dataByDay[today], 'no_data'); assert.ok(state.checkedByDay[today]);
  }
  const calls = provider.state.dataRequests;
  const reread = await (await a.api('/dashboard?view=overview&timeZone=Europe%2FRome')).json();
  assert.equal(reread.resourceStates.wellness.dataState, 'no_data');
  assert.equal(provider.state.dataRequests, calls, 'reading status never contacts Garmin');
  await sync({ view: 'overview' });
  // Settings can be queried until identity verification; the data resources remain cached.
  assert.equal(provider.state.requests.filter(row => row.path !== '/userprofile-service/userprofile/settings' && row.method === 'GET').length, 7);
  const forced = await sync({ view: 'overview', force: true });
  assert.equal(forced.resourceStates.sleep.errorCode, null);
  assert.equal(provider.state.requests.filter(row => row.path !== '/userprofile-service/userprofile/settings' && row.method === 'GET').length, 14);
  provider.state.resourceStatus = {};
  const available = await sync({ view: 'overview', force: true });
  assert.ok(await database.getGarminConnection(a.profile.id));
  assert.equal(available.measurements.daily[0].heartRateReferenceBpm, 57);
  assert.equal(available.resourceStates.wellness.dataState, 'available');
});

test('a new empty day on an established connection is neutral and does not borrow yesterday readings', async t => {
  const { a, sync, provider, database } = await fixture(t, 'heart-card', 'sleep-card', 'hrv-card', 'activities');
  const yesterday = shiftDate(today, -1);
  await sync({ view: 'overview', from: yesterday, to: yesterday });
  const connection = await database.getGarminConnection(a.profile.id);
  provider.state.resourceStatus.wellness = 204;
  provider.state.resourceBodies.hrv = { userProfilePk: connection.identity, hrvSummaries: [] };
  provider.state.resourceBodies.sleep = [];
  provider.state.resourceBodies.activities = [];
  const result = await sync({ view: 'overview' });
  const day = result.measurements.daily[0];
  assert.equal(day.date, today); assert.equal(day.heartRateReferenceBpm, null); assert.equal(day.sleepMinutes, null);
  assert.equal(result.activities.complete, true); assert.deepEqual(result.activities.sessions, []);
  assert.ok(Object.values(result.resourceStates).every(state => state.errorCode === null && state.dataState === 'no_data'));
  const past = await (await a.api(`/dashboard?view=overview&from=${yesterday}&to=${yesterday}`)).json();
  assert.equal(past.measurements.daily[0].heartRateReferenceBpm, 57);
  const calls = provider.state.dataRequests;
  await sync({ view: 'overview' });
  assert.equal(provider.state.dataRequests, calls, 'empty days have a freshness TTL too');
});

test('an empty refresh retains existing readings neutrally, while actual provider failures stay errors', async t => {
  const { sync, provider } = await fixture(t, 'heart-card', 'sleep-card', 'heart-rate', 'body-battery', 'activities');
  await sync({ view: 'overview' });
  for (const resource of ['wellness', 'sleep', 'heart-rate-day', 'body-battery-day', 'activities']) provider.state.resourceStatus[resource] = 204;
  const result = await sync({ view: 'overview', force: true });
  assert.equal(result.measurements.daily[0].sleepMinutes, 480);
  assert.equal(result.measurements.details['heart-rate-day'].points.length, 7);
  for (const state of Object.values(result.resourceStates)) {
    assert.equal(state.errorCode, null); assert.equal(state.dataState, 'cached'); assert.equal(state.complete, false);
  }
  assert.equal(result.activities.complete, false, 'an empty replacement cannot turn previous activities into a definitive zero');
  provider.state.resourceStatus.sleep = 500;
  const failed = await sync({ view: 'overview', resources: ['sleep'], force: true });
  assert.equal(failed.resourceStates.sleep.errorCode, 'GARMIN_REQUEST_FAILED');
  assert.equal(failed.measurements.daily[0].sleepMinutes, 480);
});

test('empty or not-yet-recorded DTO fields are no data, but malformed payloads remain invalid', () => {
  const { normalizeMeasurements } = require('../helpers/garmin-measurements');
  for (const resource of ['wellness', 'hrv']) {
    assert.equal(normalizeMeasurements(resource, {}, [today]).records[0].values, null);
    assert.throws(() => normalizeMeasurements(resource, { error: 'bad envelope' }, [today]), { code: 'GARMIN_INVALID_RESPONSE' });
  }
  const missing = normalizeMeasurements('wellness', { data: [{ calendarDate: today, heartRate: { restingValue: -1 }, stress: { avgLevel: -1 } }] }, [today]);
  assert.equal(missing.partial, false); assert.equal(missing.records[0].availability.heartRateReferenceBpm, 'no_data');
  assert.equal(missing.records[0].values.heartRateReferenceBpm, null);
  for (const [resource, payload] of [['heart-rate-day', { heartRateValues: null }], ['hrv-night', { hrvReadings: null }], ['body-battery-day', []]]) {
    const row = normalizeSeries(resource, payload, today).records[0];
    assert.ok(row.values === null || row.values.points.length === 0);
  }
  assert.throws(() => normalizeSeries('heart-rate-day', { error: 'bad envelope' }, today), { code: 'GARMIN_INVALID_RESPONSE' });
});

test('all daily sources skip undated empty placeholders while retaining measured days', () => {
  const { normalizeMeasurements } = require('../helpers/garmin-measurements');
  const yesterday = shiftDate(today, -1);
  const cases = [
    ['sleep', rows => rows, { calendarDate: yesterday, sleepTimeSeconds: 28800 }, { calendarDate: null, sleepTimeSeconds: null, deepSleepSeconds: null, remSleepSeconds: null, sleepScores: null, sleepNeed: {} }, 'sleepMinutes', 480],
    ['wellness', rows => ({ data: rows }), { calendarDate: yesterday, heartRate: { restingValue: 57 } }, { calendarDate: null, heartRate: null, stress: null, respiration: null, pulseOx: null, bodyBattery: null, movement: null }, 'heartRateReferenceBpm', 57],
    ['hrv', rows => ({ hrvSummaries: rows }), { calendarDate: yesterday, lastNightAvg: 48 }, { calendarDate: null, lastNightAvg: null, weeklyAvg: null, baseline: null, status: 'NONE' }, 'hrv', 48],
  ];
  for (const [resource, wrap, valid, placeholder, field, value] of cases) {
    const result = normalizeMeasurements(resource, wrap([valid, null, {}, placeholder]), [yesterday, today]);
    assert.equal(result.partial, false, resource);
    assert.equal(result.records[0].values[field], value, resource);
    assert.equal(result.records[1].values, null, resource);
    assert.throws(() => normalizeMeasurements(resource, wrap([{ ...valid, calendarDate: null }]), [today]), { code: 'INVALID_DATE_RANGE' });
    assert.throws(() => normalizeMeasurements(resource, wrap([{ ...valid, calendarDate: '2026-02-30' }]), [today]), { code: 'INVALID_DATE_RANGE' });
  }
});

test('a missing sleep day clears the previous error, retains history and is cached neutrally', async t => {
  const { a, sync, provider } = await fixture(t, 'training-status', 'sleep-card');
  const input = { view: 'overview' };
  provider.state.resourceBodies.sleep = [{ error: 'invalid response' }];
  assert.equal((await sync(input)).resourceStates.sleep.errorCode, 'GARMIN_INVALID_RESPONSE');
  const url = new URL(`http://test/sleep-service/sleep/dailySleepSummariesByDate?startDate=${shiftDate(today, -6)}&endDate=${today}`);
  const history = require('../helpers/garmin-http').parseGarminJson(measurementsFor(url).body).filter(row => row.calendarDate !== today);
  provider.state.resourceBodies.sleep = [...history, { id: null, userProfilePK: null, calendarDate: null, sleepTimeSeconds: null, deepSleepSeconds: null, lightSleepSeconds: null, remSleepSeconds: null, sleepNeed: {} }];
  const result = await sync({ ...input, resources: ['sleep'], force: true });
  assert.equal(result.resourceStates.sleep.errorCode, null);
  assert.equal(result.resourceStates.sleep.dataByDay[today], 'no_data');
  assert.equal(result.measurements.daily[0].sleepMinutes, null);
  assert.equal(result.trainingContext.daily.filter(row => Number.isFinite(row.sleepMinutes)).length, 6);
  assert.equal(result.measurements.daily[0].heartRateReferenceBpm, 57);
  const calls = provider.state.dataRequests;
  await sync(input);
  assert.equal(provider.state.dataRequests, calls);
  const reread = await (await a.api('/dashboard?view=overview&timeZone=Europe%2FRome')).json();
  assert.equal(reread.resourceStates.sleep.errorCode, null);
});

test('day series skip missing samples and undated empty battery placeholders', () => {
  const start = Date.parse(`${today}T00:00:00Z`);
  const heart = normalizeSeries('heart-rate-day', { heartRateValueDescriptors: [{ key: 'timestamp', index: 0 }, { key: 'heartRate', index: 1 }], heartRateValues: [null, [], [null, null], [start, 60]] }, today);
  assert.deepEqual(heart.records[0].values.points, [{ timestamp: start, value: 60 }]);
  const hrv = normalizeSeries('hrv-night', { hrvReadings: [null, {}, { readingTimeGMT: null, hrvValue: null }, { readingTimeGMT: new Date(start).toISOString(), hrvValue: 48 }] }, today);
  assert.equal(hrv.records[0].values.points.length, 1);
  assert.equal(normalizeSeries('body-battery-day', [{ date: null, bodyBatteryValuesArray: null }], today).records[0].values, null);
});

test('unverified values never enter the database even when a detail response precedes owner summaries', async t => {
  const { a, sync, provider, database } = await fixture(t, 'body-battery');
  provider.state.resourceStatus.wellness = 204;
  const result = await sync({ view: 'overview' });
  assert.equal(await database.getGarminConnection(a.profile.id), null);
  assert.equal(result.resourceStates['body-battery-day'].errorCode, null);
  assert.equal(result.measurements.details['body-battery-day'], null);
  provider.state.resourceStatus.wellness = 200;
  const verified = await sync({ view: 'overview', force: true });
  assert.equal(verified.measurements.details['body-battery-day'].points[0].value, 74);
});

test('merged activity module upgrades saved layouts without duplicating or losing the recorded activity card', () => {
  const { upgradeLayout, defaultLayout, catalog } = require('../helpers/dashboard-layout');
  const wellness = defaultLayout.sections.wellness;
  const summary = { id: 'old-summary', type: 'training-summary' };
  const recorded = { id: 'kept-activities', type: 'activities' };
  const heart = { id: 'kept-heart', type: 'heart-card' };
  for (const [overview, expected] of [
    [[summary, heart, recorded], [heart, recorded]],
    [[recorded, summary, heart], [recorded, heart]],
    [[heart, summary], [heart, { ...summary, type: 'activities' }]],
    [[summary, { ...summary, id: 'other-summary' }], [{ ...summary, type: 'activities' }]],
    [[recorded, { ...recorded, id: 'intentional-copy' }, summary], [recorded, { ...recorded, id: 'intentional-copy' }]],
  ]) {
    const upgraded = upgradeLayout({ version: 2, sections: { overview, wellness } });
    assert.deepEqual(upgraded.sections.overview, expected);
    assert.deepEqual(upgraded.sections.wellness, wellness);
    assert.deepEqual(upgradeLayout(upgraded), upgraded, 'migration is idempotent');
  }
  assert.equal(catalog['training-summary'], undefined, 'the layout editor offers only the merged module');
  assert.equal(defaultLayout.sections.overview.filter(module => module.type === 'activities').length, 1);
  assert.ok(!defaultLayout.sections.overview.some(module => module.type === 'training-summary'));
});
