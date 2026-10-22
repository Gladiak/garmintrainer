'use strict';

const path = require('node:path');
const fs = require('node:fs');
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
    database: {
      host: env.DB_HOST || '127.0.0.1',
      port: integerSetting(env, 'DB_PORT', 3307, 1, 65535),
      user: env.DB_USER || 'garmintrainer',
      password: env.DB_PASSWORD_FILE ? fs.readFileSync(env.DB_PASSWORD_FILE, 'utf8').trimEnd() : '',
      database: env.DB_NAME || 'garmintrainer',
      connectionLimit: 5,
      dateStrings: true,
      bigIntAsNumber: true,
    },
    encryptionKeyPath: path.resolve(__dirname, '..', env.ENCRYPTION_KEY_PATH || 'data/encryption.key'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxyHops: integerSetting(env, 'TRUST_PROXY_HOPS', 0, 0, 1),
    allowedOrigins: (env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173').split(',').map(value => value.trim()).filter(Boolean),
    garmin: {
      baseUrl: env.GARMIN_PERSONAL_API_BASE_URL || DEFAULT_BASE_URL,
      timeoutMs: integerSetting(env, 'GARMIN_HTTP_TIMEOUT_MS', 20_000, 1),
      refreshMarginMs: integerSetting(env, 'GARMIN_TOKEN_REFRESH_MARGIN_MS', 60_000, 0),
    },
  };
}

module.exports = { DEFAULT_BASE_URL, readConfig };
