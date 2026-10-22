"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { accountApplication, TEST_API_KEY } = require('./helpers');
const profileValues = { firstName: 'Test', lastName: 'Persona', primarySport: 'running', apiKey: TEST_API_KEY };
const session = { title: 'Corsa facile', sport: 'running', date: '2026-10-22', time: '18:30', durationMinutes: 45, notes: 'Ritmo comodo' };

test('dashboard e sessioni attraverso Express senza chiamate Garmin', async t => {
  const { register, provider } = await accountApplication(t);
  const a = await register(profileValues);
  const initial = await (await a.api('/dashboard')).json();
  assert.equal(initial.storage.type, 'mariadb');
  assert.equal(initial.measurements.state, 'not_imported'); assert.deepEqual(initial.measurements.daily, []);
  assert.deepEqual(initial.sessions, []);
  const created = await a.api('/sessions', { method: 'POST', body: session });
  assert.equal(created.status, 201);
  const saved = await created.json();
  const updated = await a.api(`/sessions/${saved.id}`, { method: 'PATCH', body: { status: 'completed' } });
  assert.equal((await updated.json()).status, 'completed');
  assert.equal((await (await a.api('/sessions')).json()).sessions[0].title, session.title);
  assert.equal((await a.api(`/sessions/${saved.id}`, { method: 'DELETE' })).status, 204);
  assert.equal(provider.state.tokenRequests, 0); assert.equal(provider.state.dataRequests, 0);
});

test('gli input non validi producono 400 e le sessioni inesistenti 404 dopo login', async t => {
  const { register } = await accountApplication(t);
  const a = await register(profileValues);
  const response = await a.api('/sessions', { method: 'POST', body: { ...session, durationMinutes: 0 } });
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVALID_INPUT');
  assert.equal((await a.api('/sessions/not-a-session', { method: 'DELETE' })).status, 404);
});
