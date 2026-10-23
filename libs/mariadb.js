'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const mariadb = require('mariadb');
const { readConfig } = require('./config');
const { createCredentialVault } = require('./credentials');
const { InputError, validateProfile, validateSession } = require('./validation');
const { createGarminRepository } = require('../helpers/garmin-repository');
const { createWorkoutRepository } = require('../helpers/workout-repository');
const { migrateMariaDatabase } = require('./mariadb-migrations');
const themes = new Set(require('./themes.json').map(theme => theme.id));

async function createMariaDatabase(config = readConfig()) {
  const pool = mariadb.createPool(config.database);
  let connection;
  try {
    connection = await pool.getConnection();
    await migrateMariaDatabase(connection);
    if (!fs.existsSync(config.encryptionKeyPath)) throw new Error('Chiave di cifratura assente. Ripristina il secret encryption_key dal backup.');
  } catch (error) {
    connection?.release();
    await pool.end();
    throw error;
  }
  connection.release();
  const vault = createCredentialVault(config.encryptionKeyPath);
  // Initialize before accepting requests, so permission/key failures fail startup.
  try { vault.fingerprint('installation', 'check'); }
  catch (error) { await pool.end(); throw error; }
  const query = (sql, params) => pool.query(sql, params);
  const now = () => new Date().toISOString();
  async function transaction(fn) {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const value = await fn(conn); await conn.commit(); return value; }
    catch (error) { await conn.rollback(); throw error; }
    finally { conn.release(); }
  }
  const encrypt = (value, id, field) => value ? vault.encrypt(value, `${id}:${field}`) : null;
  const decrypt = (value, id, field) => value ? vault.decrypt(value, `${id}:${field}`) : '';
  function userData(row, withPassword = false) {
    if (!row) return null;
    return { id: row.id, username: decrypt(row.username, row.id, 'username'), email: decrypt(row.email, row.id, 'email'),
      createdAt: row.created_at, ...(withPassword ? { passwordHash: row.password_hash } : {}) };
  }
  function profileData(row) {
    if (!row) throw new InputError('Profilo non trovato.', 404, 'PROFILE_NOT_FOUND');
    const firstName = decrypt(row.first_name, row.id, 'firstName');
    const lastName = decrypt(row.last_name, row.id, 'lastName');
    return { id: row.id, firstName, lastName, primarySport: row.primary_sport,
      avatar: row.avatar ? decrypt(row.avatar, row.id, 'avatar') : null,
      theme: row.theme, darkMode: Boolean(row.dark_mode), language: row.language, hasGarminKey: Boolean(row.garmin_key),
      credentialRevision: row.credential_revision, createdAt: row.created_at, updatedAt: row.updated_at,
      needsCompletion: !firstName || !lastName || !row.primary_sport };
  }
  const sessionProjection = 'id, profile_id AS profileId, title, sport, date, time, duration_minutes AS durationMinutes, notes, status, created_at AS createdAt, updated_at AS updatedAt';
  async function getProfile(id) { return profileData((await query('SELECT * FROM profiles WHERE id = ?', [id]))[0]); }
  async function findSession(profileId, id) { return (await query(`SELECT ${sessionProjection} FROM planned_sessions WHERE id = ? AND profile_id = ?`, [id, profileId]))[0]; }
  return {
    ...createGarminRepository({ query, transaction, keyPath: config.encryptionKeyPath }),
    ...createWorkoutRepository({ query, transaction }),
    async ready() { await query('SELECT 1'); },
    async createUser({ username, email, passwordHash }) {
      const id = randomUUID(); const profileId = randomUUID(); const createdAt = now();
      try {
        await transaction(async conn => {
          await conn.query('INSERT INTO users(id,username,username_lookup,email,email_lookup,password_hash,created_at) VALUES (?,?,?,?,?,?,?)',
            [id, encrypt(username, id, 'username'), vault.fingerprint(username.toLowerCase(), 'username'), encrypt(email, id, 'email'), vault.fingerprint(email.toLowerCase(), 'email'), passwordHash, createdAt]);
          await conn.query('INSERT INTO profiles(id,user_id,created_at,updated_at) VALUES (?,?,?,?)', [profileId, id, createdAt, createdAt]);
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new InputError('Nome utente o email già in uso.', 409, 'ACCOUNT_EXISTS');
        throw error;
      }
      return { id, username, email, createdAt };
    },
    async findUser(username) { return userData((await query('SELECT * FROM users WHERE username_lookup = ?', [vault.fingerprint(username.toLowerCase(), 'username')]))[0], true); },
    async getUser(id) { return userData((await query('SELECT * FROM users WHERE id = ?', [id]))[0]); },
    async getUserProfile(userId) { return profileData((await query('SELECT * FROM profiles WHERE user_id = ?', [userId]))[0]); },
    async createAuthSession({ tokenHash, userId, csrfToken, expiresAt }) {
      await query('DELETE FROM auth_sessions WHERE expires_at <= ?', [Date.now()]);
      await query('INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)', [tokenHash, userId, csrfToken, expiresAt]);
    },
    async getAuthSession(tokenHash) { return (await query('SELECT user_id AS userId, csrf_token AS csrfToken, expires_at AS expiresAt FROM auth_sessions WHERE token_hash = ? AND expires_at > ?', [tokenHash, Date.now()]))[0] || null; },
    async deleteAuthSession(tokenHash) { await query('DELETE FROM auth_sessions WHERE token_hash = ?', [tokenHash]); },
    getProfile,
    async updateProfile(id, input) {
      const values = validateProfile(input);
      await transaction(async conn => {
        const row = (await conn.query('SELECT id FROM profiles WHERE id = ? FOR UPDATE', [id]))[0];
        if (!row) throw new InputError('Profilo non trovato.', 404, 'PROFILE_NOT_FOUND');
        const fields = ['first_name = ?', 'last_name = ?', 'primary_sport = ?', 'updated_at = ?'];
        const args = [encrypt(values.firstName, id, 'firstName'), encrypt(values.lastName, id, 'lastName'), values.primarySport, now()];
        for (const field of ['avatar', 'theme', 'language']) if (values[field] !== undefined) {
          fields.push(`${field} = ?`); args.push(field === 'avatar' ? encrypt(values[field], id, 'avatar') : values[field]);
        }
        if (input.apiKey === null || (typeof input.apiKey === 'string' && input.apiKey.trim())) {
          fields.push('garmin_key = ?', 'credential_revision = credential_revision + 1');
          args.push(encrypt(input.apiKey?.trim(), id, 'garminKey'));
        }
        await conn.query(`UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`, [...args, id]);
      });
      return getProfile(id);
    },
    async updateProfileTheme(id, theme, darkMode) {
      if (!themes.has(theme)) throw new InputError('Tema non valido.', 400, 'INVALID_THEME');
      if (darkMode !== undefined && typeof darkMode !== 'boolean') throw new InputError('Modalità tema non valida.', 400, 'INVALID_INPUT');
      await query(`UPDATE profiles SET theme = ?, updated_at = ?${darkMode === undefined ? '' : ', dark_mode = ?'} WHERE id = ?`, [theme, now(), ...(darkMode === undefined ? [] : [darkMode]), id]);
      return getProfile(id);
    },
    async getGarminCredential(id) {
      const row = (await query('SELECT garmin_key,credential_revision FROM profiles WHERE id = ?', [id]))[0];
      if (!row) throw new InputError('Profilo non trovato.', 404, 'PROFILE_NOT_FOUND');
      return { apiKey: decrypt(row.garmin_key, id, 'garminKey'), revision: row.credential_revision };
    },
    async listSessions(profileId) { return Array.from(await query(`SELECT ${sessionProjection} FROM planned_sessions WHERE profile_id = ? ORDER BY date,time,created_at`, [profileId])); },
    async createSession(profileId, input) {
      const value = validateSession(input); const id = randomUUID(); const created = now();
      await query('INSERT INTO planned_sessions(id,profile_id,title,sport,date,time,duration_minutes,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, profileId, value.title, value.sport, value.date, value.time, value.durationMinutes, value.notes, created, created]);
      return findSession(profileId, id);
    },
    async setSessionStatus(profileId, id, status) {
      if (!['planned', 'completed'].includes(status)) throw new InputError('Stato non valido.', 400, undefined, 'errors.sessionStatus');
      await query('UPDATE planned_sessions SET status = ?, updated_at = ? WHERE id = ? AND profile_id = ?', [status, now(), id, profileId]);
      const session = await findSession(profileId, id);
      if (!session) throw new InputError('Sessione non trovata.', 404);
      return session;
    },
    async deleteSession(profileId, id) {
      const result = await query('DELETE FROM planned_sessions WHERE id = ? AND profile_id = ?', [id, profileId]);
      if (!result.affectedRows) throw new InputError('Sessione non trovata.', 404);
    },
    async close() { await pool.end(); },
  };
}

let shared;
function getMariaDatabase() {
  if (!shared) throw new Error('Database non inizializzato.');
  return shared;
}
async function initializeDatabase(config) { shared = await createMariaDatabase(config); return shared; }
module.exports = { createMariaDatabase, getMariaDatabase, initializeDatabase };
