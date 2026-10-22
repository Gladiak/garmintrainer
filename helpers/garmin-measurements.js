'use strict';

const { GarminApiError } = require('./garmin-errors');
const { calendarDate } = require('./garmin-dates');

const FIELDS = {
  wellness: ['heartRateReferenceBpm', 'bodyBattery', 'stress'],
  hrv: ['hrv'],
  sleep: ['sleepMinutes', 'deep', 'light', 'rem', 'awakeMinutes', 'unclassifiedSleepMinutes'],
};

function providerIdentity(row) {
  const value = row?.userProfilePk ?? row?.userProfilePK ?? row?.userProfileId ?? row?.ownerId;
  if (value === undefined || value === null) return null;
  if (!/^\d+$/.test(String(value))) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Identità Garmin non valida.');
  return String(value);
}

function normalizeMeasurements(resource, payload, days) {
  let rows;
  if (payload === null) rows = [];
  else if (resource === 'wellness') rows = payload.data;
  else if (resource === 'hrv') rows = payload.hrvSummaries;
  else rows = payload;
  if (!Array.isArray(rows) || rows.length > 100) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Riepiloghi Garmin non validi.');
  const identities = new Set([providerIdentity(payload)].filter(Boolean));
  const records = new Map(days.map(date => [date, { date, values: null, availability: {} }]));
  let partial = false;
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Misura Garmin non valida.');
    if (resource === 'wellness' && String(row.source || 'garmin').toLowerCase() !== 'garmin') continue;
    const date = calendarDate(row.calendarDate);
    if (!records.has(date)) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Misura Garmin fuori intervallo.');
    const identity = providerIdentity(row);
    if (identity) identities.add(identity);
    const record = { date, values: {}, availability: {} };
    function measure(field, value, min, max, divisor = 1) {
      const absent = value === null || value === undefined;
      const valid = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
      record.values[field] = valid ? value / divisor : null;
      record.availability[field] = valid ? 'available' : absent ? 'no_data' : 'invalid';
      if (!absent && !valid) partial = true;
    }
    if (resource === 'wellness') {
      measure('heartRateReferenceBpm', row.heartRate?.restingValue, 1, 400);
      measure('bodyBattery', row.bodyBattery?.latestValue, 5, 100);
      measure('stress', row.stress?.avgLevel, 0, 100);
    } else if (resource === 'hrv') measure('hrv', row.lastNightAvg, 1, 3000);
    else {
      for (const [field, input] of Object.entries({ sleepMinutes: 'sleepTimeSeconds', deep: 'deepSleepSeconds', light: 'lightSleepSeconds', rem: 'remSleepSeconds', awakeMinutes: 'awakeSleepSeconds', unclassifiedSleepMinutes: 'unmeasurableSleepSeconds' })) {
        measure(field, row[input], 0, 86400, 60);
      }
      if (row.deviceRemCapable === false) {
        record.values.rem = null;
        record.availability.rem = 'not_supported';
      }
    }
    const previous = records.get(date);
    if (previous.values && JSON.stringify(previous) !== JSON.stringify(record)) throw new GarminApiError('GARMIN_AMBIGUOUS_RESPONSE', 'Più riepiloghi discordanti per lo stesso giorno.');
    records.set(date, record);
  }
  if (identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Identità Garmin incoerenti nella risposta.');
  return { identity: [...identities][0] || null, records: [...records.values()], partial };
}

function normalizeActivities(rows, days) {
  const records = new Map(days.map(date => [date, { date, values: [], availability: {} }]));
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
    records.get(date).values.push({ id, date, durationMinutes: activity.duration / 60, status: 'completed', manual: activity.isManualActivity ?? activity.manualActivity ?? false });
  }
  if (identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Attività di titolari differenti.');
  return { identity: [...identities][0] || null, records: [...records.values()] };
}

module.exports = { FIELDS, normalizeMeasurements, normalizeActivities };
