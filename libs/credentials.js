'use strict';

const fs = require('node:fs');
const { randomBytes, createCipheriv, createDecipheriv, createHmac } = require('node:crypto');

// The installation key stays outside the database. AES-GCM binds each field to its owner.
function createCredentialVault(keyPath) {
  let key;
  function installationKey() {
    if (key) return key;
    if (!keyPath) return (key = randomBytes(32));
    if (!fs.existsSync(keyPath)) {
      try {
        const fd = fs.openSync(keyPath, 'wx', 0o600);
        try { fs.writeFileSync(fd, randomBytes(32)); } finally { fs.closeSync(fd); }
      } catch (error) {
        if (error.code !== 'EEXIST') throw new Error('Impossibile creare la chiave di protezione locale.');
      }
    }
    key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error('Chiave di protezione locale non valida.');
    return key;
  }
  return {
    fingerprint(value, purpose) {
      return createHmac('sha256', installationKey()).update(`${purpose}\0${value}`).digest('hex');
    },
    encrypt(value, profileId) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', installationKey(), iv);
      cipher.setAAD(Buffer.from(profileId));
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
    },
    decrypt(value, profileId) {
      if (!value) return '';
      try {
        // Never replace a lost key when encrypted data already exists.
        if (keyPath && !fs.existsSync(keyPath)) throw new Error();
        const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
        const cipher = createDecipheriv('aes-256-gcm', installationKey(), iv);
        cipher.setAAD(Buffer.from(profileId));
        cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
      } catch {
        throw new Error('Impossibile leggere la chiave Garmin. Ripristina la chiave di protezione locale o reinserisci la credenziale nel profilo.');
      }
    },
  };
}

module.exports = { createCredentialVault };
