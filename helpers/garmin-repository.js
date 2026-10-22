'use strict';

const { randomUUID } = require('node:crypto');
const { InputError } = require('../libs/validation');
const { createGarminVault } = require('./garmin-vault');
const { defaultLayout, upgradeLayout } = require('./dashboard-layout');
const { dateRange } = require('./garmin-dates');

function createGarminRepository({ query, transaction, keyPath }) {
  const vault = createGarminVault(keyPath);
  async function checkWriter(conn, profile, owner) {
    const rows = await conn.query('SELECT credential_revision FROM profiles WHERE id = ? FOR UPDATE', [profile.id]);
    const locks = await conn.query('SELECT owner, expires_at FROM garmin_sync_locks WHERE profile_id = ? FOR UPDATE', [profile.id]);
    if (rows[0]?.credential_revision !== profile.credentialRevision || locks[0]?.owner !== owner || locks[0].expires_at <= Date.now()) {
      throw new InputError('Il collegamento Garmin è cambiato. Riprova.', 409, 'PROFILE_CREDENTIAL_CHANGED');
    }
  }
  return {
    async getDashboardLayout(profileId) {
      const [row] = await query('SELECT payload FROM dashboard_layouts WHERE profile_id = ?', [profileId]);
      return row ? upgradeLayout(vault.decrypt(profileId, 'dashboard-layout', row.payload)) : structuredClone(defaultLayout);
    },
    async saveDashboardLayout(profileId, layout) {
      await query('INSERT INTO dashboard_layouts(profile_id,payload) VALUES (?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload)',
        [profileId, vault.encrypt(profileId, 'dashboard-layout', layout)]);
    },
    async getGarminConnection(profileId) {
      const [row] = await query('SELECT * FROM garmin_connections WHERE profile_id = ?', [profileId]);
      return row ? { id: row.connection_id, revision: row.credential_revision, updatedAt: Number(row.updated_at),
        ...vault.decrypt(profileId, `connection:${row.connection_id}`, row.payload) } : null;
    },
    async connectGarmin(profile, identity, settings, owner) {
      return transaction(async conn => {
        await checkWriter(conn, profile, owner);
        const [row] = await conn.query('SELECT * FROM garmin_connections WHERE profile_id = ?', [profile.id]);
        const lookup = vault.lookup(profile.id, 'identity', identity);
        const id = row?.identity_lookup === lookup ? row.connection_id : randomUUID();
        const metadata = { identity, ...settings };
        await conn.query('INSERT INTO garmin_connections(profile_id,connection_id,identity_lookup,credential_revision,payload,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE connection_id=VALUES(connection_id),identity_lookup=VALUES(identity_lookup),credential_revision=VALUES(credential_revision),payload=VALUES(payload),updated_at=VALUES(updated_at)',
          [profile.id, id, lookup, profile.credentialRevision, vault.encrypt(profile.id, `connection:${id}`, metadata), Date.now()]);
        if (row && row.connection_id !== id) await conn.query('DELETE FROM garmin_sync_state WHERE profile_id = ?', [profile.id]);
        return { id, revision: profile.credentialRevision, updatedAt: Date.now(), ...metadata };
      });
    },
    async readGarminRows(profileId, connectionId, resource, days) {
      if (!connectionId || !days.length) return [];
      const lookups = days.map(day => vault.lookup(profileId, `day:${connectionId}`, day));
      const rows = await query(`SELECT day_lookup,payload,fetched_at FROM garmin_measurements WHERE profile_id = ? AND connection_id = ? AND resource = ? AND day_lookup IN (${lookups.map(() => '?').join(',')})`, [profileId, connectionId, resource, ...lookups]);
      return rows.map(row => ({ ...vault.decrypt(profileId, `${connectionId}:${resource}:${row.day_lookup}`, row.payload), fetchedAt: Number(row.fetched_at) }));
    },
    async saveGarminRows(profile, connectionId, resource, records, owner) {
      await transaction(async conn => {
        await checkWriter(conn, profile, owner);
        const [current] = await conn.query('SELECT connection_id FROM garmin_connections WHERE profile_id = ?', [profile.id]);
        if (current?.connection_id !== connectionId) throw new InputError('Collegamento cambiato.', 409, 'PROFILE_CREDENTIAL_CHANGED');
        for (const record of records) {
          const lookup = vault.lookup(profile.id, `day:${connectionId}`, record.date);
          const payload = vault.encrypt(profile.id, `${connectionId}:${resource}:${lookup}`, record);
          await conn.query('INSERT INTO garmin_measurements(profile_id,connection_id,resource,day_lookup,payload,fetched_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE payload=VALUES(payload),fetched_at=VALUES(fetched_at)',
            [profile.id, connectionId, resource, lookup, payload, Date.now()]);
        }
      });
    },
    async getGarminSyncState(profileId, scopes, revision) {
      const rows = await query('SELECT resource,range_lookup AS rangeLookup,credential_revision AS revision,error_code AS errorCode,retry_at AS retryAt,last_attempt_at AS lastAttemptAt,outcome FROM garmin_sync_state WHERE profile_id = ? AND credential_revision = ?', [profileId, revision]);
      if (!scopes) return Array.from(rows);
      const days = new Map(Object.entries(scopes).flatMap(([resource, scope]) => dateRange(scope.from, scope.to, 62)
        .map(date => [vault.lookup(profileId, `day-state:${revision}:${resource}`, date), date])));
      return Array.from(rows).filter(row => days.has(row.rangeLookup)).map(row => ({ ...row, date: days.get(row.rangeLookup) }));
    },
    async setGarminSyncState(profile, resource, error, owner, scope, outcome = null) {
      await transaction(async conn => {
        await checkWriter(conn, profile, owner);
        for (const date of dateRange(scope.from, scope.to, 62)) {
          const lookup = vault.lookup(profile.id, `day-state:${profile.credentialRevision}:${resource}`, date);
          await conn.query('INSERT INTO garmin_sync_state(profile_id,resource,range_lookup,credential_revision,error_code,retry_at,last_attempt_at,outcome) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE error_code=VALUES(error_code),retry_at=VALUES(retry_at),last_attempt_at=VALUES(last_attempt_at),outcome=VALUES(outcome)',
            [profile.id, resource, lookup, profile.credentialRevision, error?.code || null, error?.retryAt || null, Date.now(), outcome]);
        }
      });
    },
    async acquireGarminSync(profileId, owner) {
      const now = Date.now();
      await query('INSERT INTO garmin_sync_locks(profile_id,owner,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE owner=IF(expires_at<=?,VALUES(owner),owner),expires_at=IF(owner=VALUES(owner),VALUES(expires_at),expires_at)', [profileId, owner, now + 120_000, now]);
      const [row] = await query('SELECT owner FROM garmin_sync_locks WHERE profile_id = ?', [profileId]);
      return row?.owner === owner;
    },
    async releaseGarminSync(profileId, owner) {
      await query('DELETE FROM garmin_sync_locks WHERE profile_id = ? AND owner = ?', [profileId, owner]);
    },
  };
}

module.exports = { createGarminRepository };
