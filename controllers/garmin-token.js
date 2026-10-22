'use strict';

const { withGarminRequest } = require('../helpers/garmin-http');
const { GarminApiError } = require('../helpers/garmin-errors');
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

async function personalApiToken(http, apiKey) {
  const response = await withGarminRequest(() => http.post(TOKEN_PATH, undefined, {
    headers: { Authorization: `ApiKey ${apiKey}`, Accept: '*/*' },
    responseType: 'text', transformResponse: [body => body], maxContentLength: 64 * 1024,
  }));
  const token = typeof response.data === 'string' ? response.data.trim() : '';
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new GarminApiError('GARMIN_INVALID_TOKEN', 'Garmin ha restituito un token non valido.');
  }
  return token;
}

module.exports = { personalApiToken, TOKEN_PATH };
