'use strict';

class GarminApiError extends Error {
  constructor(code, message, { statusCode = 502, upstreamStatus = null, retryAt = null } = {}) {
    super(message);
    this.name = 'GarminApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
    this.retryAt = retryAt;
  }
}

function safeHttpError(error, operation) {
  const upstreamStatus = error.response?.status ?? null;
  if (upstreamStatus === 429) {
    const header = error.response.headers?.['retry-after'];
    const delay = /^\d+$/.test(String(header)) ? Date.now() + Number(header) * 1000 : Date.parse(header);
    return new GarminApiError('GARMIN_RATE_LIMIT', 'Garmin richiede di attendere prima di aggiornare.', {
      statusCode: 429, upstreamStatus, retryAt: Number.isFinite(delay) ? Math.max(Date.now() + 1000, delay) : Date.now() + 30_000,
    });
  }
  if (upstreamStatus === 401 || (operation === 'token' && upstreamStatus === 403)) {
    return new GarminApiError(
      'GARMIN_AUTH_FAILED',
      'Accesso Garmin non consentito: verificare validità e scadenza della chiave personale.',
      { statusCode: 503, upstreamStatus },
    );
  }
  if (upstreamStatus === 403) {
    return new GarminApiError('GARMIN_FORBIDDEN', 'Garmin non consente l\'accesso alla risorsa richiesta.', {
      upstreamStatus,
    });
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new GarminApiError('GARMIN_TIMEOUT', 'Garmin non ha risposto entro il tempo previsto.', {
      statusCode: 504,
    });
  }
  return new GarminApiError(
    operation === 'token' ? 'GARMIN_TOKEN_REQUEST_FAILED' : 'GARMIN_REQUEST_FAILED',
    'La richiesta a Garmin non è riuscita.',
    { upstreamStatus },
  );
}

module.exports = { GarminApiError, safeHttpError };
