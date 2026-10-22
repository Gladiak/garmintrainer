'use strict';

const { GarminApiError } = require('./garmin-errors');
const { providerIdentity } = require('./garmin-measurements');
const { calendarDate } = require('./garmin-dates');

function invalid() {
  return new GarminApiError('GARMIN_INVALID_RESPONSE', 'Serie temporale Garmin non valida.');
}

function utcTimestamp(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 1e12) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw invalid();
  const time = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(time)) throw invalid();
  return time;
}

function normalizeSeries(resource, payload, date) {
  const record = { date, schemaVersion: 2, values: null, availability: {} };
  if (payload === null) return { records: [record], identity: null };
  let row = payload;
  if (resource === 'body-battery-day') {
    if (!Array.isArray(payload) || payload.length > 1) throw invalid();
    if (!payload.length) return { records: [record], identity: null };
    row = payload[0];
    if (row === null || row && typeof row === 'object' && !Object.keys(row).length) return { records: [record], identity: null };
    if (row.date == null && (row.bodyBatteryValuesArray == null || Array.isArray(row.bodyBatteryValuesArray) && !row.bodyBatteryValuesArray.length)) return { records: [record], identity: providerIdentity(row) };
    if (calendarDate(row.date) !== date) throw invalid();
  }
  const identity = providerIdentity(row);
  let points;
  let summary = null;
  if (resource === 'hrv-night') {
    if (row.hrvSummary?.calendarDate && calendarDate(row.hrvSummary.calendarDate) !== date) throw invalid();
    summary = typeof row.hrvSummary?.lastNightAvg === 'number' && row.hrvSummary.lastNightAvg > 0 ? row.hrvSummary.lastNightAvg : null;
    if (!Object.hasOwn(row, 'hrvReadings') && !row.hrvSummary && !identity && Object.keys(row).length) throw invalid();
    if (row.hrvReadings != null && !Array.isArray(row.hrvReadings)) throw invalid();
    points = (row.hrvReadings || []).filter(item => item !== null && !(item && typeof item === 'object' && item.readingTimeGMT == null && (item.hrvValue == null || item.hrvValue === -1)))
      .map(item => ({ timestamp: utcTimestamp(item.readingTimeGMT), value: item.hrvValue }));
  } else {
    const battery = resource === 'body-battery-day';
    const descriptors = battery ? row.bodyBatteryValueDescriptorDTOList : row.heartRateValueDescriptors;
    const values = battery ? row.bodyBatteryValuesArray : row.heartRateValues;
    if (values == null || Array.isArray(values) && !values.length) {
      if (values === undefined && !identity && Object.keys(row).length && !(battery ? row.date : Object.hasOwn(row, 'heartRateValues'))) throw invalid();
      points = [];
    } else {
      if (!Array.isArray(descriptors) || !Array.isArray(values) || values.length > 20000) throw invalid();
      const columns = new Map();
      for (const descriptor of descriptors) {
        const name = battery ? descriptor.bodyBatteryValueDescriptorKey : descriptor.key;
        const index = battery ? descriptor.bodyBatteryValueDescriptorIndex : descriptor.index;
        if (typeof name !== 'string' || !Number.isSafeInteger(index) || index < 0 || index > 30) throw invalid();
        columns.set(name.replace(/[^a-z0-9]/gi, '').toLowerCase(), index);
      }
      const column = names => names.map(name => columns.get(name)).find(index => index !== undefined);
      const time = column(['timestamp', 'timestampgmt', 'timegmt']);
      const value = column(battery ? ['bodybatterylevel', 'bodybattery', 'value'] : ['heartrate', 'heartratevalue', 'value']);
      const min = column(['minbodybattery', 'minbodybatterylevel', 'minvalue', 'min']);
      const max = column(['maxbodybattery', 'maxbodybatterylevel', 'maxvalue', 'max']);
      if (values.length && (time === undefined || value === undefined && (min === undefined || max === undefined))) throw invalid();
      points = values.filter(item => item !== null && !(Array.isArray(item) && item[time] == null
        && [value, min, max].every(index => index === undefined || item[index] == null || item[index] === -1))).map(item => {
        if (!Array.isArray(item)) throw invalid();
        return { timestamp: utcTimestamp(item[time]), value: value === undefined ? null : item[value],
          ...(min !== undefined && max !== undefined ? { min: item[min], max: item[max] } : {}) };
      });
    }
  }
  if (points.length > 20000) throw invalid();
  const maxValue = resource === 'heart-rate-day' ? 400 : resource === 'hrv-night' ? 3000 : 100;
  const start = Date.parse(`${date}T00:00:00Z`);
  const byTime = new Map();
  for (const point of points) {
    // Allow offsets and a night beginning on the previous calendar date.
    if (point.timestamp < start - 36 * 3600000 || point.timestamp > start + 48 * 3600000) throw invalid();
    for (const key of ['value', 'min', 'max']) if (key in point) {
      const value = point[key];
      point[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maxValue && (resource === 'body-battery-day' || value > 0) ? value : null;
    }
    if (point.min !== undefined && point.min !== null && point.max !== null && point.min > point.max) throw invalid();
    const previous = byTime.get(point.timestamp);
    if (previous && JSON.stringify(previous) !== JSON.stringify(point)) throw invalid();
    byTime.set(point.timestamp, point);
  }
  record.values = { points: [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp), summary };
  record.availability.points = points.length ? 'available' : 'no_data';
  return { identity, records: [record] };
}

module.exports = { normalizeSeries };
