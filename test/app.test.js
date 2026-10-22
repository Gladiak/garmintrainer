'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { createDatabase } = require('../libs/database');
const { createGarminProfileManager } = require('../libs/garmin');
const { setup, listen, TEST_API_KEY } = require('./helpers');

async function application(t, options = {}) {
  const provider = await setup(t, options);
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const profile = database.createProfile({ firstName: 'Test', lastName: 'Utente', primarySport: 'running', apiKey: TEST_API_KEY });
  const garminManager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const app = createApp({ garminManager, databaseProvider: () => database });
  const baseUrl = await listen(t, app);
  return { ...provider, appUrl: baseUrl, headers: { 'X-Profile-Id': profile.id } };
}

test('Express risponde a health e status senza contattare Garmin', async (t) => {
  const { appUrl, state, headers } = await application(t);
  const health = await fetch(`${appUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'garmintrainer' });
  const response = await fetch(`${appUrl}/api/garmin/auth/status`, { headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.deepEqual(await response.json(), {
    configured: true, cached: false, valid: false, refreshRequired: true, refreshing: false, expiresAt: null,
  });
  assert.equal(state.tokenRequests, 0);
});

test('ensure via HTTP condivide la cache e non restituisce chiave o token', async (t) => {
  const { appUrl, state, headers } = await application(t, { tokenDelayMs: 20 });
  const responses = await Promise.all(Array.from({ length: 10 }, () => fetch(`${appUrl}/api/garmin/auth/ensure`, { method: 'POST', headers })));
  for (const response of responses) {
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(JSON.parse(text).valid, true);
    assert.ok(!text.includes(TEST_API_KEY));
    assert.ok(!text.includes(state.tokens[0]));
  }
  assert.equal(state.tokenRequests, 1);
});

test('chiave rifiutata: risposta HTTP sicura con errore di servizio', async (t) => {
  const { appUrl, headers } = await application(t, { tokenStatus: 401 });
  const response = await fetch(`${appUrl}/api/garmin/auth/ensure`, { method: 'POST', headers });
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.equal(JSON.parse(body).error.code, 'GARMIN_AUTH_FAILED');
  assert.ok(!body.includes(TEST_API_KEY));
  assert.ok(!body.includes('Authorization'));
});

test('richieste JSON non valide e percorsi sconosciuti gestiti senza emettere token', async (t) => {
  const { appUrl, state } = await application(t);
  const invalid = await fetch(`${appUrl}/api/garmin/auth/ensure`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
  const missing = await fetch(`${appUrl}/missing`);
  assert.equal(missing.status, 404);
  assert.equal(state.tokenRequests, 0);
});
