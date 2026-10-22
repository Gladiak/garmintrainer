'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const mariadb = require('mariadb');
const sharp = require('sharp');
const { createMariaDatabase } = require('../libs/mariadb');
const { createApp } = require('../app');
const { readConfig } = require('../libs/config');
const { listen, setup, TEST_API_KEY } = require('./helpers');
const { defaultLayout, validateLayout } = require('../helpers/dashboard-layout');

test('MariaDB reale: account, cifratura, isolamento e persistenza dopo riavvio', async t => {
  const connection = readConfig().database;
  const admin = await mariadb.createConnection(connection);
  const schema = `trainer_test_${randomUUID().replaceAll('-', '')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-mariadb-'));
  await admin.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const provider = await setup(t);
  const config = readConfig();
  config.database = { ...connection, database: schema };
  config.encryptionKeyPath = path.join(directory, 'encryption.key');
  fs.writeFileSync(config.encryptionKeyPath, randomBytes(32), { mode: 0o600 });
  config.garmin.baseUrl = provider.baseUrl;
  let database;
  t.after(async () => {
    await database?.close();
    await admin.query(`DROP DATABASE ${schema}`);
    await admin.end();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  // Start with the previous schema to exercise a real v1 -> latest upgrade.
  await admin.query(`USE ${schema}`);
  const legacy = fs.readFileSync(path.join(__dirname, '../db/migrations/mariadb/001-accounts.sql'), 'utf8');
  for (const statement of legacy.split(';').map(value => value.trim()).filter(Boolean)) await admin.query(statement);
  await admin.query('CREATE TABLE schema_migrations(version INT PRIMARY KEY)');
  await admin.query('INSERT INTO schema_migrations(version) VALUES (1)');
  database = await createMariaDatabase(config);
  assert.equal(Number((await admin.query('SELECT MAX(version) AS version FROM schema_migrations'))[0].version), 5);
  const base = await listen(t, createApp({ databaseProvider: () => database, config }));
  const send = (endpoint, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}/api${endpoint}`, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const password = 'a test-only safe long passphrase';
  const signup = (username, email) => send('/auth/register', { method: 'POST', body: { username, email, password, passwordConfirmation: password } });
  const registered = await signup('alice', 'alice@example.test');
  assert.equal(registered.status, 201);
  const a = await registered.json();
  const cookieA = registered.headers.get('set-cookie').split(';')[0];
  const headersA = { Cookie: cookieA, 'X-CSRF-Token': a.csrfToken };
  const second = await signup('bob', 'bob@example.test');
  assert.equal(second.status, 201);
  const b = await second.json();
  const headersB = { Cookie: second.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': b.csrfToken, 'X-Profile-Id': a.profile.id };

  await t.test('schema users, unicità, default inglese e password protette', async () => {
    assert.equal(a.profile.language, 'en'); assert.equal(a.profile.needsCompletion, true);
    const rows = await admin.query(`SELECT * FROM ${schema}.users`);
    assert.equal(rows.length, 2);
    const row = rows.find(row => row.id === a.user.id);
    assert.ok(!JSON.stringify(row).includes('alice')); assert.ok(!JSON.stringify(row).includes(password));
    assert.match(row.password_hash, /^scrypt\$32768\$8\$3\$/);
    assert.equal(row.password_confirmation, undefined);
    assert.equal((await signup('ALICE', 'other@example.test')).status, 409);
    assert.equal((await signup('other', 'ALICE@EXAMPLE.TEST')).status, 409);
    const count = await admin.query(`SELECT COUNT(*) AS total FROM ${schema}.profiles`);
    assert.equal(Number(count[0].total), 2);
  });
  let savedAvatar;
  await t.test('onboarding, foto, lingua, tema e Garmin cifrati e persistenti', async () => {
    const picture = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#336699' } }).png().toBuffer();
    const body = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running', language: 'it', theme: 'ocean-gold', apiKey: TEST_API_KEY, avatar: `data:image/png;base64,${picture.toString('base64')}` };
    const result = await send('/profile', { method: 'PATCH', headers: headersA, body });
    assert.equal(result.status, 200);
    const profile = await result.json();
    savedAvatar = profile.avatar;
    assert.match(savedAvatar, /^data:image\/webp;base64,/);
    assert.equal(profile.needsCompletion, false); assert.equal(profile.hasGarminKey, true);
    const [row] = await admin.query(`SELECT * FROM ${schema}.profiles WHERE id = ?`, [a.profile.id]);
    assert.notEqual(row.avatar, savedAvatar);
    assert.notEqual(row.first_name, 'Ada'); assert.notEqual(row.last_name, 'Rossi');
    assert.notEqual(row.garmin_key, TEST_API_KEY);
    assert.equal(provider.state.tokenRequests, 0);
    assert.equal((await database.getGarminCredential(a.profile.id)).apiKey, TEST_API_KEY);
    const invalid = await send('/profile', { method: 'PATCH', headers: headersA, body: { ...body, firstName: 'Never save', language: 'xx' } });
    assert.equal(invalid.status, 400); assert.equal((await database.getProfile(a.profile.id)).firstName, 'Ada');
    const preserved = await send('/profile', { method: 'PATCH', headers: headersA, body: { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running', apiKey: '' } });
    assert.equal(preserved.status, 200);
    const state = await preserved.json();
    assert.equal(state.avatar, savedAvatar); assert.equal(state.theme, 'ocean-gold');
    assert.equal(state.language, 'it'); assert.equal(state.credentialRevision, profile.credentialRevision);
  });
  await t.test('modalità scura per profilo: salvataggio e isolamento nel DB', async () => {
    assert.equal((await database.getProfile(a.profile.id)).darkMode, false);
    const response = await send('/profile/theme', { method: 'PATCH', headers: headersA, body: { theme: 'ocean-gold', darkMode: true } });
    assert.equal(response.status, 200); assert.equal((await response.json()).darkMode, true);
    assert.equal((await database.getProfile(b.profile.id)).darkMode, false);
    assert.equal(Number((await admin.query('SELECT dark_mode FROM profiles WHERE id = ?', [a.profile.id]))[0].dark_mode), 1);
  });
  await t.test('chiave Garmin: omissione, sostituzione, rimozione e cache isolate', async () => {
    const body = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
    assert.equal((await send('/profile', { method: 'PATCH', headers: headersA, body: { ...body, apiKey: 'test-replacement-key' } })).status, 200);
    assert.deepEqual(await database.getGarminCredential(a.profile.id), { apiKey: 'test-replacement-key', revision: 2 });
    assert.equal((await send('/profile', { method: 'PATCH', headers: headersA, body: { ...body, apiKey: null } })).status, 200);
    assert.deepEqual(await database.getGarminCredential(a.profile.id), { apiKey: '', revision: 3 });
    assert.equal((await (await send('/garmin/auth/status', { headers: headersA })).json()).configured, false);
    assert.equal((await send('/profile', { method: 'PATCH', headers: headersA, body: { ...body, apiKey: TEST_API_KEY } })).status, 200);
    assert.deepEqual(await database.getGarminCredential(a.profile.id), { apiKey: TEST_API_KEY, revision: 4 });
    assert.equal((await database.getProfile(b.profile.id)).hasGarminKey, false);
  });
  let session;
  await t.test('piano personale e accesso tra account negato', async () => {
    const response = await send('/sessions', { method: 'POST', headers: headersA, body: { title: 'Corsa privata', sport: 'running', date: '2026-10-22', durationMinutes: 50 } });
    assert.equal(response.status, 201); session = await response.json();
    const dashboard = await (await send('/dashboard', { headers: headersB })).json();
    assert.equal(dashboard.profile.id, b.profile.id); assert.deepEqual(dashboard.sessions, []);
    assert.equal((await send(`/sessions/${session.id}`, { method: 'PATCH', headers: headersB, body: { status: 'completed' } })).status, 404);
    assert.equal((await send(`/sessions/${session.id}`, { method: 'DELETE', headers: headersB })).status, 404);
    const completed = await send(`/sessions/${session.id}`, { method: 'PATCH', headers: headersA, body: { status: 'completed' } });
    assert.equal(completed.status, 200); assert.equal((await completed.json()).status, 'completed');
    assert.equal((await send('/garmin/auth/ensure', { method: 'POST', headers: headersA })).status, 200);
    assert.equal(provider.state.tokenRequests, 1);
  });
  const { dateInZone, shiftDate } = require('../helpers/garmin-dates');
  const measurementDay = dateInZone('Europe/Rome');
  const measurementInput = { from: shiftDate(measurementDay, -6), to: measurementDay, activityFrom: measurementDay, activityTo: measurementDay, timeZone: 'Europe/Rome' };
  let persistedLayout;
  await t.test('misure reali simulate: date, valori e ID sono cifrati in SQL, con isolamento fra utenti', async () => {
    provider.state.measurements = true;
    const response = await send('/garmin/sync', { method: 'POST', headers: headersA, body: measurementInput });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.measurements.daily.at(-1).heartRateReferenceBpm, 57);
    assert.equal(result.measurements.daily.at(-1).sleepMinutes, 480);
    const stored = await admin.query('SELECT * FROM garmin_measurements WHERE profile_id = ?', [a.profile.id]);
    assert.deepEqual(Object.fromEntries(['wellness', 'sleep', 'hrv', 'activities'].map(resource =>
      [resource, stored.filter(row => row.resource === resource).length])),
    { wellness: 8, sleep: 7, hrv: 1, activities: 28 }, 'recovery history is persisted as well as the visible day');
    for (const row of stored) {
      assert.match(row.payload, /^v1\./);
      assert.ok(!row.payload.includes(measurementDay));
      assert.ok(!row.payload.includes('heartRateReferenceBpm'));
      assert.ok(!row.payload.includes('9007199254740993'));
      assert.match(row.day_lookup, /^[a-f0-9]{64}$/);
    }
    const other = await (await send('/dashboard', { headers: headersB })).json();
    assert.deepEqual(other.measurements.daily, []);
    assert.deepEqual(other.activities.sessions, []);
  });
  await t.test('dettagli giornalieri e letture notturne cifrati nel DB', async () => {
    const body = { from: measurementDay, to: measurementDay, timeZone: 'Europe/Rome', resources: ['heart-rate-day', 'body-battery-day'] };
    const response = await send('/garmin/sync', { method: 'POST', headers: headersA, body });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).measurements.details['body-battery-day'].points[0].value, 74);
    const night = await send('/garmin/sync', { method: 'POST', headers: headersA, body: { ...body, view: 'wellness', resources: ['hrv-night'] } });
    assert.equal(night.status, 200);
    const rows = await admin.query("SELECT payload FROM garmin_measurements WHERE profile_id = ? AND resource IN ('heart-rate-day','body-battery-day','hrv-night')", [a.profile.id]);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.match(row.payload, /^v1\./); assert.ok(!row.payload.includes('timestamp')); assert.ok(!row.payload.includes(measurementDay));
    }
  });
  await t.test('layout privato, isolato e cifrato nel DB', async () => {
    const layout = { version: 1, modules: [{ id: 'only-sleep', type: 'sleep' }] };
    assert.equal((await send('/dashboard/layout', { method: 'PUT', headers: headersA, body: layout })).status, 200);
    assert.deepEqual(await database.getDashboardLayout(a.profile.id), validateLayout(layout));
    assert.notDeepEqual(await database.getDashboardLayout(b.profile.id), layout);
    const [row] = await admin.query('SELECT payload FROM dashboard_layouts WHERE profile_id = ?', [a.profile.id]);
    assert.match(row.payload, /^v1\./); assert.ok(!row.payload.includes('only-sleep'));
    // Preserve all sources, with a custom order to verify the saved layout survives reopening.
    persistedLayout = { version: 2, sections: { overview: [...defaultLayout.sections.overview].reverse(), wellness: defaultLayout.sections.wellness } };
    await database.saveDashboardLayout(a.profile.id, persistedLayout);
  });
  let emptyAccount;
  await t.test('assenza dati: esito neutro persistito, senza misure o identità inventate', async () => {
    const response = await signup('empty-data', 'empty-data@example.test');
    const account = await response.json();
    emptyAccount = { id: account.profile.id, headers: { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': account.csrfToken } };
    await send('/profile', { method: 'PATCH', headers: emptyAccount.headers, body: { firstName: 'No', lastName: 'Data', primarySport: 'running', apiKey: TEST_API_KEY } });
    provider.state.resourceStatus.wellness = 204;
    provider.state.resourceStatus.sleep = 204;
    try {
      const body = { view: 'overview', from: measurementDay, to: measurementDay, timeZone: 'Europe/Rome', resources: ['wellness'] };
      const empty = await send('/garmin/sync', { method: 'POST', headers: emptyAccount.headers, body });
      assert.equal(empty.status, 200);
      const result = await empty.json();
      assert.equal(result.resourceStates.wellness.errorCode, null);
      assert.equal(result.resourceStates.wellness.dataState, 'no_data');
      assert.equal(await database.getGarminConnection(emptyAccount.id), null);
      const rows = await admin.query('SELECT * FROM garmin_sync_state WHERE profile_id = ?', [emptyAccount.id]);
      assert.equal(rows.length, 8, 'wellness includes the reference day and seven prior days for recovery');
      for (const row of rows) {
        assert.equal(row.error_code, null); assert.equal(row.outcome, 'pending_identity');
      }
      assert.ok(!JSON.stringify(rows).includes(measurementDay));
      assert.equal((await admin.query('SELECT * FROM garmin_measurements WHERE profile_id = ?', [emptyAccount.id])).length, 0);
      const retained = await send('/garmin/sync', { method: 'POST', headers: headersA, body: { ...body, force: true, resources: ['sleep'] } });
      assert.equal(retained.status, 200);
      const previous = await retained.json();
      assert.equal(previous.measurements.daily[0].sleepMinutes, 480);
      assert.equal(previous.resourceStates.sleep.dataState, 'cached');
      assert.equal(previous.resourceStates.sleep.errorCode, null);
    } finally { provider.state.resourceStatus = {}; }
  });
  await t.test('sessioni e profilo persistono quando il repository viene riaperto', async () => {
    await database.close(); database = null;
    database = await createMariaDatabase(config);
    const restored = await send('/auth/session', { headers: headersA });
    assert.equal(restored.status, 200);
    const state = await restored.json();
    assert.equal(state.profile.needsCompletion, false); assert.equal(state.profile.language, 'it');
    assert.equal(state.profile.darkMode, true); assert.equal(state.profile.theme, 'ocean-gold'); assert.equal(state.profile.avatar, savedAvatar);
    assert.equal(state.user.username, 'alice'); assert.equal(state.user.email, 'alice@example.test');
    assert.equal((await database.listSessions(a.profile.id))[0].id, session.id);
    assert.equal((await database.getGarminCredential(a.profile.id)).apiKey, TEST_API_KEY);
    assert.deepEqual(await database.getDashboardLayout(a.profile.id), persistedLayout);
    const connection = await database.getGarminConnection(a.profile.id);
    const [detail] = await database.readGarminRows(a.profile.id, connection.id, 'hrv-night', [measurementDay]);
    assert.equal(detail.values.summary, 48);
    assert.equal((await (await send('/auth/session', { headers: headersB })).json()).profile.needsCompletion, true);
    const noData = await (await send(`/dashboard?view=overview&from=${measurementDay}&to=${measurementDay}&timeZone=Europe%2FRome`, { headers: emptyAccount.headers })).json();
    assert.equal(noData.resourceStates.wellness.dataState, 'no_data');
    assert.equal(noData.resourceStates.wellness.errorCode, null);
    const restoredMeasures = await (await send(`/dashboard?${new URLSearchParams(measurementInput)}`, { headers: headersA })).json();
    assert.equal(restoredMeasures.measurements.daily.at(-1).hrv, 48);
    assert.equal(restoredMeasures.activities.sessions[0].id, '9007199254740997');
  });
  await t.test('cookie invalidati al logout e scadenza applicata dal database', async () => {
    assert.equal((await send('/auth/logout', { method: 'POST', headers: { Cookie: cookieA } })).status, 403);
    const response = await send('/auth/logout', { method: 'POST', headers: headersA });
    assert.equal(response.status, 204); assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await send('/auth/session', { headers: headersA })).status, 401);
    const login = await send('/auth/login', { method: 'POST', body: { username: 'ALICE', password } });
    assert.equal(login.status, 200);
    const loggedIn = await login.json();
    assert.equal(loggedIn.profile.id, a.profile.id);
    assert.equal(loggedIn.profile.needsCompletion, false);
    assert.equal(loggedIn.profile.language, 'it');
    const wrong = await send('/auth/login', { method: 'POST', body: { username: 'alice', password: 'a wrong long passphrase' } });
    assert.equal(wrong.status, 401);
    const token = headersB.Cookie.split('=')[1]; const hash = createHash('sha256').update(token).digest('hex');
    const [row] = await admin.query(`SELECT * FROM ${schema}.auth_sessions WHERE token_hash = ?`, [hash]);
    assert.ok(row); assert.notEqual(row.token_hash, token); assert.equal(row.token_hash, hash);
    await admin.query(`UPDATE ${schema}.auth_sessions SET expires_at = 1 WHERE token_hash = ?`, [hash]);
    assert.equal((await send('/dashboard', { headers: headersB })).status, 401);
  });
  await t.test('secret di cifratura mancante: avvio bloccato e nessuna chiave sostitutiva', async () => {
    await database.close(); database = null;
    const saved = `${config.encryptionKeyPath}.backup`;
    fs.renameSync(config.encryptionKeyPath, saved);
    try {
      await assert.rejects(createMariaDatabase(config), /Chiave di cifratura assente/);
      assert.equal(fs.existsSync(config.encryptionKeyPath), false);
    } finally {
      fs.renameSync(saved, config.encryptionKeyPath);
      database = await createMariaDatabase(config);
    }
    assert.equal((await database.getProfile(a.profile.id)).firstName, 'Ada');
  });
});
