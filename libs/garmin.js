'use strict';

const axios = require('axios');
const { DEFAULT_BASE_URL, readConfig } = require('./config');
const { withGarminRequest, parseGarminJson } = require('../helpers/garmin-http');
const { GarminApiError, safeHttpError } = require('../helpers/garmin-errors');
const { personalApiToken, TOKEN_PATH } = require('../controllers/garmin-token');


function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new TypeError('Base URL Garmin non valida');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Usare HTTPS per Garmin; HTTP è consentito soltanto su loopback');
  }
  return url.toString().replace(/\/+$/, '');
}

function createGarminClient({
  apiKey = '',
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 20_000,
  refreshMarginMs = 60_000,
  now = Date.now,
} = {}) {
  if (typeof apiKey !== 'string') throw new TypeError('La chiave Garmin deve essere una stringa');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Il timeout Garmin deve essere un intero positivo');
  }
  if (!Number.isSafeInteger(refreshMarginMs) || refreshMarginMs < 0) {
    throw new TypeError('Il margine di rinnovo deve essere un intero non negativo');
  }
  const key = apiKey.trim();
  const http = axios.create({
    baseURL: validateBaseUrl(baseUrl),
    timeout: timeoutMs,
    maxRedirects: 0,
    maxContentLength: 8 * 1024 * 1024,
    paramsSerializer: { indexes: null },
  });

  // Credenziali e richiesta in corso restano private nella closure del client.
  let token = null;
  let pendingToken = null;
  let limitedUntil = 0;

  function decodeToken(accessToken) {
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) {
        throw new Error('JWT non valido');
      }
      const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
      const issuedAt = now();
      const expiresAt = payload.exp * 1000;
      if (typeof payload.exp !== 'number' || !Number.isFinite(expiresAt)
          || expiresAt <= issuedAt || expiresAt > 8.64e15) {
        throw new Error('Scadenza non valida');
      }
      // Il margine non deve far rinnovare a ogni lettura un token di breve durata.
      const margin = Math.min(refreshMarginMs, (expiresAt - issuedAt) / 10);
      return { accessToken, expiresAt, refreshAt: expiresAt - margin };
    } catch {
      throw new GarminApiError(
        'GARMIN_INVALID_TOKEN',
        'Garmin ha restituito un token senza una scadenza JWT valida.',
      );
    }
  }

  async function obtainToken() {
    let accessToken;
    try { accessToken = await personalApiToken(http, key); }
    catch (error) {
      if (error instanceof GarminApiError) throw error;
      const failure = safeHttpError(error, 'token');
      if (failure.retryAt) limitedUntil = failure.retryAt;
      throw failure;
    }
    const nextToken = decodeToken(accessToken);
    token = nextToken;
    return nextToken;
  }

  async function getTokenRecord() {
    if (limitedUntil > Date.now()) throw new GarminApiError('GARMIN_RATE_LIMIT', 'Garmin richiede di attendere.', { statusCode: 429, retryAt: limitedUntil });
    if (!key) {
      throw new GarminApiError('GARMIN_NOT_CONFIGURED', 'Chiave personale Garmin non configurata.', {
        statusCode: 503,
      });
    }
    if (pendingToken) return pendingToken;
    if (token && now() < token.refreshAt) return token;
    pendingToken = obtainToken().finally(() => { pendingToken = null; });
    return pendingToken;
  }

  function getTokenStatus() {
    const currentTime = now();
    return {
      configured: Boolean(key),
      cached: token !== null,
      valid: token !== null && currentTime < token.expiresAt,
      refreshRequired: token === null || currentTime >= token.refreshAt,
      refreshing: pendingToken !== null,
      expiresAt: token ? new Date(token.expiresAt).toISOString() : null,
    };
  }

  async function ensureToken() {
    await getTokenRecord();
    return getTokenStatus();
  }

  async function getAccessToken() {
    return (await getTokenRecord()).accessToken;
  }

  async function get(path, { params, signal, binary = false } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
        || /[\\?#\s\u0000-\u001f]/.test(path)) {
      throw new TypeError('Usare un percorso API relativo; passare le query tramite params');
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal?.throwIfAborted();
      const usedToken = await getTokenRecord();
      let response;
      try {
        response = await withGarminRequest(() => {
          if (limitedUntil > Date.now()) throw new GarminApiError('GARMIN_RATE_LIMIT', 'Garmin richiede di attendere.', { statusCode: 429, retryAt: limitedUntil });
          return http.get(path, {
          params,
          signal,
          timeout: Math.min(timeoutMs, 15_000),
          headers: { Authorization: `Bearer ${usedToken.accessToken}`, Accept: binary ? 'application/x-zip-compressed' : 'application/json' },
          // Leggere prima lo status: anche un 401 con corpo HTML deve produrre il rinnovo.
          responseType: binary ? 'arraybuffer' : 'text',
          transformResponse: [(body) => body],
          });
        }, signal);
      } catch (error) {
        if (error instanceof GarminApiError) throw error;
        if (error.response?.status === 401) {
          // Un 401 tardivo del vecchio token non deve invalidare un rinnovo già concluso.
          if (token === usedToken) token = null;
          if (attempt === 0) continue;
        }
        const failure = safeHttpError(error, 'data');
        if (failure.retryAt) limitedUntil = failure.retryAt;
        throw failure;
      }
      if (response.status === 204 || response.data === '') return null;
      if (binary) return response.data;
      try { return parseGarminJson(response.data); } catch {
        throw new GarminApiError('GARMIN_INVALID_RESPONSE', 'Garmin ha restituito dati JSON non validi.');
      }
    }
  }

  return Object.freeze({ get, ensureToken, getAccessToken, getTokenStatus });
}

function createGarminProfileManager({ databaseProvider, config = readConfig().garmin } = {}) {
  const clients = new Map();
  return {
    async getClient(profileId) {
      const database = databaseProvider();
      function fromCredential(credential) {
        const cached = clients.get(profileId);
        if (cached?.revision === credential.revision) return cached.client;
        const client = createGarminClient({ ...config, apiKey: credential.apiKey });
        clients.set(profileId, { revision: credential.revision, client });
        return client;
      }
      const credential = await database.getGarminCredential(profileId);
      return fromCredential(credential);
    },
    invalidate(profileId) { clients.delete(profileId); },
  };
}

let sharedManager;
function getGarminProfileManager() {
  if (!sharedManager) sharedManager = createGarminProfileManager({ databaseProvider: require('./mariadb').getMariaDatabase });
  return sharedManager;
}
function getGarminClient(profileId) { return getGarminProfileManager().getClient(profileId); }

module.exports = { createGarminClient, createGarminProfileManager, getGarminProfileManager, getGarminClient, GarminApiError, TOKEN_PATH };
