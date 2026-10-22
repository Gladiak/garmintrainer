'use strict';

const { GarminApiError } = require('./garmin-errors');
const { calendarDate } = require('./garmin-dates');

const FIELDS = {
  wellness: ['heartRateReferenceBpm', 'heartRateMinBpm', 'heartRateMaxBpm', 'bodyBattery', 'bodyBatteryMin', 'bodyBatteryMax', 'stress', 'stressMax', 'stressRestSeconds', 'stressLowSeconds', 'stressMediumSeconds', 'stressHighSeconds', 'respirationAvg', 'respirationMin', 'respirationMax', 'spo2Avg', 'spo2Min', 'steps'],
  hrv: ['hrv', 'hrvWeeklyAvg', 'hrvBaselineLow', 'hrvBaselineHigh', 'hrvStatus'],
  sleep: ['sleepMinutes', 'deep', 'light', 'rem', 'awakeMinutes', 'unclassifiedSleepMinutes', 'sleepScore'],
};
const VERSIONS = { wellness: 4, hrv: 4, sleep: 4, activities: 4 };

function providerIdentity(row) {
  const value = row?.userProfilePk ?? row?.userProfilePK ?? row?.userProfileId ?? row?.ownerId;
  if (value === undefined || value === null) return null;
  if (!/^\d+$/.test(String(value))) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Identità Garmin non valida.');
  return String(value);
}

function normalizeMeasurements(resource, payload, days) {
  let rows;
  if (payload === null) rows = [];
  else if (resource === 'wellness' || resource === 'hrv') {
    const key = resource === 'wellness' ? 'data' : 'hrvSummaries';
    if (!Object.hasOwn(payload, key) && Object.keys(payload).length && !providerIdentity(payload)) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Riepiloghi Garmin non validi.');
    rows = payload[key] ?? [];
  }
  else rows = payload;
  if (!Array.isArray(rows) || rows.length > 100) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Riepiloghi Garmin non validi.');
  const identities = new Set([providerIdentity(payload)].filter(Boolean));
  const records = new Map(days.map(date => [date, { date, schemaVersion: VERSIONS[resource], values: null, availability: {} }]));
  let partial = false;
  for (const row of rows) {
    if (row === null) continue;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Misura Garmin non valida.');
    if (Object.hasOwn(row, 'error') || Object.hasOwn(row, 'errors') || Object.hasOwn(row, 'message')) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Misura Garmin non valida.');
    if (resource === 'wellness' && String(row.source || 'garmin').toLowerCase() !== 'garmin') continue;
    const identity = providerIdentity(row);
    if (identity) identities.add(identity);
    const record = { schemaVersion: VERSIONS[resource], values: {}, availability: {} };
    function measure(field, value, min, max, divisor = 1) {
      const absent = value === null || value === undefined || value === -1;
      const valid = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
      record.values[field] = valid ? value / divisor : null;
      record.availability[field] = valid ? 'available' : absent ? 'no_data' : 'invalid';
      if (!absent && !valid) partial = true;
    }
    if (resource === 'wellness') {
      measure('heartRateReferenceBpm', row.heartRate?.restingValue, 1, 400);
      measure('heartRateMinBpm', row.heartRate?.minValue, 1, 400);
      measure('heartRateMaxBpm', row.heartRate?.maxValue, 1, 400);
      measure('bodyBattery', row.bodyBattery?.latestValue, 5, 100);
      measure('bodyBatteryMin', row.bodyBattery?.minValue, 5, 100);
      measure('bodyBatteryMax', row.bodyBattery?.maxValue, 5, 100);
      measure('stress', row.stress?.avgLevel, 0, 100);
      measure('stressMax', row.stress?.maxLevel, 0, 100);
      measure('respirationAvg', row.respiration?.avgValue, 1, 100);
      measure('respirationMin', row.respiration?.minValue, 1, 100);
      measure('respirationMax', row.respiration?.maxValue, 1, 100);
      measure('spo2Avg', row.pulseOx?.avgValue, 0, 100);
      measure('spo2Min', row.pulseOx?.minValue, 0, 100);
      measure('steps', row.movement?.steps?.value, 0, 300000);
      for (const [field, input] of Object.entries({ stressRestSeconds: 'restDurationInMillis', stressLowSeconds: 'lowStressDurationInMillis', stressMediumSeconds: 'mediumStressDurationInMillis', stressHighSeconds: 'highStressDurationInMillis' })) {
        measure(field, row.stress?.[input], 0, 86400000, 1000);
      }
      for (const [low, high] of [['heartRateMinBpm', 'heartRateMaxBpm'], ['bodyBatteryMin', 'bodyBatteryMax']]) {
        if (record.values[low] !== null && record.values[high] !== null && record.values[low] > record.values[high]) {
          throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Estremi giornalieri incoerenti.');
        }
      }
    } else if (resource === 'hrv') {
      measure('hrv', row.lastNightAvg, 1, 3000);
      measure('hrvWeeklyAvg', row.weeklyAvg, 1, 3000);
      measure('hrvBaselineLow', row.baseline?.balancedLow, 1, 3000);
      measure('hrvBaselineHigh', row.baseline?.balancedUpper, 1, 3000);
      record.values.hrvStatus = ['NONE', 'POOR', 'LOW', 'UNBALANCED', 'BALANCED', 'INVALID'].includes(row.status) ? row.status : null;
      record.availability.hrvStatus = record.values.hrvStatus ? 'available' : 'no_data';
    } else {
      measure('sleepScore', row.sleepScores?.overall?.value, 0, 100);
      for (const [field, input] of Object.entries({ sleepMinutes: 'sleepTimeSeconds', deep: 'deepSleepSeconds', light: 'lightSleepSeconds', rem: 'remSleepSeconds', awakeMinutes: 'awakeSleepSeconds', unclassifiedSleepMinutes: 'unmeasurableSleepSeconds' })) {
        measure(field, row[input], 0, 86400, 60);
      }
      if (row.deviceRemCapable === false) {
        record.values.rem = null;
        record.availability.rem = 'not_supported';
      }
    }
    // Garmin can include undated placeholders for days/sensors with no readings.
    // Skip only absent measurements; populated rows still require a valid date.
    if ((row.calendarDate == null || row.calendarDate === '') && !hasMeasurementData(resource, record.values)
      && !Object.values(record.availability).includes('invalid')) continue;
    const date = calendarDate(row.calendarDate);
    if (!records.has(date)) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Misura Garmin fuori intervallo.');
    record.date = date;
    const previous = records.get(date);
    if (previous.values && JSON.stringify(previous) !== JSON.stringify(record)) throw new GarminApiError('GARMIN_AMBIGUOUS_RESPONSE', 'Più riepiloghi discordanti per lo stesso giorno.');
    records.set(date, record);
  }
  if (identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Identità Garmin incoerenti nella risposta.');
  return { identity: [...identities][0] || null, records: [...records.values()], partial };
}

// Presence is independent of a successful HTTP response or a completed range.
function hasMeasurementData(resource, values) {
  if (!values) return false;
  if (resource === 'activities') return values.length > 0;
  if (FIELDS[resource]) return FIELDS[resource].some(field => Number.isFinite(values[field]))
    || resource === 'hrv' && ['POOR', 'LOW', 'UNBALANCED', 'BALANCED'].includes(values.hrvStatus);
  return Number.isFinite(values.summary) || values.points?.some(point => ['value', 'min', 'max'].some(field => Number.isFinite(point[field]))) || false;
}

function normalizeActivities(rows, days) {
  const records = new Map(days.map(date => [date, { date, schemaVersion: VERSIONS.activities, values: [], availability: {} }]));
  const identities = new Set();
  const ids = new Set();
  for (const activity of rows) {
    const identity = providerIdentity(activity);
    if (identity) identities.add(identity);
    const id = String(activity.activityId);
    if (!/^\d+$/.test(id)) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'ID attività Garmin non valido.');
    const date = calendarDate(activity.startTimeLocal?.slice(0, 10));
    if (!records.has(date) || typeof activity.duration !== 'number' || !Number.isFinite(activity.duration) || activity.duration < 0) {
      throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Attività Garmin non valida o fuori intervallo.');
    }
    if (ids.has(id)) continue;
    ids.add(id);
    const number = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
    const type = activity.activityType?.typeKey;
    const time = activity.startTimeLocal.slice(11, 16);
    records.get(date).values.push({ id, date, durationMinutes: activity.duration / 60, status: 'completed', manual: activity.isManualActivity ?? activity.manualActivity ?? false,
      activityType: typeof type === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(type) ? type : null,
      time: /^\d{2}:\d{2}$/.test(time) ? time : null,
      distanceMeters: number(activity.distance, 10_000_000), averageHeartRateBpm: number(activity.averageHR, 400),
      caloriesKcal: number(activity.calories, 100_000), elevationGainMeters: number(activity.elevationGain, 100_000),
      aerobicTrainingEffect: number(activity.aerobicTrainingEffect, 5), anaerobicTrainingEffect: number(activity.anaerobicTrainingEffect, 5),
      activityTrainingLoad: number(activity.activityTrainingLoad, 10000), vo2Max: activity.vO2MaxValue > 0 ? number(activity.vO2MaxValue, 150) : null });
  }
  if (identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Attività di titolari differenti.');
  return { identity: [...identities][0] || null, records: [...records.values()] };
}

module.exports = { FIELDS, VERSIONS, providerIdentity, normalizeMeasurements, normalizeActivities, hasMeasurementData };
