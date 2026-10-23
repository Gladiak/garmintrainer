'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Share the same serialized, restartable migrations between the app and CLI.
async function migrateMariaDatabase(connection) {
  const locks = await connection.query("SELECT GET_LOCK('garmintrainer_schema', 30) AS acquired");
  if (locks[0].acquired !== 1) throw new Error('Migrazione database già in corso.');
  try {
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY)');
    const versions = await connection.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
    const directory = path.join(__dirname, '../db/migrations/mariadb');
    const migrations = fs.readdirSync(directory).filter(name => /^\d+-.*\.sql$/.test(name)).sort();
    const currentVersion = Number(versions[0]?.version || 0);
    const latestVersion = Number(migrations.at(-1).split('-')[0]);
    if (currentVersion > latestVersion) throw new Error('Il database richiede una versione più recente dell’app.');
    for (const filename of migrations) {
      const version = Number(filename.split('-')[0]);
      if (version <= currentVersion) continue;
      const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await connection.query(statement);
      await connection.query('INSERT INTO schema_migrations(version) VALUES (?)', [version]);
    }
  } finally { await connection.query("SELECT RELEASE_LOCK('garmintrainer_schema')"); }
}

module.exports = { migrateMariaDatabase };
