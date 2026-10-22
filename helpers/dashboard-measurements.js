'use strict';

const { randomUUID } = require('node:crypto');
const { InputError } = require('../libs/validation');
const { GarminApiError } = require('../libs/garmin');
const getSummary = require('../controllers/garmin-summary-daily');
const getHrv = require('../controllers/garmin-hrv-daily');
const getSleep = require('../controllers/garmin-sleep-daily');
const getSettings = require('../controllers/garmin-user-settings');
const getActivities = require('../controllers/garmin-activities');
const { FIELDS, normalizeMeasurements, normalizeActivities } = require('./garmin-measurements');
const { calendarDate, shiftDate, dateRange, validTimeZone, dateInZone } = require('./garmin-dates');

const RESOURCES = ['wellness', 'hrv', 'sleep', 'activities'];

function rangesFor(input, timeZone) {
  const today = dateInZone(timeZone);
  const requestedTo = calendarDate(input.to || today);
  const from = calendarDate(input.from || shiftDate(requestedTo, -29));
  dateRange(from, requestedTo, 31);
  // The browser and the Garmin calendar can be on different dates during travel.
  const to = requestedTo > today ? today : requestedTo;
  const days = dateRange(from, to, 31);
  if (from < shiftDate(today, -89)) throw new InputError('Intervallo non disponibile.', 400, 'INVALID_DATE_RANGE');
  const previousMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const activityFrom = calendarDate(input.activityFrom || previousMonth.toISOString().slice(0, 10));
  const activityTo = calendarDate(input.activityTo || today);
  dateRange(activityFrom, activityTo, 62);
  if (activityFrom < shiftDate(today, -365)) throw new InputError('Intervallo non disponibile.', 400, 'INVALID_DATE_RANGE');
  const activityDays = activityFrom > today ? [] : dateRange(activityFrom, activityTo > today ? today : activityTo, 62);
  return { today, from, to, days, activityFrom, activityTo, activityDays };
}

function freshRows(rows, days, today) {
  return days.every(day => {
    const row = rows.find(item => item.date === day);
    return row && Date.now() - row.fetchedAt < (day >= shiftDate(today, -2) ? 15 * 60_000 : 24 * 60 * 60_000);
  });
}

function createDashboardMeasurements({ getDatabase, garmin }) {
  async function read(profile, input = {}) {
    const db = getDatabase();
    let connection = await db.getGarminConnection(profile.id);
    if (profile.hasGarminKey && connection?.revision !== profile.credentialRevision) connection = null;
    const timeZone = validTimeZone(connection?.timeZone) || validTimeZone(input.timeZone) || 'UTC';
    const range = rangesFor(input, timeZone);
    const rows = Object.fromEntries(await Promise.all(RESOURCES.map(async resource => [resource,
      await db.readGarminRows(profile.id, connection?.id, resource, resource === 'activities' ? range.activityDays : range.days)])));
    const errors = await db.getGarminSyncState(profile.id);
    const sync = {};
    for (const resource of RESOURCES) {
      const days = resource === 'activities' ? range.activityDays : range.days;
      const cached = rows[resource];
      const error = errors.find(item => item.resource === resource);
      const complete = cached.length === days.length && !cached.some(row => row.missing);
      sync[resource] = {
        state: error?.errorCode ? 'stale' : !complete ? 'missing' : freshRows(cached, days, range.today) ? 'fresh' : 'stale',
        complete,
        lastSuccessAt: cached.length ? new Date(Math.min(...cached.map(row => row.valueFetchedAt || row.fetchedAt))).toISOString() : null,
        errorCode: error?.errorCode || null, retryAt: error?.retryAt ? new Date(Number(error.retryAt)).toISOString() : null,
      };
    }
    const imported = Object.keys(FIELDS).some(resource => rows[resource].length);
    const daily = imported ? range.days.map(date => {
      const day = { date, source: 'garmin', availability: {} };
      for (const [resource, fields] of Object.entries(FIELDS)) {
        const row = rows[resource].find(item => item.date === date);
        for (const field of fields) {
          day[field] = row?.values?.[field] ?? null;
          day.availability[field] = row?.availability?.[field] || (row ? 'no_data' : 'unknown');
        }
      }
      day.heartRateBasis = day.heartRateReferenceBpm === null ? 'unavailable' : 'garmin_resting_or_minimum';
      return day;
    }) : [];
    return {
      timeZone, today: range.today,
      measurements: { state: imported ? Object.keys(FIELDS).every(resource => sync[resource].complete && !sync[resource].errorCode) ? 'ready' : 'partial' : 'not_imported',
        range: { from: range.from, to: range.to }, daily, sync: Object.fromEntries(Object.keys(FIELDS).map(resource => [resource, sync[resource]])) },
      activities: { sessions: rows.activities.flatMap(row => row.missing ? [] : row.values || []), ...sync.activities,
        range: { from: range.activityFrom, to: range.activityTo } },
    };
  }

  async function sync(profile, input = {}, requestSignal) {
    if (!profile.hasGarminKey) throw new GarminApiError('GARMIN_NOT_CONFIGURED', 'Collega Garmin dal profilo.', { statusCode: 503 });
    const resources = input.resources || RESOURCES;
    if (!Array.isArray(resources) || !resources.length || resources.length > 4 || resources.some(value => !RESOURCES.includes(value)) || input.force !== undefined && typeof input.force !== 'boolean') {
      throw new InputError('Risorse di sincronizzazione non valide.', 400, 'INVALID_INPUT');
    }
    const db = getDatabase();
    let connection = await db.getGarminConnection(profile.id);
    let timeZone = validTimeZone(connection?.timeZone) || validTimeZone(input.timeZone) || 'UTC';
    let range = rangesFor(input, timeZone);
    const states = await db.getGarminSyncState(profile.id);
    const limited = states.find(state => Number(state.retryAt) > Date.now());
    if (limited) throw new GarminApiError('GARMIN_RATE_LIMIT', 'Attendi prima di aggiornare Garmin.', { statusCode: 429, retryAt: Number(limited.retryAt) });
    const owner = randomUUID();
    if (!await db.acquireGarminSync(profile.id, owner)) throw new InputError('Sincronizzazione già in corso.', 409, 'GARMIN_SYNC_BUSY');
    const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(requestSignal ? [requestSignal] : [])]);
    try {
      const client = await garmin.getClient(profile.id);
      let settingsAt = connection?.settingsAt || 0;
      if (!connection || connection.revision !== profile.credentialRevision || Date.now() - settingsAt > 24 * 60 * 60_000) {
        try {
          const settings = await getSettings(client, {}, { signal });
          timeZone = validTimeZone(settings?.timeZone) || timeZone;
          settingsAt = Date.now();
        } catch (error) {
          if (['GARMIN_AUTH_FAILED', 'GARMIN_RATE_LIMIT'].includes(error.code)) throw error;
          // A settings outage does not discard otherwise valid measurements.
        }
      }
      range = rangesFor(input, timeZone);
      if (!connection && range.to === range.today && resources.some(resource => resource !== 'activities')) {
        range.from = shiftDate(range.to, -29);
        range.days = dateRange(range.from, range.to, 30);
      }
      const outcomes = await Promise.all([...new Set(resources)].map(async resource => {
        const days = resource === 'activities' ? range.activityDays : range.days;
        const previous = await db.readGarminRows(profile.id, connection?.id, resource, days);
        if (!input.force && connection?.revision === profile.credentialRevision && freshRows(previous, days, range.today)) return { resource, skipped: true };
        if (!days.length) return { resource, skipped: true };
        try {
          let result;
          if (resource === 'activities') {
            const activities = [];
            let complete = false;
            for (let page = 0; page < 10; page++) {
              const batch = await getActivities(client, { startDate: days[0], endDate: days.at(-1), start: page * 99, limit: 99, excludeChildren: true, sortBy: 'startLocal', sortOrder: 'desc' }, { signal });
              if (batch && batch.length > 99) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Pagina attività troppo grande.');
              activities.push(...(batch || []));
              if (!batch || batch.length < 99) { complete = true; break; }
            }
            if (!complete) throw new GarminApiError('GARMIN_RANGE_INCOMPLETE', 'Troppe attività per un singolo intervallo.');
            result = normalizeActivities(activities, days);
          } else {
            const input = resource === 'hrv' ? { fromDate: days[0], toDate: days.at(-1) } : { startDate: days[0], endDate: days.at(-1) };
            const fetch = { wellness: getSummary, hrv: getHrv, sleep: getSleep }[resource];
            result = normalizeMeasurements(resource, await fetch(client, input, { signal }), days);
          }
          return { resource, previous, previousConnection: connection?.id, ...result };
        } catch (error) {
          if (error instanceof InputError) error = new GarminApiError('GARMIN_INVALID_RESPONSE', 'Date non valide nella risposta Garmin.');
          return { resource, error };
        }
      }));
      signal.throwIfAborted();
      const identityErrors = outcomes.some(result => result.error?.code === 'GARMIN_IDENTITY_MISMATCH');
      const identities = new Set(outcomes.map(result => result.identity).filter(Boolean));
      if (connection?.revision === profile.credentialRevision) identities.add(connection.identity);
      if (identityErrors || identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Il titolare dei dati Garmin non coincide.');
      const identity = [...identities][0];
      if (!identity && outcomes.some(result => !result.skipped && !result.error)) {
        throw new GarminApiError('GARMIN_IDENTITY_PENDING', 'Nessun dato disponibile per verificare il collegamento.');
      }
      if (identity) connection = await db.connectGarmin(profile, identity, { timeZone, settingsAt }, owner);
      for (const result of outcomes) {
        if (result.skipped) continue;
        if (result.records && connection) {
          // Only retain missing old values after the provider identity is verified.
          const previous = result.previousConnection === connection.id ? result.previous
            : await db.readGarminRows(profile.id, connection.id, result.resource, result.records.map(record => record.date));
          result.records = result.records.map(record => {
            const old = previous.find(row => row.date === record.date);
            const empty = record.values === null || result.resource === 'activities' && record.values.length === 0;
            if (!empty || !old?.values || Array.isArray(old.values) && old.values.length === 0) return record;
            result.partial = true;
            return { ...record, values: old.values, missing: true,
              valueFetchedAt: old.valueFetchedAt || old.fetchedAt,
              availability: Object.fromEntries((FIELDS[result.resource] || []).map(field => [field, 'not_in_latest_response'])) };
          });
          await db.saveGarminRows(profile, connection.id, result.resource, result.records, owner);
          await db.setGarminSyncState(profile, result.resource, result.partial ? { code: 'GARMIN_PARTIAL_DATA' } : null, owner);
        } else if (result.error) await db.setGarminSyncState(profile, result.resource, result.error, owner);
      }
      return read(profile, input);
    } catch (error) {
      if (error instanceof GarminApiError) {
        for (const resource of resources) await db.setGarminSyncState(profile, resource, error, owner);
      }
      throw error;
    } finally { await db.releaseGarminSync(profile.id, owner); }
  }

  return { read, sync };
}

module.exports = { createDashboardMeasurements, rangesFor, freshRows };
