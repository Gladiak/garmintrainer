'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sqlite = require('better-sqlite3');
const { createDatabase } = require('../libs/database');
const { createCredentialVault } = require('../libs/credentials');
const { createGarminProfileManager } = require('../libs/garmin');
const { createApp } = require('../app');
const { listen, setup, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const languages = ['en', 'it', 'fr', 'es', 'de'];

test('profiles default to English, accept five languages, preserve omissions and reject invalid values atomically', (t) => {
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const profile = db.createProfile(values);
  assert.equal(profile.language, 'en');
  assert.equal(db.importLegacyKey(TEST_API_KEY).language, 'en');
  for (const language of languages) {
    assert.equal(db.createProfile({ ...values, language }).language, language);
    assert.equal(db.updateProfile(profile.id, { ...values, language }).language, language);
    assert.equal(db.updateProfile(profile.id, values).language, language);
  }
  const count = db.listProfiles().length;
  for (const language of [null, '', 'EN', 'en-GB', 'pt', [], {}, 42, true]) {
    assert.throws(() => db.createProfile({ ...values, language }), { code: 'INVALID_LANGUAGE' });
    assert.throws(() => db.updateProfile(profile.id, { ...values, firstName: 'Do not save', language }), { code: 'INVALID_LANGUAGE' });
    assert.equal(db.getProfile(profile.id).firstName, 'Ada');
    assert.equal(db.getProfile(profile.id).language, 'de');
    assert.equal(db.listProfiles().length, count);
  }
});

test('language is returned by HTTP lists/dashboard, isolated per profile and does not invalidate Garmin credentials', async (t) => {
  const provider = await setup(t);
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const manager = createGarminProfileManager({ databaseProvider: () => db, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ databaseProvider: () => db, garminManager: manager }));
  const send = (endpoint, body, method = 'POST') => fetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await send('/profiles', { ...values, apiKey: TEST_API_KEY });
  assert.equal(created.status, 201);
  const a = await created.json();
  assert.equal(a.language, 'en');
  const b = db.createProfile({ ...values, language: 'it' });
  const client = manager.getClient(a.id);
  for (const language of languages) {
    const updated = await send(`/profiles/${a.id}`, { ...values, language }, 'PATCH');
    assert.equal(updated.status, 200);
    const profile = await updated.json();
    assert.equal(profile.language, language);
    assert.equal(profile.credentialRevision, a.credentialRevision);
    assert.ok(!JSON.stringify(profile).includes(TEST_API_KEY));
    assert.strictEqual(manager.getClient(a.id), client);
  }
  await send(`/profiles/${a.id}`, values, 'PATCH');
  const listed = await (await fetch(`${base}/api/profiles`)).json();
  assert.equal(listed.profiles.find(p => p.id === a.id).language, 'de');
  assert.equal(listed.profiles.find(p => p.id === b.id).language, 'it');
  const dashboard = await (await fetch(`${base}/api/dashboard`, { headers: { 'X-Profile-Id': a.id } })).json();
  assert.equal(dashboard.profile.language, 'de');
  for (const language of [null, '', 'xx', [], 42]) {
    const response = await send(`/profiles/${a.id}`, { ...values, firstName: 'Do not save', language }, 'PATCH');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_LANGUAGE');
    assert.equal(db.getProfile(a.id).firstName, 'Ada');
    assert.equal(db.getProfile(a.id).language, 'de');
  }
  assert.equal(db.getGarminCredential(a.id).apiKey, TEST_API_KEY);
  assert.equal(provider.state.tokenRequests, 0);
});

test('version 4 migration assigns English, preserves existing data and persists later language changes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-languages-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'trainer.sqlite');
  const old = new Sqlite(filename);
  for (const file of ['001-initial.sql', '002-local-profiles.sql', '003-profile-avatar.sql', '004-profile-theme.sql']) {
    old.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  }
  const encrypted = createCredentialVault(`${filename}.key`).encrypt(TEST_API_KEY, 'legacy');
  old.prepare(`INSERT INTO profiles(id,first_name,last_name,primary_sport,avatar,theme,garmin_key,credential_revision,created_at,updated_at)
    VALUES ('legacy','Ada','Rossi','running','fixture-avatar','ocean-gold',?,1,'2026-10-22','2026-10-22')`).run(encrypted);
  old.prepare(`INSERT INTO planned_sessions(id,profile_id,title,sport,date,duration_minutes,notes,created_at,updated_at)
    VALUES ('plan','legacy','Corsa al parco','running','2026-10-22',30,'Note personali','2026-10-22','2026-10-22')`).run();
  old.close();
  let db = createDatabase(filename);
  assert.equal(db.getProfile('legacy').language, 'en');
  assert.equal(db.getProfile('legacy').theme, 'ocean-gold');
  assert.equal(db.getProfile('legacy').avatar, 'fixture-avatar');
  assert.equal(db.getGarminCredential('legacy').apiKey, TEST_API_KEY);
  db.updateProfile('legacy', { ...values, language: 'fr' });
  db.close();
  db = createDatabase(filename); t.after(() => db.close());
  assert.equal(db.getProfile('legacy').language, 'fr');
  assert.equal(db.listSessions('legacy')[0].title, 'Corsa al parco');
  assert.equal(db.listSessions('legacy')[0].notes, 'Note personali');
  assert.equal(db.getGarminCredential('legacy').apiKey, TEST_API_KEY);
});

test('HTTP validation errors can be translated again after a live language switch', async (t) => {
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const base = await listen(t, createApp({ databaseProvider: () => db }));
  const { request } = await import('../frontend/src/lib/api.js');
  const { setLanguage, messageText } = await import('../frontend/src/lib/i18n.js');
  const nativeFetch = global.fetch;
  global.fetch = (url, options) => nativeFetch(new URL(url, base), options);
  t.after(() => { global.fetch = nativeFetch; setLanguage('en'); });
  setLanguage('en');
  let failure;
  try { await request('/profiles', { method: 'POST', body: { ...values, firstName: '' } }); }
  catch (error) { failure = error; }
  assert.equal(failure.status, 400);
  assert.equal(failure.translationKey, 'errors.profileName');
  assert.match(messageText(failure), /First and last name/);
  setLanguage('it');
  assert.match(messageText(failure), /Nome e cognome/);
  setLanguage('fr');
  assert.match(messageText(failure), /prénom et le nom/);
});
