'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication } = require('./helpers');
const { hashPassword, verifyPassword } = require('../libs/auth');

test('password: salt casuale, verifica e nessun testo in chiaro', async () => {
  const password = 'a test-only long passphrase';
  const a = await hashPassword(password); const b = await hashPassword(password);
  assert.notEqual(a, b); assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword('wrong password', a), false);
});

test('registrazione, onboarding persistente, login e logout con cookie protetto', async t => {
  const { register, raw } = await accountApplication(t);
  const a = await register();
  assert.equal(a.profile.needsCompletion, true); assert.equal(a.profile.language, 'en');
  assert.deepEqual((await (await a.api('/auth/session')).json()).profile, a.profile);
  assert.equal((await a.api('/auth/logout', { method: 'POST' })).status, 204);
  assert.equal((await a.api('/dashboard')).status, 401);
  const login = await raw('/auth/login', { method: 'POST', body: { username: a.username.toUpperCase(), password: a.password } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const session = await login.json();
  assert.equal(session.profile.id, a.profile.id); assert.equal(session.profile.needsCompletion, true);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
  const completed = await raw('/profile', { method: 'PATCH', headers, body: { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running', language: 'it' } });
  assert.equal(completed.status, 200); assert.equal((await completed.json()).needsCompletion, false);
  assert.equal((await (await raw('/auth/session', { headers })).json()).profile.needsCompletion, false);
  assert.ok(!JSON.stringify(session).includes('passwordHash')); assert.ok(!JSON.stringify(session).includes(a.password));
  // Rotation revokes an old session when signing in again from the same browser.
  const rotated = await raw('/auth/login', { method: 'POST', headers, body: { username: a.username, password: a.password } });
  assert.equal(rotated.status, 200);
  assert.equal((await raw('/auth/session', { headers })).status, 401);
  assert.equal((await rotated.json()).profile.language, 'it');
});

test('validazione, duplicati case insensitive e credenziali errate', async t => {
  const { raw, register } = await accountApplication(t);
  const valid = { username: 'new-user', email: 'new@example.test', password: 'a sufficiently long password', passwordConfirmation: 'a sufficiently long password' };
  for (const [field, value, code] of [['username','x','INVALID_USERNAME'], ['email','invalid','INVALID_EMAIL'], ['password','short','INVALID_PASSWORD'], ['passwordConfirmation','different','PASSWORD_MISMATCH']]) {
    const response = await raw('/auth/register', { method: 'POST', body: { ...valid, [field]: value } });
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, code);
  }
  const a = await register();
  for (const duplicate of [{ ...valid, username: a.username.toUpperCase() }, { ...valid, email: a.user.email.toUpperCase() }]) {
    const response = await raw('/auth/register', { method: 'POST', body: duplicate });
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'ACCOUNT_EXISTS');
  }
  for (const username of [a.username, 'does-not-exist']) {
    const response = await raw('/auth/login', { method: 'POST', body: { username, password: 'wrong passphrase' } });
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'LOGIN_FAILED');
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('mutazioni richiedono CSRF e rifiutano origini esterne anche prima del login', async t => {
  const { raw, register } = await accountApplication(t);
  const a = await register();
  for (const headers of [{ Cookie: a.headers.Cookie }, { ...a.headers, 'X-CSRF-Token': 'wrong' }, { ...a.headers, Origin: 'https://evil.example' }, { ...a.headers, 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await raw('/profile/theme', { method: 'PATCH', headers, body: { theme: 'ocean-gold' } })).status, 403);
    assert.equal((await raw('/auth/logout', { method: 'POST', headers })).status, 403);
  }
  assert.equal((await raw('/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { username: a.username, password: a.password } })).status, 403);
  assert.equal((await a.api('/auth/session')).status, 200);
});

test('limita i tentativi di autenticazione e comunica quando riprovare', async t => {
  const { raw } = await accountApplication(t);
  // Validation failures also consume the budget without expensive hashes.
  for (let i = 0; i < 30; i++) assert.equal((await raw('/auth/register', { method: 'POST', body: {} })).status, 400);
  const limited = await raw('/auth/login', { method: 'POST', body: {} });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
