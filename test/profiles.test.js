'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sqlite = require('better-sqlite3');
const { createDatabase } = require('../libs/database');
const { createGarminProfileManager } = require('../libs/garmin');
const { migrateLegacyCredentials } = require('../libs/legacy-credentials');
const { createApp } = require('../app');
const { setup, listen, TEST_API_KEY } = require('./helpers');
const { PROFILE_PATH } = require('../postman/mocks/garmin/default');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const session = { title: 'Allenamento personale', sport: 'running', date: '2026-10-22', durationMinutes: 40 };
const SECOND_KEY = 'test-second-personal-key';
const THIRD_KEY = 'test-replacement-personal-key';
function memory(t) {
  const database = createDatabase(':memory:');
  t.after(() => database.close());
  return database;
}
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-profiles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function application(t) {
  const provider = await setup(t, { apiKeys: [TEST_API_KEY, SECOND_KEY, THIRD_KEY] });
  const database = memory(t);
  const manager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const url = await listen(t, createApp({ garminManager: manager, databaseProvider: () => database }));
  const api = async (endpoint, { id, body, method = 'GET' } = {}) => fetch(`${url}/api${endpoint}`, {
    method, headers: { ...(id ? { 'X-Profile-Id': id } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { provider, database, manager, api };
}

test('profili: campi obbligatori, cinque sport e nessuna credenziale nei metadati', (t) => {
  const db = memory(t);
  for (const primarySport of ['running', 'cycling', 'swimming', 'gym', 'hiit']) {
    const profile = db.createProfile({ ...values, primarySport, apiKey: TEST_API_KEY });
    assert.equal(profile.primarySport, primarySport);
    assert.equal(profile.hasGarminKey, true);
    assert.equal(profile.needsCompletion, false);
  }
  for (const invalid of [{ ...values, firstName: '' }, { ...values, lastName: ' ' }, { ...values, primarySport: 'walking' }, { ...values, apiKey: 'one\ntwo' }, { ...values, apiKey: 123 }]) {
    assert.throws(() => db.createProfile(invalid), { code: 'INVALID_INPUT' });
  }
  assert.ok(!JSON.stringify(db.listProfiles()).includes(TEST_API_KEY));
});

test('chiave invariata se omessa o vuota, sostituzione e rimozione esplicita', (t) => {
  const db = memory(t);
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  db.updateProfile(p.id, { ...values, firstName: 'Anna' });
  db.updateProfile(p.id, { ...values, apiKey: '' });
  assert.deepEqual(db.getGarminCredential(p.id), { apiKey: TEST_API_KEY, revision: 1 });
  db.updateProfile(p.id, { ...values, apiKey: SECOND_KEY });
  assert.deepEqual(db.getGarminCredential(p.id), { apiKey: SECOND_KEY, revision: 2 });
  db.updateProfile(p.id, { ...values, apiKey: null });
  assert.equal(db.getProfile(p.id).hasGarminKey, false);
  assert.equal(db.getGarminCredential(p.id).apiKey, '');
});

test('Express richiede un profilo esplicito e non ripiega su quello di un altro utente', async (t) => {
  const { api, database, provider } = await application(t);
  database.createProfile({ ...values, apiKey: TEST_API_KEY });
  for (const [endpoint, method] of [['/sessions', 'GET'], ['/sessions', 'POST'], ['/garmin/auth/status', 'GET'], ['/garmin/auth/ensure', 'POST']]) {
    assert.equal((await api(endpoint, { method })).status, 409);
    assert.equal((await api(endpoint, { method, id: 'missing-profile' })).status, 404);
  }
  const empty = await (await api('/dashboard')).json();
  assert.equal(empty.profile, null); assert.equal(empty.garmin, null); assert.deepEqual(empty.sessions, []);
  assert.equal(provider.state.tokenRequests, 0);
});

test('creazione e modifica HTTP non contattano Garmin né restituiscono la chiave', async (t) => {
  const { api, provider } = await application(t);
  const response = await api('/profiles', { method: 'POST', body: { ...values, apiKey: TEST_API_KEY } });
  assert.equal(response.status, 201);
  const p = await response.json();
  const changed = await api(`/profiles/${p.id}`, { method: 'PATCH', body: { ...values, apiKey: SECOND_KEY } });
  assert.equal(changed.status, 200);
  for (const endpoint of ['/profiles', '/dashboard', '/garmin/auth/status']) {
    const body = await (await api(endpoint, { id: p.id })).text();
    assert.ok(!body.includes(TEST_API_KEY)); assert.ok(!body.includes(SECOND_KEY));
    assert.ok(!body.includes('garmin_key'));
  }
  assert.equal(provider.state.tokenRequests, 0); assert.equal(provider.state.dataRequests, 0);
});

test('cache concorrenti separate, rinnovo 401 e rotazione di una chiave isolati per profilo', async (t) => {
  const { api, database, manager, provider } = await application(t);
  const a = database.createProfile({ ...values, apiKey: TEST_API_KEY });
  const b = database.createProfile({ ...values, firstName: 'Bruno', apiKey: SECOND_KEY });
  const ca = manager.getClient(a.id); const cb = manager.getClient(b.id);
  assert.notStrictEqual(ca, cb); assert.strictEqual(ca, manager.getClient(a.id));
  assert.throws(() => manager.getClient(), { code: 'PROFILE_NOT_FOUND' });
  await Promise.all(Array.from({ length: 20 }, () => ca.ensureToken()));
  await Promise.all(Array.from({ length: 20 }, () => cb.ensureToken()));
  assert.equal(provider.state.tokenRequests, 2);
  assert.deepEqual(provider.state.requests.map((r) => r.authorization), [`ApiKey ${TEST_API_KEY}`, `ApiKey ${SECOND_KEY}`]);
  const bToken = await cb.getAccessToken();
  assert.notEqual(await ca.getAccessToken(), bToken);
  provider.state.rejectFirstToken = true;
  await ca.get(PROFILE_PATH);
  assert.equal(provider.state.tokenRequests, 3);
  assert.equal(await cb.getAccessToken(), bToken);
  await api(`/profiles/${a.id}`, { method: 'PATCH', body: { ...values, apiKey: THIRD_KEY } });
  assert.equal(manager.getClient(a.id).getTokenStatus().cached, false);
  assert.strictEqual(manager.getClient(b.id), cb);
  const prepared = await api('/garmin/auth/ensure', { method: 'POST', id: a.id });
  assert.equal(prepared.status, 200);
  assert.equal(provider.state.requests.at(-1).authorization, `ApiKey ${THIRD_KEY}`);
  assert.equal(await cb.getAccessToken(), bToken);
  await api(`/profiles/${a.id}`, { method: 'PATCH', body: { ...values, apiKey: null } });
  assert.equal((await (await api('/garmin/auth/status', { id: a.id })).json()).configured, false);
  assert.equal((await api('/garmin/auth/ensure', { method: 'POST', id: a.id })).status, 503);
  assert.equal(provider.state.tokenRequests, 4);
});

test('le sessioni di un profilo non possono essere lette o modificate da un altro', async (t) => {
  const { api, database } = await application(t);
  const a = database.createProfile(values); const b = database.createProfile({ ...values, firstName: 'Bruno' });
  const saved = await (await api('/sessions', { method: 'POST', id: a.id, body: session })).json();
  assert.equal(saved.profileId, a.id);
  assert.deepEqual((await (await api('/sessions', { id: b.id })).json()).sessions, []);
  assert.deepEqual((await (await api('/dashboard', { id: b.id })).json()).sessions, []);
  assert.equal((await api(`/sessions/${saved.id}`, { method: 'PATCH', id: b.id, body: { status: 'completed' } })).status, 404);
  assert.equal((await api(`/sessions/${saved.id}`, { method: 'DELETE', id: b.id })).status, 404);
  assert.equal(database.listSessions(a.id)[0].status, 'planned');
});

test('migrazione versione 1 conserva il piano e lo assegna soltanto al profilo iniziale', (t) => {
  const filename = path.join(temporary(t), 'legacy.sqlite');
  const old = new Sqlite(filename);
  old.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/001-initial.sql'), 'utf8'));
  old.prepare(`INSERT INTO planned_sessions(id,title,sport,date,duration_minutes,created_at,updated_at) VALUES ('legacy','Piano esistente','running','2026-10-22',30,'2026-10-22','2026-10-22')`).run();
  old.close();
  const db = createDatabase(filename); t.after(() => db.close());
  const p = db.listProfiles()[0];
  assert.equal(p.needsCompletion, true);
  assert.equal(db.listSessions(p.id)[0].id, 'legacy');
  assert.equal(db.importLegacyKey(TEST_API_KEY).id, p.id);
  const other = db.createProfile(values);
  assert.deepEqual(db.listSessions(other.id), []);
});

test('migrazione .env idempotente: chiave cifrata conservata e variabili non segrete mantenute', (t) => {
  const directory = temporary(t);
  const filename = path.join(directory, 'trainer.sqlite');
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, `# Configurazione\nGARMIN_API_KEY=${TEST_API_KEY}\nexport GARMIN_PERSONAL_API_KEY='${SECOND_KEY}'\nPORT=3100\n`);
  const db = createDatabase(filename); t.after(() => db.close());
  assert.equal(migrateLegacyCredentials(db, envPath), true);
  const p = db.listProfiles()[0];
  assert.equal(db.getGarminCredential(p.id).apiKey, SECOND_KEY);
  assert.equal(migrateLegacyCredentials(db, envPath), false);
  fs.writeFileSync(envPath, `GARMIN_API_KEY=${TEST_API_KEY}\nPORT=3100\n`);
  migrateLegacyCredentials(db, envPath);
  assert.equal(db.listProfiles().length, 1);
  assert.equal(db.getGarminCredential(p.id).apiKey, SECOND_KEY);
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'PORT=3100\n');
  assert.equal(fs.statSync(`${filename}.key`).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(db.listProfiles()).includes(SECOND_KEY));
  db.close();
  const bytes = fs.readFileSync(filename);
  assert.ok(!bytes.includes(Buffer.from(TEST_API_KEY))); assert.ok(!bytes.includes(Buffer.from(SECOND_KEY)));
});

test('perdita della chiave di cifratura: errore sicuro, nessuna sostituzione automatica', (t) => {
  const filename = path.join(temporary(t), 'trainer.sqlite');
  let db = createDatabase(filename);
  const p = db.createProfile({ ...values, apiKey: TEST_API_KEY }); db.close();
  fs.renameSync(`${filename}.key`, `${filename}.key.saved`);
  db = createDatabase(filename); t.after(() => db.close());
  assert.throws(() => db.getGarminCredential(p.id), /Ripristina la chiave/);
  assert.equal(fs.existsSync(`${filename}.key`), false);
  fs.renameSync(`${filename}.key.saved`, `${filename}.key`);
  assert.equal(db.getGarminCredential(p.id).apiKey, TEST_API_KEY);
});

test('una credenziale cifrata copiata su un altro profilo non può essere decifrata', (t) => {
  const filename = path.join(temporary(t), 'trainer.sqlite');
  const db = createDatabase(filename); t.after(() => db.close());
  const a = db.createProfile({ ...values, apiKey: TEST_API_KEY });
  const b = db.createProfile(values);
  const raw = new Sqlite(filename);
  raw.prepare('UPDATE profiles SET garmin_key = (SELECT garmin_key FROM profiles WHERE id = ?) WHERE id = ?').run(a.id, b.id);
  raw.close();
  assert.throws(() => db.getGarminCredential(b.id), /Impossibile leggere la chiave Garmin/);
  assert.equal(db.getGarminCredential(a.id).apiKey, TEST_API_KEY);
});

test('migrazione .env rimuove anche credenziali quotate su più righe', (t) => {
  const directory = temporary(t);
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'HOST=127.0.0.1\nGARMIN_API_KEY="test-legacy\nmultiline"\nPORT=3100\n');
  const db = memory(t);
  migrateLegacyCredentials(db, envPath);
  assert.equal(fs.readFileSync(envPath, 'utf8'), 'HOST=127.0.0.1\nPORT=3100\n');
  assert.equal(db.getGarminCredential(db.listProfiles()[0].id).apiKey, 'test-legacy\nmultiline');
});

test('una chiave sostituita durante l’emissione non pubblica lo stato del vecchio token', async (t) => {
  const { api, database, manager, provider } = await application(t);
  provider.state.tokenDelayMs = 50;
  const p = database.createProfile({ ...values, apiKey: TEST_API_KEY });
  const pending = api('/garmin/auth/ensure', { id: p.id, method: 'POST' });
  for (let attempt = 0; provider.state.tokenRequests === 0 && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(provider.state.tokenRequests, 1);
  await api(`/profiles/${p.id}`, { method: 'PATCH', body: { ...values, apiKey: SECOND_KEY } });
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'PROFILE_CREDENTIAL_CHANGED');
  assert.equal(manager.getClient(p.id).getTokenStatus().cached, false);
});

test('eliminazione HTTP: rimuove solo profilo e piano richiesti, invalida la cache e gestisce ultimo profilo', async (t) => {
  const { api, database, manager, provider } = await application(t);
  const a = database.createProfile({ ...values, apiKey: TEST_API_KEY, theme: 'ocean-gold' });
  const b = database.createProfile({ ...values, firstName: 'Bruno', apiKey: SECOND_KEY });
  database.createSession(a.id, session); const preserved = database.createSession(b.id, session);
  manager.getClient(a.id); const bClient = manager.getClient(b.id);
  const invalidated = [];
  const invalidate = manager.invalidate.bind(manager);
  manager.invalidate = (id) => { invalidated.push(id); invalidate(id); };
  const removed = await api(`/profiles/${a.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204); assert.equal(await removed.text(), '');
  assert.deepEqual(invalidated, [a.id]);
  assert.deepEqual(database.listProfiles().map(p => p.id), [b.id]);
  assert.equal(database.listSessions(b.id)[0].id, preserved.id);
  assert.equal(database.getGarminCredential(b.id).apiKey, SECOND_KEY);
  assert.strictEqual(manager.getClient(b.id), bClient);
  assert.throws(() => database.getGarminCredential(a.id), { code: 'PROFILE_NOT_FOUND' });
  for (const endpoint of ['/dashboard', '/sessions', '/garmin/auth/status', '/garmin/auth/ensure']) {
    const result = await api(endpoint, { id: a.id, method: endpoint.endsWith('ensure') ? 'POST' : 'GET' });
    assert.equal(result.status, 404);
  }
  const missing = await api(`/profiles/${a.id}`, { method: 'DELETE' });
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error.code, 'PROFILE_NOT_FOUND');
  assert.equal((await api(`/profiles/${b.id}`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(database.listProfiles(), []);
  const dashboard = await (await api('/dashboard')).json();
  assert.equal(dashboard.profile, null); assert.deepEqual(dashboard.sessions, []);
  const fresh = database.createProfile(values);
  assert.deepEqual(database.listSessions(fresh.id), []);
  assert.equal(provider.state.tokenRequests, 0); assert.equal(provider.state.dataRequests, 0);
});

test('rimozione del profilo migrato elimina il riferimento legacy senza alterare altri profili', (t) => {
  const db = memory(t);
  const legacy = db.importLegacyKey(TEST_API_KEY);
  const other = db.createProfile(values);
  db.createSession(legacy.id, session);
  db.deleteProfile(legacy.id);
  const imported = db.importLegacyKey(SECOND_KEY);
  assert.notEqual(imported.id, legacy.id);
  assert.equal(db.getGarminCredential(imported.id).apiKey, SECOND_KEY);
  assert.equal(db.getProfile(other.id).firstName, values.firstName);
  assert.deepEqual(db.listSessions(imported.id), []);
});

test('eliminazione durante emissione token: il profilo rimosso non pubblica credenziali obsolete', async (t) => {
  const { api, database, provider } = await application(t);
  provider.state.tokenDelayMs = 50;
  const profile = database.createProfile({ ...values, apiKey: TEST_API_KEY });
  const pending = api('/garmin/auth/ensure', { id: profile.id, method: 'POST' });
  for (let attempt = 0; provider.state.tokenRequests === 0 && attempt < 100; attempt += 1) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(provider.state.tokenRequests, 1);
  assert.equal((await api(`/profiles/${profile.id}`, { method: 'DELETE' })).status, 204);
  const result = await pending;
  assert.equal(result.status, 404); assert.equal((await result.json()).error.code, 'PROFILE_NOT_FOUND');
});
