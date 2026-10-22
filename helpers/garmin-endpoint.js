'use strict';

const { InputError } = require('../libs/validation');
const { GarminApiError } = require('./garmin-errors');
const { calendarDate, dateRange } = require('./garmin-dates');
const { setTimeout: delay } = require('node:timers/promises');

// Controllers declare each public contract once; this helper validates and executes it.
function garminEndpoint({ path, parameters = {}, response = 'object', range, maxDays = 31 }) {
  return async function fetchGarminEndpoint(client, input = {}, { signal } = {}) {
    const params = {};
    let target = path;
    for (const [name, definition] of Object.entries(parameters)) {
      const { location, type, required, default: fallback } = definition;
      let value = input[name] ?? fallback;
      if (value === undefined) {
        if (required) throw new InputError('Parametro Garmin mancante.', 400, 'INVALID_INPUT');
        continue;
      }
      if (type === 'date') value = calendarDate(value);
      else if (type === 'id') {
        if (typeof value === 'number' && !Number.isSafeInteger(value) || !/^\d{1,20}$/.test(String(value))) throw new InputError('ID Garmin non valido.', 400, 'INVALID_INPUT');
        value = String(value);
      } else if (type === 'integer' && !Number.isSafeInteger(value)
        || type === 'number' && !Number.isFinite(value)
        || type === 'boolean' && typeof value !== 'boolean'
        || type === 'string' && (typeof value !== 'string' || value.length > 500)
        || type === 'array' && (!Array.isArray(value) || value.length > 30 || value.some(item => typeof item !== 'string' || item.length > 100))) {
        throw new InputError('Parametro Garmin non valido.', 400, 'INVALID_INPUT');
      }
      if (location === 'path') target = target.replace(`{${name}}`, encodeURIComponent(value));
      else params[name] = value;
    }
    if (range && input[range[0]] !== undefined && input[range[1]] !== undefined) dateRange(input[range[0]], input[range[1]], maxDays);
    if ('limit' in params && (params.limit < 1 || params.limit > 99)
      || 'start' in params && params.start < 0) throw new InputError('Paginazione non valida.', 400, 'INVALID_INPUT');
    let data;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        data = await client.get(target, { params, signal, binary: response === 'binary' });
        break;
      } catch (error) {
        if (attempt || signal?.aborted || !(error.code === 'GARMIN_TIMEOUT' || error.upstreamStatus >= 500)) throw error;
        await delay(250 + Math.random() * 250, undefined, { signal });
      }
    }
    if (data === null) return null;
    if (response === 'binary') return data;
    if (response === 'array' ? !Array.isArray(data) : !data || typeof data !== 'object' || Array.isArray(data)) {
      throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Formato della risposta Garmin non valido.');
    }
    return data;
  };
}

module.exports = { garminEndpoint };
