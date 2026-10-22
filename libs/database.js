'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const { readConfig } = require('./config');
const { createCredentialVault } = require('./credentials');
const THEME_IDS = new Set(require('./themes.json').map((theme) => theme.id));

class InputError extends Error {
  constructor(message, statusCode = 400, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || (statusCode === 404 ? 'SESSION_NOT_FOUND' : 'INVALID_INPUT');
  }
}

const SPORTS = new Set(['running', 'cycling', 'strength', 'walking', 'mobility', 'swimming']);
const PRIMARY_SPORTS = new Set(['running', 'cycling', 'swimming', 'gym', 'hiit']);

function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Profilo non valido.');
  for (const field of ['firstName', 'lastName']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].trim().length > 80) {
      throw new InputError('Nome e cognome sono obbligatori, con un massimo di 80 caratteri ciascuno.');
    }
  }
  if (!PRIMARY_SPORTS.has(input.primarySport)) throw new InputError('Seleziona lo sport principale.');
  if (input.theme !== undefined && !THEME_IDS.has(input.theme)) throw new InputError('Seleziona un tema disponibile.', 400, 'INVALID_THEME');
  if (input.apiKey !== undefined && input.apiKey !== null &&
    (typeof input.apiKey !== 'string' || input.apiKey.trim().length > 8192 || /[\s\x00-\x1f\x7f]/.test(input.apiKey.trim()))) {
    throw new InputError('Inserisci una chiave Garmin valida, senza spazi o interruzioni di riga.');
  }
  if (input.avatar !== undefined && input.avatar !== null &&
    (typeof input.avatar !== 'string' || input.avatar.length > 128 * 1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.avatar))) {
    throw new InputError('Immagine del profilo non valida.', 400, 'INVALID_AVATAR');
  }
  return { firstName: input.firstName.trim(), lastName: input.lastName.trim(), primarySport: input.primarySport,
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    ...(input.theme === undefined ? {} : { theme: input.theme }) };
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Sessione non valida.');
  const { title, sport, date, time = '', durationMinutes, notes = '' } = input;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) throw new InputError('Inserisci un titolo di massimo 120 caratteri.');
  if (!SPORTS.has(sport)) throw new InputError('Seleziona uno sport valido.');
  if (!isCalendarDate(date)) throw new InputError('Inserisci una data valida.');
  if (typeof time !== 'string' || (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new InputError('Inserisci un orario valido.');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) throw new InputError('La durata deve essere tra 1 e 1440 minuti.');
  if (typeof notes !== 'string' || notes.length > 2000) throw new InputError('Le note possono contenere fino a 2000 caratteri.');
  return { title: title.trim(), sport, date, time, durationMinutes, notes: notes.trim() };
}

function createDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    if (filename !== ':memory:') database.pragma('journal_mode = WAL');
    const version = database.pragma('user_version', { simple: true });
    if (version > 4) throw new Error('Il database richiede una versione più recente dell’app.');
    for (const [index, file] of ['001-initial.sql', '002-local-profiles.sql', '003-profile-avatar.sql', '004-profile-theme.sql'].entries()) {
      if (version > index) continue;
      const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', file), 'utf8');
      database.transaction(() => database.exec(sql))();
    }
  } catch (error) {
    database.close();
    throw error;
  }

  const vault = createCredentialVault(filename === ':memory:' ? null : `${filename}.key`);
  const profileProjection = `id, first_name AS firstName, last_name AS lastName, primary_sport AS primarySport, avatar, theme,
    (garmin_key IS NOT NULL) AS hasGarminKey, credential_revision AS credentialRevision,
    created_at AS createdAt, updated_at AS updatedAt`;
  const profileRow = database.prepare(`SELECT ${profileProjection} FROM profiles WHERE id = ?`);
  function getProfile(id) {
    const row = typeof id === 'string' ? profileRow.get(id) : undefined;
    if (!row) throw new InputError('Profilo non trovato. Seleziona un profilo locale.', 404, 'PROFILE_NOT_FOUND');
    return { ...row, hasGarminKey: Boolean(row.hasGarminKey), needsCompletion: !row.firstName || !row.lastName || !row.primarySport };
  }
  function listProfiles() {
    return database.prepare('SELECT id FROM profiles ORDER BY created_at, rowid').all().map(({ id }) => getProfile(id));
  }
  const insertProfile = database.prepare(`INSERT INTO profiles
    (id, first_name, last_name, primary_sport, avatar, theme, garmin_key, credential_revision, created_at, updated_at)
    VALUES (@id, @firstName, @lastName, @primarySport, @avatar, @theme, @encryptedKey, @revision, @now, @now)`);
  function addProfile(values, apiKey = '') {
    const id = randomUUID();
    insertProfile.run({ ...values, avatar: values.avatar || null, theme: values.theme || 'sage-ivory', id, encryptedKey: apiKey ? vault.encrypt(apiKey, id) : null, revision: apiKey ? 1 : 0, now: new Date().toISOString() });
    // Only the first profile inherits sessions created before profiles existed.
    database.prepare('UPDATE planned_sessions SET profile_id = ? WHERE profile_id IS NULL').run(id);
    return getProfile(id);
  }
  const projection = `id, profile_id AS profileId, title, sport, date, time, duration_minutes AS durationMinutes,
    notes, status, created_at AS createdAt, updated_at AS updatedAt`;
  const find = database.prepare(`SELECT ${projection} FROM planned_sessions WHERE id = ? AND profile_id = ?`);
  const list = database.prepare(`SELECT ${projection} FROM planned_sessions WHERE profile_id = ? ORDER BY date, time, created_at`);
  const insert = database.prepare(`INSERT INTO planned_sessions
    (id, profile_id, title, sport, date, time, duration_minutes, notes, created_at, updated_at)
    VALUES (@id, @profileId, @title, @sport, @date, @time, @durationMinutes, @notes, @createdAt, @createdAt)`);

  if (!listProfiles().length && database.prepare('SELECT 1 FROM planned_sessions LIMIT 1').get()) {
    database.transaction(() => addProfile({ firstName: '', lastName: '', primarySport: null }))();
  }

  return {
    listProfiles, getProfile,
    createProfile(input) {
      const values = validateProfile(input);
      return database.transaction(() => addProfile(values, input.apiKey?.trim() || ''))();
    },
    updateProfile(id, input) {
      getProfile(id);
      const values = validateProfile(input);
      return database.transaction(() => {
        const now = new Date().toISOString();
        database.prepare('UPDATE profiles SET first_name = ?, last_name = ?, primary_sport = ?, updated_at = ? WHERE id = ?')
          .run(values.firstName, values.lastName, values.primarySport, now, id);
        if (values.avatar !== undefined) database.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(values.avatar, id);
        if (values.theme !== undefined) database.prepare('UPDATE profiles SET theme = ? WHERE id = ?').run(values.theme, id);
        // Omission or an empty field preserves the saved key; null explicitly removes it.
        if (input.apiKey === null || (typeof input.apiKey === 'string' && input.apiKey.trim())) {
          const encrypted = input.apiKey === null ? null : vault.encrypt(input.apiKey.trim(), id);
          database.prepare('UPDATE profiles SET garmin_key = ?, credential_revision = credential_revision + 1 WHERE id = ?').run(encrypted, id);
        }
        return getProfile(id);
      })();
    },
    updateProfileTheme(id, theme) {
      getProfile(id);
      if (!THEME_IDS.has(theme)) throw new InputError('Seleziona un tema disponibile.', 400, 'INVALID_THEME');
      database.prepare('UPDATE profiles SET theme = ?, updated_at = ? WHERE id = ?').run(theme, new Date().toISOString(), id);
      return getProfile(id);
    },
    deleteProfile(id) {
      getProfile(id);
      database.transaction(() => {
        database.prepare('DELETE FROM planned_sessions WHERE profile_id = ?').run(id);
        database.prepare("DELETE FROM app_settings WHERE name = 'legacy_env_profile' AND value = ?").run(id);
        database.prepare('DELETE FROM profiles WHERE id = ?').run(id);
      })();
    },
    getGarminCredential(id) {
      const profile = getProfile(id);
      const row = database.prepare('SELECT garmin_key FROM profiles WHERE id = ?').get(id);
      return { apiKey: vault.decrypt(row.garmin_key, id), revision: profile.credentialRevision };
    },
    importLegacyKey(apiKey) {
      return database.transaction(() => {
        const imported = database.prepare("SELECT value FROM app_settings WHERE name = 'legacy_env_profile'").get();
        if (imported) return getProfile(imported.value);
        let profile = listProfiles().find((item) => item.needsCompletion && !item.hasGarminKey);
        if (!profile) profile = addProfile({ firstName: '', lastName: '', primarySport: null });
        database.prepare('UPDATE profiles SET garmin_key = ?, credential_revision = credential_revision + 1 WHERE id = ?')
          .run(vault.encrypt(apiKey, profile.id), profile.id);
        database.prepare("INSERT INTO app_settings(name, value) VALUES ('legacy_env_profile', ?)").run(profile.id);
        return getProfile(profile.id);
      })();
    },
    listSessions(profileId) { getProfile(profileId); return list.all(profileId); },
    createSession(profileId, input) {
      getProfile(profileId);
      const session = { ...validateSession(input), profileId, id: randomUUID(), createdAt: new Date().toISOString() };
      insert.run(session);
      return find.get(session.id, profileId);
    },
    setSessionStatus(profileId, id, status) {
      getProfile(profileId);
      if (!['planned', 'completed'].includes(status)) throw new InputError('Stato della sessione non valido.');
      const result = database.prepare('UPDATE planned_sessions SET status = ?, updated_at = ? WHERE id = ? AND profile_id = ?')
        .run(status, new Date().toISOString(), id, profileId);
      if (!result.changes) throw new InputError('Sessione non trovata.', 404);
      return find.get(id, profileId);
    },
    deleteSession(profileId, id) {
      getProfile(profileId);
      const result = database.prepare('DELETE FROM planned_sessions WHERE id = ? AND profile_id = ?').run(id, profileId);
      if (!result.changes) throw new InputError('Sessione non trovata.', 404);
    },
    close() { if (database.open) database.close(); },
  };
}

let sharedDatabase;
function getDatabase() {
  if (!sharedDatabase) sharedDatabase = createDatabase(readConfig().databasePath);
  return sharedDatabase;
}

module.exports = { createDatabase, getDatabase, InputError, isCalendarDate };
