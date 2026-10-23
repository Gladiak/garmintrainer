'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const mariadb = require('mariadb');
const { readConfig } = require('../libs/config');
const { createMariaDatabase } = require('../libs/mariadb');
const { createApp } = require('../app');
const { listen } = require('./helpers');
const { gymfitFixture } = require('./gymfit-fixtures');
const { createRepository } = require('../helpers/gymfit/repository');
const { newImport, importCatalog } = require('../helpers/gymfit/importer');

test('workout routines: real MariaDB, private CRUD, catalog search and load conservation', async t => {
  const config = readConfig();
  const admin = await mariadb.createConnection(config.database);
  const schema = `workout_test_${randomUUID().replaceAll('-', '')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-workouts-'));
  config.database = { ...config.database, database: schema };
  config.encryptionKeyPath = path.join(directory, 'key');
  fs.writeFileSync(config.encryptionKeyPath, randomBytes(32));
  await admin.query(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE ${schema}`);
  let database;
  t.after(async () => { await database?.close(); await admin.query(`DROP DATABASE ${schema}`); await admin.end(); fs.rmSync(directory, { recursive: true, force: true }); });
  database = await createMariaDatabase(config);
  let garminCalls = 0;
  const base = await listen(t, createApp({ config, databaseProvider: () => database, garminManager: { getClient() { garminCalls++; throw new Error('Gym routines must not call Garmin'); } } }));
  const send = (endpoint, { headers, body, method = 'GET' } = {}) => fetch(base + '/api' + endpoint, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  async function account(username) {
    const password = 'workout-only-long-test-password';
    const response = await send('/auth/register', { method: 'POST', body: { username, email: `${username}@example.test`, password, passwordConfirmation: password } });
    const data = await response.json(); assert.equal(response.status, 201);
    return { profile: data.profile, headers: { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': data.csrfToken } };
  }
  const alice = await account('alice'); const bob = await account('bob');
  const api = (url, options = {}) => send(url, { ...options, headers: alice.headers });
  let body; let saved;
  await t.test('catalog missing is explicit and all routes require authentication', async () => {
    assert.equal((await send('/workouts')).status, 401);
    assert.equal((await send('/gym/catalog')).status, 401);
    assert.equal((await (await api('/gym/catalog')).json()).available, false);
    assert.deepEqual((await (await api('/gym/exercises')).json()).items, []);
  });
  const repo = createRepository(admin); await repo.lock(); const run = newImport({ sample: 1 }); await repo.create(run);
  const fixture = gymfitFixture(35);
  await importCatalog({ repository: repo, client: fixture.client, run, now: () => fixture.clock, sleep: fixture.sleep, random: () => 0 });
  await t.test('search is paginated, filtered, and never exposes source payloads', async () => {
    const catalog = await (await api('/gym/catalog')).json(); assert.equal(catalog.available, true); assert.equal(catalog.groups.length, 2);
    const response = await (await api('/gym/exercises')).json();
    assert.equal(response.items.length, 24); assert.equal(response.total, 35);
    assert.equal(response.items[0].source_payload, undefined); assert.ok(response.items[0].groups.length);
    assert.equal((await (await api('/gym/exercises?q=%25')).json()).total, 0, 'percent is a literal search, not SQL wildcard');
    const page2 = await (await api('/gym/exercises?page=2')).json(); assert.equal(page2.items.length, 11);
    const filtered = await (await api(`/gym/exercises?equipment=${encodeURIComponent(response.items[0].equipment)}&group=${catalog.groups[0].id}`)).json(); assert.ok(filtered.total > 0);
    const item = response.items[0];
    body = { name: 'Upper A', notes: 'test', exercises: [{ ...item, sets: [{ repetitions: 10, loadKg: 40, restSeconds: 90 }, { repetitions: 8, loadKg: 50, restSeconds: 120 }] }] };
  });
  await t.test('save persists variable sets and totals, ignoring client supplied muscle weights', async () => {
    const response = await api('/workouts', { method: 'POST', body: { ...body, groups: [], load: { totalLoad: 1 } } }); assert.equal(response.status, 201);
    saved = await response.json(); assert.equal(saved.load.totalLoad, 800); assert.equal(saved.load.totalRepetitions, 18);
    assert.equal(saved.version, 1); assert.equal(saved.exercises[0].sets[1].loadKg, 50);
    assert.ok(Math.abs(saved.load.groups.reduce((sum, g) => sum + g.percentage, 0) - 100) < 1e-8);
    const result = await (await api('/workouts')).json(); assert.equal(result.total, 1); assert.deepEqual(result.items[0], saved);
  });
  await t.test('another account cannot read, replace or delete a routine by UUID', async () => {
    for (const [method, value] of [['GET', undefined], ['PUT', { ...body, version: 1 }], ['DELETE', { version: 1 }]]) {
      assert.equal((await send('/workouts/' + saved.id, { method, body: value, headers: bob.headers })).status, 404);
    }
    assert.equal((await (await send('/workouts', { headers: bob.headers })).json()).total, 0);
    assert.equal((await send('/workouts', { method: 'POST', body, headers: { Cookie: alice.headers.Cookie } })).status, 403);
  });
  await t.test('invalid references roll back edits; stale versions are rejected', async () => {
    const bad = { ...body, version: 1, name: 'Must not persist', exercises: [{ ...body.exercises[0], exerciseId: randomUUID() }] };
    assert.equal((await api('/workouts/' + saved.id, { method: 'PUT', body: bad })).status, 400);
    assert.deepEqual(await (await api('/workouts/' + saved.id)).json(), saved);
    const changed = await api('/workouts/' + saved.id, { method: 'PUT', body: { ...body, version: 1, name: 'Upper B' } }); assert.equal(changed.status, 200);
    saved = await changed.json(); assert.equal(saved.version, 2);
    assert.equal((await api('/workouts/' + saved.id, { method: 'PUT', body: { ...body, version: 1 } })).status, 409);
    assert.equal((await api('/workouts/' + saved.id, { method: 'DELETE', body: { version: 1 } })).status, 409);
  });
  await t.test('in-use catalog versions are protected and deletion cascades only routine data', async () => {
    await assert.rejects(admin.query('DELETE FROM gymfit_imports WHERE id=?', [run.id]));
    assert.equal((await api('/workouts/' + saved.id, { method: 'DELETE', body: { version: saved.version } })).status, 204);
    assert.equal((await api('/workouts/' + saved.id)).status, 404);
    assert.equal(Number((await admin.query('SELECT COUNT(*) AS n FROM workout_routine_sets'))[0].n), 0);
    assert.equal(Number((await admin.query('SELECT COUNT(*) AS n FROM gymfit_exercises'))[0].n), 35);
    assert.equal(garminCalls, 0);
  });
});
