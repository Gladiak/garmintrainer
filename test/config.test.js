'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readConfig } = require('../libs/config');

test('configurazione Docker: password letta dal file segreto e impostazioni esplicite', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-secret-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'db_password');
  fs.writeFileSync(filename, 'test-only-password\n', { mode: 0o600 });
  const config = readConfig({ HOST: '0.0.0.0', DB_HOST: 'db', DB_PORT: '3306', DB_PASSWORD_FILE: filename, COOKIE_SECURE: 'true' });
  assert.equal(config.database.host, 'db'); assert.equal(config.database.port, 3306);
  assert.equal(config.database.password, 'test-only-password'); assert.equal(config.cookieSecure, true);
  assert.throws(() => readConfig({ DB_PASSWORD_FILE: path.join(directory, 'missing') }), { code: 'ENOENT' });
});

test('proxy VPS: hop esplicito e validato; header inoltrati ignorati in locale', () => {
  assert.equal(readConfig({}).trustProxyHops, 0);
  assert.equal(readConfig({ TRUST_PROXY_HOPS: '1' }).trustProxyHops, 1);
  for (const value of ['2', '-1', 'true', '1.5']) {
    assert.throws(() => readConfig({ TRUST_PROXY_HOPS: value }), /TRUST_PROXY_HOPS/);
  }
});
