'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const sharp = require('sharp');
const Sqlite = require('better-sqlite3');
const { normalizeAvatar, MAX_AVATAR_BYTES } = require('../libs/avatar');
const { createDatabase } = require('../libs/database');
const { createGarminProfileManager } = require('../libs/garmin');
const { createApp } = require('../app');
const { setup, listen, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const dataUrl = (bytes, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;
async function picture(color = '#24634e') {
  return sharp({ create: { width: 420, height: 280, channels: 3, background: color } }).png().toBuffer();
}
async function application(t) {
  const provider = await setup(t);
  const database = createDatabase(':memory:'); t.after(() => database.close());
  const manager = createGarminProfileManager({ databaseProvider: () => database, config: { baseUrl: provider.baseUrl } });
  const url = await listen(t, createApp({ garminManager: manager, databaseProvider: () => database }));
  const api = (endpoint, body, method = 'POST') => fetch(`${url}/api${endpoint}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { database, manager, provider, api, url };
}

test('le foto vengono ricodificate a 256 × 256, con orientamento corretto e senza metadati', async () => {
  const original = await sharp(await picture()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const avatar = await normalizeAvatar(dataUrl(original, 'image/jpeg'));
  const metadata = await sharp(Buffer.from(avatar.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 256); assert.equal(metadata.height, 256);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
});

test('avatar HTTP: caricamento, sostituzione, omissione e rimozione per singolo profilo', async (t) => {
  const { api, url, database, manager, provider } = await application(t);
  const first = await api('/profiles', { ...values, apiKey: TEST_API_KEY, avatar: dataUrl(await picture()) });
  assert.equal(first.status, 201);
  const a = await first.json();
  assert.match(a.avatar, /^data:image\/webp;base64,/);
  const b = database.createProfile({ ...values, firstName: 'Bruno' });
  assert.equal(b.avatar, null);
  const client = manager.getClient(a.id);
  await api(`/profiles/${a.id}`, { ...values, firstName: 'Anna' }, 'PATCH');
  assert.equal(database.getProfile(a.id).avatar, a.avatar);
  const changed = await api(`/profiles/${a.id}`, { ...values, avatar: dataUrl(await picture('#d48b59')) }, 'PATCH');
  const newAvatar = (await changed.json()).avatar;
  assert.notEqual(newAvatar, a.avatar);
  const list = await (await fetch(`${url}/api/profiles`)).json();
  assert.equal(list.profiles.find(p => p.id === a.id).avatar, newAvatar);
  assert.equal(list.profiles.find(p => p.id === b.id).avatar, null);
  assert.strictEqual(manager.getClient(a.id), client);
  assert.equal(database.getGarminCredential(a.id).apiKey, TEST_API_KEY);
  const removed = await api(`/profiles/${a.id}`, { ...values, avatar: null }, 'PATCH');
  assert.equal(removed.status, 200); assert.equal((await removed.json()).avatar, null);
  assert.equal(provider.state.tokenRequests, 0); assert.equal(provider.state.dataRequests, 0);
});

test('le immagini oltre 32 KB passano solo dal parser dei profili', async (t) => {
  const { api } = await application(t);
  const bytes = await sharp(randomBytes(180 * 180 * 3), { raw: { width: 180, height: 180, channels: 3 } }).png().toBuffer();
  assert.ok(bytes.length > 32 * 1024);
  const response = await api('/profiles', { ...values, avatar: dataUrl(bytes) });
  assert.equal(response.status, 201);
  const oversizedSession = await api('/sessions', { notes: 'a'.repeat(33 * 1024) });
  assert.equal(oversizedSession.status, 413);
});

test('file corrotti, MIME falsi, URL esterni e dimensioni eccessive vengono rifiutati senza modificare il profilo', async (t) => {
  const { api, database } = await application(t);
  const a = database.createProfile(values);
  const png = await picture();
  const invalid = [true, '', 'https://example.com/avatar.png', 'data:image/svg+xml;base64,PHN2Zy8+',
    dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'), 'image/jpeg'),
    dataUrl(png, 'image/jpeg'), dataUrl(png.subarray(0, 40)),
    dataUrl(Buffer.alloc(MAX_AVATAR_BYTES + 1)), 'data:image/png;base64,%%%invalid'];
  for (const avatar of invalid) {
    const response = await api(`/profiles/${a.id}`, { ...values, firstName: 'Da non salvare', avatar }, 'PATCH');
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_AVATAR');
    assert.equal(database.getProfile(a.id).firstName, values.firstName);
    assert.equal(database.getProfile(a.id).avatar, null);
  }
});

test('la migrazione versione 2 mantiene profili e credenziali; la foto persiste alla riapertura', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-avatar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'trainer.sqlite');
  const old = new Sqlite(filename);
  for (const file of ['001-initial.sql', '002-local-profiles.sql']) old.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  old.prepare(`INSERT INTO profiles(id,first_name,last_name,primary_sport,created_at,updated_at) VALUES ('legacy','Ada','Rossi','running','2026-10-22','2026-10-22')`).run();
  old.close();
  let db = createDatabase(filename);
  assert.equal(db.getProfile('legacy').avatar, null);
  const avatar = await normalizeAvatar(dataUrl(await picture()));
  db.updateProfile('legacy', { ...values, avatar, apiKey: TEST_API_KEY }); db.close();
  db = createDatabase(filename); t.after(() => db.close());
  assert.equal(db.getProfile('legacy').avatar, avatar);
  assert.equal(db.getGarminCredential('legacy').apiKey, TEST_API_KEY);
});
