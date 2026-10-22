'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, TEST_API_KEY } = require('./helpers');
const { makeJwt, TOKEN_PATH, PROFILE_PATH } = require('../postman/mocks/garmin/default');
const { createGarminClient, GarminApiError } = require('../libs/garmin');
const { readConfig } = require('../libs/config');

test('configurazione: le chiavi globali vengono ignorate, valori numerici validati', () => {
  assert.equal(readConfig({ GARMIN_API_KEY: 'legacy', GARMIN_PERSONAL_API_KEY: 'preferred' }).garmin.apiKey, undefined);
  assert.equal(readConfig({}).host, '127.0.0.1');
  assert.throws(() => readConfig({ PORT: '3000oops' }), /PORT/);
  assert.throws(() => readConfig({ GARMIN_HTTP_TIMEOUT_MS: '0' }), /TIMEOUT/);
});

test('stato senza chiamate HTTP e chiave mancante gestita esplicitamente', async (t) => {
  const { client, state } = await setup(t, {}, { apiKey: '' });
  assert.equal(client.getTokenStatus().configured, false);
  await assert.rejects(client.ensureToken(), { code: 'GARMIN_NOT_CONFIGURED', statusCode: 503 });
  assert.equal(state.tokenRequests, 0);
});

test('richieste concorrenti condividono un unico POST testuale senza corpo', async (t) => {
  const { client, state } = await setup(t, { tokenDelayMs: 20 });
  const tokens = await Promise.all(Array.from({ length: 20 }, () => client.getAccessToken()));
  assert.equal(new Set(tokens).size, 1);
  assert.equal(state.tokenRequests, 1);
  assert.deepEqual(state.requests[0], { method: 'POST', path: TOKEN_PATH, authorization: `ApiKey ${TEST_API_KEY}`, body: '' });
  assert.equal(client.getTokenStatus().valid, true);
  assert.ok(!JSON.stringify(client.getTokenStatus()).includes(tokens[0]));
  assert.ok(!JSON.stringify(client).includes(TEST_API_KEY));
});

test('riuso della cache e invio del Bearer nelle letture condivise', async (t) => {
  const { client, state } = await setup(t);
  assert.deepEqual(await client.get(PROFILE_PATH), { timeZone: 'Europe/Rome' });
  await client.get(PROFILE_PATH, { params: { example: 'value' } });
  assert.equal(state.tokenRequests, 1);
  assert.equal(state.dataRequests, 2);
  assert.equal(state.requests[1].authorization, `Bearer ${state.tokens[0]}`);
});

test('rinnovo automatico dopo la scadenza senza attendere timer reali', async (t) => {
  let clock = Date.UTC(2026, 9, 22, 8);
  const { client, state } = await setup(t, { now: () => clock }, { now: () => clock });
  const first = await client.getAccessToken();
  clock += 25 * 60 * 60 * 1000;
  assert.equal(client.getTokenStatus().valid, false);
  const renewed = await client.getAccessToken();
  assert.notEqual(renewed, first);
  assert.equal(state.tokenRequests, 2);
  assert.equal(client.getTokenStatus().valid, true);
});

test('rinnovo nel margine preventivo e margine proporzionato ai token brevi', async (t) => {
  let clock = Date.UTC(2026, 9, 22, 8);
  const { client, state } = await setup(t, { now: () => clock, tokenLifetimeSeconds: 30 }, { now: () => clock });
  await client.ensureToken();
  clock += 1000;
  await client.ensureToken();
  assert.equal(state.tokenRequests, 1);
  clock += 27_000;
  assert.equal(client.getTokenStatus().valid, true);
  assert.equal(client.getTokenStatus().refreshRequired, true);
  await client.ensureToken();
  assert.equal(state.tokenRequests, 2);
});

test('401 concorrenti, anche tardivi, condividono il rinnovo e non scartano il token nuovo', async (t) => {
  const { client, state } = await setup(t, { rejectFirstToken: true, tokenDelayMs: 10, dataDelayMs: 15 });
  const results = await Promise.all(Array.from({ length: 20 }, () => client.get(PROFILE_PATH)));
  assert.ok(results.every((result) => result.timeZone === 'Europe/Rome'));
  assert.equal(state.tokenRequests, 2);
  assert.equal(state.dataRequests, 40);
});

test('un 401 con corpo HTML produce comunque un rinnovo', async (t) => {
  const { client, state } = await setup(t, { rejectFirstToken: true, unauthorizedHtml: true });
  assert.deepEqual(await client.get(PROFILE_PATH), { timeZone: 'Europe/Rome' });
  assert.equal(state.tokenRequests, 2);
});

test('401 persistente: un solo retry, errore esplicito e cache invalidata', async (t) => {
  const { client, state } = await setup(t, { rejectAllTokens: true });
  await assert.rejects(client.get(PROFILE_PATH), { code: 'GARMIN_AUTH_FAILED', upstreamStatus: 401 });
  assert.equal(state.tokenRequests, 2);
  assert.equal(state.dataRequests, 2);
  assert.equal(client.getTokenStatus().cached, false);
});

for (const status of [401, 403, 500]) {
  test(`emissione token rifiutata (${status}): nessun loop, nessuna credenziale nell'errore, recupero successivo`, async (t) => {
    const { client, state } = await setup(t, { tokenStatus: status });
    await assert.rejects(client.ensureToken(), (error) => {
      assert.ok(error instanceof GarminApiError);
      assert.equal(error.upstreamStatus, status);
      assert.ok(!JSON.stringify(error).includes(TEST_API_KEY));
      assert.equal(error.config, undefined);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(state.tokenRequests, 1);
    assert.equal(client.getTokenStatus().refreshing, false);
    state.tokenStatus = 200;
    await client.ensureToken();
    assert.equal(state.tokenRequests, 2);
  });
}

for (const body of ['not-a-jwt', makeJwt({}), makeJwt({ exp: '1234567890' }), makeJwt({ exp: 1 })]) {
  test(`risposta token non utilizzabile: ${body === 'not-a-jwt' ? 'testo non JWT' : 'claim exp non valido'}`, async (t) => {
    const { client, state } = await setup(t, { tokenBody: body });
    await assert.rejects(client.ensureToken(), { code: 'GARMIN_INVALID_TOKEN' });
    assert.equal(client.getTokenStatus().cached, false);
    assert.equal(client.getTokenStatus().refreshing, false);
    state.tokenBody = null;
    await client.ensureToken();
    assert.equal(client.getTokenStatus().valid, true);
  });
}

for (const status of [403, 429, 500]) {
  test(`errore dati ${status}: non provoca un rinnovo del token`, async (t) => {
    const { client, state } = await setup(t, { dataStatus: status });
    await assert.rejects(client.get(PROFILE_PATH), { upstreamStatus: status });
    assert.equal(state.tokenRequests, 1);
    assert.equal(state.dataRequests, 1);
  });
}

test('timeout limitato e richiesta successiva libera di ottenere un token', async (t) => {
  const { client, state } = await setup(t, { tokenDelayMs: 100 }, { timeoutMs: 20 });
  await assert.rejects(client.ensureToken(), { code: 'GARMIN_TIMEOUT', statusCode: 504 });
  assert.equal(client.getTokenStatus().refreshing, false);
  state.tokenDelayMs = 0;
  await client.ensureToken();
  assert.equal(client.getTokenStatus().valid, true);
});

test('redirect del provider non seguito', async (t) => {
  const { client, state } = await setup(t, { tokenStatus: 302 });
  await assert.rejects(client.ensureToken(), { upstreamStatus: 302 });
  assert.equal(state.requests.length, 1);
});

test('risposte senza contenuto e JSON inatteso distinti dagli errori di autenticazione', async (t) => {
  const { client, state } = await setup(t, { dataStatus: 204 });
  assert.equal(await client.get(PROFILE_PATH), null);
  state.dataStatus = 200;
  state.dataBody = '<html>Not JSON</html>';
  await assert.rejects(client.get(PROFILE_PATH), { code: 'GARMIN_INVALID_RESPONSE' });
  assert.equal(state.tokenRequests, 1);
});

test('URL esterni e percorsi ambigui rifiutati prima di usare le credenziali', async (t) => {
  const { client, state } = await setup(t);
  for (const value of ['https://example.com', '//example.com', '/\\example.com', '/path?key=value']) {
    await assert.rejects(client.get(value), TypeError);
  }
  assert.equal(state.tokenRequests, 0);
  assert.throws(() => createGarminClient({ baseUrl: 'http://example.com' }), TypeError);
});
