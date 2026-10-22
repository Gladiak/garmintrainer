'use strict';

const { InputError } = require('../libs/validation');

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(Date.parse(`${value}T12:00:00Z`))
      || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new InputError('Intervallo di date non valido.', 400, 'INVALID_DATE_RANGE');
  }
  return value;
}

function shiftDate(day, offset) {
  const date = new Date(`${calendarDate(day)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateRange(from, to, maxDays = 31) {
  calendarDate(from); calendarDate(to);
  const length = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
  if (length < 1 || length > maxDays) throw new InputError('Intervallo di date non valido.', 400, 'INVALID_DATE_RANGE');
  return Array.from({ length }, (_, index) => shiftDate(from, index));
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  try { return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone; }
  catch { return null; }
}

function dateInZone(timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

module.exports = { calendarDate, shiftDate, dateRange, validTimeZone, dateInZone };
