'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../libs/database');
const { createApp } = require('../app');
const { setup, listen } = require('./helpers');
const { createGarminProfileManager } = require('../libs/garmin');
const { TEST_API_KEY } = require('./helpers');
const profileValues = { firstName: 'Test', lastName: 'Persona', primarySport: 'running', apiKey: TEST_API_KEY };

const session = { title: 'Corsa facile', sport: 'running', date: '2026-10-22', time: '18:30', durationMinutes: 45, notes: 'Ritmo comodo' };

test('SQLite mantiene le sessioni dopo la chiusura e riapertura del file', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-db-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'trainer.sqlite');
  let database = createDatabase(filename);
  const profile = database.createProfile(profileValues);
  const saved = database.createSession(profile.id, session);
  database.close();
  database = createDatabase(filename);
  t.after(() => database.close());
  assert.equal(database.listSessions(profile.id).length, 1);
  assert.deepEqual(database.listSessions(profile.id)[0], saved);
  assert.equal(database.getGarminCredential(profile.id).apiKey, TEST_API_KEY);
  assert.ok(!fs.readFileSync(filename).includes(Buffer.from(TEST_API_KEY)));
});

test('sessioni: validazione, stato e rimozione senza inserire dati dimostrativi', (t) => {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const profile = database.createProfile(profileValues);
  assert.deepEqual(database.listSessions(profile.id), []);
  for (const invalid of [{ ...session, date: '2026-02-30' }, { ...session, time: '25:00' }, { ...session, durationMinutes: -1 }, { ...session, sport: 'unknown' }, { ...session, title: '   ' }]) {
    assert.throws(() => database.createSession(profile.id, invalid), { code: 'INVALID_INPUT' });
  }
  const saved = database.createSession(profile.id, session);
  assert.equal(saved.status, 'planned');
  assert.equal(database.setSessionStatus(profile.id, saved.id, 'completed').status, 'completed');
  assert.throws(() => database.setSessionStatus(profile.id, saved.id, 'unknown'), { statusCode: 400 });
  database.deleteSession(profile.id, saved.id);
  assert.equal(database.listSessions(profile.id).length, 0);
  assert.throws(() => database.deleteSession(profile.id, saved.id), { statusCode: 404 });
});

test('dashboard e sessioni funzionano attraverso Express senza chiamate Garmin', async (t) => {
  const provider = await setup(t);
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const profile = database.createProfile(profileValues);
  const headers = { 'X-Profile-Id': profile.id, 'Content-Type': 'application/json' };
  const garminManager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ garminManager, databaseProvider: () => database }));
  const initial = await (await fetch(`${base}/api/dashboard`, { headers })).json();
  assert.equal(initial.storage.type, 'sqlite');
  assert.equal(initial.measurements.state, 'not_imported');
  assert.deepEqual(initial.measurements.daily, []);
  assert.deepEqual(initial.sessions, []);
  const created = await fetch(`${base}/api/sessions`, { method: 'POST', headers, body: JSON.stringify(session) });
  assert.equal(created.status, 201);
  const saved = await created.json();
  const updated = await fetch(`${base}/api/sessions/${saved.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'completed' }) });
  assert.equal((await updated.json()).status, 'completed');
  const listed = await (await fetch(`${base}/api/sessions`, { headers })).json();
  assert.equal(listed.sessions[0].title, session.title);
  assert.equal((await fetch(`${base}/api/sessions/${saved.id}`, { method: 'DELETE', headers })).status, 204);
  assert.equal(provider.state.tokenRequests, 0);
  assert.equal(provider.state.dataRequests, 0);
});

test('gli input non validi producono 400, le sessioni inesistenti 404', async (t) => {
  const provider = await setup(t);
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  const profile = database.createProfile(profileValues);
  const headers = { 'X-Profile-Id': profile.id, 'Content-Type': 'application/json' };
  const garminManager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ garminManager, databaseProvider: () => database }));
  const response = await fetch(`${base}/api/sessions`, { method: 'POST', headers, body: JSON.stringify({ ...session, durationMinutes: 0 }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  assert.equal((await fetch(`${base}/api/sessions/not-a-session`, { method: 'DELETE', headers })).status, 404);
});
