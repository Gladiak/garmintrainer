'use strict';

// Synthetic measurements for local integration tests; never real account data.
function measurementsFor(url, identity = '9007199254740993') {
  const path = url.pathname;
  const resource = path.includes('/v2/dailysummaries') ? 'wellness' : path.includes('/hrv/daily/') ? 'hrv'
    : path.includes('/dailySleepSummariesByDate') ? 'sleep' : path.includes('/search/activities') ? 'activities' : null;
  if (!resource) return null;
  const from = resource === 'hrv' ? path.split('/').at(-2) : url.searchParams.get('startDate');
  const to = resource === 'hrv' ? path.split('/').at(-1) : url.searchParams.get('endDate');
  const dates = [];
  for (let day = from; day <= to; ) {
    dates.push(day);
    const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  let body;
  if (resource === 'wellness') body = { data: dates.map(calendarDate => ({ userProfilePk: identity, calendarDate, source: 'garmin', heartRate: { restingValue: 57 }, stress: { avgLevel: 23 }, bodyBattery: { latestValue: 74 } })) };
  else if (resource === 'hrv') body = { userProfilePk: identity, hrvSummaries: dates.map(calendarDate => ({ calendarDate, lastNightAvg: 48, createTimeStamp: `${calendarDate}T09:00:00.000` })) };
  else if (resource === 'sleep') body = dates.map(calendarDate => ({ userProfilePK: identity, calendarDate, sleepTimeSeconds: 28800, deepSleepSeconds: 5400, lightSleepSeconds: 16200, remSleepSeconds: 6300, unmeasurableSleepSeconds: 900, awakeSleepSeconds: 600, deviceRemCapable: true }));
  else body = Number(url.searchParams.get('start')) === 0 ? [{ activityId: '9007199254740997', ownerId: identity, startTimeLocal: `${to} 07:00:00`, duration: 2700.5, activityType: { typeKey: 'running' } }] : [];
  // IDs are JSON integer tokens, so tests exercise lossless parsing over HTTP.
  return { resource, body: JSON.stringify(body).replace(/"(900719925474099\d)"/g, '$1') };
}

module.exports = { measurementsFor };
