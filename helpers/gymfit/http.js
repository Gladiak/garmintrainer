'use strict';

const { ImportError } = require('./model');

// Keep credentials confined to the documented origin and never follow redirects.
function createHttpClient(apiKey, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new ImportError('API_KEY_REQUIRED', 'Configura GYMFIT_API_KEY oppure GYMFIT_API_KEY_FILE.');
  return async (path, parameters = {}) => {
    const url = new URL(path, 'https://api.gymfit-api.com');
    if (url.origin !== 'https://api.gymfit-api.com' || !url.pathname.startsWith('/v2/')) throw new ImportError('INVALID_ENDPOINT', 'Endpoint GymFit non valido.');
    for (const [name, value] of Object.entries(parameters)) if (value != null) url.searchParams.set(name, String(value));
    try {
      const response = await fetchImpl(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      let data;
      try { data = text.length <= 8 * 1024 * 1024 ? JSON.parse(text) : null; } catch { data = null; }
      return { status: response.status, headers: response.headers, data };
    } catch {
      throw new ImportError('NETWORK_ERROR', 'Errore di rete o timeout durante la richiesta GymFit.', 'paused');
    }
  };
}

module.exports = { createHttpClient };
