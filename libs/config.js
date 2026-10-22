'use strict';

const path = require('node:path');
const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';

function integerSetting(env, name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  if (env[name] === undefined) return fallback;
  if (!/^\d+$/.test(env[name])) throw new Error(`${name} deve essere un intero`);
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} fuori dall'intervallo consentito`);
  }
  return value;
}

function readConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: integerSetting(env, 'PORT', 3000, 1, 65535),
    databasePath: env.DATABASE_PATH
      ? path.resolve(__dirname, '..', env.DATABASE_PATH)
      : path.join(__dirname, '..', 'db', 'garmintrainer.sqlite'),
    garmin: {
      baseUrl: env.GARMIN_PERSONAL_API_BASE_URL || DEFAULT_BASE_URL,
      timeoutMs: integerSetting(env, 'GARMIN_HTTP_TIMEOUT_MS', 20_000, 1),
      refreshMarginMs: integerSetting(env, 'GARMIN_TOKEN_REFRESH_MARGIN_MS', 60_000, 0),
    },
  };
}

module.exports = { DEFAULT_BASE_URL, readConfig };
