'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

function migrateLegacyCredentials(database, envPath) {
  if (!fs.existsSync(envPath)) return false;
  const original = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(original);
  const keys = ['GARMIN_PERSONAL_API_KEY', 'GARMIN_API_KEY'];
  if (!keys.some((name) => Object.hasOwn(parsed, name))) return false;
  const apiKey = (parsed.GARMIN_PERSONAL_API_KEY ?? parsed.GARMIN_API_KEY ?? '').trim();
  // Commit the encrypted credential before removing its legacy source. Import is idempotent.
  if (apiKey) database.importLegacyKey(apiKey);
  const cleaned = original.replace(/^[\t ]*(?:export[\t ]+)?GARMIN_(?:PERSONAL_)?API_KEY[\t ]*=[\t ]*(?:"(?:\\.|[^"\\])*"|'[^']*'|`[^`]*`|[^\r\n]*)(?:[^\r\n]*)(?:\r?\n|$)/gm, '');
  // Refuse to leave a partially removed multiline credential behind.
  if (Object.keys(dotenv.parse(cleaned)).some((name) => keys.includes(name)) ||
    (apiKey && cleaned.includes(apiKey))) throw new Error('Rimozione della chiave dal file .env non riuscita.');
  const temporary = `${envPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, cleaned, { mode: 0o600, flag: 'wx' });
    if (fs.readFileSync(envPath, 'utf8') !== original) throw new Error('Il file .env è cambiato durante la migrazione. Riavvia l’app.');
    fs.renameSync(temporary, envPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  for (const name of keys) delete process.env[name];
  return true;
}

module.exports = { migrateLegacyCredentials };
