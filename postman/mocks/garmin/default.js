'use strict';

// Simulatore di test. La chiave e i JWT di questo file sono esclusivamente fittizi.
const http = require('node:http');
const { measurementsFor } = require('./measurements');
const TEST_API_KEY = 'test-garmin-personal-key';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const PROFILE_PATH = '/userprofile-service/userprofile/settings';

function makeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.testsignature`;
}

function createGarminMock({ now = Date.now, ...options } = {}) {
  const defaults = {
    tokenStatus: 200, dataStatus: 200, tokenDelayMs: 0, dataDelayMs: 0,
    tokenLifetimeSeconds: 86400, rejectFirstToken: false, rejectAllTokens: false,
    unauthorizedHtml: false, tokenBody: null, dataBody: null, apiKeys: [TEST_API_KEY],
    measurements: false, measurementIdentity: '9007199254740993', resourceStatus: {}, resourceBodies: {}, retryAfter: '1',
  };
  const state = { ...defaults, ...options, tokenRequests: 0, dataRequests: 0, requests: [], tokens: [] };

  function reply(res, status, body, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  async function readBody(req) {
    if (req.body !== undefined) {
      return req.body === null ? '' : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    return body;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const measurement = state.measurements ? measurementsFor(url, state.measurementIdentity) : null;
    if (pathname === '/__stats' && req.method === 'GET') {
      return reply(res, 200, { tokenRequests: state.tokenRequests, dataRequests: state.dataRequests });
    }
    if (pathname === '/__control' && req.method === 'POST') {
      const control = JSON.parse(await readBody(req));
      if (control.reset) Object.assign(state, defaults, { tokenRequests: 0, dataRequests: 0, requests: [], tokens: [] });
      for (const key of Object.keys(defaults)) if (key in control) state[key] = control[key];
      return reply(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === TOKEN_PATH) {
      state.tokenRequests += 1;
      state.requests.push({ method: req.method, path: pathname, authorization: req.headers.authorization, body: await readBody(req) });
      if (state.tokenDelayMs) await new Promise((resolve) => setTimeout(resolve, state.tokenDelayMs));
      if (!state.apiKeys.some((key) => req.headers.authorization === `ApiKey ${key}`)) return reply(res, 401, { error: 'Invalid test key' });
      if (state.tokenStatus === 302) {
        res.writeHead(302, { Location: '/must-not-follow-redirect' });
        return res.end();
      }
      if (state.tokenStatus !== 200) return reply(res, state.tokenStatus, { error: `Rejected ${TEST_API_KEY}` });
      const jwt = state.tokenBody ?? makeJwt({ exp: Math.floor(now() / 1000) + state.tokenLifetimeSeconds, jti: state.tokenRequests });
      state.tokens.push(jwt);
      return reply(res, 200, `${jwt}\n`, 'text/plain');
    }

    if (req.method === 'GET' && (pathname === PROFILE_PATH || measurement)) {
      state.dataRequests += 1;
      state.requests.push({ method: req.method, path: pathname, query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
      if (state.dataDelayMs) await new Promise((resolve) => setTimeout(resolve, state.dataDelayMs));
      const bearer = req.headers.authorization?.replace(/^Bearer /, '');
      const reject = !state.tokens.includes(bearer) || state.rejectAllTokens
        || (state.rejectFirstToken && bearer === state.tokens[0]);
      if (reject) {
        return state.unauthorizedHtml
          ? reply(res, 401, '<html>Unauthorized</html>', 'text/html')
          : reply(res, 401, { error: 'Invalid test bearer token' });
      }
      if (measurement) {
        const status = state.resourceStatus[measurement.resource] || state.dataStatus;
        if (status === 429) res.setHeader('Retry-After', state.retryAfter);
        return reply(res, status, state.resourceBodies[measurement.resource] ?? measurement.body);
      }
      if (state.dataStatus === 204) { res.writeHead(204); return res.end(); }
      if (state.dataStatus !== 200) return reply(res, state.dataStatus, { error: 'Simulated upstream error' });
      return reply(res, 200, state.dataBody ?? { timeZone: 'Europe/Rome' });
    }

    reply(res, 501, { error: 'Endpoint not modeled by this authentication simulation' });
  }

  const handler = (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: 'Mock request failed' });
      else res.end();
    });
  };
  return { handler, state };
}

if (typeof pm !== 'undefined' || require.main === module) {
  http.createServer(createGarminMock().handler).listen(Number(process.env.PORT) || 4500, '127.0.0.1');
}

module.exports = { createGarminMock, makeJwt, TEST_API_KEY, TOKEN_PATH, PROFILE_PATH };
