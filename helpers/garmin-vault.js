'use strict';

const { readFileSync } = require('node:fs');
const { hkdfSync, createHmac, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

function createGarminVault(keyPath) {
  const master = readFileSync(keyPath);
  if (master.length !== 32) throw new Error('Chiave di cifratura Garmin non valida.');
  function key(profileId, purpose) {
    return hkdfSync('sha256', master, Buffer.alloc(0), `garmin:v1:${profileId}:${purpose}`, 32);
  }
  return {
    lookup(profileId, context, value) {
      return createHmac('sha256', key(profileId, 'index')).update(`${context}\0${value}`).digest('hex');
    },
    encrypt(profileId, context, value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(profileId, 'encryption'), iv);
      cipher.setAAD(Buffer.from(`garmin:v1:${profileId}:${context}`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
    },
    decrypt(profileId, context, payload) {
      const [version, iv, tag, ciphertext] = payload.split('.');
      if (version !== 'v1') throw new Error('Versione cifratura Garmin non supportata.');
      const cipher = createDecipheriv('aes-256-gcm', key(profileId, 'encryption'), Buffer.from(iv, 'base64'));
      cipher.setAAD(Buffer.from(`garmin:v1:${profileId}:${context}`));
      cipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(ciphertext, 'base64')), cipher.final()]).toString('utf8'));
    },
  };
}

module.exports = { createGarminVault };
