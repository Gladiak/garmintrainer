'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createGarminVault } = require('../helpers/garmin-vault');

test('measurement encryption hides values/dates and authenticates user, connection and row', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-health-key-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'key');
  fs.writeFileSync(filename, randomBytes(32), { mode: 0o600 });
  const vault = createGarminVault(filename);
  const value = { date: '2026-10-22', hrv: 48 };
  const encrypted = vault.encrypt('alice', 'connection:sleep:day1', value);
  assert.ok(!encrypted.includes('2026-10-22')); assert.ok(!encrypted.includes('hrv'));
  assert.notEqual(encrypted, vault.encrypt('alice', 'connection:sleep:day1', value), 'fresh random nonce');
  assert.deepEqual(createGarminVault(filename).decrypt('alice', 'connection:sleep:day1', encrypted), value);
  for (const [user, context] of [['bob', 'connection:sleep:day1'], ['alice', 'connection:sleep:day2'], ['alice', 'other:sleep:day1']]) {
    assert.throws(() => vault.decrypt(user, context, encrypted));
  }
  assert.notEqual(vault.lookup('alice', 'date:connection', value.date), vault.lookup('bob', 'date:connection', value.date));
  assert.throws(() => createGarminVault(path.join(directory, 'missing')));
});
