'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sqlite = require('better-sqlite3');
const themes = require('../libs/themes.json');
const { createDatabase } = require('../libs/database');
const { createCredentialVault } = require('../libs/credentials');
const { createGarminProfileManager } = require('../libs/garmin');
const { createApp } = require('../app');
const { setup, listen, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };

test('sei temi ammessi; tema predefinito e input non validi senza modifiche parziali', (t) => {
  const db = createDatabase(':memory:'); t.after(() => db.close());
  assert.equal(themes.length, 6);
  const p = db.createProfile(values);
  assert.equal(p.theme, 'sage-ivory');
  for (const theme of themes) assert.equal(db.updateProfile(p.id, { ...values, theme: theme.id }).theme, theme.id);
  for (const invalid of [null, '', 'not-a-theme', [], 42]) {
    assert.throws(() => db.updateProfile(p.id, { ...values, firstName: 'Non salvare', theme: invalid }), { code: 'INVALID_THEME' });
    assert.equal(db.getProfile(p.id).firstName, values.firstName);
  }
});

test('tema HTTP per profilo, omissione conservativa, cache Garmin e credenziali invariate', async (t) => {
  const provider = await setup(t);
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const manager = createGarminProfileManager({ databaseProvider: () => db, config: { baseUrl: provider.baseUrl } });
  const base = await listen(t, createApp({ databaseProvider: () => db, garminManager: manager }));
  const request = (endpoint, body, method = 'POST') => fetch(`${base}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await request('/profiles', { ...values, theme: 'ember-night', apiKey: TEST_API_KEY });
  assert.equal(created.status, 201);
  const a = await created.json();
  const b = db.createProfile({ ...values, firstName: 'Bruno', theme: 'vanilla-pastel' });
  const client = manager.getClient(a.id);
  assert.equal((await request(`/profiles/${a.id}`, { ...values, theme: 'ocean-gold' }, 'PATCH')).status, 200);
  assert.equal((await request(`/profiles/${a.id}`, values, 'PATCH')).status, 200);
  assert.strictEqual(manager.getClient(a.id), client);
  const listed = await (await fetch(`${base}/api/profiles`)).json();
  assert.equal(listed.profiles.find(p => p.id === a.id).theme, 'ocean-gold');
  assert.equal(listed.profiles.find(p => p.id === b.id).theme, 'vanilla-pastel');
  const dashboard = await (await fetch(`${base}/api/dashboard`, { headers: { 'X-Profile-Id': a.id } })).json();
  assert.equal(dashboard.profile.theme, 'ocean-gold');
  assert.equal(db.getGarminCredential(a.id).apiKey, TEST_API_KEY);
  const invalid = await request(`/profiles/${a.id}`, { ...values, theme: 'invalid' }, 'PATCH');
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_THEME');
  assert.equal(provider.state.tokenRequests, 0);
});

test('migrazione da versione 3: profilo, foto, credenziale e piano conservati; tema persistente', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'garmin-themes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'trainer.sqlite');
  const old = new Sqlite(filename);
  for (const file of ['001-initial.sql', '002-local-profiles.sql', '003-profile-avatar.sql']) old.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  const encrypted = createCredentialVault(`${filename}.key`).encrypt(TEST_API_KEY, 'legacy');
  old.prepare(`INSERT INTO profiles(id,first_name,last_name,primary_sport,garmin_key,credential_revision,avatar,created_at,updated_at) VALUES ('legacy','Ada','Rossi','running',?,1,'fixture-avatar','2026-10-22','2026-10-22')`).run(encrypted);
  old.prepare(`INSERT INTO planned_sessions(id,profile_id,title,sport,date,duration_minutes,created_at,updated_at) VALUES ('plan','legacy','Corsa','running','2026-10-22',30,'2026-10-22','2026-10-22')`).run();
  old.close();
  let db = createDatabase(filename);
  assert.equal(db.getProfile('legacy').theme, 'sage-ivory');
  assert.equal(db.getProfile('legacy').avatar, 'fixture-avatar');
  assert.equal(db.getGarminCredential('legacy').apiKey, TEST_API_KEY);
  assert.equal(db.listSessions('legacy').length, 1);
  db.updateProfile('legacy', { ...values, theme: 'slate-night' }); db.close();
  db = createDatabase(filename); t.after(() => db.close());
  assert.equal(db.getProfile('legacy').theme, 'slate-night');
  assert.equal(db.getProfile('legacy').avatar, 'fixture-avatar');
});

test('superfici in scala di grigi condivise, accenti leggibili e colori dei dati distinguibili', async () => {
  const { THEMES, UI_PALETTE: ui } = await import('../frontend/src/lib/palette.js');
  function luminance(hex) {
    const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  function ratio(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  for (const [text, background] of [[ui.ink, ui.ivory], [ui.ink, ui.surface], [ui.textMuted, ui.surface], [ui.textMuted, ui.mist], [ui.onAccent, ui.sageStrong]]) {
    assert.ok(ratio(text, background) >= 4.5, `${text} su ${background}`);
  }
  for (const theme of THEMES) {
    for (const field of ['ivory', 'surface', 'mist', 'mistSoft', 'mossSoft', 'sandSoft', 'sidebarNote', 'ink', 'textMuted', 'border']) {
      assert.equal(theme.palette[field], ui[field]);
      assert.match(ui[field], /^#([a-f0-9]{2})\1\1$/i, `${field} usa una tonalità grigia`);
    }
    assert.ok(ratio(theme.palette.onAccent, theme.palette.sageStrong) >= 4.5, `${theme.id}: testo su pulsanti e navigazione`);
    assert.ok(ratio(theme.palette.accentInk, ui.surface) >= 3, `${theme.id}: focus e icone`);
    assert.equal(theme.mode, 'light');
    for (const color of Object.values(theme.metricColors)) {
      assert.ok(ratio(color, ui.surface) >= 3, `${theme.id}: grafico ${color} su ${ui.surface}`);
    }
  }
  assert.equal(new Set(THEMES.map(theme => theme.metricColors.restingHeartRate)).size, 6);
  assert.equal(new Set(THEMES.map(theme => theme.palette.sageStrong)).size, 6);
});

test('salvataggio tema separato per profili incompleti: validazione, isolamento e nessun rinnovo token', async (t) => {
  const provider = await setup(t);
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const legacy = db.importLegacyKey(TEST_API_KEY);
  const other = db.createProfile(values);
  const manager = createGarminProfileManager({ databaseProvider: () => db, config: { baseUrl: provider.baseUrl } });
  const client = manager.getClient(legacy.id);
  const base = await listen(t, createApp({ databaseProvider: () => db, garminManager: manager }));
  const save = (id, body) => fetch(`${base}/api/profiles/${id}/theme`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await save(legacy.id, { theme: 'ocean-gold', firstName: 'Non modificare', apiKey: 'ignored' });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.theme, 'ocean-gold'); assert.equal(updated.needsCompletion, true);
  assert.equal(updated.firstName, legacy.firstName); assert.equal(updated.avatar, legacy.avatar);
  assert.equal(updated.credentialRevision, legacy.credentialRevision);
  assert.equal(db.getGarminCredential(legacy.id).apiKey, TEST_API_KEY);
  assert.strictEqual(manager.getClient(legacy.id), client);
  assert.equal(db.getProfile(other.id).theme, 'sage-ivory');
  for (const invalid of [{}, { theme: null }, { theme: 'unknown' }, { theme: [] }]) {
    const result = await save(legacy.id, invalid);
    assert.equal(result.status, 400); assert.equal((await result.json()).error.code, 'INVALID_THEME');
    assert.equal(db.getProfile(legacy.id).theme, 'ocean-gold');
  }
  assert.equal((await save('missing', { theme: 'ocean-gold' })).status, 404);
  assert.equal(provider.state.tokenRequests, 0);
});
