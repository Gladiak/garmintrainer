'use strict';

// Synthetic measurements for local integration tests; never real account data.
function measurementsFor(url, identity = '9007199254740993') {
  const path = url.pathname;
  const resource = path.includes('/v2/dailysummaries') ? 'wellness' : path.includes('/hrv/daily/') ? 'hrv'
    : path.includes('/dailySleepSummariesByDate') ? 'sleep' : path.includes('/search/activities') ? 'activities'
    : path.includes('/bodyBattery/reports/daily') ? 'body-battery-day' : path.endsWith('/dailyHeartRate') ? 'heart-rate-day'
    : /\/hrv\/\d{4}-\d{2}-\d{2}$/.test(path) ? 'hrv-night' : null;
  if (!resource) return null;
  if (['body-battery-day', 'heart-rate-day', 'hrv-night'].includes(resource)) {
    const date = url.searchParams.get('date') || url.searchParams.get('startDate') || path.split('/').at(-1);
    const start = Date.parse(`${date}T00:00:00Z`);
    const readings = [0, 3, 6, 9, 12, 15, 18].map((hour, index) => [start + hour * 3600000, [74, 85, 92, 78, 64, 43, 28][index]]);
    let body;
    if (resource === 'body-battery-day') body = [{ date, bodyBatteryValueDescriptorDTOList: [{ bodyBatteryValueDescriptorIndex: 1, bodyBatteryValueDescriptorKey: 'bodyBatteryLevel' }, { bodyBatteryValueDescriptorIndex: 0, bodyBatteryValueDescriptorKey: 'timestamp' }], bodyBatteryValuesArray: readings }];
    else if (resource === 'heart-rate-day') body = { userProfilePK: identity, heartRateValueDescriptors: [{ index: 0, key: 'timestamp' }, { index: 1, key: 'heartRate' }], heartRateValues: readings.map(([timestamp, value]) => [timestamp, value + 25]) };
    else body = { userProfilePk: identity, hrvSummary: { calendarDate: date, lastNightAvg: 48 }, hrvReadings: [-2, 0, 2, 4, 6].map((hour, index) => ({ readingTimeGMT: new Date(start + hour * 3600000).toISOString(), hrvValue: [44, 50, 56, 46, 48][index] })) };
    return { resource, body: JSON.stringify(body).replace(/"(900719925474099\d)"/g, '$1') };
  }
  const from = resource === 'hrv' ? path.split('/').at(-2) : url.searchParams.get('startDate');
  const to = resource === 'hrv' ? path.split('/').at(-1) : url.searchParams.get('endDate');
  const dates = [];
  for (let day = from; day <= to; ) {
    dates.push(day);
    const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  let body;
  if (resource === 'wellness') body = { data: dates.map((calendarDate, index) => ({ userProfilePk: identity, calendarDate, source: 'garmin', respiration: { avgValue: 15, minValue: 11, maxValue: 22 }, pulseOx: { avgValue: 97, minValue: 93 }, movement: { steps: { value: 8250 } }, heartRate: { restingValue: 57, minValue: 44 + index % 5, maxValue: 152 + index % 9 }, stress: { avgLevel: 23, maxLevel: 72, restDurationInMillis: 28800000, lowStressDurationInMillis: 14400000, mediumStressDurationInMillis: 7200000, highStressDurationInMillis: 3600000 }, bodyBattery: { latestValue: 74, minValue: 12 + index % 7, maxValue: 91 + index % 6 } })) };
  else if (resource === 'hrv') body = { userProfilePk: identity, hrvSummaries: dates.map(calendarDate => ({ calendarDate, lastNightAvg: 48, weeklyAvg: 47, baseline: { balancedLow: 40, balancedUpper: 62 }, status: 'BALANCED', createTimeStamp: `${calendarDate}T09:00:00.000` })) };
  else if (resource === 'sleep') body = dates.map(calendarDate => ({ userProfilePK: identity, calendarDate, sleepScores: { overall: { value: 82 } }, sleepTimeSeconds: 28800, deepSleepSeconds: 5400, lightSleepSeconds: 16200, remSleepSeconds: 6300, unmeasurableSleepSeconds: 900, awakeSleepSeconds: 600, deviceRemCapable: true }));
  else {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
    const age = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`)) / 86400000);
    const id = String(9007199254740997n + BigInt(age));
    body = Number(url.searchParams.get('start')) === 0 ? [{ activityId: id, ownerId: identity, startTimeLocal: `${to} 07:00:00`, duration: 2700.5, distance: 8250, averageHR: 144, calories: 520, elevationGain: 78, aerobicTrainingEffect: 3.2, anaerobicTrainingEffect: 1.1, activityTrainingLoad: 96, vO2MaxValue: 49, activityType: { typeKey: 'running' } }] : [];
  }
  // IDs are JSON integer tokens, so tests exercise lossless parsing over HTTP.
  return { resource, body: JSON.stringify(body).replace(/"(900719925474099\d)"/g, '$1') };
}

module.exports = { measurementsFor };
