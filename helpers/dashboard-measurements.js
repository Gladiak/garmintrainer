'use strict';

const { randomUUID } = require('node:crypto');
const { InputError } = require('../libs/validation');
const { GarminApiError } = require('../libs/garmin');
const getSummary = require('../controllers/garmin-summary-daily');
const getHrv = require('../controllers/garmin-hrv-daily');
const getSleep = require('../controllers/garmin-sleep-daily');
const getSettings = require('../controllers/garmin-user-settings');
const getActivities = require('../controllers/garmin-activities');
const getHeartDay = require('../controllers/garmin-heart-rate-day');
const getBatteryDay = require('../controllers/garmin-body-battery');
const getHrvNight = require('../controllers/garmin-hrv-day');
const { FIELDS, VERSIONS, normalizeMeasurements, normalizeActivities, hasMeasurementData } = require('./garmin-measurements');
const { normalizeSeries } = require('./garmin-series');
const { moduleRequirements, viewModules } = require('./dashboard-layout');
const { calendarDate, shiftDate, dateRange, validTimeZone, dateInZone } = require('./garmin-dates');

function rangesFor(input, timeZone) {
  const today = dateInZone(timeZone);
  const requestedTo = calendarDate(input.to || today);
  const period = input.period === undefined ? 1 : Number(input.period);
  if (![1, 7, 14, 30].includes(period)) throw new InputError('Periodo non valido.', 400, 'INVALID_DATE_RANGE');
  const requestedFrom = calendarDate(input.from || shiftDate(requestedTo, -(period - 1)));
  dateRange(requestedFrom, requestedTo, 31);
  if (requestedTo > shiftDate(today, 1)) throw new InputError('Intervallo futuro non disponibile.', 400, 'INVALID_DATE_RANGE');
  const to = requestedTo > today ? today : requestedTo;
  const from = requestedFrom > to ? to : requestedFrom;
  const days = dateRange(from, to, 31);
  if (input.view === 'overview' && from !== to) throw new InputError('La panoramica mostra un solo giorno.', 400, 'INVALID_DATE_RANGE');
  if (from < shiftDate(today, -89)) throw new InputError('Intervallo non disponibile.', 400, 'INVALID_DATE_RANGE');
  const activityFrom = calendarDate(input.activityFrom || from);
  const activityTo = calendarDate(input.activityTo || to);
  dateRange(activityFrom, activityTo, 62);
  if (activityFrom < shiftDate(today, -365)) throw new InputError('Intervallo non disponibile.', 400, 'INVALID_DATE_RANGE');
  const activityDays = activityFrom > today ? [] : dateRange(activityFrom, activityTo > today ? today : activityTo, 62);
  return { today, from, to, days, activityFrom, activityTo, activityDays };
}

function freshRows(rows, days, today, resource, attempts = []) {
  return days.every(day => {
    const row = rows.find(item => item.date === day);
    const attempt = attempts.find(item => item.resource === resource && item.date === day);
    const checked = attempt && !attempt.errorCode && ['no_data', 'pending_identity'].includes(attempt.outcome) ? Number(attempt.lastAttemptAt) : 0;
    const fetchedAt = row?.schemaVersion === (VERSIONS[resource] || 2) ? row.fetchedAt : checked;
    return fetchedAt > 0 && Date.now() - fetchedAt < (day >= shiftDate(today, -2) ? 15 * 60_000 : 24 * 60 * 60_000);
  });
}

function missingRanges(rows, days, today, force, resource, attempts) {
  const groups = [];
  for (const day of days) {
    if (!force && freshRows(rows, [day], today, resource, attempts)) continue;
    const previous = groups.at(-1);
    if (previous && shiftDate(previous.at(-1), 1) === day) previous.push(day);
    else groups.push([day]);
  }
  return groups;
}

function requirementsFor(layout, range, moduleId, view) {
  layout = { modules: viewModules(layout, view) };
  if (moduleId !== undefined) {
    const module = layout.modules.find(item => item.id === moduleId);
    if (!module) throw new InputError('Modulo non trovato.', 400, 'INVALID_INPUT');
    layout = { modules: [module] };
  }
  const requirements = moduleRequirements(layout, range.from, range.to);
  if (requirements.activities) requirements.activities = {
    from: requirements.activities.from < range.activityFrom ? requirements.activities.from : range.activityFrom,
    to: range.activityDays.at(-1) || range.to,
  };
  return requirements;
}

function createDashboardMeasurements({ getDatabase, garmin }) {
  async function context(profile, input) {
    const db = getDatabase();
    let connection = await db.getGarminConnection(profile.id);
    if (!profile.hasGarminKey || connection?.revision !== profile.credentialRevision) connection = null;
    const timeZone = validTimeZone(connection?.timeZone) || validTimeZone(input.timeZone) || 'UTC';
    const range = rangesFor(input, timeZone);
    const layout = await db.getDashboardLayout(profile.id);
    const requirements = requirementsFor(layout, range, undefined, input.view);
    return { db, connection, timeZone, range, requirements, layout };
  }

  async function read(profile, input = {}) {
    const { db, connection, timeZone, range, requirements, layout } = await context(profile, input);
    const resources = Object.keys(requirements);
    const rows = Object.fromEntries(await Promise.all(resources.map(async resource => [resource,
      await db.readGarminRows(profile.id, connection?.id, resource, dateRange(requirements[resource].from, requirements[resource].to, 62))])));
    const errors = await db.getGarminSyncState(profile.id, requirements, profile.credentialRevision);
    const sync = {};
    for (const resource of resources) {
      const scope = requirements[resource];
      const days = dateRange(scope.from, scope.to, 62);
      const cached = rows[resource];
      const attempts = errors.filter(item => item.resource === resource);
      const resourceErrors = attempts.filter(item => item.errorCode && item.errorCode !== 'GARMIN_IDENTITY_PENDING'
        && !(item.errorCode === 'GARMIN_PARTIAL_DATA' && !item.outcome && cached.find(row => row.date === item.date)?.missing));
      const error = resourceErrors[0];
      const complete = cached.length === days.length && !cached.some(row => row.missing || row.schemaVersion !== (VERSIONS[resource] || 2));
      const dataByDay = Object.fromEntries(days.map(date => {
        const row = cached.find(item => item.date === date);
        const attempt = attempts.find(item => item.date === date);
        return [date, hasMeasurementData(resource, row?.values) ? row.missing ? 'cached' : 'available'
          : row || attempt && !attempt.errorCode && attempt.outcome ? 'no_data' : 'waiting'];
      }));
      sync[resource] = {
        range: scope,
        state: error?.errorCode ? 'stale' : freshRows(cached, days, range.today, resource, attempts) ? 'fresh' : !complete ? 'missing' : 'stale',
        complete,
        dataByDay,
        dataState: Object.values(dataByDay).includes('available') ? 'available' : Object.values(dataByDay).includes('cached') ? 'cached' : Object.values(dataByDay).includes('waiting') ? 'waiting' : 'no_data',
        lastSuccessAt: cached.length ? new Date(Math.min(...cached.map(row => row.valueFetchedAt || row.fetchedAt))).toISOString() : null,
        acquiredByDay: Object.fromEntries(cached.map(row => [row.date, new Date(row.valueFetchedAt || row.fetchedAt).toISOString()])),
        checkedByDay: Object.fromEntries(attempts.map(attempt => [attempt.date, new Date(Number(attempt.lastAttemptAt)).toISOString()])),
        errorCode: error?.errorCode || null, retryAt: error?.retryAt ? new Date(Number(error.retryAt)).toISOString() : null,
        errors: resourceErrors.map(item => ({ date: item.date, code: item.errorCode })),
      };
    }

    const imported = resources.some(resource => resource !== 'activities' && rows[resource].length);
    const measurementDay = date => {
      const day = { date, source: 'garmin', availability: {} };
      for (const [resource, fields] of Object.entries(FIELDS)) {
        const row = rows[resource]?.find(item => item.date === date);
        for (const field of fields) {
          day[field] = row?.values?.[field] ?? null;
          day.availability[field] = row?.availability?.[field] || (row ? 'no_data' : 'unknown');
        }
      }
      day.heartRateBasis = day.heartRateReferenceBpm === null ? 'unavailable' : 'garmin_resting_or_minimum';
      return day;
    };
    const daily = imported ? range.days.map(measurementDay) : [];
    const activities = new Map();
    let conflictingActivities = false;
    for (const session of (rows.activities || []).flatMap(row => row.missing ? [] : row.values || [])) {
      const previous = activities.get(session.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(session)) conflictingActivities = true;
      activities.set(session.id, session);
    }
    const trainingModule = viewModules(layout, input.view).some(module => module.type === 'training-status');
    const activityDaysComplete = days => !conflictingActivities && days.every(date => {
      const row = rows.activities?.find(item => item.date === date);
      return row && !row.missing && row.schemaVersion === VERSIONS.activities;
    });
    return {
      view: input.view || 'overview', timeZone, today: range.today, requirements, resourceStates: sync,
      measurements: { state: imported ? resources.filter(resource => resource !== 'activities').every(resource => sync[resource].complete && !sync[resource].errorCode) ? 'ready' : 'partial' : 'not_imported',
        range: { from: range.from, to: range.to }, daily,
        details: Object.fromEntries(resources.filter(resource => !FIELDS[resource] && resource !== 'activities').map(resource => [resource, rows[resource].find(row => row.date === range.to)?.values || null])),
        sync: Object.fromEntries(Object.keys(FIELDS).filter(resource => sync[resource]).map(resource => [resource, sync[resource]])) },
      trainingContext: trainingModule ? {
        daily: dateRange(shiftDate(range.to, -7), range.to, 8).map(measurementDay),
        sessions: [...activities.values()].filter(session => session.date >= shiftDate(range.to, -27) && session.date <= range.to),
        completeByDay: Object.fromEntries(dateRange(shiftDate(range.to, -27), range.to, 28).map(date => [date, activityDaysComplete([date])])),
      } : null,
      activities: { sessions: [...activities.values()].filter(session => session.date >= range.activityFrom && session.date <= (range.activityDays.at(-1) || range.to)), ...sync.activities,
        ...(sync.activities ? { complete: activityDaysComplete(range.activityDays) } : {}),
        ...(conflictingActivities ? { complete: false, state: 'stale', errorCode: 'GARMIN_AMBIGUOUS_RESPONSE' } : {}),
        range: { from: range.from, to: range.to } },
    };
  }

  async function sync(profile, input = {}, requestSignal) {
    let { db, connection, timeZone, range, layout } = await context(profile, input);
    let requirements = requirementsFor(layout, range, input.moduleId, input.view);
    const resources = input.resources || Object.keys(requirements);
    if (!Array.isArray(resources) || resources.length > 7 || resources.some(value => !Object.hasOwn(requirements, value)) || input.force !== undefined && typeof input.force !== 'boolean') {
      throw new InputError('Risorse di sincronizzazione non valide.', 400, 'INVALID_INPUT');
    }
    if (!resources.length) return read(profile, input);
    if (!profile.hasGarminKey) throw new GarminApiError('GARMIN_NOT_CONFIGURED', 'Collega Garmin dal profilo.', { statusCode: 503 });
    const states = await db.getGarminSyncState(profile.id, undefined, profile.credentialRevision);
    const limited = states.find(state => Number(state.retryAt) > Date.now());
    if (limited) throw new GarminApiError('GARMIN_RATE_LIMIT', 'Attendi prima di aggiornare Garmin.', { statusCode: 429, retryAt: Number(limited.retryAt) });
    const owner = randomUUID();
    if (!await db.acquireGarminSync(profile.id, owner)) throw new InputError('Sincronizzazione già in corso.', 409, 'GARMIN_SYNC_BUSY');
    const signal = AbortSignal.any([AbortSignal.timeout(90_000), ...(requestSignal ? [requestSignal] : [])]);
    try {
      const client = await garmin.getClient(profile.id);
      let settingsAt = connection?.settingsAt || 0;
      if (!connection || Date.now() - settingsAt > 24 * 60 * 60_000) {
        try {
          const settings = await getSettings(client, {}, { signal });
          timeZone = validTimeZone(settings?.timeZone) || timeZone;
          settingsAt = Date.now();
        } catch (error) {
          if (['GARMIN_AUTH_FAILED', 'GARMIN_RATE_LIMIT'].includes(error.code)) throw error;
        }
      }
      range = rangesFor(input, timeZone);
      requirements = requirementsFor(await db.getDashboardLayout(profile.id), range, input.moduleId, input.view);
      const outcomes = await Promise.all([...new Set(resources)].map(async resource => {
        const scope = requirements[resource];
        if (!scope) return { resource, skipped: true };
        const days = dateRange(scope.from, scope.to, 62);
        const previous = await db.readGarminRows(profile.id, connection?.id, resource, days);
        const groups = missingRanges(previous, days, range.today, input.force, resource, states);
        if (!groups.length) return { resource, skipped: true };
        try {
          const results = [];
          for (const dates of groups) {
            const from = dates[0], to = dates.at(-1);
            if (resource === 'activities') {
              const activities = [];
              let complete = false;
              for (let page = 0; page < 10; page++) {
                const batch = await getActivities(client, { startDate: from, endDate: to, start: page * 99, limit: 99, excludeChildren: true, sortBy: 'startLocal', sortOrder: 'desc' }, { signal });
                if (batch?.length > 99) throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Pagina attività troppo grande.');
                activities.push(...(batch || []));
                if (!batch || batch.length < 99) { complete = true; break; }
              }
              if (!complete) throw new GarminApiError('GARMIN_RANGE_INCOMPLETE', 'Troppe attività per un singolo intervallo.');
              results.push(normalizeActivities(activities, dates));
            } else if (FIELDS[resource]) {
              const params = resource === 'hrv' ? { fromDate: from, toDate: to } : { startDate: from, endDate: to };
              const fetch = { wellness: getSummary, hrv: getHrv, sleep: getSleep }[resource];
              results.push(normalizeMeasurements(resource, await fetch(client, params, { signal }), dates));
            } else {
              const fetch = { 'heart-rate-day': getHeartDay, 'body-battery-day': getBatteryDay, 'hrv-night': getHrvNight }[resource];
              const params = resource === 'heart-rate-day' ? { date: to } : resource === 'hrv-night' ? { calendarDate: to } : { startDate: to, endDate: to };
              results.push(normalizeSeries(resource, await fetch(client, params, { signal }), to));
            }
          }
          const identities = new Set(results.map(result => result.identity).filter(Boolean));
          if (identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Identità Garmin incoerenti.');
          return { resource, previous, previousConnection: connection?.id, identity: [...identities][0], records: results.flatMap(result => result.records), partial: results.some(result => result.partial), scopes: groups.map(dates => ({ from: dates[0], to: dates.at(-1) })) };
        } catch (error) {
          if (error instanceof InputError) error = new GarminApiError('GARMIN_INVALID_RESPONSE', 'Date non valide nella risposta Garmin.');
          return { resource, error };
        }
      }));
      signal.throwIfAborted();
      const identities = new Set(outcomes.map(result => result.identity).filter(Boolean));
      if (connection) identities.add(connection.identity);
      if (outcomes.some(result => result.error?.code === 'GARMIN_IDENTITY_MISMATCH') || identities.size > 1) throw new GarminApiError('GARMIN_IDENTITY_MISMATCH', 'Il titolare dei dati Garmin non coincide.');
      // Some detail reports have no owner field. Verify the account once via V2.
      if (!identities.size && outcomes.some(result => result.records?.some(record => hasMeasurementData(result.resource, record.values)))) {
        const probe = normalizeMeasurements('wellness', await getSummary(client, { startDate: range.to, endDate: range.to }, { signal }), [range.to]);
        if (probe.identity) identities.add(probe.identity);
      }
      const identity = [...identities][0];
      if (identity) connection = await db.connectGarmin(profile, identity, { timeZone, settingsAt }, owner);
      for (const result of outcomes) {
        if (result.skipped) continue;
        if (result.records && connection) {
          const previous = result.previousConnection === connection.id ? result.previous
            : await db.readGarminRows(profile.id, connection.id, result.resource, result.records.map(record => record.date));
          result.records = result.records.map(record => {
            const old = previous.find(row => row.date === record.date);
            if (hasMeasurementData(result.resource, record.values) || !hasMeasurementData(result.resource, old?.values)) return record;
            return { ...record, values: old.values, missing: true, valueFetchedAt: old.valueFetchedAt || old.fetchedAt,
              availability: Object.fromEntries((FIELDS[result.resource] || ['points']).map(field => [field, 'not_in_latest_response'])) };
          });
          await db.saveGarminRows(profile, connection.id, result.resource, result.records, owner);
          for (const record of result.records) await db.setGarminSyncState(profile, result.resource, result.partial ? { code: 'GARMIN_PARTIAL_DATA' } : null, owner, { from: record.date, to: record.date }, record.missing || !hasMeasurementData(result.resource, record.values) ? 'no_data' : 'available');
        } else if (result.error) await db.setGarminSyncState(profile, result.resource, result.error, owner, requirements[result.resource]);
        else if (result.records) {
          // Empty days do not prove an account identity. Cache only the attempt, never unverified values.
          for (const scope of result.scopes) await db.setGarminSyncState(profile, result.resource, null, owner, scope, 'pending_identity');
        }
      }
      return read(profile, { ...input, timeZone });
    } catch (error) {
      if (error instanceof GarminApiError) for (const resource of resources) {
        if (requirements[resource]) await db.setGarminSyncState(profile, resource, error, owner, requirements[resource]);
      }
      throw error;
    } finally { await db.releaseGarminSync(profile.id, owner); }
  }

  return { read, sync };
}

module.exports = { createDashboardMeasurements, rangesFor, freshRows };
