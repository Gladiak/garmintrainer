'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY } = require('./helpers');

const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const languages = ['en', 'it', 'fr', 'es', 'de'];

test('language is account scoped and does not invalidate Garmin credentials', async t => {
  const { register, manager, database, provider } = await accountApplication(t);
  const a = await register({ ...values, apiKey: TEST_API_KEY });
  const b = await register({ ...values, language: 'it' });
  const client = (await manager.getClient(a.profile.id));
  for (const language of languages) {
    const updated = await a.api('/profile', { method: 'PATCH', body: { ...values, language } });
    assert.equal(updated.status, 200); assert.equal((await updated.json()).language, language);
    assert.strictEqual((await manager.getClient(a.profile.id)), client);
  }
  await a.api('/profile', { method: 'PATCH', body: values });
  assert.equal((await (await a.api('/dashboard')).json()).profile.language, 'de');
  assert.equal((await (await b.api('/profile')).json()).language, 'it');
  for (const language of [null, '', 'xx', [], 42]) {
    const invalid = await a.api('/profile', { method: 'PATCH', body: { ...values, firstName: 'Do not save', language } });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error.code, 'INVALID_LANGUAGE');
    assert.equal(database.getProfile(a.profile.id).firstName, 'Ada');
  }
  assert.equal(database.getGarminCredential(a.profile.id).apiKey, TEST_API_KEY);
  assert.equal(provider.state.tokenRequests, 0);
});

test('HTTP validation errors can be translated again after a live language switch', async t => {
  const { register, base } = await accountApplication(t);
  const a = await register(values);
  const { request, setCsrfToken } = await import('../frontend/src/lib/api.js');
  const { setLanguage, messageText } = await import('../frontend/src/lib/i18n.js');
  const nativeFetch = global.fetch;
  global.fetch = (url, options = {}) => nativeFetch(new URL(url, base), { ...options, headers: { ...options.headers, Cookie: a.headers.Cookie } });
  setCsrfToken(a.csrfToken);
  t.after(() => { global.fetch = nativeFetch; setLanguage('en'); setCsrfToken(null); });
  setLanguage('en');
  let failure;
  try { await request('/profile', { method: 'PATCH', body: { ...values, firstName: '' } }); } catch (error) { failure = error; }
  assert.equal(failure.status, 400); assert.equal(failure.translationKey, 'errors.profileName');
  assert.match(messageText(failure), /First and last name/);
  setLanguage('it'); assert.match(messageText(failure), /Nome e cognome/);
  setLanguage('fr'); assert.match(messageText(failure), /prénom et le nom/);
});
