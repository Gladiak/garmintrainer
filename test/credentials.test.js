'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCredentialVault } = require('../libs/credentials');

function keyFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-vault-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'encryption.key');
}

test('cifratura: nonce casuali, chiave persistente e separazione per account e campo', t => {
  const filename = keyFile(t);
  const vault = createCredentialVault(filename);
  const text = 'test-only-private-value';
  const encrypted = vault.encrypt(text, 'user-a:email');
  assert.notEqual(vault.encrypt(text, 'user-a:email'), encrypted);
  assert.ok(!encrypted.includes(text));
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const reopened = createCredentialVault(filename);
  assert.equal(reopened.decrypt(encrypted, 'user-a:email'), text);
  assert.throws(() => reopened.decrypt(encrypted, 'user-b:email'));
  assert.throws(() => reopened.decrypt(encrypted, 'user-a:username'));
  assert.notEqual(vault.fingerprint(text, 'username'), vault.fingerprint(text, 'email'));
  assert.equal(vault.fingerprint(text, 'email'), reopened.fingerprint(text, 'email'));
});

test('perdita della chiave: nessuna sostituzione durante la decifratura', t => {
  const filename = keyFile(t);
  const encrypted = createCredentialVault(filename).encrypt('private', 'user:garminKey');
  fs.renameSync(filename, `${filename}.backup`);
  const vault = createCredentialVault(filename);
  assert.throws(() => vault.decrypt(encrypted, 'user:garminKey'), /Ripristina/);
  assert.equal(fs.existsSync(filename), false);
  fs.renameSync(`${filename}.backup`, filename);
  assert.equal(vault.decrypt(encrypted, 'user:garminKey'), 'private');
});

test('chiavi non valide e cifrature manomesse vengono rifiutate', t => {
  const filename = keyFile(t);
  const vault = createCredentialVault(filename);
  const encrypted = vault.encrypt('private', 'user:email');
  const parts = encrypted.split('.');
  const tag = Buffer.from(parts[1], 'base64'); tag[0] ^= 1; parts[1] = tag.toString('base64');
  assert.throws(() => vault.decrypt(parts.join('.'), 'user:email'));
  fs.writeFileSync(filename, 'invalid key');
  assert.throws(() => createCredentialVault(filename).encrypt('private', 'user:email'), /non valida/);
});
