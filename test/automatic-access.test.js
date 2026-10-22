'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../libs/database');
const { createGarminProfileManager } = require('../libs/garmin');
const { createApp } = require('../app');
const { setup, listen, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Test', lastName: 'Automatico', primarySport: 'running' };

async function fixture(t, mockOptions = {}) {
  const { prepareProfileAccess } = await import('../frontend/src/lib/garmin-access.js');
  const provider = await setup(t, mockOptions);
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const manager = createGarminProfileManager({ databaseProvider: () => db, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ databaseProvider: () => db, garminManager: manager }));
  const request = async (path, { profileId, method, signal } = {}) => {
    const response = await fetch(`${base}/api${path}`, { method, signal, headers: profileId ? { 'X-Profile-Id': profileId } : {} });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error.message);
    return result;
  };
  const run = (options) => prepareProfileAccess({ request, isCurrent: () => true, ...options });
  return { provider, db, manager, request, run };
}

test('avvio automatico via HTTP: token pronto, cache riusata, nessuna chiave nel risultato', async (t) => {
  const { provider, db, request, run } = await fixture(t);
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  const initial = await request('/dashboard', { profileId: p.id });
  const states = [];
  await run({ profileId: p.id, status: initial.garmin, onChange: (state) => states.push(state) });
  assert.equal(states[0].connecting, true);
  assert.equal(states.at(-1).connecting, false); assert.equal(states.at(-1).error, '');
  assert.equal(states.at(-1).status.valid, true);
  assert.ok(!JSON.stringify(states).includes(TEST_API_KEY));
  const ready = await request('/dashboard', { profileId: p.id });
  await run({ profileId: p.id, status: ready.garmin, onChange: () => assert.fail('Nessuna nuova attivazione per il token valido') });
  assert.equal(provider.state.tokenRequests, 1); assert.equal(provider.state.dataRequests, 0);
});

test('profili senza chiave o senza selezione non emettono richieste Garmin', async (t) => {
  const { provider, db, request, run } = await fixture(t);
  const p = db.createProfile(values);
  for (const profileId of [null, p.id]) {
    const data = await request('/dashboard', { profileId });
    await run({ profileId, status: data.garmin, onChange: () => assert.fail('Il piano locale non richiede attivazione') });
  }
  assert.equal(provider.state.tokenRequests, 0);
});

test('chiave rifiutata: errore separato, piano e profilo salvati, retry solo alla richiesta successiva', async (t) => {
  const { provider, db, request, run } = await fixture(t, { tokenStatus: 401 });
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  db.createSession(p.id, { title: 'Corsa locale', sport: 'running', date: '2026-10-22', durationMinutes: 30 });
  const data = await request('/dashboard', { profileId: p.id });
  const states = [];
  await run({ profileId: p.id, status: data.garmin, onChange: (state) => states.push(state) });
  assert.equal(states.at(-1).connecting, false);
  assert.match(states.at(-1).error, /Accesso Garmin non consentito/);
  assert.ok(!states.at(-1).error.includes(TEST_API_KEY));
  assert.equal(provider.state.tokenRequests, 1);
  assert.equal(db.getProfile(p.id).hasGarminKey, true); assert.equal(db.listSessions(p.id).length, 1);
  provider.state.tokenStatus = 200;
  await run({ profileId: p.id, status: data.garmin, onChange: (state) => states.push(state) });
  assert.equal(states.at(-1).error, ''); assert.equal(states.at(-1).status.valid, true);
  assert.equal(provider.state.tokenRequests, 2);
});

test('token da rinnovare e accessi concorrenti condividono la richiesta del backend', async (t) => {
  const { provider, db, manager, run } = await fixture(t, { tokenDelayMs: 25 });
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  // A status snapshot can be valid while already within the renewal window.
  await Promise.all(Array.from({ length: 3 }, () => run({ profileId: p.id, status: { configured: true, valid: true, refreshRequired: true }, onChange: () => {} })));
  assert.equal(provider.state.tokenRequests, 1); assert.equal(manager.getClient(p.id).getTokenStatus().valid, true);
});

test('cambio profilo: la risposta tardiva non sovrascrive lo stato del nuovo profilo', async (t) => {
  const { provider, db, request, run } = await fixture(t, { tokenDelayMs: 40 });
  const a = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  const b = db.createProfile({ ...values, firstName: 'Altro' });
  let selected = a.id;
  const states = [];
  const pending = run({ profileId: a.id, status: { configured: true, valid: false }, isCurrent: () => selected === a.id, onChange: (state) => states.push(state) });
  for (let i = 0; provider.state.tokenRequests === 0 && i < 100; i += 1) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(provider.state.tokenRequests, 1);
  selected = b.id;
  await pending;
  assert.deepEqual(states, [{ connecting: true, error: '' }]);
  const current = await request('/dashboard', { profileId: b.id });
  assert.equal(current.garmin.configured, false);
});

test('richiesta annullata non pubblica errori o stato del profilo precedente', async (t) => {
  const { provider, db, run } = await fixture(t, { tokenDelayMs: 40 });
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  const controller = new AbortController();
  const states = [];
  const pending = run({ profileId: p.id, status: { configured: true, valid: false }, signal: controller.signal, onChange: state => states.push(state) });
  for (let i = 0; provider.state.tokenRequests === 0 && i < 100; i += 1) await new Promise(resolve => setTimeout(resolve, 1));
  controller.abort();
  await pending;
  assert.deepEqual(states, [{ connecting: true, error: '' }]);
});
