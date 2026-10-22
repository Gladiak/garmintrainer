"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY } = require('./helpers');
const values = { firstName: 'Ada', lastName: 'Rossi', primarySport: 'running' };
const session = { title: 'Allenamento personale', sport: 'running', date: '2026-10-22', durationMinutes: 40 };
const SECOND_KEY = 'test-second-personal-key';
const THIRD_KEY = 'test-replacement-personal-key';

test('HTTP richiede login e ignora identità fornite dal browser', async t => {
  const { raw, register, provider } = await accountApplication(t);
  const a = await register(values);
  for (const endpoint of ['/profile', '/dashboard', '/sessions', '/garmin/auth/status']) {
    assert.equal((await raw(endpoint, { headers: { 'X-Profile-Id': a.profile.id } })).status, 401);
  }
  const dashboard = await (await a.api('/dashboard')).json();
  assert.equal(dashboard.profile.id, a.profile.id);
  assert.equal(dashboard.profiles, undefined);
  assert.equal(provider.state.tokenRequests, 0);
  for (const [endpoint, method] of [['/profiles','GET'], ['/profiles','POST'], [`/profiles/${a.profile.id}`,'DELETE']]) {
    assert.equal((await a.api(endpoint, { method })).status, 404);
  }
});

test('un profilo per account: creazione, metadati privati e isolamento delle sessioni', async t => {
  const { register, provider } = await accountApplication(t);
  const a = await register({ ...values, apiKey: TEST_API_KEY });
  const b = await register({ ...values, firstName: 'Bruno' });
  const saved = await (await a.api('/sessions', { method: 'POST', body: session })).json();
  const foreignHeaders = { 'X-Profile-Id': a.profile.id };
  const dashboard = await (await b.api('/dashboard', { headers: foreignHeaders })).json();
  assert.equal(dashboard.profile.id, b.profile.id);
  assert.deepEqual(dashboard.sessions, []);
  for (const method of ['PATCH', 'DELETE']) {
    assert.equal((await b.api(`/sessions/${saved.id}`, { method, headers: foreignHeaders, body: method === 'PATCH' ? { status: 'completed' } : undefined })).status, 404);
  }
  assert.equal((await (await a.api('/sessions')).json()).sessions[0].status, 'planned');
  for (const endpoint of ['/profile', '/dashboard', '/garmin/auth/status']) {
    const body = await (await a.api(endpoint)).text();
    assert.ok(!body.includes(TEST_API_KEY)); assert.ok(!body.includes('garmin_key'));
  }
  assert.equal(provider.state.tokenRequests, 0);
});

test('cache e rotazione di una chiave restano isolate per account', async t => {
  const { register, manager, provider } = await accountApplication(t, { apiKeys: [TEST_API_KEY, SECOND_KEY, THIRD_KEY] });
  const a = await register({ ...values, apiKey: TEST_API_KEY });
  const b = await register({ ...values, apiKey: SECOND_KEY });
  const ca = (await manager.getClient(a.profile.id)); const cb = (await manager.getClient(b.profile.id));
  await Promise.all(Array.from({ length: 20 }, () => ca.ensureToken()));
  await Promise.all(Array.from({ length: 20 }, () => cb.ensureToken()));
  assert.equal(provider.state.tokenRequests, 2);
  const bToken = await cb.getAccessToken();
  await a.api('/profile', { method: 'PATCH', body: { ...values, apiKey: THIRD_KEY } });
  assert.equal((await manager.getClient(a.profile.id)).getTokenStatus().cached, false);
  assert.strictEqual((await manager.getClient(b.profile.id)), cb);
  assert.equal((await a.api('/garmin/auth/ensure', { method: 'POST' })).status, 200);
  assert.equal(provider.state.requests.at(-1).authorization, `ApiKey ${THIRD_KEY}`);
  assert.equal(await cb.getAccessToken(), bToken);
  await a.api('/profile', { method: 'PATCH', body: { ...values, apiKey: null } });
  assert.equal((await (await a.api('/garmin/auth/status')).json()).configured, false);
  assert.equal((await a.api('/garmin/auth/ensure', { method: 'POST' })).status, 503);
});

test('rotazione durante emissione non pubblica lo stato di un vecchio token', async t => {
  const { register, manager, provider } = await accountApplication(t, { apiKeys: [TEST_API_KEY, SECOND_KEY], tokenDelayMs: 100 });
  const a = await register({ ...values, apiKey: TEST_API_KEY });
  const pending = a.api('/garmin/auth/ensure', { method: 'POST' });
  for (let n = 0; provider.state.tokenRequests === 0 && n < 200; n++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(provider.state.tokenRequests, 1);
  await a.api('/profile', { method: 'PATCH', body: { ...values, apiKey: SECOND_KEY } });
  assert.equal((await pending).status, 409);
  assert.equal((await manager.getClient(a.profile.id)).getTokenStatus().cached, false);
});
